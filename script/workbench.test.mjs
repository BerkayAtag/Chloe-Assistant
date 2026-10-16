import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseResearchPage, robotsAllows, crawlSite } from '../src/lib/site-research.ts';
import { publicAddress, PublicPageError } from '../src/lib/public-page.ts';
import { analyzeProject } from '../src/lib/project-analysis.ts';
import { reviewArtifacts, assertArtifactReviewed } from '../src/lib/office-review.ts';
import { BUILTIN_SKILLS, defaultSkillIds } from '../src/lib/builtin-skills.ts';
import { assignedSkillInstructions, isInstalledSkill, listInstalledSkills } from '../src/lib/skills.ts';

test('bundled skills have stable identities, visible sources and default role assignments', () => {
  assert.equal(new Set(BUILTIN_SKILLS.map(s => s.id)).size, 5);
  assert.deepEqual(defaultSkillIds('developer'), ['builtin-codebase', 'builtin-replica']);
  for (const skill of BUILTIN_SKILLS) {
    assert.ok(isInstalledSkill(skill.id));
    assert.match(listInstalledSkills().find(s => s.id === skill.id).sha256, /^[a-f0-9]{64}$/);
    assert.match(assignedSkillInstructions([skill.id]), /güvenilmeyen içerik/);
    assert.ok(assignedSkillInstructions([skill.id]).includes(skill.content));
  }
});
test('HTML extraction removes executable content and follows same-origin non-query links only', () => {
  const p = parseResearchPage('<title>Company &amp; Co</title><script>secret-script</script><style>secret-style</style><p>Public facts</p><a href="/about">About</a><a href="https://other.test/">Other</a><a href="/login?token=secret">Login</a><a href="/about#team">Team</a>', 'https://example.com/');
  assert.equal(p.title, 'Company & Co'); assert.ok(!p.text.includes('secret-'));
  assert.deepEqual(p.links, ['https://example.com/about']);
  assert.equal(parseResearchPage('<p>Chloe&#x27;s &#351; &#128512;</p>', 'https://example.com').text, "Chloe's ş 😀");
});
test('robots selects specific agent, longest path, allow tie and wildcard end', () => {
  const rules = 'User-agent: *\nDisallow: /\nUser-agent: Chloe\nDisallow: /private\nAllow: /private/public\nDisallow: /*.pdf$';
  assert.ok(robotsAllows(rules, 'https://example.com/about'));
  assert.ok(!robotsAllows(rules, 'https://example.com/private/x'));
  assert.ok(robotsAllows(rules, 'https://example.com/private/public'));
  assert.ok(!robotsAllows(rules, 'https://example.com/report.pdf'));
  assert.ok(robotsAllows('User-agent: *\nDisallow: /a\nAllow: /a', 'https://example.com/a'));
});
test('public IP boundary excludes loopback, private, link local and reserved ranges', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '169.254.1.1', '192.168.1.1', '100.64.1.1', '198.18.1.1', '203.0.113.1', '::1', '224.0.0.1', '999.0.0.1']) assert.equal(publicAddress(ip), false, ip);
  assert.ok(publicAddress('1.1.1.1'));
});
test('crawl checks robots and respects same-origin, cap, source metadata and blocked pages', async () => {
  const seen = [];
  const reader = async (url, signal, origin, allow) => {
    seen.push(url); assert.equal(origin, 'https://example.com'); signal.throwIfAborted(); if (allow) assert.ok(allow(url));
    const text = url.endsWith('robots.txt') ? 'User-agent: *\nDisallow: /private' : '<title>Test</title><p>Public source.</p><a href="/private">Private</a><a href="/about">About</a><a href="https://other.test/">Other</a>';
    return { bytes: Buffer.from(text), mime: 'text/html', url };
  };
  const result = await crawlSite('https://example.com', 2, undefined, reader);
  assert.equal(result.pages.length, 2); assert.match(result.markdown, /Erişim:/);
  assert.equal(seen[0], 'https://example.com/robots.txt'); assert.ok(!seen.some(u => u.includes('/private') || u.includes('other.test')));
});
test('robots failure fails closed; missing robots is allowed; abort prevents crawling', async () => {
  await assert.rejects(crawlSite('https://example.com', 1, undefined, async () => { throw new Error('offline'); }), /başlatılmadı/);
  const reader = async (url) => { if (url.endsWith('robots.txt')) throw new PublicPageError('not found', 404); return { bytes: Buffer.from('test source'), mime: 'text/plain', url }; };
  assert.equal((await crawlSite('https://example.com', 1, undefined, reader)).pages.length, 1);
  await assert.rejects(crawlSite('https://example.com', 1, AbortSignal.abort(), reader));
});
test('invalid crawler URLs and caps are rejected before network', async () => {
  for (const url of ['http://example.com', 'https://user:secret@example.com', 'https://example.com/?token=x']) await assert.rejects(crawlSite(url));
  await assert.rejects(crawlSite('https://example.com', 7), /1–6/);
});
test('project inventory excludes secret directories and symlinks and never executes scripts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chloe-inventory-'));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'touch SHOULD_NOT_EXIST' }, dependencies: { example: '1.0.0' } }));
    fs.writeFileSync(path.join(root, 'main.test.ts'), 'test'); fs.writeFileSync(path.join(root, '.env'), 'SECRET'); fs.symlinkSync('/etc/passwd', path.join(root, 'linked.txt'));
    const result = analyzeProject(root);
    assert.equal(result.fileCount, 2); assert.deepEqual(result.tests, ['main.test.ts']); assert.deepEqual(result.manifests[0].scripts, ['test']);
    assert.ok(!result.markdown.includes('SECRET')); assert.ok(!result.markdown.includes('linked.txt')); assert.ok(!fs.existsSync(path.join(root, 'SHOULD_NOT_EXIST')));
  } finally { fs.rmSync(root, { recursive: true }); }
});
test('artifact gate blocks missing, negative and stale reviews', () => {
  const a = { id: 'a', path: 'x.ts', content: 'first', originalHash: '', applied: false };
  assert.throws(() => assertArtifactReviewed(a), /denetim/);
  reviewArtifacts(JSON.stringify({ reviews: [{ path: 'x.ts', verdict: 'changes_requested', summary: 'Missing error handling' }] }), [a]);
  assert.throws(() => assertArtifactReviewed(a), /denetim/);
  reviewArtifacts(JSON.stringify({ reviews: [{ path: 'x.ts', verdict: 'approved', summary: 'No blocking issue; tests not run' }] }), [a]);
  assertArtifactReviewed(a); assert.equal(a.review.testsExecuted, false);
  a.content = 'changed'; assert.throws(() => assertArtifactReviewed(a), /denetim/);
});
test('malformed/incomplete review cannot partially approve artifacts', () => {
  const a = { path: 'a.ts', content: 'a' }; const b = { path: 'b.ts', content: 'b' };
  assert.throws(() => reviewArtifacts('{"reviews":[{"path":"a.ts","verdict":"approved","summary":"ok"}]}', [a,b]));
  assert.equal(a.review, undefined); assert.equal(b.review, undefined);
  assert.throws(() => reviewArtifacts('```json\n{"reviews":[{"path":"a.ts","verdict":"approved","summary":""}]}\n```', [a]));
});
test('memory retains, scopes, ranks, corrects, archives and survives module reload without erasing corrupt data', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chloe-memory-qa-'));
  process.env.CHLOE_MEMORY_DIR = directory;
  const m = await import('../src/lib/memory-bank.ts');
  try {
    const global = m.retainMemory({ kind: 'fact', title: 'Mimari', text: 'TypeScript kullanılır.', scope: '', sources: ['https://example.com'] });
    m.retainMemory({ kind: 'experience', title: 'Özel', text: 'Project secret note', scope: '/project-b', sources: [] });
    assert.equal(m.recallMemories('', '/project-a').length, 1);
    assert.equal(m.recallMemories('TypeScript')[0].id, global.id);
    const corrected = m.retainMemory({ kind: 'fact', title: 'Mimari', text: 'TypeScript ve Swift kullanılır.', scope: '', sources: [], replaces: global.id });
    assert.equal(m.recallMemories().length, 1); assert.equal(m.recallMemories('', '', true).length, 2);
    assert.throws(() => m.archiveMemory(global.id, false), /düzeltmesi/);
    m.archiveMemory(corrected.id, true); m.archiveMemory(global.id, false);
    assert.equal(m.recallMemories()[0].id, global.id);
    assert.throws(() => m.archiveMemory(corrected.id, false), /önceki sürümü/);
    const reread = await import('../src/lib/memory-bank.ts?reload=1'); assert.equal(reread.recallMemories()[0].id, global.id);
    assert.match(m.memoryBankContext('TypeScript'), /talimat değil/);
    assert.throws(() => m.retainMemory({ kind: 'fact', title: 'bad', text: 'bad', scope: '', sources: ['javascript:alert(1)'] }), /Kaynaklar/);
    assert.equal(fs.statSync(path.join(directory, 'records.json')).mode & 0o777, 0o600);
    fs.writeFileSync(path.join(directory, 'records.json'), '{broken');
    assert.throws(() => m.retainMemory({ kind: 'fact', title: 'new', text: 'new', scope: '', sources: [] }));
    assert.equal(fs.readFileSync(path.join(directory, 'records.json'), 'utf8'), '{broken');
  } finally { fs.rmSync(directory, { recursive: true }); delete process.env.CHLOE_MEMORY_DIR; }
});
