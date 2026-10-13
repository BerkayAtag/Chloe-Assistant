import test from 'node:test';
import assert from 'node:assert/strict';
import { previewSkill, searchSkillCatalog } from '../src/lib/skills.ts';
import { DEFAULT_SETTINGS } from '../src/lib/settings.ts';
import { thinkingOptions } from '../src/lib/thinking-options.ts';

test('skill preview validates Agent Skills metadata and shows a stable content hash', async () => {
  const originalFetch = globalThis.fetch;
  const content = `---\nname: demo\ndescription: >-\n  A valid demonstration skill\n  with a folded description.\n---\n\nInstructions.\n`;
  globalThis.fetch = async (input) => {
    if (String(input).includes('/git/trees/main?recursive=1')) {
      return new Response(JSON.stringify({ tree: [{ path: 'skills/demo/SKILL.md', type: 'blob', mode: '100644' }] }), { status: 200 });
    }
    return new Response(content, { status: 200 });
  };
  try {
    const result = await previewSkill('https://github.com/acme/demo/tree/main/skills/demo');
    assert.equal(result.name, 'demo');
    assert.equal(result.description, 'A valid demonstration skill with a folded description.');
    assert.match(result.sha256, /^[a-f0-9]{64}$/);
    assert.match(result.content, /Instructions\./);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('skill importer rejects non-GitHub URLs before making a request', async () => {
  await assert.rejects(previewSkill('https://example.com/owner/repo/tree/main/skill'), /HTTPS GitHub/);
});

test('AI Hero catalogue discovers named repository SKILL.md entries', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => new Response(JSON.stringify(String(input).endsWith('/repos/mattpocock/skills')
    ? { default_branch: 'main' }
    : { tree: [
        { path: 'skills/engineering/code-review/SKILL.md', type: 'blob', mode: '100644' },
        { path: 'skills/research/deep-research/SKILL.md', type: 'blob', mode: '100644' },
        { path: 'README.md', type: 'blob', mode: '100644' },
      ] }), { status: 200 });
  try {
    const result = await searchSkillCatalog('ai-hero', 'code-review');
    assert.equal(result.length, 1);
    assert.match(result[0].sourceUrl, /mattpocock\/skills\/tree\/main\/skills\/engineering\/code-review$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('thinking mode maps only to known compatible provider model APIs', () => {
  const settings = { ...DEFAULT_SETTINGS, cloudProvider: 'gemini', cloudModel: 'gemini-3.1-flash', thinkingMode: 'high' };
  assert.deepEqual(thinkingOptions(settings), { google: { thinkingLevel: 'high', store: false } });
  assert.deepEqual(thinkingOptions({ ...settings, cloudModel: 'gemini-2.5-flash', thinkingMode: 'fast' }), { google: { thinkingBudget: 0, store: false } });
  assert.deepEqual(thinkingOptions({ ...settings, cloudProvider: 'openai', cloudModel: 'gpt-4o' }), undefined);
  assert.deepEqual(thinkingOptions({ ...settings, cloudProvider: 'openai', cloudModel: 'o3', thinkingMode: 'high' }), { openai: { reasoningEffort: 'high' } });
  assert.deepEqual(thinkingOptions({ ...settings, cloudProvider: 'custom' }), undefined);
});
