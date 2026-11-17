import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const iconsDir = path.resolve("src-tauri/icons");
fs.mkdirSync(iconsDir, { recursive: true });

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

/** Generates a valid RGBA PNG with a Cyberdyne obsidian rounded square & glowing crimson core */
function createCyberdynePng(size) {
  const raw = Buffer.alloc(size * (1 + size * 4));
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const maxR = size * 0.46;
  const innerRingR = size * 0.28;
  const coreR = size * 0.14;

  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const px = rowStart + 1 + x * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Rounded rect mask
      const rx = Math.max(0, Math.abs(dx) - size * 0.32);
      const ry = Math.max(0, Math.abs(dy) - size * 0.32);
      const cornerDist = Math.sqrt(rx * rx + ry * ry);

      if (cornerDist > size * 0.16) {
        raw[px] = 0;
        raw[px + 1] = 0;
        raw[px + 2] = 0;
        raw[px + 3] = 0;
      } else if (dist <= coreR) {
        // Glowing T-800 crimson core
        raw[px] = 239;
        raw[px + 1] = 68;
        raw[px + 2] = 68;
        raw[px + 3] = 255;
      } else if (Math.abs(dist - innerRingR) <= Math.max(1.2, size * 0.035)) {
        // Crimson HUD ring
        raw[px] = 220;
        raw[px + 1] = 38;
        raw[px + 2] = 38;
        raw[px + 3] = 235;
      } else if (dist <= maxR) {
        // Obsidian matte interior
        raw[px] = 14;
        raw[px + 1] = 16;
        raw[px + 2] = 22;
        raw[px + 3] = 255;
      } else {
        // Titanium border
        raw[px] = 39;
        raw[px + 1] = 43;
        raw[px + 2] = 54;
        raw[px + 3] = 255;
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth 8
  ihdr[9] = 6; // color type 6 = RGBA!
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function createIcoFromPng(pngBuf, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // ICO
  header.writeUInt16LE(1, 4); // 1 image

  const dir = Buffer.alloc(16);
  dir[0] = size >= 256 ? 0 : size;
  dir[1] = size >= 256 ? 0 : size;
  dir[2] = 0;
  dir[3] = 0;
  dir.writeUInt16LE(1, 4);
  dir.writeUInt16LE(32, 6);
  dir.writeUInt32LE(pngBuf.length, 8);
  dir.writeUInt32LE(22, 12);

  return Buffer.concat([header, dir, pngBuf]);
}

const png32 = createCyberdynePng(32);
const png128 = createCyberdynePng(128);
const ico = createIcoFromPng(png32, 32);

fs.writeFileSync(path.join(iconsDir, "32x32.png"), png32);
fs.writeFileSync(path.join(iconsDir, "128x128.png"), png128);
fs.writeFileSync(path.join(iconsDir, "icon.ico"), ico);
console.log("Generated Cyberdyne RGBA icons.");
