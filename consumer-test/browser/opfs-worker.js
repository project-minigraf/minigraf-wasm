// A real module worker consuming the installed package, without an import map.
import init, { BrowserDb } from '/node_modules/@minigraf/browser/minigraf_wasm.js'

await init()
let db
const rows = (query) => JSON.parse(db.prepare(query).execute({})).results

self.onmessage = async ({ data: { id, op, name, bytes } }) => {
  try {
    let value
    switch (op) {
      case 'open':
        db = await BrowserDb.openOpfs(name)
        value = true
        break
      case 'write':
        await db.execute('(transact [[:alice :name "Alice"]])')
        value = true
        break
      case 'names':
        value = rows('(query [:find ?n :where [?e :name ?n]])')
        break
      case 'close':
        db.close()
        value = true
        break
      case 'stream':
        for (let sequence = 1; sequence <= 10000; sequence++) {
          await db.execute(`(transact [[:commit-${sequence} :sequence ${sequence}] [:commit-${sequence} :complete true]])`)
          self.postMessage({ event: 'ack', sequence })
        }
        value = true
        break
      case 'prefix':
        value = {
          rows: rows('(query [:find ?s ?ok :where [?e :sequence ?s] [?e :complete ?ok] :order-by [?s :asc]])'),
          sequences: rows('(query [:find ?s :where [?e :sequence ?s]])').length,
          markers: rows('(query [:find ?ok :where [?e :complete ?ok]])').length,
        }
        break
      case 'indexeddb': {
        const indexed = await BrowserDb.open(name)
        await indexed.execute('(transact [[:alice :name "Alice"]])')
        await indexed.checkpoint()
        indexed.close()
        const reopened = await BrowserDb.open(name)
        value = JSON.parse(await reopened.execute('(query [:find ?n :where [?e :name ?n]])')).results
        reopened.close()
        break
      }
      case 'replacement': {
        const source = BrowserDb.openInMemory()
        const facts = Array.from({ length: 1000 }, (_, i) => `[:new-${i} :name "new-${i}"]`).join(' ')
        await source.execute(`(transact [${facts}])`)
        value = source.exportGraph()
        source.close()
        break
      }
      case 'import':
        self.postMessage({ event: 'import-start' })
        await db.importGraph(new Uint8Array(bytes))
        value = true
        break
      default:
        throw new Error(`unknown operation ${op}`)
    }
    self.postMessage({ id, value })
  } catch (error) {
    self.postMessage({ id, error: String(error) })
  }
}
self.postMessage({ event: 'ready' })
