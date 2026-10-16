import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MAX_WORKSPACE_FILE_SIZE = 120_000;
const MAX_TREE_ENTRIES = 500;
const MAX_TREE_DEPTH = 6;
const EXCLUDED_DIRECTORIES = new Set([
  '.aws', '.build', '.cache', '.config', '.git', '.next', '.ssh', '.swiftpm', '.turbo',
  '.vercel', '.vscode-test', '.chloe', '.codex', '__pycache__', 'coverage', 'data',
  'dist', 'build', 'node_modules', 'out', 'target', 'vendor', 'venv',
]);
const EXCLUDED_FILES = new Set([
  '.ds_store', '.netrc', '.npmrc', '.pypirc', 'credentials', 'id_rsa', 'id_ed25519',
  'next-env.d.ts', 'tsconfig.tsbuildinfo',
]);

export class WorkspaceError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'WorkspaceError';
    this.status = status;
  }
}

export function contentHash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

export function resolveWorkspaceRoot(input: string): string {
  if (typeof input !== 'string' || !input.trim() || input.length > 4096) {
    throw new WorkspaceError('Bir proje klasörü seç veya tam yolunu yaz.');
  }
  let root: string;
  try {
    root = fs.realpathSync(input.trim());
  } catch {
    throw new WorkspaceError('Proje klasörü bulunamadı veya erişilemiyor.');
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(root);
  } catch {
    throw new WorkspaceError('Proje klasörü okunamıyor.');
  }
  const home = process.env.HOME ? path.resolve(process.env.HOME) : '';
  if (!stat.isDirectory() || root === path.parse(root).root || (home && root === home)) {
    throw new WorkspaceError('Güvenlik için kök dizin veya kullanıcı ana klasörü yerine belirli bir proje klasörü seç.');
  }
  return root;
}

function excludedPath(relative: string): boolean {
  const segments = relative.split(/[\\/]/u);
  return segments.some((segment) => {
    const lower = segment.toLowerCase();
    return (
      EXCLUDED_DIRECTORIES.has(lower) ||
      lower.startsWith('.next-') ||
      lower === '.venv' ||
      EXCLUDED_FILES.has(lower) ||
      lower.startsWith('.env') ||
      /\.(?:pem|key|p12|pfx|jks|keystore|crt|cer)$/u.test(lower)
    );
  });
}

export function resolveTarget(root: string, relative: string, allowMissing: boolean): string {
  if (typeof relative !== 'string' || !relative || relative.length > 1024 || path.isAbsolute(relative)) {
    throw new WorkspaceError('Dosya yolu geçersiz.');
  }
  const segments = relative.split(/[\\/]/u);
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('\0'))) {
    throw new WorkspaceError('Dosya yolu proje klasörünün dışında.');
  }
  if (excludedPath(relative)) throw new WorkspaceError('Gizli yapılandırma, kimlik bilgisi veya üretilmiş dosyalara bu ekrandan erişilemiyor.', 403);

  let current = root;
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (!allowMissing || (error as NodeJS.ErrnoException).code !== 'ENOENT') {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' && allowMissing) break;
        throw new WorkspaceError('Dosya veya klasör bulunamadı.', 404);
      }
      // A new file is allowed only when its entire parent directory exists.
      // Returning the first missing segment would silently save to the wrong path.
      if (index !== segments.length - 1) throw new WorkspaceError('Yeni dosyanın üst klasörü bulunamadı.', 404);
      continue;
    }
    if (stat.isSymbolicLink()) throw new WorkspaceError('Sembolik bağlantılar üzerinden dosya erişimi engellendi.', 403);
  }
  const resolved = path.resolve(current);
  if (!resolved.startsWith(root + path.sep)) throw new WorkspaceError('Dosya yolu proje klasörünün dışında.', 403);
  return resolved;
}

// Models sometimes repeat the absolute workspace shown in their prompt. Accept
// that spelling only inside this root; resolveTarget still checks every segment.
export function agentWorkspacePath(root: string, input: string, directory = false): string {
  if (typeof input !== 'string' || input.length > 4096 || input.includes('\0')) throw new WorkspaceError('Dosya yolu geçersiz.');
  const relative = path.isAbsolute(input) ? path.relative(root, input) : input;
  if (directory && (relative === '' || relative === '.')) return '';
  resolveTarget(root, relative, true);
  return relative;
}

export function listWorkspaceEntries(inputRoot: string) {
  const root = resolveWorkspaceRoot(inputRoot);
  const entries: Array<{ path: string; type: 'file' | 'directory'; size?: number }> = [];
  const pending: Array<{ absolute: string; relative: string; depth: number }> = [{ absolute: root, relative: '', depth: 0 }];
  let depthLimited = false;

  while (pending.length && entries.length < MAX_TREE_ENTRIES) {
    const current = pending.shift()!;
    let children: fs.Dirent[];
    try {
      children = fs.readdirSync(current.absolute, { withFileTypes: true });
    } catch {
      continue;
    }
    children.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const child of children) {
      if (entries.length >= MAX_TREE_ENTRIES) break;
      const relative = current.relative ? `${current.relative}/${child.name}` : child.name;
      if (excludedPath(relative) || child.isSymbolicLink()) continue;
      const absolute = path.join(current.absolute, child.name);
      if (child.isDirectory()) {
        entries.push({ path: relative, type: 'directory' });
        if (current.depth < MAX_TREE_DEPTH) pending.push({ absolute, relative, depth: current.depth + 1 });
        else depthLimited = true;
      } else if (child.isFile()) {
        try {
          const size = fs.statSync(absolute).size;
          entries.push({ path: relative, type: 'file', size });
        } catch { /* Ignore files removed while the tree is being read. */ }
      }
    }
  }
  return { root, entries, truncated: depthLimited || pending.length > 0 || entries.length >= MAX_TREE_ENTRIES };
}

export function readWorkspaceFile(inputRoot: string, relative: string) {
  const root = resolveWorkspaceRoot(inputRoot);
  const target = resolveTarget(root, relative, false);
  const stat = fs.statSync(target);
  if (!stat.isFile()) throw new WorkspaceError('Seçilen yol bir dosya değil.');
  if (stat.size > MAX_WORKSPACE_FILE_SIZE) throw new WorkspaceError('Dosya 120 KB sınırını aşıyor.', 413);
  const buffer = fs.readFileSync(target);
  if (buffer.includes(0)) throw new WorkspaceError('Bu ikili dosya metin editöründe açılamaz.', 415);
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new WorkspaceError('Dosya geçerli UTF-8 metni değil ve editörde açılamaz.', 415);
  }
  return { path: relative, source, hash: contentHash(source) };
}

export function saveWorkspaceFile(inputRoot: string, relative: string, source: string, expectedHash: string) {
  if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > MAX_WORKSPACE_FILE_SIZE) {
    throw new WorkspaceError('Dosya 120 KB sınırını aşıyor.', 413);
  }
  if (typeof expectedHash !== 'string' || !/^[a-f\d]{64}$/u.test(expectedHash)) {
    throw new WorkspaceError('Dosya sürüm bilgisi geçersiz; dosyayı yeniden aç.', 400);
  }

  const root = resolveWorkspaceRoot(inputRoot);
  const target = resolveTarget(root, relative, true);
  const parent = path.dirname(target);
  let parentReal: string;
  try {
    parentReal = fs.realpathSync(parent);
  } catch {
    throw new WorkspaceError('Yeni dosyanın üst klasörü bulunamadı.', 404);
  }
  if (parentReal !== root && !parentReal.startsWith(root + path.sep)) throw new WorkspaceError('Dosya yolu proje klasörünün dışında.', 403);
  if (fs.existsSync(target) && !fs.statSync(target).isFile()) throw new WorkspaceError('Yalnızca dosyalar kaydedilebilir.');

  const existing = fs.existsSync(target) ? fs.readFileSync(target) : Buffer.alloc(0);
  if (existing.includes(0)) throw new WorkspaceError('İkili dosyaların üzerine yazılamaz.', 415);
  if (existing.byteLength > MAX_WORKSPACE_FILE_SIZE) throw new WorkspaceError('Dosya 120 KB sınırını aşıyor.', 413);
  const current = existing.toString('utf8');
  if (contentHash(current) !== expectedHash) throw new WorkspaceError('Dosya başka bir işlemde değişti; güncel sürümü açıp tekrar dene.', 409);

  const temporary = `${target}.chloe-${crypto.randomUUID()}.tmp`;
  const mode = fs.existsSync(target) ? fs.statSync(target).mode & 0o777 : 0o644;
  try {
    fs.writeFileSync(temporary, source, { encoding: 'utf8', flag: 'wx', mode });
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return { path: relative, hash: contentHash(source), source };
}
