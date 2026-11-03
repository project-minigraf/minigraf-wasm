import init, { BrowserDb } from '../pkg/minigraf_wasm.js'
import { cases } from './cases.mjs'

export async function run(test) {
  await init()
  const db = BrowserDb.openInMemory()
  const result = await cases(db, 'browser', test)
  db.free()
  // A fresh browser context per run isolates IndexedDB. Each write measures
  // one fixed-size commit on a fresh DB; creation is outside the timer.
  for (const suffix of ['indexeddb_write/1k', 'indexeddb_reopen/1k']) {
    const id = `binding/browser/${suffix}`
    const samples = []
    for (let i = 0; i < (test ? 1 : 10); i++) {
      const name = `${suffix}-${i}`
      let handle = await BrowserDb.open(name)
      const statement = '(transact [' + Array.from({ length: 1000 }, (_, j) => `[:e${j} :n ${j}]`).join(' ') + '])'
      if (suffix.startsWith('indexeddb_reopen')) {
        await handle.execute(statement)
        handle.free()
      }
      // No clock reads in --test, including persistence cases.
      const start = test ? 0 : performance.now()
      if (suffix.startsWith('indexeddb_write')) await handle.execute(statement)
      else handle = await BrowserDb.open(name)
      if (!test) samples.push((performance.now() - start) * 1e6)
      const count = JSON.parse(await handle.execute('(query [:find (count ?n) :where [?e :n ?n]])')).results
      if (JSON.stringify(count) !== '[[1000]]') throw new Error(`incorrect result: ${id}`)
      handle.free()
    }
    result.executed.push(id)
    if (!test) {
      samples.sort((a, b) => a - b)
      result.metrics[id] = { latency: { value: (samples[4] + samples[5]) / 2 } }
    }
  }
  return result
}
