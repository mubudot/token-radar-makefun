import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface Protocol {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
}
export interface Snapshot {
  as_of: string; source: string; floor_usd: number;
  protocols: Protocol[]; watchlist: string[];
}
export interface BoardRow {
  slug: string; name: string; rank: number; implied_value_usd: number; farm_steps: string[];
  [key: string]: unknown;
}

export function argument(name: string, fallback: string, args = process.argv.slice(2)): string {
  const flag = '--' + name;
  const equal = args.find(a => a.startsWith(flag + '='));
  if (equal !== undefined) return equal.slice(flag.length + 1);
  const at = args.indexOf(flag);
  if (at < 0) return fallback;
  if (!args[at + 1] || args[at + 1].startsWith('--')) throw new Error(flag + ' needs a value');
  return args[at + 1];
}

function date(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}
function fail(message: string): never { throw new Error('snapshot: ' + message); }
function object(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Strict input, retaining exactly the ten raw fields; no inferred values in data.js. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { fail('invalid JSON'); }
  if (!object(raw)) fail('expected an object');
  if (!date(raw.as_of) || typeof raw.source !== 'string') fail('invalid as_of/source');
  if (!Number.isSafeInteger(raw.floor_usd) || (raw.floor_usd as number) <= 0) fail('invalid floor');
  if (!Array.isArray(raw.protocols) || !raw.protocols.length) fail('protocols must be nonempty');
  const seen = new Set<string>();
  const protocols: Protocol[] = raw.protocols.map((p: unknown, i: number) => {
    if (!object(p)) fail('protocol ' + i + ' is not an object');
    if (typeof p.slug !== 'string' || !/^\S{1,128}$/.test(p.slug) || seen.has(p.slug)) fail('bad/duplicate slug at ' + i);
    if (typeof p.name !== 'string' || !p.name.trim()) fail('missing name for ' + p.slug);
    if (p.category !== null && typeof p.category !== 'string') fail('bad category for ' + p.slug);
    if (!Array.isArray(p.chains) || p.chains.some(c => typeof c !== 'string' || !c.trim())) fail('bad chains for ' + p.slug);
    if (!Number.isSafeInteger(p.tvl_usd) || (p.tvl_usd as number) <= 0) fail('bad TVL for ' + p.slug);
    if (p.change_7d !== null && (typeof p.change_7d !== 'number' || !Number.isFinite(p.change_7d))) fail('bad growth for ' + p.slug);
    if (p.mcap_usd !== null && !Number.isSafeInteger(p.mcap_usd)) fail('bad cap for ' + p.slug);
    if (p.listed_at !== null && !date(p.listed_at)) fail('bad listed_at for ' + p.slug);
    for (const key of ['gecko_id', 'symbol']) if (p[key] !== null && (typeof p[key] !== 'string' || !(p[key] as string).trim())) fail('bad ' + key + ' for ' + p.slug);
    seen.add(p.slug);
    return {
      slug: p.slug, name: p.name, category: p.category as string | null,
      chains: (p.chains as string[]).slice(), tvl_usd: p.tvl_usd as number,
      change_7d: p.change_7d as number | null, mcap_usd: p.mcap_usd as number | null,
      listed_at: p.listed_at as string | null, gecko_id: p.gecko_id as string | null,
      symbol: p.symbol as string | null
    };
  });
  if (!Array.isArray(raw.watchlist) || raw.watchlist.some(s => typeof s !== 'string' || !seen.has(s))) fail('watchlist has unknown slugs');
  if (new Set(raw.watchlist).size !== raw.watchlist.length) fail('duplicate watchlist slug');
  protocols.sort((a, b) => a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
  return { as_of: raw.as_of, source: raw.source, floor_usd: raw.floor_usd as number,
    protocols, watchlist: (raw.watchlist as string[]).slice().sort() };
}

export function readSnapshot(path: string): Snapshot {
  const file = statSync(path).isDirectory() ? join(path, 'snapshot.json') : path;
  return parseSnapshot(new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(file)));
}

export function dataScript(snapshot: Snapshot): string {
  const payload = { as_of: snapshot.as_of, floor_usd: snapshot.floor_usd,
    watchlist: snapshot.watchlist, protocols: snapshot.protocols };
  const json = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return 'window.RADAR_DATA=' + json + ';\n';
}
