// No browser/capture: validate encoding of existing images in temporary memory/output only.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeScreenshot, pngScanlines, SCREENSHOT_MIN_BYTES, SCREENSHOT_MAX_BYTES } from './shot-encoding.mjs';
import { imageInfo } from '../lib/images.ts';
import { prepareOutput, DOSSIER_GATE_BYTES } from '../lib/output.ts';
import { buildDossier } from '../vendor/makefun-board.ts';
const repo = fileURLToPath(new URL('..', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'radar-encoding-test-'));
try {
  prepareOutput(repo, temp);
  for (const name of ['1-board.png', '2-detail.png', '3-filtered.png']) {
    const input = readFileSync(join(repo, 'screenshots', name)), output = await encodeScreenshot(input);
    assert(output.length >= SCREENSHOT_MIN_BYTES && output.length <= SCREENSHOT_MAX_BYTES);
    assert.deepEqual(imageInfo(output), imageInfo(input));
    assert(pngScanlines(output).equals(pngScanlines(input)), 'lossless scanlines');
    if (name === '1-board.png') assert(output.equals(await encodeScreenshot(input)), 'deterministic encoding');
    writeFileSync(join(temp, 'screenshots', name), output);
    console.log(name + ': ' + input.length + ' → ' + output.length + ' bytes, pixels unchanged');
  }
  const dossier = buildDossier(temp, { text_max_bytes: 65536 });
  assert(dossier.length <= DOSSIER_GATE_BYTES);
  assert(!JSON.parse(Buffer.from(dossier).toString()).text.includes('[Cut at '));
  console.log('PASS: three lossless images in byte window; dossier ' + dossier.length + ' ≤ ' + DOSSIER_GATE_BYTES + '; full source. No captures run.');
} finally { rmSync(temp, { recursive: true, force: true }); }
