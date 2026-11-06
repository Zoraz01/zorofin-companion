'use strict';

// Checks a downloaded PNG or JPEG without decoding it, and drops the parts a
// browser doesn't need (text, EXIF and other metadata, PNG animation frames).
// Pixels are copied untouched. Anything that isn't a plain PNG or baseline/
// progressive JPEG is refused, so a renamed file or an SVG never gets served.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Ancillary PNG chunks that carry text, metadata or animation.
const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME', 'acTL', 'fcTL', 'fdAT']);
// JPEG frame headers that hold the size (SOF0-15 except DHT, JPG and DAC).
const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const MAX_PIXELS = 20_000_000;

function png(buffer) {
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  const parts = [PNG_SIGNATURE];
  let offset = 8;
  let width = 0;
  let height = 0;
  let sawData = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > buffer.length || !/^[A-Za-z]{4}$/.test(type)) return null;
    if (offset === 8) {
      if (type !== 'IHDR' || length !== 13) return null;
      width = buffer.readUInt32BE(offset + 8);
      height = buffer.readUInt32BE(offset + 12);
    }
    if (type === 'IDAT') sawData = true;
    if (!PNG_DROP.has(type)) parts.push(buffer.subarray(offset, end));
    offset = end;
    if (type === 'IEND') return sawData ? { type: 'png', width, height, body: Buffer.concat(parts) } : null;
  }
  return null;
}

function jpeg(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  const parts = [buffer.subarray(0, 2)];
  let offset = 2;
  let width = 0;
  let height = 0;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    if (marker === 0xff) { offset += 1; continue; }
    const length = buffer.readUInt16BE(offset + 2);
    const end = offset + 2 + length;
    if (length < 2 || end > buffer.length) return null;
    if (JPEG_SOF.has(marker) && length >= 7) {
      height = buffer.readUInt16BE(offset + 5);
      width = buffer.readUInt16BE(offset + 7);
    }
    if (marker === 0xda) {
      // Start of scan: the compressed image follows, up to the end marker.
      if (!width || !height) return null;
      parts.push(buffer.subarray(offset));
      return { type: 'jpg', width, height, body: Buffer.concat(parts) };
    }
    // Keep JFIF (APP0), colour profiles (APP2 ICC) and Adobe colour info (APP14).
    // Drop EXIF/XMP (APP1), other APPn blocks and comments.
    const app = marker >= 0xe0 && marker <= 0xef;
    const keep = !app && marker !== 0xfe
      || marker === 0xe0 || marker === 0xee
      || (marker === 0xe2 && buffer.toString('latin1', offset + 4, offset + 15) === 'ICC_PROFILE');
    if (keep) parts.push(buffer.subarray(offset, end));
    offset = end;
  }
  return null;
}

// Returns { type: 'png' | 'jpg', width, height, body } or null.
function inspectImage(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  const image = png(buffer) || jpeg(buffer);
  if (!image || !image.width || !image.height || image.width * image.height > MAX_PIXELS) return null;
  return image;
}

module.exports = { inspectImage };
