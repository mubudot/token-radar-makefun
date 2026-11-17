// Meaningful model/ledger/browser/gate checks, standard library only. Fixtures stay in /tmp.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createContext, runInContext } from 'node:vm';
import { deflateSync } from 'node:zlib';
import { buildDossier } from '../vendor/makefun-board.ts';
import { dataScript, readSnapshot } from '../lib/snapshot.ts';
import { checkBoard, htmlNetworkIssue, jsNetworkIssue, runGate } from '../lib/gate.ts';
import { imageInfo } from '../lib/images.ts';

const require = createRequire(import.meta.url);
const Model = require('../dashboard/model.js');
const input = process.argv[2] || '../token-radar-01-kit/input/snapshot.json';
const snapshot = readSnapshot(input), before = JSON.stringify(snapshot);
const radar = Model.buildRadar(snapshot);
assert.equal(JSON.stringify(snapshot), before, 'model must not mutate raw inputs');
assert.equal(radar.rows.length, 285);
assert.equal(radar.summary.watchlist_covered, 40);
assert.equal(radar.trading_peers.length, 128);
assert.equal(radar.summary.token_recorded, 288);
assert.equal(radar.excluded.length, 345);
assert(checkBoard(radar.rows, snapshot).every(r => r.pass));
assert(radar.rows.every(p => Model.isRankable(p) && p.token_status === 'pre-token'));
assert.equal(JSON.stringify(Model.buildRadar({ ...snapshot, protocols: snapshot.protocols.slice().reverse(), watchlist: snapshot.watchlist.slice().reverse() })), JSON.stringify(radar), 'input ordering must not affect any result');
const renamed = Model.buildRadar({ ...snapshot, protocols: snapshot.protocols.map((p, i) => ({ ...p, name: 'Record ' + i })) });
assert.deepEqual(renamed.rows.map(p => [p.slug, p.rank, p.implied_value_usd]), radar.rows.map(p => [p.slug, p.rank, p.implied_value_usd]), 'names cannot change rank/value');
assert.equal(Model.classify({ mcap_usd: 0, gecko_id: 'identifier', symbol: null }), 'token-recorded');
assert.equal(Model.classify({ mcap_usd: 1, gecko_id: null, symbol: null }), 'trades');
assert.equal(Model.classify({ mcap_usd: null, gecko_id: null, symbol: null }), 'pre-token');

const asOf = '2026-11-14';
const sample = (slug: string, category: string, ratio: number, days: number | null) => ({
  slug, name: slug, category, chains: ['Ethereum', 'Base'], tvl_usd: 1_000_000,
  mcap_usd: ratio * 1_000_000, change_7d: 0, gecko_id: slug, symbol: null,
  listed_at: days === null ? null : new Date(Date.parse(asOf + 'T00:00:00Z') - days * 86_400_000).toISOString().slice(0, 10)
});
const samples = [sample('a', 'A', 1, 10), sample('b', 'A', 4, 20), sample('c', 'B', 16, 30)];
const cal = Model.deriveMultiples(samples, asOf);
const a = cal.categories.find(p => p.category === 'A');
assert(Math.abs(cal.global.raw_multiple - 4) < 1e-12);
assert(Math.abs(a.raw_multiple - 2) < 1e-12, 'even log median is a geometric midpoint');
assert(Math.abs(a.multiple - 2 ** (1 / 3) * 4 ** (2 / 3)) < 1e-12, 'shrink in log space');
const held = Model.deriveMultiples(samples, asOf, 'c');
assert.deepEqual(held.global.peer_slugs, ['a', 'b']);
assert.equal(held.categories.find(p => p.category === 'B').source, 'global-fallback');
assert.equal(held.global.median_age_days, 15, 'held-out record excluded from age pool');
assert.equal(Model.impliedValue({ ...samples[0], change_7d: null, listed_at: null }, cal).growth.factor, 1);
assert.equal(Model.impliedValue({ ...samples[0], change_7d: 10000 }, cal).growth.factor, Math.sqrt(2));
assert.equal(Model.impliedValue({ ...samples[0], change_7d: -10000 }, cal).growth.factor, Math.sqrt(0.5));
const ageImputed = Model.impliedValue({ ...samples[0], listed_at: null }, cal).time;
assert.equal(ageImputed.used_days, 15); assert.equal(ageImputed.source, 'category-median');
const times = [0, 365, 730, 1095, 100000].map(d => Model.impliedValue(sample('test', 'A', 1, d), cal).time.factor);
assert.equal(times[0], 0.8); assert(times[2] > times[1] && times[2] > times[3]);
assert(Math.abs(times[4] - 1) < 1e-12);
assert.equal(Model.spearman([1, 2, 3], [3, 2, 1]), -1);
assert.equal(Model.spearman([1, 1, 2], [5, 5, 7]), 1);
assert.equal(Model.spearman([1, 1, 1], [1, 2, 3]), null);
for (const p of radar.trading_peers) {
  assert.equal(p.model.multiple.global_n, 127);
  assert.equal(p.model.multiple.omitted_slug, p.slug);
  assert(!p.model.multiple.peer_slugs.includes(p.slug));
}
const round = (n: number) => Math.round(n * 100) / 100;
for (const p of radar.rows) {
  const f = p.farm_plan, steps = f.steps;
  assert.equal(steps.length, 6);
  assert.deepEqual(p.farm_steps, steps.map(s => s.text));
  assert(p.chains.includes(f.chain));
  assert.equal(f.gas_per_tx_usd, Math.min(...f.chain_choices.map(c => c.gas_per_tx_usd)));
  assert.equal(f.est_setup_cost_usd, round(steps.filter(s => s.phase === 'setup').reduce((n, s) => n + s.est_cost_usd, 0)));
  assert.equal(f.est_exit_cost_usd, steps[5].est_cost_usd);
  assert.equal(f.setup_minutes, steps.filter(s => s.phase === 'setup').reduce((n, s) => n + s.active_minutes, 0));
  assert.equal(f.total_active_minutes, steps.reduce((n, s) => n + s.active_minutes, 0));
  assert.equal(f.opportunity_cost_usd, round(f.capital_usd * 0.05 * (f.hold_days + f.exit_wait_days_assumed) / 365));
  assert.equal(f.est_total_cost_usd, round(f.est_setup_cost_usd + f.est_exit_cost_usd + f.opportunity_cost_usd));
  const expected = Math.round(p.tvl_usd * p.model.multiple.factor * p.model.growth.factor * p.model.time.factor);
  assert.equal(p.implied_value_usd, expected);
}

// A true classic-script environment: window === globalThis, no CommonJS or module loader.
const browser = createContext({});
runInContext('globalThis.window=globalThis; Date.now=()=>{throw Error("wall clock")}; Math.random=()=>{throw Error("randomness")};', browser);
runInContext(dataScript(snapshot), browser);
runInContext(readFileSync(new URL('../dashboard/model.js', import.meta.url), 'utf8'), browser);
const browserRows = runInContext('JSON.stringify(RadarModel.buildRadar(RADAR_DATA).rows)', browser);
assert.equal(browserRows, JSON.stringify(radar.rows), 'browser and board must be byte-identical');
const emitted = resolve('out/board.json');
assert.equal(JSON.stringify(JSON.parse(readFileSync(emitted, 'utf8')).rows), browserRows);
assert(readFileSync(new URL('../dashboard/model.js', import.meta.url)).length <= 22000);

assert(htmlNetworkIssue('<img src="https://remote.invalid/image">'));
assert(htmlNetworkIssue('<a href="https&#58;//remote.invalid">x</a>'));
assert(htmlNetworkIssue('<style>div{background:url(https://remote.invalid)}</style>'));
assert(htmlNetworkIssue('<script>import("https://remote.invalid")</script>'));
assert(!htmlNetworkIssue('<p>https://visible.invalid</p><!-- <a href="https://comment.invalid"> -->'));
assert(jsNetworkIssue('export { x } from "https://remote.invalid";'));
assert(jsNetworkIssue('require(/*comment*/ "h\\x74tps://remote.invalid")'));
assert(!jsNetworkIssue('const label="https://visible.invalid"; // import "https://comment.invalid"'));

// Structural fixtures are test data, never screenshots of the dashboard or hand-in artifacts.
function png(width: number, height: number): Buffer {
  function chunk(type: string, body: Buffer): Buffer {
    const name = Buffer.from(type), prefix = Buffer.alloc(4), crc = Buffer.alloc(4);
    prefix.writeUInt32BE(body.length);
    let sum = 0xffffffff;
    for (const byte of Buffer.concat([name, body])) {
      sum ^= byte;
      for (let bit = 0; bit < 8; bit++) sum = sum & 1 ? (sum >>> 1) ^ 0xedb88320 : sum >>> 1;
    }
    crc.writeUInt32BE((sum ^ 0xffffffff) >>> 0);
    return Buffer.concat([prefix, name, body, crc]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc(height * (width * 3 + 1)))), chunk('IEND', Buffer.alloc(0))]);
}
const fixture = png(1000, 800);
assert.deepEqual(imageInfo(fixture), { type: 'PNG', width: 1000, height: 800 });
assert.throws(() => imageInfo(fixture.subarray(0, fixture.length - 1)));
const corrupt = Buffer.from(fixture); corrupt[corrupt.length - 1] ^= 1;
assert.throws(() => imageInfo(corrupt), /CRC/);
assert.throws(() => imageInfo(png(1441, 800)), /1440/);
// A complete 800×800 grayscale baseline JPEG: DC=0 + EOB for 10,000 blocks.
function jpegSegment(marker: number, body: Buffer): Buffer {
  const prefix = Buffer.from([255, marker, 0, 0]); prefix.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([prefix, body]);
}
const huffman = (table: number) => Buffer.from([table, 1, ...Array(15).fill(0), 0]);
const jpeg = Buffer.concat([Buffer.from([255, 216]), jpegSegment(0xdb, Buffer.from([0, ...Array(64).fill(1)])),
  jpegSegment(0xc0, Buffer.from([8, 3, 32, 3, 32, 1, 1, 17, 0])),
  jpegSegment(0xc4, Buffer.concat([huffman(0), huffman(16)])),
  jpegSegment(0xda, Buffer.from([1, 1, 0, 0, 63, 0])), Buffer.alloc(2500), Buffer.from([255, 217])]);
assert.deepEqual(imageInfo(jpeg), { type: 'JPEG', width: 800, height: 800 });
assert.throws(() => imageInfo(jpeg.subarray(0, jpeg.length - 1)));
for (const file of readdirSync('../token-radar-01-kit/starter/screenshots')) imageInfo(readFileSync(join('../token-radar-01-kit/starter/screenshots', file)));
const temp = mkdtempSync(join(tmpdir(), 'radar-gate-fixture-'));
try {
  mkdirSync(join(temp, 'dashboard')); mkdirSync(join(temp, 'screenshots'));
  writeFileSync(join(temp, 'dashboard/index.html'), '<!doctype html><html lang="en"><title>Gate fixture</title><p>Test only</p></html>');
  writeFileSync(join(temp, 'dashboard/app.css'), 'body{color:black}');
  writeFileSync(join(temp, 'dashboard/app.js'), '"use strict";');
  writeFileSync(join(temp, 'board.json'), JSON.stringify({ rows: radar.rows }));
  for (let i = 1; i <= 2; i++) writeFileSync(join(temp, 'screenshots', i + '-fixture.png'), fixture);
  writeFileSync(join(temp, 'screenshots/3-fixture.jpg'), jpeg);
  const dossier = Buffer.from(buildDossier(temp, { text_max_bytes: 65536 }));
  writeFileSync(join(temp, 'dossier.json'), dossier);
  assert(runGate(temp, snapshot).rows.every(row => row.pass), 'all seven gate rows pass on complete fixtures');
  writeFileSync(join(temp, 'dashboard/app.css'), 'body{background:url(https://remote.invalid)}');
  const altered = runGate(temp, snapshot);
  assert.equal(altered.rows.find(r => r.check === 'dashboard_files')?.pass, false);
  assert.equal(altered.rows.find(r => r.check === 'dossier_matches')?.pass, false, 'dossier detects changed source');
} finally { rmSync(temp, { recursive: true, force: true }); }
console.log('PASS: model arithmetic, leave-one-out isolation, farm ledgers, input-order/name invariance, classic-browser/board equality, network rules, image integrity and all seven complete-fixture gate rows.');
