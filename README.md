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
import init, { MiniGrafDb } from '@minigraf/browser'

await init()

const db = MiniGrafDb.inMemory()
db.execute('(transact [[:alice :name "Alice"]])')

const result = JSON.parse(db.execute('(query [:find ?n :where [?e :name ?n]])'))
console.log(result.results[0][0])  // "Alice"
```

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
