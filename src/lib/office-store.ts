import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DEFAULT_AGENTS, type OfficeAgent, type OfficeRun } from './office-types';
import { isInstalledSkill } from './skills';

const root = path.join(process.cwd(), 'data', 'office');
type StoredAgent = OfficeAgent & { secret?: string };
type OfficeData = { agents: StoredAgent[]; runs: OfficeRun[] };
function prepare() { fs.mkdirSync(root, { recursive: true, mode: 0o700 }); }
function read(): OfficeData {
  prepare();
  const file = path.join(root, 'office.json');
  if (!fs.existsSync(file)) return { agents: structuredClone(DEFAULT_AGENTS), runs: [] };
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(data.agents) || !Array.isArray(data.runs)) throw new Error('Ajan ofisi verileri okunamadı; mevcut dosya korunuyor.');
  return data;
}
function write(data: OfficeData) {
  prepare(); const temp = path.join(root, 'office.json.tmp');
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(temp, path.join(root, 'office.json'));
}
function key() {
  prepare(); const file = path.join(root, '.key');
  if (!fs.existsSync(file)) { try { fs.writeFileSync(file, crypto.randomBytes(32), { mode: 0o600, flag: 'wx' }); } catch (e) { if (!fs.existsSync(file)) throw e; } }
  return fs.readFileSync(file);
}
function seal(value: string) {
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  return Buffer.concat([iv, cipher.update(value), cipher.final(), cipher.getAuthTag()]).toString('base64');
}
function unseal(value: string) {
  const bytes = Buffer.from(value, 'base64'); const decipher = crypto.createDecipheriv('aes-256-gcm', key(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString('utf8');
}
export function officeAgents(includeSecrets = false): OfficeAgent[] {
  return read().agents.map((stored) => {
    const { secret, ...agent } = stored;
    delete agent.apiKey;
    return { ...agent, hasKey: !!secret, ...(includeSecrets ? { apiKey: secret ? unseal(secret) : '' } : {}) };
  });
}
export function saveOfficeAgents(input: unknown) {
  if (!Array.isArray(input) || input.length < 2 || input.length > 8) throw new Error('Ekip 2–8 ajan içermeli.');
  const data = read(); const ids = new Set<string>();
  const next: StoredAgent[] = input.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new Error('Geçersiz ajan.');
    const a = raw as Record<string, unknown>;
    for (const field of ['id', 'name', 'role', 'provider', 'model', 'baseUrl', 'instructions']) if (typeof a[field] !== 'string') throw new Error(`Ajan alanı geçersiz: ${field}`);
    const id = a.id as string;
    if (!/^[a-zA-Z0-9_-]{1,60}$/.test(id) || ids.has(id)) throw new Error('Ajan kimliği geçersiz veya tekrarlanıyor.'); ids.add(id);
    if (!['coordinator', 'researcher', 'developer', 'reviewer'].includes(a.role as string) || !['inherit', 'gemini', 'openai', 'anthropic', 'custom', 'local'].includes(a.provider as string)) throw new Error('Ajan rolü veya sağlayıcı geçersiz.');
    if (!(a.name as string).trim() || (a.name as string).length > 80 || (a.instructions as string).length > 6000 || (a.model as string).length > 150) throw new Error('Ajan adı, modeli veya talimatı geçersiz.');
    if (a.apiKey !== undefined && (typeof a.apiKey !== 'string' || a.apiKey.length > 4096)) throw new Error('API anahtarı geçersiz.');
    const provider = a.provider as OfficeAgent['provider'];
    if (provider !== 'inherit' && !(a.model as string).trim()) throw new Error('Özel ajan için model adı gerekli.');
    if (provider === 'custom' || provider === 'local') {
      const url = new URL(a.baseUrl as string);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('API adresi HTTP(S) olmalı.');
    }
    const previous = data.agents.find((item) => item.id === id);
    // Never forward a saved key to a different provider or custom endpoint.
    const sameConnection = previous?.provider === provider && previous?.baseUrl.replace(/\/+$/, '') === (a.baseUrl as string).trim().replace(/\/+$/, '');
    const secret = a.clearKey === true ? undefined : (a.apiKey as string)?.trim() ? seal((a.apiKey as string).trim()) : sameConnection ? previous?.secret : undefined;
    const skillIds = Array.isArray(a.skillIds) ? [...new Set(a.skillIds)] : [];
    if (skillIds.length > 5 || skillIds.some((skillId) => typeof skillId !== 'string' || !isInstalledSkill(skillId))) {
      throw new Error('Ajan beceri ataması geçersiz veya kurulu olmayan bir beceri seçildi.');
    }
    return { id, name: (a.name as string).trim(), role: a.role as OfficeAgent['role'], provider, model: (a.model as string).trim(), baseUrl: (a.baseUrl as string).trim(), instructions: a.instructions as string, enabled: a.enabled !== false, supportsTools: a.supportsTools !== false, skillIds, secret };
  });
  if (next.filter((a) => a.enabled && a.role === 'coordinator').length !== 1 || !next.some((a) => a.enabled && a.role !== 'coordinator')) throw new Error('Bir koordinatör ve en az bir çalışan ajan etkin olmalı.');
  data.agents = next; write(data); return officeAgents();
}
export function officeRuns() { return read().runs; }
export function saveOfficeRun(run: OfficeRun) {
  const data = read(); const index = data.runs.findIndex((r) => r.id === run.id);
  run.updatedAt = new Date().toISOString();
  if (index < 0) data.runs.unshift(run); else data.runs[index] = run;
  write(data);
}
export function removeOfficeRun(id: string) { const data = read(); data.runs = data.runs.filter((r) => r.id !== id); write(data); }
