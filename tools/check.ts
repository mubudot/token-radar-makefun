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
assert.equal(radar.rows.length, 198);
assert.equal(radar.summary.watchlist_covered, 40);
assert.equal(radar.trading_peers.length, 128);
assert.equal(radar.summary.token_recorded, 288);
assert.equal(radar.excluded.length, 432);
assert.equal(radar.summary.excluded_categories, 128);
assert.equal(radar.summary.excluded_pre_token, 144);
assert.equal(radar.rows.length + radar.trading_peers.length + radar.excluded.length, snapshot.protocols.length);
assert(checkBoard(radar.rows, snapshot).every(r => r.pass));
assert(radar.rows.every(p => Model.isRankable(p) && p.token_status === 'pre-token'));
assert.equal(JSON.stringify(Model.buildRadar({ ...snapshot, protocols: snapshot.protocols.slice().reverse(), watchlist: snapshot.watchlist.slice().reverse() })), JSON.stringify(radar), 'input ordering must not affect any result');
const renamed = Model.buildRadar({ ...snapshot, protocols: snapshot.protocols.map((p, i) => ({ ...p, name: 'Record ' + i })) });
// Generic name rules now affect eligibility, while names still cannot affect a value.
for (const p of radar.rows) assert.equal(renamed.rows.find(q => q.slug === p.slug)?.implied_value_usd, p.implied_value_usd);
for (const p of radar.excluded.filter(p => p.token_status === 'pre-token')) {
  assert(p.exclusion_rules.length > 0);
  assert(p.reason.startsWith('excluded: derivative/infrastructure of a traded token; '));
}
for (const [category, name] of [['Bridge', 'Example'], ['Lending', 'Example V2'], ['Lending', 'Wrapped Example'], ['Lending', 'Example STAKED asset'], ['Lending', 'Coinbase Example']]) {
  assert(Model.exclusionRules({ category, name }).length > 0);
}
assert.equal(Model.exclusionRules({ category: 'Lending', name: 'UnwrappedLabs v2alpha' }).length, 0, 'whole-word and trailing-version boundaries');
assert(radar.rows.every(p => !Model.exclusionRules(p).length));
// Regression diagnostics are reported honestly, never enforced as improvement claims.
assert(Math.abs(radar.validation.spearman - 0.42326268082768725) < 1e-12);
assert(Math.abs(radar.validation.median_error_factor - 3.585115715913548) < 1e-12);
assert.equal(radar.validation.within_3x_count, 57);
assert.equal(radar.validation.within_3x_share, 57 / 128);
assert(Math.abs(radar.validation.baseline.spearman - 0.4161497436366966) < 1e-12);
assert(Math.abs(radar.validation.baseline.median_error_factor - 5.069588651542522) < 1e-12);
assert.equal(radar.validation.baseline.within_3x_count, 45);
assert.equal(radar.validation.rank_beats_baseline, radar.validation.spearman > radar.validation.baseline.spearman);
assert(Math.abs(radar.calibration.fit.time_power) > 0.1, 'T must retain a meaningful effect on this snapshot');
assert(new Set(radar.rows.map(p => p.model.growth.factor)).size > 100, 'G must vary across the board');
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
assert.equal(a.fit.shrink_weight, 2 / 18);
const mix = Model.CONSTANTS.ensemble_fit_weight;
const prior = Math.log(Model.CONSTANTS.fit_pivot_usd * cal.global.multiple);
const pooled = (cal.fit.pooled_log_intercept - (1 - mix) * prior) / mix;
const shrunk = a.fit.shrink_weight * a.fit.raw_log_intercept + (1 - a.fit.shrink_weight) * pooled;
assert(Math.abs(a.fit.log_intercept - (mix * shrunk + (1 - mix) * prior)) < 1e-12, 'category shrinkage and ensemble operate in log space');
const held = Model.deriveMultiples(samples, asOf, 'c');
assert.deepEqual(held.global.peer_slugs, ['a', 'b']);
assert.equal(held.categories.find(p => p.category === 'B').source, 'global-fallback');
assert.equal(held.global.median_age_days, 15, 'held-out record excluded from age pool');
assert.equal(JSON.stringify(Model.deriveMultiples(samples.map(p => p.slug === 'c' ? { ...p, mcap_usd: p.mcap_usd * 1e8, listed_at: '1900-01-01' } : p), asOf, 'c')), JSON.stringify(held), 'held-out cap/date cannot influence fitted coefficients or imputation');
// Exact sublinear relation with known priors: recover beta=0.5 rather than imposing beta=1.
const powerPeers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30].map((k, i) => ({
  ...sample('power-' + i, 'A', 1, 0), tvl_usd: k * k * 1e6, mcap_usd: 800000 * k
}));
const powerCal = Model.deriveMultiples(powerPeers, asOf);
assert(Math.abs(powerCal.fit.base_beta - 0.5) < 1e-10);
assert(Math.abs(powerCal.fit.beta - (0.5 * Model.CONSTANTS.ensemble_fit_weight + 1 - Model.CONSTANTS.ensemble_fit_weight)) < 1e-10);
const contaminated = powerPeers.map((p, i) => i === 11 ? { ...p, mcap_usd: p.mcap_usd * 1000 } : p);
assert(Math.abs(Model.deriveMultiples(contaminated, asOf).fit.base_beta - 0.5) < 0.1, 'Huber slope resists one extreme market-cap observation');
assert.equal(Model.impliedValue({ ...samples[0], change_7d: null, listed_at: null }, cal).growth.factor, 1);
assert.equal(Model.CONSTANTS.growth_weight, 0.20);
assert.equal(Model.CONSTANTS.growth_log_clip, Math.LN2);
const neutral = Model.impliedValue({ ...samples[0], change_7d: 0 }, cal);
for (const change of [-10000, -100, -50, -10, 0, 10, 100, 10000, null]) {
  const result = Model.impliedValue({ ...samples[0], change_7d: change }, cal);
  const used = Math.max(-50, Math.min(100, change ?? 0));
  const expected = Math.exp(0.20 * Math.log1p(used / 100));
  assert(Math.abs(result.growth.factor - expected) < 1e-12);
  assert.equal(result.growth.weight, 0.20);
  assert.equal(result.growth.used_pct, used);
  assert.equal(result.growth.missing, change === null);
  assert.equal(result.growth.clamped, change !== null && change !== used);
  assert(Math.abs(result.unrounded_usd / neutral.unrounded_usd - expected) < 1e-12, 'growth changes the final value at fixed calibration');
}
const positive = Model.impliedValue({ ...samples[0], change_7d: 10 }, cal);
const negative = Model.impliedValue({ ...samples[0], change_7d: -10 }, cal);
assert(positive.implied_value_usd > neutral.implied_value_usd && neutral.implied_value_usd > negative.implied_value_usd);
const ageImputed = Model.impliedValue({ ...samples[0], listed_at: null }, cal).time;
assert.equal(ageImputed.used_days, 15); assert.equal(ageImputed.source, 'category-median');
const times = [0, 365, 730, 1095, 100000].map(d => Model.impliedValue(sample('test', 'A', 1, d), cal).time.base_factor);
assert.equal(times[0], 0.8); assert(times[2] > times[1] && times[2] > times[3]);
assert(Math.abs(times[4] - 1) < 1e-12);
assert.equal(Model.spearman([1, 2, 3], [3, 2, 1]), -1);
assert.equal(Model.spearman([1, 1, 2], [5, 5, 7]), 1);
assert.equal(Model.spearman([1, 1, 1], [1, 2, 3]), null);
for (const p of radar.trading_peers) {
  assert.equal(p.model.multiple.global_n, 127);
  assert.equal(p.model.multiple.omitted_slug, p.slug);
  assert(!p.model.multiple.peer_slugs.includes(p.slug));
  assert.equal(p.model.fit.n, 127);
  assert(p.model.fit.base_beta >= 0 && p.model.fit.base_beta <= Model.CONSTANTS.rank_beta_cap);
  assert.equal(p.model.growth.weight, Model.CONSTANTS.growth_weight);
  assert(Math.abs(p.model.fit.base_time_power) <= Model.CONSTANTS.time_coef_cap);
  const independentFold = Model.deriveMultiples(snapshot.protocols, snapshot.as_of, p.slug);
  assert.equal(p.model.fit.beta, independentFold.fit.beta);
  assert.equal(p.model.fit.pooled_log_intercept, independentFold.fit.pooled_log_intercept);
  assert.equal(p.predicted_value_usd, Model.impliedValue(p, independentFold).implied_value_usd);
  assert.equal(p.baseline_value_usd, Math.max(1, Math.round(p.tvl_usd * independentFold.global.multiple)));
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
  assert.equal(f.cash_cost_usd, round(f.est_setup_cost_usd + f.est_exit_cost_usd));
  assert.equal(f.opportunity_horizon_days, f.hold_days + f.exit_wait_days_assumed);
  assert.equal(f.risk_horizon_days, f.opportunity_horizon_days);
  assert.equal(f.smart_contract_haircut_usd, round(f.capital_usd * Model.FARM.smart_contract_haircut_rate));
  assert.equal(f.depeg_haircut_usd, round(f.capital_usd * Model.FARM.depeg_haircut_rate));
  assert.equal(f.risk_haircut_usd, round(f.smart_contract_haircut_usd + f.depeg_haircut_usd));
  assert.equal(f.est_total_cost_usd, round(f.cash_cost_usd + f.opportunity_cost_usd + f.risk_haircut_usd));
  assert.equal(round(steps.reduce((n, s) => n + s.all_in_cost_usd, 0)), f.est_total_cost_usd);
  assert.equal(steps[3].risk_haircut_usd, f.risk_haircut_usd);
  const expected = Math.round(p.tvl_usd * p.model.multiple.factor * p.model.growth.factor * p.model.time.factor);
  assert.equal(p.implied_value_usd, expected);
  const fittedBase = Math.exp(p.model.fit.log_intercept) * (p.tvl_usd / p.model.fit.pivot_tvl_usd) ** p.model.fit.beta;
  assert(Math.abs(p.tvl_usd * p.model.multiple.factor - fittedBase) / fittedBase < 1e-12);
  assert(p.model.growth.factor >= Math.exp(-0.20 * Math.LN2) && p.model.growth.factor <= Math.exp(0.20 * Math.LN2));
  assert.equal(p.model.time.factor, p.model.time.base_factor ** p.model.fit.time_power);
}

// A true classic-script environment: window === globalThis, no CommonJS or module loader.
const browser = createContext({});
runInContext('globalThis.window=globalThis; Date.now=()=>{throw Error("wall clock")}; Math.random=()=>{throw Error("randomness")};', browser);
runInContext(dataScript(snapshot), browser);
runInContext(readFileSync(new URL('../dashboard/model.js', import.meta.url), 'utf8'), browser);
const browserRows = runInContext('JSON.stringify(RadarModel.buildRadar(RADAR_DATA).rows)', browser);
assert.equal(browserRows, JSON.stringify(radar.rows), 'browser and board must be byte-identical');
const emitted = resolve(process.argv[3] || 'out', 'board.json');
assert.equal(JSON.stringify(JSON.parse(readFileSync(emitted, 'utf8')).rows), browserRows);
assert.deepEqual(JSON.parse(readFileSync(emitted, 'utf8')).farm_assumptions, Model.FARM);
const sourceRoot = new URL('../dashboard/', import.meta.url);
assert(readdirSync(sourceRoot).reduce((n, file) => n + readFileSync(new URL(file, sourceRoot)).length, 0) <= 62500);
const output = resolve(process.argv[3] || 'out');
const strictDossier = Buffer.from(buildDossier(output, { text_max_bytes: 64000 }));
const doc = JSON.parse(strictDossier.toString('utf8'));
assert(Buffer.byteLength(doc.text) <= 64000);
assert(!/\[Cut at \d+ bytes:/.test(doc.text), 'the entire readable source must fit with listings and fences');
assert.deepEqual(strictDossier, readFileSync(join(output, 'dossier.json')), '64,000-byte and canonical 65,536-byte caps must yield identical complete dossiers');

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
