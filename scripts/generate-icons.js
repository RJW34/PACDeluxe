#!/usr/bin/env node
/**
 * Icon Generator Script
 *
 * Generates placeholder icons for Tauri build.
 * Creates PNG files of required sizes and ICO for Windows.
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { deflateSync } from 'zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ICONS_DIR = join(__dirname, '..', 'src-tauri', 'icons');

// Ensure icons directory exists
if (!existsSync(ICONS_DIR)) {
  mkdirSync(ICONS_DIR, { recursive: true });
}

/**
 * Calculate CRC32
 */
function calculateCRC32(data) {
  let crc = 0xFFFFFFFF;

  // CRC32 table
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }

  for (let i = 0; i < data.length; i++) {
    crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }

  return (crc ^ 0xFFFFFFFF) >>> 0; // Ensure unsigned
}

/**
 * Create a PNG chunk
 */
function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuffer, data]);
  const crc = calculateCRC32(crcData);

  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc, 0);

  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

/**
 * Create a PNG image
 */
function createPNG(size) {
  // Create image data (purple/blue circular gradient)
  const rawData = [];
  for (let y = 0; y < size; y++) {
    rawData.push(0); // Filter byte
    for (let x = 0; x < size; x++) {
      const cx = x - size / 2;
      const cy = y - size / 2;
      const dist = Math.sqrt(cx * cx + cy * cy) / (size / 2);

      // Create a nice gradient (purple center, darker edges)
      const r = Math.floor(Math.max(0, Math.min(255, 100 + (1 - dist) * 80)));
      const g = Math.floor(Math.max(0, Math.min(255, 50 + (1 - dist) * 50)));
      const b = Math.floor(Math.max(0, Math.min(255, 180 + (1 - dist) * 75)));

      rawData.push(r, g, b);
    }
  }

  // PNG signature
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData.writeUInt8(8, 8);   // Bit depth
  ihdrData.writeUInt8(2, 9);   // Color type (RGB)
  ihdrData.writeUInt8(0, 10);  // Compression
  ihdrData.writeUInt8(0, 11);  // Filter
  ihdrData.writeUInt8(0, 12);  // Interlace

  const ihdrChunk = createChunk('IHDR', ihdrData);

  // IDAT chunk (compressed image data)
  const compressedData = deflateSync(Buffer.from(rawData));
  const idatChunk = createChunk('IDAT', compressedData);

  // IEND chunk
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

/**
 * Create ICO file (Windows icon)
 */
function createICO(pngBuffers) {
  // ICO header
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);                    // Reserved
  header.writeUInt16LE(1, 2);                    // Type (1 = ICO)
  header.writeUInt16LE(pngBuffers.length, 4);   // Number of images

  // Directory entries and image data
  const entries = [];
  const images = [];
  let offset = 6 + (pngBuffers.length * 16);

  for (const { size, data } of pngBuffers) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size > 255 ? 0 : size, 0);  // Width (0 = 256)
    entry.writeUInt8(size > 255 ? 0 : size, 1);  // Height (0 = 256)
    entry.writeUInt8(0, 2);                       // Color palette
    entry.writeUInt8(0, 3);                       // Reserved
    entry.writeUInt16LE(1, 4);                   // Color planes
    entry.writeUInt16LE(32, 6);                  // Bits per pixel
    entry.writeUInt32LE(data.length, 8);         // Image size
    entry.writeUInt32LE(offset, 12);             // Offset

    entries.push(entry);
    images.push(data);
    offset += data.length;
  }

  return Buffer.concat([header, ...entries, ...images]);
}

// Main execution
console.log('[generate-icons] Creating Tauri icons...');

// Generate PNG files of various sizes
const sizes = [32, 128, 256];
const pngBuffers = [];

for (const size of sizes) {
  console.log(`[generate-icons] Generating ${size}x${size} PNG...`);
  const png = createPNG(size);
  pngBuffers.push({ size, data: png });

  // Write PNG files
  if (size === 32) {
    writeFileSync(join(ICONS_DIR, '32x32.png'), png);
  } else if (size === 128) {
    writeFileSync(join(ICONS_DIR, '128x128.png'), png);
  } else if (size === 256) {
    writeFileSync(join(ICONS_DIR, '128x128@2x.png'), png); // 2x is 256
    writeFileSync(join(ICONS_DIR, 'icon.png'), png);       // Main icon
  }
}

// Create ICO file for Windows
console.log('[generate-icons] Generating icon.ico...');
const ico = createICO(pngBuffers);
writeFileSync(join(ICONS_DIR, 'icon.ico'), ico);

// Create ICNS placeholder for macOS
// Note: Real ICNS requires specific format, using largest PNG as placeholder
console.log('[generate-icons] Generating icon.icns (PNG placeholder)...');
const largestPng = pngBuffers.find(p => p.size === 256);
writeFileSync(join(ICONS_DIR, 'icon.icns'), largestPng.data);

console.log('[generate-icons] Icons created successfully!');
console.log(`[generate-icons] Output directory: ${ICONS_DIR}`);
