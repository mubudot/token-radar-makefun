import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { buildDossier, TEXT_FILE } from '../vendor/makefun-board.ts';
import { DOSSIER_GATE_BYTES } from './output.ts';
import { imageInfo } from './images.ts';
import type { Snapshot, BoardRow } from './snapshot.ts';

export interface GateRow { check: string; pass: boolean; detail: string }
export interface FileInfo { path: string; bytes: number }
export const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const http = /https?:\/\//i;
const utf8 = (path: string) => new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(path));
const good = (check: string, detail: string): GateRow => ({ check, pass: true, detail });
const bad = (check: string, detail: string): GateRow => ({ check, pass: false, detail });
function guarded(check: string, fn: () => string): GateRow {
  try { return good(check, fn()); } catch (e) { return bad(check, e instanceof Error ? e.message : String(e)); }
}
function requireTrue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function checkBoard(rows: unknown, snapshot: Snapshot): GateRow[] {
  const list = Array.isArray(rows) ? rows as BoardRow[] : [];
  const known = new Set(snapshot.protocols.map(p => p.slug));
  return [
    guarded('board_file', () => {
      requireTrue(Array.isArray(rows) && list.length >= 100 && list.length <= 4000, 'rows must number 100–4000');
      const seen = new Set();
      for (const r of list) {
        requireTrue(r && typeof r === 'object', 'row must be an object');
        requireTrue(typeof r.slug === 'string' && /^\S{1,128}$/u.test(r.slug), 'invalid slug');
        requireTrue(known.has(r.slug), 'invented slug: ' + r.slug);
        requireTrue(!seen.has(r.slug), 'duplicate slug: ' + r.slug); seen.add(r.slug);
        requireTrue(typeof r.name === 'string' && r.name.trim(), r.slug + ': empty name');
        requireTrue(Number.isSafeInteger(r.rank) && r.rank > 0, r.slug + ': invalid rank');
        requireTrue(Number.isSafeInteger(r.implied_value_usd) && r.implied_value_usd > 0 && r.implied_value_usd <= 100_000_000_000_000, r.slug + ': invalid value');
        requireTrue(Array.isArray(r.farm_steps), r.slug + ': farm_steps is not an array');
      }
      requireTrue(new Set(list.map(r => r.implied_value_usd)).size > 1, 'all implied values equal');
      return list.length + ' unique snapshot slugs; positive whole ranks/values';
    }),
    guarded('sorted_by_value', () => {
      requireTrue(list.length >= 2, 'no ranking');
      const sorted = list.slice().sort((a, b) => a.rank - b.rank);
      sorted.forEach((r, i) => {
        requireTrue(r.rank === i + 1, 'ranks are not exactly 1…N');
        if (i) requireTrue(r.implied_value_usd <= sorted[i - 1].implied_value_usd, 'value increases at rank ' + r.rank);
      });
      requireTrue(sorted[0].implied_value_usd > sorted[sorted.length - 1].implied_value_usd, 'all implied values equal');
      return '1…' + list.length + '; values non-increasing';
    }),
    guarded('coverage', () => {
      const slugs = new Set(list.map(r => r?.slug)), missing = snapshot.watchlist.filter(s => !slugs.has(s));
      requireTrue(!missing.length, 'missing: ' + missing.slice(0, 6).join(', '));
      return snapshot.watchlist.length + '/' + snapshot.watchlist.length + ' watchlist slugs';
    }),
    guarded('farm_steps', () => {
      requireTrue(list.length > 0, 'no plans');
      for (const r of list) {
        requireTrue(Array.isArray(r.farm_steps) && r.farm_steps.length >= 3 && r.farm_steps.length <= 12, r.slug + ': expected 3–12 steps');
        for (const step of r.farm_steps) requireTrue(typeof step === 'string' && [...step.trim()].length >= 20 && [...step.trim()].length <= 600, r.slug + ': step outside 20–600 characters');
      }
      return 'all ' + list.length + ' plans have 3–12 steps of 20–600 characters';
    })
  ];
}

/** Tokenize JS without executing it; comments and ordinary visible string data may contain URLs. */
function jsTokens(source: string): { value: string; string: boolean }[] {
  const out: { value: string; string: boolean }[] = [];
  let at = 0;
  while (at < source.length) {
    const ch = source[at];
    if (/\s/.test(ch)) { at++; continue; }
    if (source.startsWith('//', at)) { const end = source.indexOf('\n', at + 2); at = end < 0 ? source.length : end; continue; }
    if (source.startsWith('/*', at)) { const end = source.indexOf('*/', at + 2); at = end < 0 ? source.length : end + 2; continue; }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch; let value = ''; at++;
      while (at < source.length && source[at] !== quote) {
        if (source[at] === '\\' && at + 1 < source.length) {
          const tail = source.slice(at), hex = /^\\x([\da-f]{2})/i.exec(tail), unicode = /^\\u(?:\{([\da-f]+)\}|([\da-f]{4}))/i.exec(tail);
          if (hex || unicode) {
            const match = (hex || unicode)!;
            const code = parseInt(match[1] || match[2], 16);
            value += code <= 0x10ffff ? String.fromCodePoint(code) : '\ufffd'; at += match[0].length;
          } else { at++; value += source[at++]; }
        } else value += source[at++];
      }
      at++; out.push({ value, string: true }); continue;
    }
    const word = /^[A-Za-z_$][\w$]*/.exec(source.slice(at));
    if (word) { out.push({ value: word[0], string: false }); at += word[0].length; }
    else { out.push({ value: ch, string: false }); at++; }
  }
  return out;
}
export function jsNetworkIssue(source: string): boolean {
  const tokens = jsTokens(source);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.string) continue;
    if (t.value === 'require' || t.value === 'import') {
      if (tokens[i + 1]?.value === '(' && tokens[i + 2]?.string && http.test(tokens[i + 2].value)) return true;
    }
    if (t.value !== 'import' && t.value !== 'export') continue;
    if (tokens[i + 1]?.string && http.test(tokens[i + 1].value)) return true;
    if (tokens[i + 1]?.value === '.' || tokens[i + 1]?.value === '(') continue;
    for (let j = i + 1; j < tokens.length && tokens[j].value !== ';'; j++) {
      if (!tokens[j].string && tokens[j].value === 'from' && tokens[j + 1]?.string && http.test(tokens[j + 1].value)) return true;
    }
  }
  return false;
}
function htmlEntities(value: string): string {
  const named: Record<string, string> = { colon: ':', sol: '/', amp: '&', Tab: '\t', NewLine: '\n', quot: '"', apos: "'", lt: '<', gt: '>' };
  return value.replace(/&(#x[\da-f]+|#\d+|[A-Za-z]+);?/gi, (all, key: string) => {
    if (!key.startsWith('#')) return named[key] ?? all;
    const code = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\ufffd';
  });
}
function cssNetworkIssue(source: string): boolean {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\\([\da-f]{1,6})\s?/gi, (_, x) => String.fromCodePoint(parseInt(x, 16) || 0xfffd)).replace(/\\(.)/g, '$1');
  return http.test(text);
}
export function htmlNetworkIssue(source: string): boolean {
  let issue = false;
  const html = source.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b([^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*)>([\s\S]*?)<\/\1\s*>/gi, (_, tag, attrs, body) => {
    if (tag.toLowerCase() === 'style' ? cssNetworkIssue(body) : jsNetworkIssue(body)) issue = true;
    return '<' + tag + attrs + '></' + tag + '>';
  });
  for (const match of html.matchAll(/<[A-Za-z][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>/g)) {
    for (const a of match[0].matchAll(/[^\s=<>]+\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      if (http.test(htmlEntities(a[1] ?? a[2] ?? a[3] ?? ''))) issue = true;
    }
  }
  return issue;
}

export function dashboardFiles(root: string): FileInfo[] {
  requireTrue(existsSync(root) && lstatSync(root).isDirectory(), 'missing dashboard/');
  const files: FileInfo[] = [];
  function walk(rel: string): void {
    for (const name of readdirSync(join(root, rel)).sort()) {
      const path = rel ? rel + '/' + name : name, st = lstatSync(join(root, path));
      if (st.isDirectory()) { requireTrue(!name.startsWith('.'), 'dot directory: ' + path); walk(path); }
      else {
        requireTrue(st.isFile() && PLAIN_NAME.test(name), 'invalid file: ' + path);
        files.push({ path, bytes: st.size });
      }
      requireTrue(files.length <= 400, 'more than 400 dashboard files');
    }
  }
  walk('');
  requireTrue(files.reduce((n, f) => n + f.bytes, 0) <= 4_194_304, 'dashboard exceeds 4 MiB');
  return files;
}
export interface GateReport { rows: GateRow[]; source_bytes: number; dashboard_bytes: number; screenshots: FileInfo[] }
export function runGate(output: string, snapshot: Snapshot): GateReport {
  let sourceBytes = 0, dashboardBytes = 0;
  const dash = guarded('dashboard_files', () => {
    const files = dashboardFiles(join(output, 'dashboard'));
    dashboardBytes = files.reduce((n, f) => n + f.bytes, 0);
    sourceBytes = files.filter(f => TEXT_FILE.test(f.path)).reduce((n, f) => n + f.bytes, 0);
    requireTrue(files.some(f => f.path === 'index.html') && files.some(f => /\.css$/.test(f.path)) && files.some(f => /\.js$/.test(f.path)), 'need index.html, CSS and JS');
    for (const f of files) {
      const ext = extname(f.path).toLowerCase();
      if (!['.html', '.css', '.js', '.mjs'].includes(ext)) continue;
      const text = utf8(join(output, 'dashboard', f.path));
      const network = ext === '.html' ? htmlNetworkIssue(text) : ext === '.css' ? cssNetworkIssue(text) : jsNetworkIssue(text);
      requireTrue(!network, 'network address: ' + f.path);
    }
    return files.length + ' regular files, ' + dashboardBytes + ' bytes, no network addresses';
  });
  let rows: unknown = [], boardError = '';
  try {
    const path = join(output, 'board.json');
    requireTrue(lstatSync(path).isFile() && lstatSync(path).size <= 8_388_608, 'board must be regular and ≤8 MiB');
    const board = JSON.parse(utf8(path)); rows = Array.isArray(board) ? board : board?.rows;
  } catch (e) { boardError = e instanceof Error ? e.message : String(e); }
  const boardChecks = checkBoard(rows, snapshot);
  if (boardError) boardChecks[0] = bad('board_file', boardError);
  const screenshots: FileInfo[] = [];
  const dimensionsLabel: string[] = [];
  const images = guarded('screenshots', () => {
    const dir = join(output, 'screenshots');
    const names = existsSync(dir) ? readdirSync(dir).filter(n => !n.startsWith('.')).sort() : [];
    for (const name of names) {
      const path = join(dir, name), st = lstatSync(path);
      screenshots.push({ path: name, bytes: st.size });
      requireTrue(PLAIN_NAME.test(name) && st.isFile(), 'invalid image file: ' + name);
      requireTrue(st.size <= 524_288, name + ': exceeds 512 KiB');
      const info = imageInfo(readFileSync(path));
      dimensionsLabel.push(name + ' ' + info.width + '×' + info.height);
    }
    requireTrue(names.length >= 3 && names.length <= 4, names.length + ' images; need 3–4');
    return dimensionsLabel.join('; ');
  });
  const dossier = guarded('dossier_matches', () => {
    const expected = Buffer.from(buildDossier(output, { text_max_bytes: 65_536 }));
    const path = join(output, 'dossier.json');
    requireTrue(lstatSync(path).isFile() && lstatSync(path).size <= DOSSIER_GATE_BYTES, 'dossier must be regular and ≤1.5 MiB');
    requireTrue(expected.equals(readFileSync(path)), 'dossier differs from buildDossier');
    const doc = JSON.parse(expected.toString('utf8'));
    return expected.length + ' bytes; ' + (/\[Cut at \d+ bytes:/.test(doc.text) ? 'source CUT' : 'all source shown');
  });
  return { rows: [dash, ...boardChecks, images, dossier], source_bytes: sourceBytes, dashboard_bytes: dashboardBytes, screenshots };
}
