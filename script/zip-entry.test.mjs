import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { test } from 'node:test';
import { readZipEntry } from '../src/lib/zip-entry.ts';

function zip(entries) {
  const locals = []; const centrals = []; let offset = 0;
  for (const [name, content, method] of entries) {
    const nameBuffer = Buffer.from(name); const raw = Buffer.from(content);
    const data = method === 8 ? deflateRawSync(raw) : raw;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBuffer.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(method, 10);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(nameBuffer.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuffer, data); centrals.push(central, nameBuffer); offset += 30 + nameBuffer.length + data.length;
  }
  const directory = Buffer.concat(centrals); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

test('docx entries are read from deflated and stored ZIP members without external tools', () => {
  const archive = zip([['[Content_Types].xml', '<Types/>', 0], ['word/document.xml', '<w:p>Merhaba dünya</w:p>', 8]]);
  assert.equal(readZipEntry(archive, 'word/document.xml', 1024).toString('utf8'), '<w:p>Merhaba dünya</w:p>');
  assert.equal(readZipEntry(archive, '[Content_Types].xml', 1024).toString('utf8'), '<Types/>');
});

test('missing entries, oversized entries and non-ZIP data are rejected', () => {
  const archive = zip([['word/document.xml', 'x'.repeat(4096), 8]]);
  assert.throws(() => readZipEntry(archive, 'word/missing.xml', 1024 * 1024), /bulunamadı/);
  assert.throws(() => readZipEntry(archive, 'word/document.xml', 100), /sınırını/);
  assert.throws(() => readZipEntry(Buffer.from('not a zip file at all, definitely'), 'word/document.xml', 100), /ZIP/);
});
