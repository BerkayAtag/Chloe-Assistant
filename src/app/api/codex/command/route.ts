import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { localRequestAllowed } from '@/lib/request-origin';
import { resolveWorkspaceRoot, WorkspaceError } from '@/lib/codex-workspace';

export const maxDuration = 130;

interface RunnableTask {
  id: string;
  label: string;
  executable: string;
  args: string[];
}

const runningWorkspaces = new Set<string>();
const MAX_OUTPUT_BYTES = 160_000;
const TIMEOUT_MS = 120_000;

function availableTasks(root: string) {
  let scripts: Record<string, unknown> = {};
  try {
    const packageJSON = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, unknown> };
    scripts = packageJSON.scripts || {};
  } catch { /* Projects without package.json may still offer Swift and Git tasks. */ }
  const tasks: RunnableTask[] = [];
  if (typeof scripts.test === 'string') tasks.push({ id: 'test', label: 'Testleri çalıştır', executable: 'npm', args: ['test'] });
  for (const script of Object.keys(scripts).filter((name) => name.startsWith('test:')).slice(0, 20)) {
    if (typeof scripts[script] === 'string') tasks.push({ id: script, label: `Test: ${script.slice(5)}`, executable: 'npm', args: ['run', script] });
  }
  for (const script of ['lint', 'build'] as const) {
    if (typeof scripts[script] === 'string') tasks.push({ id: script, label: script === 'lint' ? 'Lint çalıştır' : 'Üretim derlemesi', executable: 'npm', args: ['run', script] });
  }
  if (fs.existsSync(path.join(root, 'node_modules/.bin/tsc'))) {
    tasks.push({ id: 'typecheck', label: 'TypeScript kontrolü', executable: path.join(root, 'node_modules/.bin/tsc'), args: ['--noEmit'] });
  }
  if (fs.existsSync(path.join(root, 'Package.swift'))) tasks.push({ id: 'swiftBuild', label: 'Swift derlemesi', executable: 'swift', args: ['build'] });
  if (fs.existsSync(path.join(root, '.git'))) tasks.push({ id: 'diffCheck', label: 'Git diff kontrolü', executable: 'git', args: ['diff', '--check'] });
  return tasks;
}

function terminateGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

export async function POST(request: Request) {
  if (!localRequestAllowed(request)) return NextResponse.json({ error: 'Proje komutları yalnızca Chloe içinden çalıştırılabilir.' }, { status: 403 });
  if (Number(request.headers.get('content-length') || 0) > 16_000) return NextResponse.json({ error: 'İstek boyutu sınırı aşıldı.' }, { status: 413 });

  let body: unknown;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, 'utf8') > 16_000) return NextResponse.json({ error: 'İstek boyutu sınırı aşıldı.' }, { status: 413 });
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'İstek biçimi geçersiz.' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'İstek biçimi geçersiz.' }, { status: 400 });
  const input = body as Record<string, unknown>;
  if (typeof input.workspace !== 'string' || typeof input.task !== 'string') {
    return NextResponse.json({ error: 'Proje klasörü veya test türü geçersiz.' }, { status: 400 });
  }

  try {
    const root = resolveWorkspaceRoot(input.workspace);
    if (input.task === 'list') return NextResponse.json({ tasks: availableTasks(root) });
    const task = availableTasks(root).find((available) => available.id === input.task);
    if (!task) {
      throw new WorkspaceError('Bu proje için seçilen kontrol komutu kullanılamıyor.');
    }
    if (runningWorkspaces.has(root)) return NextResponse.json({ error: 'Bu projede başka bir kontrol zaten çalışıyor.' }, { status: 409 });
    if (request.signal.aborted) return NextResponse.json({ error: 'İstek iptal edildi.' }, { status: 408 });

    const executable = task.executable;
    runningWorkspaces.add(root);
    try {
      const result = await new Promise<{ output: string; exitCode: number | null; timedOut: boolean; truncated: boolean }>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let byteCount = 0;
        let timedOut = false;
        let truncated = false;
        const child = spawn(executable, [...task.args], {
          cwd: root,
          env: {
            PATH: process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin',
            HOME: process.env.HOME || os.tmpdir(),
            TMPDIR: os.tmpdir(),
            LANG: process.env.LANG || 'en_US.UTF-8',
            NODE_ENV: process.env.NODE_ENV || 'development',
            CI: '1',
            NO_COLOR: '1',
            npm_config_userconfig: '/dev/null',
            npm_config_audit: 'false',
            npm_config_fund: 'false',
          },
          shell: false,
          detached: process.platform !== 'win32',
          stdio: 'pipe',
        });
        child.stdin.end();
        let escalation: ReturnType<typeof setTimeout> | undefined;
        const stop = () => {
          if (child.pid && process.platform !== 'win32') terminateGroup(child.pid, 'SIGTERM');
          else child.kill('SIGTERM');
          escalation ||= setTimeout(() => {
            if (child.pid && process.platform !== 'win32') terminateGroup(child.pid, 'SIGKILL');
            else if (child.exitCode === null) child.kill('SIGKILL');
          }, 2000);
          escalation.unref();
        };
        const append = (chunk: Buffer) => {
          if (byteCount >= MAX_OUTPUT_BYTES) {
            truncated = true;
            stop();
            return;
          }
          const remaining = MAX_OUTPUT_BYTES - byteCount;
          const kept = chunk.subarray(0, remaining);
          chunks.push(kept);
          byteCount += kept.byteLength;
          if (kept.byteLength < chunk.byteLength) {
            truncated = true;
            stop();
          }
        };
        child.stdout.on('data', append);
        child.stderr.on('data', append);
        const timeout = setTimeout(() => {
          timedOut = true;
          stop();
        }, TIMEOUT_MS);
        const abort = stop;
        child.once('error', (error) => {
          clearTimeout(timeout);
          clearTimeout(escalation);
          request.signal.removeEventListener('abort', abort);
          reject(error);
        });
        request.signal.addEventListener('abort', abort, { once: true });
        if (request.signal.aborted) abort();
        child.once('close', (exitCode) => {
          clearTimeout(timeout);
          clearTimeout(escalation);
          request.signal.removeEventListener('abort', abort);
          resolve({ output: Buffer.concat(chunks).toString('utf8'), exitCode, timedOut, truncated });
        });
      });
      return NextResponse.json({
        ...result,
        success: result.exitCode === 0 && !result.timedOut && !request.signal.aborted,
      });
    } finally {
      runningWorkspaces.delete(root);
    }
  } catch (error) {
    const status = error instanceof WorkspaceError ? error.status : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Proje kontrolü çalıştırılamadı.' }, { status });
  }
}
