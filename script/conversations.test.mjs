import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('invalid titles cannot poison persisted conversations or break the sidebar', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chloe-conversations-'));
  const previous = process.env.CHLOE_DATA_DIR;
  process.env.CHLOE_DATA_DIR = directory;
  try {
    const db = await import('../src/lib/db.ts');
    const conversation = db.createConversation('  Merhaba  ');
    assert.equal(conversation.title, 'Merhaba');
    const before = fs.readFileSync(path.join(directory, 'conversations.json'), 'utf8');
    for (const title of [{ broken: true }, [], 42, false, 'a'.repeat(301)]) {
      assert.throws(() => db.createConversation(title), TypeError);
      assert.throws(() => db.renameConversation(conversation.id, title), TypeError);
    }
    assert.throws(() => db.renameConversation(conversation.id, '   '), TypeError);
    assert.equal(fs.readFileSync(path.join(directory, 'conversations.json'), 'utf8'), before);
    assert.equal(db.renameConversation(conversation.id, 'Yeni').title, 'Yeni');
    db.addMessage(conversation.id, 'user', 'Bir mesaj');
    assert.equal(db.searchMemory('mesaj').length, 1);
    assert.equal(db.deleteConversation(conversation.id), true);
    assert.deepEqual(db.getAllConversations(), []);
  } finally {
    if (previous === undefined) delete process.env.CHLOE_DATA_DIR; else process.env.CHLOE_DATA_DIR = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
