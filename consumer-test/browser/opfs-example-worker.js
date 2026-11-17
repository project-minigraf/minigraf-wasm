import init, { BrowserDb } from '/node_modules/@minigraf/browser/minigraf_wasm.js'

const ready = init()
self.onmessage = async ({ data: { name } }) => {
  let db
  try {
    await ready
    db = await BrowserDb.openOpfs(name)
    await db.execute('(transact [[:alice :name "Alice"]])')
    const names = JSON.parse(await db.execute('(query [:find ?n :where [?e :name ?n]])')).results
    self.postMessage({ names })
  } catch (error) {
    self.postMessage({ error: String(error) })
  } finally {
    db?.close()
  }
}
