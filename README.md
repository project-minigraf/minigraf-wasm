# minigraf (WebAssembly)

WebAssembly builds of [Minigraf](https://github.com/project-minigraf/minigraf) — zero-config,
single-file, embedded bi-temporal graph database with Datalog queries.

Two packages are published from this repo:

| Package | Target | Install |
|---------|--------|---------|
| [`@minigraf/browser`](https://www.npmjs.com/package/@minigraf/browser) | Browser (wasm-bindgen) | `npm install @minigraf/browser` |
| [`@minigraf/wasi`](https://www.npmjs.com/package/@minigraf/wasi) | Node.js / WASI runtimes | `npm install @minigraf/wasi` |

## Browser (`@minigraf/browser`)

```js
import init, { BrowserDb } from '@minigraf/browser'

await init()

const db = await BrowserDb.open('mydb')   // IndexedDB-backed; BrowserDb.openInMemory() for tests
await db.execute('(transact [[:alice :name "Alice"]])')

const result = JSON.parse(await db.execute('(query [:find ?n :where [?e :name ?n]])'))
console.log(result.results[0][0])  // "Alice"
```

### Query cursors

`db.query(datalog)` returns a `BrowserCursor` whose answer is fixed when it opens.
`nextBatch(n)` returns up to `n` rows as a JSON array (encoded like `execute()`'s
`results`), or `undefined` at the end; `close()` releases it. A `transact`, `retract`
or `rule` throws `[API-012]`.

```js
const cursor = db.query('(query [:find ?n :where [?e :name ?n]])')
try {
  let batch
  while ((batch = cursor.nextBatch(1000)) !== undefined) {
    for (const row of JSON.parse(batch)) console.log(row)
  }
} finally {
  cursor.close()
}
```

### Prepared queries

`db.prepare(datalog)` parses a query once and returns a `BrowserPreparedQuery`;
`execute(bindings)` returns the JSON `execute()` returns, and `query(bindings)` a
`BrowserCursor`. Both are synchronous. Bindings are an object of slot name (without the
`$`) to a boolean, a string, `null`, a `bigint` or a `number` (an integer when
`Number.isInteger` accepts it, else a float), or a typed `{ type, value }` form:
`{ type: 'float', value: 2 }`, `'keyword'`, `'ref'`, `{ type: 'entity', value: uuid }`,
`{ type: 'txCount' | 'timestamp', value }` for `:as-of`, and `{ type: 'anyValidTime' }`
for `:valid-at`. A value that is not a bind value throws a `TypeError`; a missing slot
throws `[API-022]`, a slot in an attribute position `[API-023]`, and a value of the wrong
kind `[API-024]`.

```js
const pq = db.prepare('(query [:find ?n :where [?e :age $age] [?e :name ?n]])')
JSON.parse(pq.execute({ age: 30 })).results
```

`withMaxDerivedFacts(n)`, `withQueryMemoryLimit(bytes)` and `withMaxIterations(n)` each
return a new `BrowserPreparedQuery` with that limit; the one they are called on is
unchanged, and the new one keeps the database open as it does. An allowed keyword in
the query text still overrides them. The argument is a non-negative integer `number`; at
or above 2^32 − 1 (the browser's largest `usize`) it means no limit, and a negative,
fractional or non-finite number throws `[API-017]`. These setters are the browser's way
to set a query memory limit: `BrowserDb` takes no options, so the default override list
applies and `:query-memory-limit` in query text throws `[API-025]`.

```js
const reach = db.prepare('(query [:find ?x ?y :where (reach ?x ?y)])')
const small = reach.withMaxDerivedFacts(10000).withQueryMemoryLimit(16 * 1024 * 1024)
small.execute({}) // [INT-020] or [QRY-012] past a limit; reach is unchanged
```

### User functions

`db.registerPredicate(name, fn)` adds a predicate, called in a query as `[(name ?v)]`.
`db.registerAggregate(name, { init, step, finish })` adds an aggregate, used in `:find`
as `(name ?v)` and as a window function with `:over`: `init()` returns a new
accumulator (one per group or window partition), `step(acc, value)` returns the
accumulator after `value`, and `finish(acc, count)` returns the result, `count` being
the number of values stepped. All are called as plain functions, with no `this`.

```js
db.registerPredicate('adult?', (v) => v.type === 'integer' && v.value >= 18n)
db.registerAggregate('product', {
  init: () => 1n,
  step: (acc, v) => acc * v.value,
  finish: (acc) => acc,
})
await db.execute('(query [:find ?n :where [?e :age ?a] [(adult? ?a)] [?e :name ?n]])')
await db.execute('(query [:find (product ?a) :where [?e :age ?a]])')
```

- **Values.** A function receives each value as a `{ type, value }` object: `type` is
  `'string'`, `'integer'` (`value` a `bigint`), `'float'`, `'boolean'`, `'ref'` (an
  entity UUID string), `'keyword'`, `'null'` (no `value`) or `'set'` (`value` an array
  of these). A predicate returns a boolean. `finish` returns a value in any form a
  prepared query's bindings accept: a plain value or a typed `{ type, value }` form.
- **Errors.** A function that throws fails the query with `[QRY-014]`, carrying the
  error's `message` (else `String(e)`), and so does a predicate that returns anything
  but a boolean, or a `finish` whose result is not a value. Registration throws a
  `TypeError` when a function is missing, and `[INT-040]` when the name is taken.
- **Lifecycle.** Registration is synchronous. A query that is already open (a
  `BrowserCursor`) does not see a function registered after it; every query opened
  afterwards does. The database keeps each function until it, and every cursor and
  prepared query opened from it, are freed. There is no unregister.
- **Cost.** Each value is one call into JavaScript, so a function over many rows costs
  one call per value.
- **Calling the database from a function.** A function runs synchronously inside the
  query that calls it. From there `query`, `prepare` (and the prepared query's
  `execute`/`query`), `exportGraph`, `registerPredicate` and `registerAggregate` run at
  once. `execute`, `checkpoint` and `importGraph` return a Promise that starts only after
  the outer query has returned, so the function cannot wait for it, and the outer query
  does not see its write.

### Write transactions

`db.beginWrite()` opens a write transaction (minigraf#824; first in the release built on
core v3.0.0, core commit `32d71ce0`). It stages several `transact`, `retract` and
`query` statements, with queries seeing what it staged, and then commits them as one
transaction or rolls them back:

```js
const tx = db.beginWrite()
try {
  tx.execute('(transact [[:alice :balance 70] [:bob :balance 80]])')
  const [[balance]] = JSON.parse(tx.execute('(query [:find ?b :where [:alice :balance ?b]])')).results
  if (balance >= 0) await tx.commit()
} finally {
  tx.rollback() // does nothing once committed
}
```

- `beginWrite()` takes no options. `tx.execute(datalog)` is synchronous and returns
  `execute`'s JSON; a staged write returns `{"ok":true}`, and a statement that throws
  stages nothing and leaves the transaction open. No cursors or prepared queries inside
  a transaction.
- `await tx.commit()` applies everything as one transaction at once (other code sees the
  facts as soon as `commit()` is called) and resolves after the IndexedDB write: the
  commit is durable when the promise resolves. There is no WAL. A failed IndexedDB write
  rejects it, as a failed `execute` write does. `tx.rollback()` discards the
  transaction, and so does freeing it while open (`tx.free()`).
- After a commit (successful or not) or a rollback the transaction is finished:
  `execute` and `commit` throw or reject with `[API-018]`; `rollback` does nothing.
- While it is open, every other call on its database that reads or writes (`execute`,
  `query`, `prepare`, `checkpoint`, `importGraph`, another `beginWrite`, a prepared
  query's `execute`/`query`) throws or rejects with `[INT-001]`, so other asynchronous
  code cannot mistake the database for the transaction. A cursor opened before keeps
  returning its rows. A user function its queries run gets `[INT-001]` the same way.
  End every transaction, in a `finally`: JavaScript's collector may never free it.
- Rules registered inside a transaction stay registered after a rollback.

### Not available in the browser

`BrowserDb` keeps its pages in memory and writes them to IndexedDB; it has no `.graph`
file, WAL or file lock. So the file-backed options of the other bindings
(`read_only`, `allow_unlocked`, `page_cache_size`, the WAL options) do not apply.
`BrowserDb` takes no open options at all: the override list (`allow_overrides`), the
query limits and `transaction_chunk_facts` keep their defaults, and a prepared query's
limits are set with its setters. The raw log writer (`LogWriter`) is not built for
wasm32, and the fact log is not exposed in the browser. To move data between a browser and a native database, use
`exportGraph()` / `importGraph()`.

## WASI (`@minigraf/wasi`)

The package is the Minigraf REPL compiled to `wasm32-wasip1`, not a library: it
reads Datalog commands from stdin and prints the results to stdout, over an
in-memory database. In `repl.mjs`:

```js
import { WASI } from "node:wasi";
import { startMinigrafWasi } from "@minigraf/wasi";

const wasi = new WASI({ version: "preview1", args: ["minigraf"], env: process.env });
await startMinigrafWasi(wasi);
```

```bash
printf '%s\n' '(transact [[:alice :name "Alice"]])' '(query [:find ?n :where [?e :name ?n]])' | node repl.mjs
```

Every command the REPL reads commits on its own, as one transaction, and a command that
fails leaves the ones before it committed. There are no explicit transactions (no
begin, commit or rollback commands, minigraf#824); for those, use `@minigraf/browser`
or another binding.

For the browser, or for a database that persists, use `@minigraf/browser`, or
[`minigraf`](https://www.npmjs.com/package/minigraf) in Node.js.

## Building from source

Requires Rust stable toolchain and `wasm-pack`.

```bash
# Browser target
wasm-pack build --target web --features browser

# WASI target
cargo build --target wasm32-wasip1 --release
```

## Cascade release

This repo receives a `core-release` repository_dispatch from the minigraf monorepo
cascade whenever a new version of the `minigraf` core crate is published. The release
workflow pins the new version, commits, tags, and publishes both npm packages.

## License

MIT OR Apache-2.0
