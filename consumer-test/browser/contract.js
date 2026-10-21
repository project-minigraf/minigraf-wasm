// Consumer contract for @minigraf/browser, run by driver.mjs in two loads of
// contract.html: the first writes to an IndexedDB database, the driver reloads
// the page, and the second reads it back.
import init, { BrowserDb } from '@minigraf/browser'

const checks = []
const check = (ok, what) => {
  if (!ok) throw new Error(`failed: ${what}`)
  checks.push(what)
}

async function run() {
  await init()

  // Installed version, from the package the import map points at.
  const pkg = await (await fetch('/node_modules/@minigraf/browser/package.json')).json()
  const expected = new URL(location.href).searchParams.get('version')
  check(pkg.version === expected, `installed @minigraf/browser ${pkg.version}, expected ${expected}`)

  // In memory.
  const mem = BrowserDb.openInMemory()
  await mem.execute('(transact [[:alice :name "Alice"] [:alice :age 30]])')
  const rows = JSON.parse(await mem.execute('(query [:find ?n ?a :where [?e :name ?n] [?e :age ?a]])')).results
  check(JSON.stringify(rows) === '[["Alice",30]]', 'in-memory transact and query')

  // Error type: a rejected promise with a string reason. It should carry the
  // error code ("[PRS-001] ..."), but BrowserDb drops it (minigraf#673); check
  // for the code once the pinned core has the fix.
  let reason
  try {
    await mem.execute('(nosuchcommand [])')
  } catch (e) {
    reason = e
  }
  check(typeof reason === 'string' && /nosuchcommand/.test(reason), `an invalid command rejects with its message (${reason})`)

  // IndexedDB-backed: survives a page reload.
  const db = await BrowserDb.open('contract')
  const query = '(query [:find ?n :where [?e :name ?n]])'
  if (sessionStorage.getItem('written') === null) {
    await db.execute('(transact [[:bob :name "Bob"]])')
    sessionStorage.setItem('written', '1')
    return { phase: 'written', checks }
  }
  const names = JSON.parse(await db.execute(query)).results
  check(JSON.stringify(names) === '[["Bob"]]', 'IndexedDB database survives a page reload')
  return { phase: 'read', checks }
}

window.__result = await run().catch((e) => ({ error: String(e?.stack ?? e), checks }))
