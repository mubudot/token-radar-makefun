import { inflateSync } from 'node:zlib';

export interface ImageInfo { type: 'PNG' | 'JPEG'; width: number; height: number }
const pngMagic = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const crcTable = Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function dimensions(width: number, height: number): void {
  if (!width || !height || Math.max(width, height) > 1440 || Math.min(width, height) < 800) {
    throw new Error(`${width}×${height}: long side ≤1440, short side ≥800 required`);
  }
}

/** Validate chunks/CRC, the complete zlib stream, and each PNG scanline (Adam7 included). */
function png(bytes: Buffer): ImageInfo {
  let at = 8, width = 0, height = 0, depth = 0, color = -1, interlace = 0;
  let header = false, palette = false, ended = false, seenData = false, dataEnded = false;
  const chunks: Buffer[] = [];
  while (at < bytes.length) {
    if (at + 12 > bytes.length) throw new Error('truncated PNG chunk');
    const length = bytes.readUInt32BE(at), end = at + 12 + length;
    if (end > bytes.length) throw new Error('truncated PNG payload');
    const type = bytes.toString('ascii', at + 4, at + 8), body = bytes.subarray(at + 8, end - 4);
    if (!/^[A-Za-z]{4}$/.test(type)) throw new Error('invalid PNG chunk type');
    if (crc32(bytes.subarray(at + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) throw new Error('PNG CRC mismatch: ' + type);
    if (!header && type !== 'IHDR') throw new Error('PNG must start with IHDR');
    if (type === 'IHDR') {
      if (header || length !== 13) throw new Error('invalid/duplicate IHDR');
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      dimensions(width, height);
      depth = body[8]; color = body[9]; interlace = body[12];
      const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!depths[color]?.includes(depth) || body[10] !== 0 || body[11] !== 0 || interlace > 1) throw new Error('invalid PNG pixel format');
      header = true;
    } else if (type === 'PLTE') {
      if (palette || seenData || !length || length % 3 || length > 768 || color === 0 || color === 4) throw new Error('invalid PLTE');
      if (color === 3 && length / 3 > 2 ** depth) throw new Error('palette exceeds PNG bit depth');
      palette = true;
    } else if (type === 'IDAT') {
      if (dataEnded || color === 3 && !palette) throw new Error('invalid IDAT order');
      seenData = true; chunks.push(body);
    } else if (type === 'IEND') {
      if (length || !seenData || end !== bytes.length) throw new Error('invalid IEND or trailing PNG bytes');
      ended = true; at = end; break;
    } else {
      if (seenData) dataEnded = true;
      if (type[0] === type[0].toUpperCase()) throw new Error('unknown critical PNG chunk ' + type);
    }
    at = end;
  }
  if (!ended || at !== bytes.length) throw new Error('PNG lacks complete IEND');
  const compressed = Buffer.concat(chunks);
  const result = inflateSync(compressed, { maxOutputLength: 20_000_000, info: true });
  if (result.engine.bytesWritten !== compressed.length) throw new Error('trailing PNG compressed data');
  const pixels = result.buffer;
  const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const passes = interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
  let offset = 0;
  for (const [x, y, dx, dy] of passes) {
    const w = Math.max(0, Math.ceil((width - x) / dx)), h = Math.max(0, Math.ceil((height - y) / dy));
    if (!w || !h) continue;
    const stride = Math.ceil(w * channels[color] * depth / 8);
    for (let row = 0; row < h; row++) {
      if (offset + stride + 1 > pixels.length || pixels[offset] > 4) throw new Error('invalid/truncated PNG scanline');
      offset += stride + 1;
    }
  }
  if (offset !== pixels.length) throw new Error('extra PNG scanline bytes');
  return { type: 'PNG', width, height };
}

/** Whole JPEG marker/entropy-stream validation, including progressive multi-scan images.
 * This checks structure, dimensions and termination; it is not a JPEG pixel decoder. */
function jpeg(bytes: Buffer): ImageInfo {
  let at = 2, width = 0, height = 0, frame = false, scan = false, entropy = false;
  const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  while (at < bytes.length) {
    if (entropy) {
      while (at < bytes.length) {
        if (bytes[at] !== 0xff) { at++; continue; }
        const start = at;
        while (bytes[at] === 0xff) at++;
        if (at >= bytes.length) throw new Error('truncated JPEG entropy marker');
        if (bytes[at] === 0x00 || bytes[at] >= 0xd0 && bytes[at] <= 0xd7) { at++; continue; }
        at = start; entropy = false; break;
      }
    }
    if (bytes[at++] !== 0xff) throw new Error('invalid JPEG marker');
    while (bytes[at] === 0xff) at++;
    if (at >= bytes.length) throw new Error('truncated JPEG marker');
    const marker = bytes[at++];
    if (marker === 0xd9) {
      if (!frame || !scan || at !== bytes.length) throw new Error('incomplete JPEG or trailing bytes');
      return { type: 'JPEG', width, height };
    }
    if (marker === 0 || marker === 0xd8 || marker >= 0xd0 && marker <= 0xd7) throw new Error('unexpected JPEG marker');
    if (marker === 0x01) continue;
    if (at + 2 > bytes.length) throw new Error('truncated JPEG segment');
    const size = bytes.readUInt16BE(at), end = at + size;
    if (size < 2 || end > bytes.length) throw new Error('invalid JPEG segment size');
    if (sof.has(marker)) {
      if (frame || size < 8) throw new Error('invalid JPEG frame');
      height = bytes.readUInt16BE(at + 3); width = bytes.readUInt16BE(at + 5);
      dimensions(width, height);
      if (!bytes[at + 7] || size !== 8 + 3 * bytes[at + 7]) throw new Error('invalid JPEG frame components');
      frame = true;
    }
    if (marker === 0xda) {
      if (!frame || size < 6 || size !== 6 + 2 * bytes[at + 2]) throw new Error('invalid JPEG scan');
      scan = true; entropy = true;
    }
    at = end;
  }
  throw new Error('JPEG lacks complete EOI');
}

export function imageInfo(bytes: Buffer): ImageInfo {
  if (bytes.subarray(0, 8).equals(pngMagic)) return png(bytes);
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return jpeg(bytes);
  throw new Error('not PNG or JPEG');
}
