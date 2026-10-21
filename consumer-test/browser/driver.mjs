// Serves the consumer app (the pages and node_modules) over HTTP and runs the
// quick start and the contract pages in headless Chromium.
// usage: node driver.mjs <expected version>
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const expected = process.argv[2];
const root = process.cwd();
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".wasm": "application/wasm",
};

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
  try {
    const body = await readFile(join(root, path));
    res.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
let failed = false;
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => console.log(`  [page] ${m.text()}`));

  // Waits for the page's module to finish and returns window.__result.
  const result = async () => {
    await page.waitForFunction(() => window.__result !== undefined, null, { timeout: 60_000 })
      .catch(() => {
        throw new Error(`the page did not finish: ${errors.join("; ") || "no error reported"}`);
      });
    if (errors.length) throw new Error(errors.join("; "));
    return page.evaluate(() => window.__result);
  };

  await page.goto(`${origin}/quickstart.html`);
  const quick = await result();
  if (quick.name !== "Alice") throw new Error(`quick start printed ${quick.name}`);
  console.log("ok: README quick start");

  await page.goto(`${origin}/contract.html?version=${encodeURIComponent(expected)}`);
  const first = await result();
  if (first.error || first.phase !== "written") throw new Error(first.error ?? `phase ${first.phase}`);
  await page.reload();
  const second = await result();
  if (second.error || second.phase !== "read") throw new Error(second.error ?? `phase ${second.phase}`);
  for (const c of second.checks) console.log(`ok: ${c}`);
} catch (e) {
  console.error(`::error::${e.message}`);
  failed = true;
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
