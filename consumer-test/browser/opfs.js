import init, { BrowserDb } from '@minigraf/browser'

const checks = []
function check(ok, label) {
  if (!ok) throw new Error(label)
  checks.push(label)
}
function worker() {
  const instance = new Worker('./opfs-worker.js', { type: 'module' })
  let next = 0
  let acknowledge = () => {}
  let importing = () => {}
  const pending = new Map()
  const ready = new Promise((resolve, reject) => {
    instance.onerror = (event) => reject(new Error(event.message))
    instance.onmessage = ({ data }) => {
      if (data.event === 'ready') resolve()
      else if (data.event === 'ack') acknowledge(data.sequence)
      else if (data.event === 'import-start') importing()
      else {
        const waiter = pending.get(data.id)
        if (!waiter) return
        pending.delete(data.id)
        if (data.error) waiter.reject(new Error(data.error))
        else waiter.resolve(data.value)
      }
    }
  })
  return {
    ready,
    onAck(fn) { acknowledge = fn },
    onImport(fn) { importing = fn },
    async call(op, args = {}) {
      await ready
      return new Promise((resolve, reject) => {
        const id = ++next
        pending.set(id, { resolve, reject })
        instance.postMessage({ id, op, ...args })
      })
    },
    stop() {
      instance.terminate()
      for (const waiter of pending.values()) waiter.reject(new Error('worker terminated'))
      pending.clear()
    },
  }
}
async function run() {
  await init()
  let mainError
  try { await BrowserDb.openOpfs('main-thread') } catch (e) { mainError = String(e) }
  check(mainError?.startsWith('[API-026]'), 'main-thread open rejects with API-026')

  const first = worker(), second = worker()
  try {
    const name = `consumer-${crypto.randomUUID()}`
    await first.call('open', { name })
    await first.call('write')
    let lockError
    try { await second.call('open', { name }) } catch (e) { lockError = e.message }
    check(lockError?.startsWith('[STG-026]'), 'another worker gets STG-026')
    await first.call('close')
    await second.call('open', { name })
    check(JSON.stringify(await second.call('names')) === '[["Alice"]]', 'close releases lock and acknowledged write reopens')
    await second.call('close')
    await first.call('open', { name })
    first.stop()
    // Handle release following worker termination is asynchronous in some engines.
    await reopen(second, name)
    check(JSON.stringify(await second.call('names')) === '[["Alice"]]', 'worker termination preserves acknowledged write and releases lock')
    await second.call('close')
    check(JSON.stringify(await second.call('indexeddb', { name })) === '[["Alice"]]', 'IndexedDB write/checkpoint/reopen in a dedicated worker')
  } finally {
    first.stop()
    second.stop()
  }

  // The page observes each ack before scheduling termination. Recovery may
  // include additional commits whose ack was in flight when the worker died.
  const delays = [0, 1, 3, 7, 15, 31]
  for (const delay of delays) {
    const writer = worker(), reader = worker()
    let acknowledged = 0
    const name = `termination-${crypto.randomUUID()}`
    try {
      await writer.call('open', { name })
      await new Promise((resolve, reject) => {
        let armed = false
        writer.onAck((sequence) => {
          if (sequence !== acknowledged + 1) reject(new Error('ack sequence has a gap'))
          acknowledged = sequence
          if (acknowledged >= 3 && !armed) {
            armed = true
            setTimeout(() => { writer.stop(); resolve() }, delay)
          }
        })
        writer.call('stream').catch((e) => {
          if (e.message !== 'worker terminated') reject(e)
        })
      })
      await reopen(reader, name)
      const recovered = await reader.call('prefix')
      check(recovered.rows.length >= acknowledged, `termination ${delay}ms retains all ${acknowledged} observed acks`)
      check(recovered.rows.length === recovered.sequences && recovered.rows.length === recovered.markers,
        `termination ${delay}ms has no partial transaction`)
      check(recovered.rows.every(([sequence, complete], i) => sequence === i + 1 && complete === true),
        `termination ${delay}ms recovers a gap-free prefix (${recovered.rows.length} commits)`)
      await reader.call('close')
    } finally {
      writer.stop()
      reader.stop()
    }
  }
  for (const delay of [0, 1, 5, 20]) {
    const writer = worker(), reader = worker()
    const name = `import-termination-${crypto.randomUUID()}`
    try {
      const bytes = await writer.call('replacement')
      await writer.call('open', { name })
      await writer.call('write')
      await new Promise((resolve, reject) => {
        writer.onImport(() => setTimeout(() => { writer.stop(); resolve() }, delay))
        writer.call('import', { bytes }).catch((e) => {
          if (e.message !== 'worker terminated') reject(e)
        })
      })
      await reopen(reader, name)
      const names = (await reader.call('names')).map(([value]) => value).sort()
      const oldImage = JSON.stringify(names) === '["Alice"]'
      const newImage = JSON.stringify(names) === JSON.stringify(Array.from({ length: 1000 }, (_, i) => `new-${i}`).sort())
      check(oldImage || newImage, `import termination ${delay}ms recovers the complete old or new image`)
      await reader.call('close')
    } finally {
      writer.stop()
      reader.stop()
    }
  }
  const example = new Worker('./opfs-example-worker.js', { type: 'module' })
  try {
    const names = await new Promise((resolve, reject) => {
      example.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data.names)
      example.onerror = (event) => reject(new Error(event.message))
      example.postMessage({ name: `readme-${crypto.randomUUID()}` })
    })
    check(JSON.stringify(names) === '[["Alice"]]', 'README module-worker example')
  } finally { example.terminate() }
  return checks
}
async function reopen(client, name) {
  // Retry only the transient lock while the terminated worker is being torn
  // down. A recovery error must fail immediately, never be hidden by a retry.
  for (let attempt = 0; ; attempt++) {
    try { await client.call('open', { name }); return } catch (e) {
      if (!e.message.startsWith('[STG-026]') || attempt >= 1000) throw e
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
}
run().then((checks) => { window.__result = { checks } })
  .catch((error) => { window.__result = { error: String(error), checks } })
