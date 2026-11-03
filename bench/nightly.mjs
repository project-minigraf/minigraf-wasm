// Browser timings are collected in-page, never around Playwright RPC.
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { chromium } from 'playwright'
const root = process.cwd()
const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm' }
const server = createServer(async (req, res) => {
  const path = resolve(root, '.' + new URL(req.url, 'http://x').pathname)
  if (!path.startsWith(root + sep)) return res.writeHead(403).end()
  try { res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }); res.end(await readFile(path)) }
  catch { res.end() }
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
let browser
try {
  browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${server.address().port}/bench/index.html${process.argv.includes('--test') ? '?test' : ''}`)
  await page.waitForFunction(() => window.result !== undefined, null, { timeout: 120000 })
  const result = await page.evaluate(() => window.result)
  if (result.error) throw new Error(result.error)
  for (const id of result.executed) console.log(`ok: ${id}`)
  if (!process.argv.includes('--test')) await writeFile('binding-results.json', JSON.stringify(result.metrics, null, 2) + '\n')
} finally { await browser?.close(); server.close() }
