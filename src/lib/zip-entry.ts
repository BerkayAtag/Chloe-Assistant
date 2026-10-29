import { inflateRawSync } from 'node:zlib';

// Reads one entry from a ZIP archive (e.g. word/document.xml inside a .docx)
// without shelling out to `unzip`, which Windows does not ship.
export function readZipEntry(archive: Buffer, name: string, maxBytes: number): Buffer {
  const eocdMin = 22;
  let eocd = -1;
  for (let i = archive.length - eocdMin; i >= Math.max(0, archive.length - eocdMin - 0xffff); i--) {
    if (archive.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP dizini bulunamadı.');
  const count = archive.readUInt16LE(eocd + 10);
  let offset = archive.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (offset + 46 > archive.length || archive.readUInt32LE(offset) !== 0x02014b50) throw new Error('ZIP dizini bozuk.');
    const method = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const size = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    const entryName = archive.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (entryName !== name) continue;
    if (size > maxBytes) throw new Error('Belge içeriği okuma sınırını aşıyor.');
    if (localOffset + 30 > archive.length || archive.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('ZIP girdisi bozuk.');
    const start = localOffset + 30 + archive.readUInt16LE(localOffset + 26) + archive.readUInt16LE(localOffset + 28);
    const data = archive.subarray(start, start + compressedSize);
    if (method === 0) return Buffer.from(data);
    if (method === 8) return inflateRawSync(data, { maxOutputLength: maxBytes });
    throw new Error('Desteklenmeyen ZIP sıkıştırması.');
  }
  throw new Error(name + ' bulunamadı.');
}
