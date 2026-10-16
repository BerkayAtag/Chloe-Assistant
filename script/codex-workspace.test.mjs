import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import {
  agentWorkspacePath,
  contentHash,
  listWorkspaceEntries,
  readWorkspaceFile,
  resolveWorkspaceRoot,
  saveWorkspaceFile,
  WorkspaceError,
} from '../src/lib/codex-workspace.ts';

let temporaryRoot;
let workspace;
let outside;

before(() => {
  temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'chloe-code-workspace-'));
  workspace = path.join(temporaryRoot, 'project');
  outside = path.join(temporaryRoot, 'outside.txt');
  mkdirSync(path.join(workspace, 'src'), { recursive: true });
  mkdirSync(path.join(workspace, 'node_modules', 'sample'), { recursive: true });
  mkdirSync(path.join(workspace, '.next-backup-test'), { recursive: true });
  writeFileSync(path.join(workspace, 'src', 'app.ts'), 'export const answer = 42;\n');
  writeFileSync(path.join(workspace, '.env.local'), 'API_KEY=never-read');
  writeFileSync(path.join(workspace, 'node_modules', 'sample', 'index.js'), 'ignored');
  writeFileSync(path.join(workspace, '.next-backup-test', 'cache.json'), 'ignored');
  writeFileSync(path.join(workspace, '.DS_Store'), 'ignored');
  writeFileSync(path.join(workspace, 'next-env.d.ts'), 'generated');
  writeFileSync(outside, 'outside project');
  symlinkSync(outside, path.join(workspace, 'src', 'external.txt'));
});

after(() => {
  if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true });
});

test('workspace listing excludes credentials, dependencies, and symbolic links', () => {
  const result = listWorkspaceEntries(workspace);
  const paths = result.entries.map((entry) => entry.path);
  assert.ok(paths.includes('src/app.ts'));
  assert.ok(!paths.some((item) => item.startsWith('node_modules')));
  assert.ok(!paths.some((item) => item.startsWith('.next-backup-')));
  assert.ok(!paths.includes('.env.local'));
  assert.ok(!paths.includes('.DS_Store'));
  assert.ok(!paths.includes('next-env.d.ts'));
  assert.ok(!paths.includes('src/external.txt'));
});

test('file reads return content and a stable SHA-256 version', () => {
  const result = readWorkspaceFile(workspace, 'src/app.ts');
  assert.equal(result.source, 'export const answer = 42;\n');
  assert.equal(result.hash, contentHash(result.source));
});

test('path traversal, absolute paths, symlinks, and credential files are rejected', () => {
  for (const file of ['../outside.txt', path.join(temporaryRoot, 'outside.txt'), 'src/external.txt', '.env.local']) {
    assert.throws(() => readWorkspaceFile(workspace, file), WorkspaceError);
  }
  assert.throws(() => readWorkspaceFile(os.tmpdir(), 'missing'), WorkspaceError);
});

test('saving requires the file version to remain unchanged and supports new files', () => {
  const opened = readWorkspaceFile(workspace, 'src/app.ts');
  const saved = saveWorkspaceFile(workspace, 'src/app.ts', 'export const answer = 43;\n', opened.hash);
  assert.equal(readFileSync(path.join(workspace, 'src', 'app.ts'), 'utf8'), saved.source);
  assert.throws(() => saveWorkspaceFile(workspace, 'src/app.ts', 'stale', opened.hash), /başka bir işlemde değişti/u);

  const created = saveWorkspaceFile(workspace, 'src/new.ts', 'export {};\n', contentHash(''));
  assert.equal(readFileSync(path.join(workspace, 'src', 'new.ts'), 'utf8'), created.source);
});

test('binary files cannot be opened or replaced in the text editor', () => {
  writeFileSync(path.join(workspace, 'src', 'image.bin'), Buffer.from([0, 1, 2]));
  assert.throws(() => readWorkspaceFile(workspace, 'src/image.bin'), /ikili dosya/u);
  assert.throws(() => saveWorkspaceFile(workspace, 'src/image.bin', 'text', contentHash('')), /üzerine yazılamaz/u);
});

test('root-level files can be saved without allowing missing parent directories', () => {
  saveWorkspaceFile(workspace, 'README.md', 'hello', contentHash(''));
  const opened = readWorkspaceFile(workspace, 'README.md');
  saveWorkspaceFile(workspace, 'README.md', 'updated', opened.hash);
  assert.equal(readWorkspaceFile(workspace, 'README.md').source, 'updated');
  assert.throws(() => saveWorkspaceFile(workspace, 'missing/nested.ts', 'wrong target', contentHash('')), /üst klasörü/u);
  assert.throws(() => saveWorkspaceFile(workspace, 'missing/missing', 'wrong target', contentHash('')), /üst klasörü/u);
  assert.throws(() => readWorkspaceFile(workspace, 'missing'), WorkspaceError);
});

test('agent paths accept scoped absolute paths and root listings without weakening boundaries', () => {
  const root = resolveWorkspaceRoot(workspace);
  assert.equal(agentWorkspacePath(root, path.join(root, 'src/app.ts')), 'src/app.ts');
  assert.equal(agentWorkspacePath(root, root, true), '');
  assert.equal(agentWorkspacePath(root, '.', true), '');
  assert.equal(agentWorkspacePath(root, '', true), '');
  for (const input of [outside, '../outside.txt', path.join(root, '.env.local'), path.join(root, 'src/external.txt')]) {
    assert.throws(() => agentWorkspacePath(root, input), WorkspaceError);
  }
});

test('save limit counts UTF-8 bytes instead of JavaScript characters', () => {
  assert.throws(() => saveWorkspaceFile(workspace, 'unicode.txt', '🌍'.repeat(31_000), contentHash('')), /120 KB/u);
});

test('workspace root must be a specific directory, not the filesystem or home root', () => {
  assert.throws(() => resolveWorkspaceRoot('/'), WorkspaceError);
  if (process.env.HOME) assert.throws(() => resolveWorkspaceRoot(process.env.HOME), WorkspaceError);
});
