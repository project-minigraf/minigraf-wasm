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

### Not available in the browser

`BrowserDb` keeps its pages in memory and writes them to IndexedDB; it has no `.graph`
file, WAL or file lock. So the file-backed options of the other bindings
(`read_only`, `allow_unlocked`, `page_cache_size`, the WAL options) do not apply, and
the raw log writer (`LogWriter`) is not built for wasm32. The fact log is not exposed
in the browser. To move data between a browser and a native database, use
`exportGraph()` / `importGraph()`.

## WASI (`@minigraf/wasi`)

```js
import { instantiateMinigrafWasiWith } from '@minigraf/wasi'
import { WASI } from 'node:wasi'

const wasi = new WASI({ version: 'preview1' })
const instance = await instantiateMinigrafWasiWith(wasi)
// Use the WebAssembly instance exports
```

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
