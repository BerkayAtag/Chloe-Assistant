import path from 'node:path';
import { listWorkspaceEntries, readWorkspaceFile } from './codex-workspace.ts';

/** A bounded, read-only inventory. Does not run scripts or send files to AI. */
export function analyzeProject(workspace: string) {
  const tree = listWorkspaceEntries(workspace); const files = tree.entries.filter((e) => e.type === 'file');
  const languages: Record<string, number> = {}; const manifests: { path: string; dependencies: string[]; scripts: string[] }[] = []; const warnings: string[] = [];
  for (const file of files) { const ext = path.extname(file.path).toLowerCase(); if (ext) languages[ext] = (languages[ext] || 0) + 1; }
  for (const file of files.filter((f) => path.basename(f.path) === 'package.json').slice(0, 12)) {
    try {
      const pkg = JSON.parse(readWorkspaceFile(tree.root, file.path).source);
      manifests.push({ path: file.path, dependencies: [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})].slice(0, 100), scripts: Object.keys(pkg.scripts || {}).slice(0, 40) });
    } catch { warnings.push(`${file.path}: manifest okunamadı veya sınırı aştı.`); }
  }
  const tests = files.filter((f) => /(^|\/)(__tests__|tests?|e2e)\/|[.-](test|spec)\.|Tests\//i.test(f.path)).map((f) => f.path);
  const markers = files.filter((f) => /(^|\/)(Package.swift|pyproject.toml|requirements.txt|Cargo.toml|go.mod|Dockerfile|README.md|AGENTS.md|next.config.[cm]?[jt]s)$/.test(f.path)).map((f) => f.path);
  if (!tests.length) warnings.push('Taranan kapsamda test dosyası bulunmadı; bu, projede hiç test olmadığını kanıtlamaz.');
  if (tree.truncated) warnings.push('Envanter en fazla 500 girdi / 7 klasör seviyesiyle sınırlı; derin alanlar incelenmedi.');
  const markdown = [`# Proje envanteri`, `Klasör: ${tree.root}`, `Tarih: ${new Date().toISOString()}`, `## Kapsam\n${files.length} dosya. Salt okunur envanter; kod/test çalıştırılmadı. Kimlik bilgisi, bağımlılık ve derleme klasörleri hariçtir. Güvenlik denetimi veya tüm projenin anlaşılması anlamına gelmez.`, `## Dosya türleri\n${Object.entries(languages).sort((a,b) => b[1]-a[1]).map(([k,v]) => `- ${k}: ${v}`).join('\n')}`, `## Manifestler\n${manifests.map((m) => `### ${m.path}\nKomut adları (çalıştırılmadı): ${m.scripts.join(', ') || 'yok'}\nBağımlılıklar: ${m.dependencies.join(', ') || 'yok'}`).join('\n\n')}`, `## Giriş belgeleri / yapı işaretleri\n${markers.join('\n') || 'Bulunamadı'}`, `## Test adayları\n${tests.join('\n') || 'Bulunamadı'}`, `## Sınırlar ve uyarılar\n${warnings.join('\n') || 'Ek uyarı yok.'}`, `## Dosya haritası\n${files.map((f) => f.path).join('\n')}`].join('\n\n');
  return { root: tree.root, fileCount: files.length, truncated: tree.truncated, languages, manifests, tests, warnings, markdown };
}
