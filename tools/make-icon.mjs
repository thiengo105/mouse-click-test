// Generates a 1024x1024 RGBA PNG of a mouse silhouette, with no image
// dependencies: raw pixel buffer -> zlib deflate -> PNG chunks.
import zlib from 'node:zlib';
import fs from 'node:fs';

const S = 1024;
const px = Buffer.alloc(S * S * 4);

const BG = [24, 28, 35, 255];
const FG = [230, 237, 243, 255];
const ACCENT = [76, 154, 255, 255];

const set = (x, y, c) => {
  const i = (y * S + x) * 4;
  px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = c[3];
};

// Signed distance to a rounded rectangle, used for both the tile and the body.
const sdRoundRect = (px_, py, cx, cy, hw, hh, r) => {
  const qx = Math.abs(px_ - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};

// Coverage of a shape at a pixel, sampled 3x3 for antialiasing.
const cover = (x, y, fn) => {
  let hits = 0;
  for (let sy = 0; sy < 3; sy++)
    for (let sx = 0; sx < 3; sx++)
      if (fn(x + (sx + 0.5) / 3, y + (sy + 0.5) / 3) <= 0) hits++;
  return hits / 9;
};

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

const cx = S / 2;
const bodyTop = 168, bodyBot = 872;
const bodyCy = (bodyTop + bodyBot) / 2;
const bodyHh = (bodyBot - bodyTop) / 2;
const bodyHw = 236;

// Mouse body: a rounded rect with a much rounder top than a plain radius gives,
// approximated by blending toward an ellipse across the upper half.
const bodyShape = (x, y) => {
  const rect = sdRoundRect(x, y, cx, bodyCy, bodyHw, bodyHh, 200);
  const ell = Math.hypot((x - cx) / bodyHw, (y - bodyTop - 210) / 210) - 1;
  return y < bodyTop + 210 ? Math.max(rect, ell) : rect;
};

const seamY = bodyTop + 300;
const wheelShape = (x, y) => sdRoundRect(x, y, cx, bodyTop + 148, 30, 74, 30);

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    // Tile background
    let c = BG;
    const tile = cover(x, y, (a, b) => sdRoundRect(a, b, cx, cx, 512, 512, 200));
    c = mix([0, 0, 0, 0], BG, tile);

    // Body outline: a ring around the body edge
    const bodyD = bodyShape(x + 0.5, y + 0.5);
    const ring = cover(x, y, (a, b) => Math.abs(bodyShape(a, b)) - 13);
    if (ring > 0) c = mix(c, FG, ring);

    // Seam between the two primary buttons
    if (bodyD < 0) {
      const seam = cover(x, y, (a, b) =>
        Math.max(Math.abs(b - seamY) - 6, bodyShape(a, b) + 8)
      );
      if (seam > 0) c = mix(c, FG, seam);
      const split = cover(x, y, (a, b) =>
        Math.max(Math.abs(a - cx) - 6, Math.max(bodyShape(a, b) + 8, b - seamY))
      );
      if (split > 0) c = mix(c, FG, split);
    }

    // Scroll wheel, in the accent colour
    const wheel = cover(x, y, wheelShape);
    if (wheel > 0) c = mix(c, ACCENT, wheel);

    set(x, y, c);
  }
}

// --- PNG encoding ---------------------------------------------------------
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0; // filter: none
  px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
}

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
};

let TABLE = null;
function crc32(buf) {
  if (!TABLE) {
    TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABLE[n] = c;
    }
  }
  let c = -1;
  for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // colour type: RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

fs.writeFileSync(process.argv[2], png);
console.log(`wrote ${process.argv[2]} (${(png.length / 1024).toFixed(1)} KB)`);
