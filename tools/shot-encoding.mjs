// Lossless PNG sizing: real scanline bytes, no padding or pixel changes.
import { constants, createDeflate, deflateSync, inflateSync } from 'node:zlib';
import { imageInfo } from '../lib/images.ts';
export const SCREENSHOT_MIN_BYTES = 300_000;
export const SCREENSHOT_MAX_BYTES = 350_000;
const SEARCH_STEPS = 24;
function partsOf(bytes) {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Capture must be PNG');
  const parts = [];
  for (let at = 8; at < bytes.length;) {
    const end = at + bytes.readUInt32BE(at) + 12;
    if (end > bytes.length) throw new Error('Truncated PNG');
    parts.push({ type: bytes.toString('ascii', at + 4, at + 8), bytes: bytes.subarray(at, end) }); at = end;
  }
  return parts;
}
export function pngScanlines(bytes) {
  return inflateSync(Buffer.concat(partsOf(bytes).filter(p => p.type === 'IDAT').map(p => p.bytes.subarray(8, -4))));
}
function idat(body) {
  const chunk = Buffer.alloc(body.length + 12); chunk.writeUInt32BE(body.length);
  chunk.write('IDAT', 4, 'ascii'); body.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4); return chunk;
}
function assemble(original, compressed) {
  const out = [original.subarray(0, 8)]; let inserted = false;
  for (const part of partsOf(original)) {
    if (part.type !== 'IDAT') out.push(part.bytes);
    else if (!inserted) { out.push(idat(compressed)); inserted = true; }
  }
  return Buffer.concat(out);
}
// Store a real prefix at level 0, then compress the remaining scanlines at level 9.
function mixedCompression(scanlines, prefix) {
  if (!prefix) return Promise.resolve(deflateSync(scanlines, { level: 9 }));
  return new Promise((resolve, reject) => {
    const stream = createDeflate({ level: 0 }), chunks = [];
    stream.on('data', b => chunks.push(b)); stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.write(scanlines.subarray(0, prefix));
    stream.params(9, constants.Z_DEFAULT_STRATEGY, error => {
      if (error) reject(error); else stream.end(scanlines.subarray(prefix));
    });
  });
}
export async function encodeScreenshot(original) {
  imageInfo(original);
  const scanlines = pngScanlines(original);
  let out = assemble(original, await mixedCompression(scanlines, 0));
  if (out.length > SCREENSHOT_MAX_BYTES) throw new Error('Lossless capture exceeds 350000 bytes; reduce capture density before retrying');
  let lo = 0, hi = scanlines.length;
  for (let step = 0; out.length < SCREENSHOT_MIN_BYTES || out.length > SCREENSHOT_MAX_BYTES; step++) {
    if (step >= SEARCH_STEPS || lo > hi) throw new Error('Cannot encode inside 300000–350000 bytes');
    const prefix = Math.floor((lo + hi) / 2);
    out = assemble(original, await mixedCompression(scanlines, prefix));
    if (out.length < SCREENSHOT_MIN_BYTES) lo = prefix + 1;
    else if (out.length > SCREENSHOT_MAX_BYTES) hi = prefix - 1;
  }
  imageInfo(out);
  if (!pngScanlines(out).equals(scanlines)) throw new Error('Encoding changed pixel scanlines');
  return out;
}
