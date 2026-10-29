// Packs the macOS iconset PNGs into a Windows .ico (PNG-compressed entries).
// Usage: node windows/make-icon.mjs <output.ico>
import fs from 'node:fs';
import path from 'node:path';

const iconset = path.join(import.meta.dirname, '..', 'macos', 'Resources', 'Chloe.iconset');
const sizes = [[16, 'icon_16x16.png'], [32, 'icon_32x32.png'], [64, 'icon_32x32@2x.png'], [128, 'icon_128x128.png'], [256, 'icon_256x256.png']];
const images = sizes.map(([size, name]) => [size, fs.readFileSync(path.join(iconset, name))]);

const header = Buffer.alloc(6); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
const entries = []; let offset = 6 + 16 * images.length;
for (const [size, data] of images) {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0); entry.writeUInt8(size >= 256 ? 0 : size, 1);
  entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6); entry.writeUInt32LE(data.length, 8); entry.writeUInt32LE(offset, 12);
  entries.push(entry); offset += data.length;
}
fs.writeFileSync(process.argv[2], Buffer.concat([header, ...entries, ...images.map(([, data]) => data)]));
