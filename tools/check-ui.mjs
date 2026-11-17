// Functional browser QA only. No screenshot, recording or capture calls.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('..', import.meta.url));
const pw = process.env.PLAYWRIGHT_PKG || resolve(repo, '../shot-tools/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(pw).href);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [], requests = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('request', r => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
  await page.goto(pathToFileURL(resolve(process.argv[2] || 'out', 'dashboard/index.html')).href);
  await page.waitForSelector('#p-board tbody tr');
  const expected = await page.evaluate(() => {
    const r = RadarModel.buildRadar(RADAR_DATA), p = r.rows.find(p => p.watchlist);
    return { count: r.rows.length, watch: r.summary.watchlist_total, peers: r.trading_peers.length,
      firstWatch: p.name, budget: p.farm_plan.est_total_cost_usd.toFixed(2),
      maxTvlName: r.rows.slice().sort((a,b) => b.tvl_usd-a.tvl_usd)[0].name };
  });
  assert.equal(await page.locator('#p-board tbody tr').count(), expected.count);
  await page.locator('#p-board th button').filter({ hasText: /^TVL$/ }).click();
  assert((await page.locator('#p-board tbody tr').first().textContent()).includes(expected.maxTvlName));
  assert.equal(await page.locator('#p-board th[aria-sort]').count(), 1);
  await page.fill('#fq', 'not-a-protocol-zzzz');
  assert((await page.locator('#p-board').textContent()).includes('No matching rows'));
  await page.click('#frst');
  await page.click('#t-watchlist');
  assert.equal(await page.locator('#p-watchlist tbody tr').count(), expected.watch);
  await page.locator('#p-watchlist tbody tr').filter({ hasText: expected.firstWatch }).click();
  assert.equal(await page.locator('#drawer[open] .steps li').count(), 6);
  const detail = await page.locator('#d-body').textContent();
  for (const label of ['Capital at risk', 'All-in budget', 'Gas (all steps)', 'Contract haircut 1%', 'Depeg haircut 1%', '$' + expected.budget]) assert(detail.includes(label), label);
  await page.keyboard.press('Escape');
  await page.click('#t-peers');
  assert.equal(await page.locator('#p-peers tbody tr').count(), expected.peers);
  await page.locator('#p-peers tbody tr').first().click();
  assert((await page.locator('#d-body').textContent()).includes('LOO vs market cap'));
  await page.keyboard.press('Escape');
  await page.click('#t-model');
  const model = await page.locator('#p-model').textContent();
  for (const text of ['Spearman beats baseline', 'Ensemble', 'Before v2', 'smart_contract_haircut_rate', 'depeg_haircut_rate', '0.4161', '0.3989', '0.4237']) assert(model.includes(text), text);
  assert.equal(await page.locator('#p-model .g2m > :last-child tbody tr').count(), 144);
  await page.locator('#p-model .g2m > :last-child tbody tr').first().click();
  assert((await page.locator('#d-body').textContent()).includes('EXCLUDED'));
  await page.keyboard.press('Escape');
  for (const width of [1440, 720]) {
    await page.setViewportSize({ width, height: 900 });
    const sizes = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(sizes[0] <= sizes[1] + 1, 'page overflow at ' + width + ': ' + sizes);
  }
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  console.log('PASS: board sorting/filter/reset, watchlist, all detail types/cost ledger, peers, baseline disclosure, exclusions and responsive layout. No screenshots/captures run.');
} finally { await browser.close(); }
