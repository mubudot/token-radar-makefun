#!/usr/bin/env node
// Capture the dashboard screenshots from a fresh build (dev tool, not part of the dashboard).
//   node tools/shoot.mjs [--input ../token-radar-01-kit/input/snapshot.json]
// Playwright is loaded from env PLAYWRIGHT_PKG (an index.mjs path).
// Steps: node main.ts -> out/, open out/dashboard/index.html at 1440x900, capture
//   1-board, 2-detail, 3-filtered. Lossless encoding enforces 300000–350000 bytes each.
// Only the operator runs capture. Encoder tests import shot-encoding.mjs without a browser.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { encodeScreenshot, SCREENSHOT_MIN_BYTES, SCREENSHOT_MAX_BYTES } from './shot-encoding.mjs';
import { imageInfo } from '../lib/images.ts';
import { DOSSIER_GATE_BYTES } from '../lib/output.ts';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const input = resolve(repo, arg('input', '../token-radar-01-kit/input/snapshot.json'));
const out = resolve(repo, arg('output', 'out'));
const shots = join(repo, 'screenshots');
const PW = process.env.PLAYWRIGHT_PKG || resolve(repo, '../shot-tools/node_modules/playwright/index.mjs');
const W = 1440, H = 900;
const COUNT = 3;

const build = () => execFileSync(process.execPath, [join(repo, 'main.ts'), '--input', input, '--output', out], { stdio: 'inherit' });
const size = p => statSync(p).size;

build();
const { chromium } = await import(pathToFileURL(PW).href);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1, colorScheme: 'dark' });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const url = pathToFileURL(join(out, 'dashboard', 'index.html')).href;
const tmp = mkdtempSync(join(tmpdir(), 'radar-shots-'));
const settle = async () => { await page.evaluate(() => document.fonts.ready); await page.mouse.move(W - 2, H - 2); await page.waitForTimeout(150); };
const snap = async name => { await settle(); const p = join(tmp, name + '.raw.png'); await page.screenshot({ path: p }); return [name, p]; };
const raws = [];

await page.goto(url);
await page.waitForSelector('#p-board tbody tr');
raws.push(await snap('1-board'));

// Detail: choose observed positive growth with substantial G and T effects.
const selected = await page.evaluate(() => {
  const row = RadarModel.buildRadar(RADAR_DATA).rows.find(r => r.watchlist &&
    r.change_7d > 0 && !r.model.time.imputed &&
    Math.abs(r.model.growth.factor - 1) >= 0.02 && Math.abs(r.model.time.factor - 1) >= 0.1);
  if (!row) throw new Error('No watchlist row with non-trivial observed G/T');
  return { slug: row.slug, name: row.name };
});
const slug = selected.slug;
await page.locator('#p-board tbody tr').filter({ hasText: selected.name }).first().click();
await page.waitForSelector('#drawer[open] .steps');
for (const label of ['7d growth %', 'Applied G', 'Days without token*', 'Applied T']) {
  const bounds = await page.getByText(label, { exact: true }).boundingBox();
  if (!bounds || bounds.y < 0 || bounds.y + bounds.height > H) throw new Error(label + ' is outside the detail capture');
}
raws.push(await snap('2-detail'));
await page.keyboard.press('Escape');

// Filtered: 7d>0 + min TVL $10M + the category/chain whose result best fills one screen (~18 rows),
// all set through the UI controls so chips and "Showing N of M" are the page's own.
const pick = await page.evaluate(() => {
  const R = RadarModel.buildRadar(RADAR_DATA), cat = RadarModel.categoryOf, opts = new Map();
  for (const r of R.rows) if (r.change_7d > 0 && r.tvl_usd >= 1e7) {
    for (const k of ['fcat:' + cat(r), ...r.chains.map(c => 'fchn:' + c)]) opts.set(k, (opts.get(k) || 0) + 1);
  }
  return [...opts].sort((a, b) => Math.abs(a[1] - 18) - Math.abs(b[1] - 18) || (a[0] < b[0] ? -1 : 1))[0][0].split(':');
});
await page.selectOption('#' + pick[0], pick[1]);
await page.click('#fpos');
await page.selectOption('#ftvl', '10000000');
const cat = pick.join('=');
await page.waitForSelector('#chips:not([hidden])');
raws.push(await snap('3-filtered'));
await page.click('#frst');

await browser.close();
if (errors.length) throw new Error('Page errors:\n' + errors.join('\n'));

if (raws.length !== COUNT) throw new Error('Exactly three captures required');
const encoded = [];
for (const [name, raw] of raws) encoded.push([name, await encodeScreenshot(readFileSync(raw))]);
mkdirSync(shots, { recursive: true });
for (const n of readdirSync(shots)) if (/\.(png|jpe?g)$/i.test(n)) rmSync(join(shots, n));
for (const [name, bytes] of encoded) {
  const dst = join(shots, name + '.png'), info = imageInfo(bytes);
  writeFileSync(dst, bytes);
  console.log(`${name}.png: ${bytes.length} bytes, ${info.width}×${info.height}, lossless`);
}
rmSync(tmp, { recursive: true, force: true });
console.log(`${COUNT} captures, window ${SCREENSHOT_MIN_BYTES}..${SCREENSHOT_MAX_BYTES}; detail ${slug}; filter "${cat}"`);
build();
if (size(join(out, 'dossier.json')) > DOSSIER_GATE_BYTES) throw new Error('Dossier exceeds 1.5 MiB');
