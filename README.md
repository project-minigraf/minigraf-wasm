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

const db = await BrowserDb.open('mydb')   // IndexedDB-backed; or BrowserDb.openInMemory() for tests
await db.execute('(transact [[:alice :name "Alice"]])')

const result = JSON.parse(await db.execute('(query [:find ?n :where [?e :name ?n]])'))
console.log(result.results[0][0])  // "Alice"
```

`execute()` returns a `Promise<string>` containing JSON:

- Query: `{"variables": [...], "results": [[...], ...]}`
- Transact: `{"transacted": <tx_id>}`
- Retract: `{"retracted": <tx_id>}`
- Rule: `{"ok": true}`

Other methods:

| Method | Description |
|--------|-------------|
| `BrowserDb.open(name)` | Open or create a database persisted in IndexedDB (async). |
| `BrowserDb.openInMemory()` | Open a non-persistent database. Data is lost when the page closes. |
| `db.exportGraph()` | Serialise the database to a `Uint8Array` that is byte-compatible with native `.graph` files. |
| `await db.importGraph(bytes)` | Replace the database with a `.graph` blob. The blob must be checkpointed, with no pending WAL sidecar. |
| `await db.checkpoint()` | Flush dirty pages to IndexedDB. You only need it after bulk operations; `execute()` already writes through. Does nothing on in-memory databases. |

`@minigraf/browser` does not run in Node.js. For server-side use, use [`minigraf`](https://www.npmjs.com/package/minigraf).

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
