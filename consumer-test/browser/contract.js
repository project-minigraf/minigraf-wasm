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

  // Prepared query (minigraf#181): parse once, run with plain and typed values.
  await mem.execute('(transact [[:bob :name "Bob"] [:bob :age 41]])')
  const pq = mem.prepare('(query [:find ?n :where [?e :age $age] [?e :name ?n]])')
  check(JSON.stringify(JSON.parse(pq.execute({ age: 30 })).results) === '[["Alice"]]', 'prepared query with a number')
  check(JSON.stringify(JSON.parse(pq.execute({ age: 41n })).results) === '[["Bob"]]', 'prepared query with a bigint')
  check(JSON.stringify(JSON.parse(pq.execute({ age: { type: 'integer', value: 30 } })).results) === '[["Alice"]]', 'prepared query with a typed value')
  let missing
  try {
    pq.execute({})
  } catch (e) {
    missing = e
  }
  check(typeof missing === 'string' && missing.startsWith('[API-022] '), `a missing slot is API-022 (${missing})`)

  // Sets (minigraf#316): a set value comes back as an array, and binds as a
  // JS Set or the typed form.
  await mem.execute('(transact [[:alice :tags #{1 "x"}]])')
  const tags = JSON.parse(await mem.execute('(query [:find ?t :where [?e :tags ?t]])')).results
  check(JSON.stringify(tags) === '[[["x",1]]]', `a set value comes back as an array (${JSON.stringify(tags)})`)
  const member = mem.prepare('(query [:find ?n :where [?e :tags ?t] [(in? 1 $s)] [?e :name ?n]])')
  check(JSON.stringify(JSON.parse(member.execute({ s: new Set([1, 2]) })).results) === '[["Alice"]]', 'a JS Set binds')
  check(JSON.stringify(JSON.parse(member.execute({ s: { type: 'set', value: [3] } })).results) === '[]', 'a typed set binds')

  // User functions (minigraf#180): each value arrives as { type, value }, an
  // integer's value a bigint; a function that throws fails the query, QRY-014.
  await mem.execute('(transact [[:carol :name "Carol"] [:carol :age 12]])')
  mem.registerPredicate('adult?', (v) => v.type === 'integer' && v.value >= 18n)
  const adults = JSON.parse(await mem.execute('(query [:find ?n :where [?e :age ?a] [(adult? ?a)] [?e :name ?n]])')).results
  check(JSON.stringify(adults.map((r) => r[0]).sort()) === '["Alice","Bob"]', `a registered predicate (${JSON.stringify(adults)})`)
  mem.registerAggregate('product', {
    init: () => 1n,
    step: (acc, v) => acc * v.value,
    finish: (acc, count) => (count === 3 ? acc : -1n),
  })
  const product = JSON.parse(await mem.execute('(query [:find (product ?a) :where [?e :age ?a]])')).results
  check(JSON.stringify(product) === '[[14760]]', `a registered aggregate (${JSON.stringify(product)})`)
  mem.registerPredicate('boom?', () => {
    throw new Error('boom')
  })
  let thrown
  try {
    await mem.execute('(query [:find ?n :where [?e :age ?a] [(boom? ?a)] [?e :name ?n]])')
  } catch (e) {
    thrown = e
  }
  check(thrown === '[QRY-014] user function `boom?` failed: boom', `a function that throws is QRY-014 (${thrown})`)

  // Error type: a rejected promise whose reason starts with the error code,
  // as on every other API ("[PRS-011] Unknown command: nosuchcommand").
  let reason
  try {
    await mem.execute('(nosuchcommand [])')
  } catch (e) {
    reason = e
  }
  check(typeof reason === 'string' && /^\[PRS-011\] .*nosuchcommand/.test(reason), `the error carries its code (${reason})`)

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
