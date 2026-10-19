// GERÇEK sağlayıcıyla uçtan uca kodlama testi: klasör ver → AI kod yazsın →
// dosyaya kaydedilsin → klasörde çalıştırılabilsin. Anahtar hiç yazdırılmaz.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const base = process.env.CHLOE_TEST_URL || 'http://127.0.0.1:3004';
const headers = { 'Content-Type': 'application/json', Origin: base, 'x-chloe-settings': '1' };
let checks = 0;
const check = (label, ok, extra = '') => { assert.ok(ok, label); console.log('PASS', label, extra); checks++; };
const post = async (route, body) => {
  const response = await fetch(base + route, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(130_000) });
  return { status: response.status, data: await response.json().catch(() => ({})) };
};

// 1) Kasadan etkin bağlantıyı al (anahtar loglanmaz)
const vault = await (await fetch(base + '/api/settings', { headers })).json();
const connection = vault.connection || vault;
const settings = {
  provider: connection.provider, cloudProvider: connection.cloudProvider, cloudModel: connection.cloudModel,
  apiKey: connection.apiKey, apiBaseUrl: connection.apiBaseUrl, customProviderName: connection.customProviderName,
  customModel: connection.customModel, customSupportsTools: connection.customSupportsTools,
  savedCustomProviders: [], selectedCustomProviderIds: '', selectedCustomProviderId: '',
  ollamaUrl: connection.ollamaUrl, ollamaModel: connection.ollamaModel,
};
check('kasadan etkin bağlantı okundu', Boolean(settings.apiKey), `(sağlayıcı: ${settings.cloudProvider})`);

// 2) Kullanıcının verdiği klasörü taklit eden izole proje
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'chloe-kod-'));
await fs.mkdir(path.join(root, 'src'), { recursive: true });
await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
  name: 'chloe-kod-testi', type: 'module',
  scripts: { test: 'node -e "import(\'./src/greet.js\').then(m=>{const s=m.greet(\'Ada\');console.log(\'KOD_CALISTI:\'+s);if(!s.includes(\'Ada\'))process.exit(1)})"' },
}, null, 2));
await fs.writeFile(path.join(root, 'src/greet.js'), '// boş\nexport function greet() {}\n');

const listed = await post('/api/codex/workspace', { action: 'list', workspace: root });
check('klasör açıldı ve dosyalar listelendi', listed.status === 200 && (listed.data.entries || []).some((e) => e.path === 'src/greet.js'));

// 3) AI'dan gerçek kod iste
const source = await fs.readFile(path.join(root, 'src/greet.js'), 'utf8');
const generated = await post('/api/codex', {
  filename: 'src/greet.js',
  instruction: 'greet(name) fonksiyonunu, verilen ismi "Merhaba <isim>!" biçiminde selamlayan bir metin döndürecek şekilde yaz. Yalnızca tam dosya kodunu döndür.',
  source, settings,
});
check('AI kod üretti', generated.status === 200 && typeof generated.data.source === 'string' && generated.data.source.includes('greet'), `(${(generated.data.source || '').length} karakter)`);

// 4) Öneriyi kullanıcı onayıyla diske yaz
const hash = createHash('sha256').update(source).digest('hex');
const saved = await post('/api/codex/workspace', {
  action: 'save', workspace: root, path: 'src/greet.js', source: generated.data.source, expectedHash: hash,
});
check('kod klasöre kaydedildi', saved.status === 200);
const onDisk = await fs.readFile(path.join(root, 'src/greet.js'), 'utf8');
check('diskteki içerik AI çıktısıyla aynı', onDisk.trim() === String(generated.data.source).trim());

// 5) Klasörde çalıştır (kodlama → çalıştırma zinciri)
const beforeRun = await post('/api/codex/command', { workspace: root, task: 'list' });
check('çalıştırılabilir görevler bulundu', beforeRun.status === 200 && (beforeRun.data.tasks || []).some((t) => t.id === 'test'));
const started = await post('/api/codex/command', { workspace: root, task: 'test' });
check('görev başarıyla tamamlandı', started.status === 200 && started.data.success === true && started.data.exitCode === 0 && !started.data.timedOut);
const output = started.data.output || '';
check('üretilen kod klasörde çalıştı', /KOD_CALISTI:\s*Merhaba Ada/.test(output), `(çıktı: ${output.replace(/\s+/g, ' ').slice(0, 90)})`);

await fs.rm(root, { recursive: true, force: true });
console.log(`TOTAL ${checks} passed. Klasörde uygulama geliştirme akışı doğrulandı.`);
