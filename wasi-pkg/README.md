# @minigraf/wasi

WASI WebAssembly package for Minigraf.

This package contains the `wasm32-wasip1` build of the Minigraf REPL as
`minigraf-wasi.wasm`, plus a small Node.js ESM loader. It is for server-side
WASM runtimes such as Wasmtime, Wasmer and Node's WASI support. The REPL reads
Datalog commands from stdin and prints the results to stdout, over an
in-memory database.

## Quick start

In `repl.mjs`:

```js
import { WASI } from "node:wasi";
import { startMinigrafWasi } from "@minigraf/wasi";

const wasi = new WASI({ version: "preview1", args: ["minigraf"], env: process.env });
await startMinigrafWasi(wasi);
```

```bash
printf '%s\n' '(transact [[:alice :name "Alice"]])' '(query [:find ?n :where [?e :name ?n]])' | node repl.mjs
```

Use `MINIGRAF_WASI_WASM_PATH` or the `wasmPath` option to point the loader at
an alternate `.wasm` file during tests or custom packaging.

## License

MIT OR Apache-2.0
