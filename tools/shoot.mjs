#!/usr/bin/env node
// Capture the dashboard screenshots from a fresh build (dev tool, not part of the dashboard).
//   node tools/shoot.mjs [--input ../token-radar-01-kit/input/snapshot.json]
// Playwright is loaded from env PLAYWRIGHT_PKG (an index.mjs path); ImageMagick `convert` re-encodes.
// Steps: node main.ts -> out/, open out/dashboard/index.html at 1440x900, capture
//   1-board, 2-detail (drawer on a top watchlist row), 3-filtered (chips + "N of M"), 4-model,
// encode each into the byte window (lossless PNG if it fits, else PNG8 palette search, else JPEG
// quality search), write them to screenshots/, then rebuild out/ so dossier.json picks them up.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const input = resolve(repo, arg('input', '../token-radar-01-kit/input/snapshot.json'));
const out = resolve(repo, arg('output', 'out'));
const shots = join(repo, 'screenshots');
const PW = process.env.PLAYWRIGHT_PKG || '/workspace/projects/2de6bbf5-9a6e-4c92-adbd-7caaf9109ad3/makefun/shot-tools/node_modules/playwright/index.mjs';
const W = 1440, H = 900;
// Byte budget. The gate caps dossier.json (base64 images + ≤64 KiB source text) at 1.5 MiB and each
// image at 512 KiB; base64 is 4/3 of the raw bytes, so 4 images share ~1.13 MB raw. Lossless PNGs are
// kept when the whole set fits; otherwise each image is re-encoded into an equal share.
const COUNT = 4, GATE = 1_572_864, TEXT_RESERVE = 70_000;
const TOTAL = Math.floor((GATE - TEXT_RESERVE) * 3 / 4) - 4_000;
const MAX = Math.min(+process.env.SHOT_MAX || 350_000, Math.floor(TOTAL / COUNT));
const MIN = Math.min(+process.env.SHOT_MIN || 300_000, MAX - 40_000);

const build = () => execFileSync(process.execPath, [join(repo, 'main.ts'), '--input', input, '--output', out], { stdio: 'inherit' });
const size = p => statSync(p).size;
const im = (...a) => execFileSync('convert', a, { stdio: ['ignore', 'ignore', 'inherit'] });
/** Lossless recompression (optipng when present). */
function lossless(raw, dst) {
  copyFileSync(raw, dst);
  try { execFileSync('optipng', ['-quiet', '-o2', '-strip', 'all', dst]); } catch { /* optional */ }
  return dst;
}

/** Pick the best encoding inside [MIN, MAX]: lossless, else largest palette PNG, else JPEG quality search. */
function encode(raw, dir, base) {
  const png = join(dir, base + '.png');
  if (size(raw) <= MAX) { copyFileSync(raw, png); return png; }
  let best = null;
  for (const colors of [256, 192, 128]) {
    const t = join(dir, `${base}.p${colors}.png`);
    im(raw, '-dither', 'None', '-colors', String(colors), '-strip', 'PNG8:' + t);
    if (size(t) <= MAX) { best = t; break; }
  }
  if (best && size(best) >= MIN) { copyFileSync(best, png); return png; }
  let lo = 60, hi = 98, jpg = null;
  while (lo <= hi) {
    const q = (lo + hi) >> 1, t = join(dir, `${base}.q${q}.jpg`);
    im(raw, '-strip', '-sampling-factor', '4:4:4', '-quality', String(q), t);
    if (size(t) <= MAX) { jpg = t; lo = q + 1; } else hi = q - 1;
  }
  if (best && (!jpg || size(best) >= size(jpg))) { copyFileSync(best, png); return png; }
  if (!jpg) throw new Error(base + ': cannot fit ' + MAX + ' bytes');
  const dst = join(dir, base + '.jpg'); copyFileSync(jpg, dst); return dst;
}

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

// Detail: the highest-ranked watchlist protocol, drawer showing formula and farm plan.
const top = await page.evaluate(() => { const r = RadarModel.buildRadar(RADAR_DATA).rows.find(x => x.watchlist); return { slug: r.slug, name: r.name }; });
const slug = top.slug;
await page.locator('#p-board tbody tr').filter({ hasText: top.name }).first().click();
await page.waitForSelector('#drawer[open] .steps');
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

await page.click('#t-model');
await page.waitForSelector('#p-model:not([hidden]) table');
raws.push(await snap('4-model'));
await browser.close();
if (errors.length) throw new Error('Page errors:\n' + errors.join('\n'));

mkdirSync(shots, { recursive: true });
for (const n of readdirSync(shots)) if (/\.(png|jpe?g)$/i.test(n)) rmSync(join(shots, n));
const opt = raws.map(([name, raw]) => [name, raw, lossless(raw, join(tmp, name + '.opt.png'))]);
const fits = opt.reduce((s, x) => s + size(x[2]), 0) <= TOTAL && opt.every(x => size(x[2]) <= 524_288);
for (const [name, raw, png] of opt) {
  const f = fits ? png : encode(png, tmp, name), dst = join(shots, name + f.slice(f.lastIndexOf('.')));
  writeFileSync(dst, readFileSync(f));
  const dim = execFileSync('identify', ['-format', '%m %wx%h', dst]).toString();
  console.log(`${dst.slice(repo.length + 1)}  ${(size(dst) / 1000).toFixed(1)} KB  ${dim}  (raw ${(size(raw) / 1000).toFixed(0)} KB)`);
}
rmSync(tmp, { recursive: true, force: true });
console.log(`${fits ? 'lossless set fits' : 'per-image window ' + MIN + '..' + MAX} (total budget ${TOTAL} bytes); detail slug ${slug}; filter cat "${cat}"`);
build();
