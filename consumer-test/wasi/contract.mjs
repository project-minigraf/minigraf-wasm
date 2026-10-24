// Consumer contract for @minigraf/wasi, run against the installed package:
// usage: node contract.mjs <expected version>
//
// The package is the REPL over an in-memory database (the WASI binary takes no
// --file), so there is no file-backed reopen to check.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const expected = process.argv[2];
const require = createRequire(import.meta.url);

// Installed version.
const { version } = require("@minigraf/wasi/package.json");
assert.equal(version, expected, `@minigraf/wasi is ${version}, not ${expected}`);
console.log(`installed @minigraf/wasi ${version}`);

function repl(lines) {
  const r = spawnSync(process.execPath, ["repl.mjs"], {
    input: lines.join("\n") + "\n",
    encoding: "utf8",
  });
  assert.equal(r.status, 0, `repl.mjs exited ${r.status}: ${r.stderr}`);
  // Node prints an ExperimentalWarning for node:wasi; the rest is the REPL's.
  const stderr = r.stderr
    .split("\n")
    .filter((l) => !/ExperimentalWarning: WASI|node --trace-warnings/.test(l))
    .join("\n")
    .trim();
  return { stdout: r.stdout, stderr };
}

// In memory: a transact and a query.
{
  const r = repl([
    '(transact [[:alice :name "Alice"] [:alice :age 30]])',
    "(query [:find ?n ?a :where [?e :name ?n] [?e :age ?a]])",
  ]);
  assert.match(r.stdout, /Transacted successfully/, "no transact result");
  assert.match(r.stdout, /^"?Alice"?\t30$/m, "query did not return Alice 30");
  assert.equal(r.stderr, "", "unexpected stderr");
  console.log("ok: in-memory transact and query");
}

// Sets (minigraf#316): a set literal is stored and printed back, and in? filters.
{
  const r = repl([
    '(transact [[:alice :tags #{1 "x"}]])',
    "(query [:find ?t :where [?e :tags ?t]])",
    "(query [:find ?t :where [?e :tags ?t] [(in? 2 ?t)]])",
  ]);
  assert.match(r.stdout, /^#\{"?x"? 1\}$/m, `the set did not come back: ${r.stdout}`);
  assert.match(r.stdout, /No results found/, "in? kept a row without 2");
  assert.equal(r.stderr, "", "unexpected stderr");
  console.log("ok: set values");
}

// Error type: an invalid command is reported with its code, and the REPL goes on.
{
  const r = repl(["(nosuchcommand [])", "(query [:find ?n :where [?e :name ?n]])"]);
  assert.match(r.stderr, /^Error: \[[A-Z]{3}-\d{3}\] /m, `no coded error: ${r.stderr}`);
  assert.match(r.stdout, /No results found/, "the REPL stopped after the error");
  console.log("ok: the error carries its code");
}
