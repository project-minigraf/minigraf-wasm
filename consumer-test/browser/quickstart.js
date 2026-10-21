// The README quick start, verbatim (readme-sync checks it), loaded by
// quickstart.html through an import map, as a page without a bundler does.
import init, { BrowserDb } from '@minigraf/browser'

await init()

const db = await BrowserDb.open('mydb')   // IndexedDB-backed; BrowserDb.openInMemory() for tests
await db.execute('(transact [[:alice :name "Alice"]])')

const result = JSON.parse(await db.execute('(query [:find ?n :where [?e :name ?n]])'))
console.log(result.results[0][0])  // "Alice"

window.__result = { name: result.results[0][0] }
