'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, AudioLines, Check, ChevronDown, Download, FileText, FolderOpen, Globe, LoaderCircle, MessageSquare, Play, Plus, Search, Settings2, Square, Trash2, Users, X } from 'lucide-react';
import { DEFAULT_AGENTS, ROLE_LABELS, type OfficeAgent, type OfficeRun } from '@/lib/office-types';
import { CLOUD_MODEL_SUGGESTIONS, settingsForRequest, modelLabel, type Settings } from '@/lib/settings';
import { sendNativeAction } from '@/lib/native-bridge';
import type { InstalledSkill, SkillCatalogSource, SkillSummary } from '@/lib/skills';

async function officeAction(body: Record<string, unknown>) {
  const response = await fetch('/api/office', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Ofis işlemi başarısız.'); return data;
}
const ACTIVE = ['planning', 'running'];
const LABELS: Record<OfficeRun['status'], string> = { planning: 'Planlanıyor', running: 'Çalışıyor', completed: 'Tamamlandı', failed: 'Hata', cancelled: 'Durduruldu', interrupted: 'Kesildi' };

function roleSuggestion(role: OfficeAgent['role'], skill: InstalledSkill) {
  const text = `${skill.name} ${skill.description}`.toLowerCase();
  const terms: Record<OfficeAgent['role'], string[]> = {
    coordinator: ['plan', 'project', 'chief', 'triage', 'productivity', 'handoff'],
    researcher: ['research', 'search', 'docs', 'data', 'teach', 'grill'],
    developer: ['code', 'engineer', 'implement', 'debug', 'test', 'frontend', 'backend'],
    reviewer: ['review', 'security', 'audit', 'test', 'quality'],
  };
  return terms[role].some((term) => text.includes(term));
}

function SkillsManager({ initialSkills, onClose, onChange }: { initialSkills: InstalledSkill[]; onClose: () => void; onChange: (skills: InstalledSkill[]) => void }) {
  const [skills, setSkills] = useState(initialSkills);
  const [source, setSource] = useState<SkillCatalogSource>('ai-skills');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<SkillSummary[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [sourceUrl, setSourceUrl] = useState('');
  const [preview, setPreview] = useState<{ sourceUrl: string; name: string; description: string; content: string; sha256: string } | null>(null);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      if (!active) return;
      setLoadingCatalog(true);
      try {
        const response = await fetch(`/api/skills/catalog?source=${source}&q=${encodeURIComponent(query)}`, { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Beceri kataloğu alınamadı.');
        if (active) { setRows(data.skills || []); setMessage(data.message || ''); }
      } catch (error) {
        if (active) { setRows([]); setMessage(error instanceof Error ? error.message : 'Kataloğa bağlanılamadı.'); }
      } finally {
        if (active) setLoadingCatalog(false);
      }
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [source, query]);
  async function inspect(sourceUrl: string) {
    setBusy(sourceUrl); setMessage('');
    try {
      const response = await fetch('/api/skills', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'preview', sourceUrl }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Beceri önizlenemedi.');
      setPreview({ ...data, sourceUrl });
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Beceri önizlenemedi.'); }
    finally { setBusy(''); }
  }
  async function install() {
    if (!preview) return;
    setBusy(preview.sourceUrl); setMessage('');
    try {
      const response = await fetch('/api/skills', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'install', sourceUrl: preview.sourceUrl, expectedHash: preview.sha256 }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Beceri kurulamadı.');
      setSkills(data.skills); onChange(data.skills); setMessage(`“${data.skill.name}” kuruldu ve artık ajanlara atanabilir.`); setPreview(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Beceri kurulamadı.'); }
    finally { setBusy(''); }
  }
  async function uninstall(id: string) {
    setBusy(id); setMessage('');
    try {
      const response = await fetch('/api/skills', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'uninstall', id }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Beceri kaldırılamadı.');
      setSkills(data.skills); onChange(data.skills); setMessage('Beceri kaldırıldı.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Beceri kaldırılamadı.'); }
    finally { setBusy(''); }
  }
  return <div className="office-modal" role="dialog" aria-modal="true" aria-label="Beceri kütüphanesi">
    <div className="office-settings">
      <header><div><h2>Beceri kütüphanesi</h2><p>Gözden geçir, kur ve ajanlara açıkça ata. Skill dosyaları komut çalıştırmaz.</p></div><button onClick={onClose} aria-label="Beceri kütüphanesini kapat"><X size={20}/></button></header>
      <div className="p-4">
        <div className="office-agent-form">
          <label>Katalog<select value={source} onChange={(event) => setSource(event.target.value as SkillCatalogSource)}>
            <option value="ai-skills">ai-skills.io · Kodus seçkisi</option><option value="ai-hero">AI Hero · Matt Pocock</option><option value="standard">Agent Skills standardı</option>
          </select></label>
          {source !== 'standard' && <label>Skill ara<div className="relative"><Search size={16} className="absolute left-3 top-3.5 text-app-muted"/><input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Örn. code review, research"/></div></label>}
          <div className="rounded-xl border border-app-border bg-app-surface p-3 text-xs leading-5 text-app-muted">
            Yalnızca HTTPS GitHub kaynakları alınır. `SKILL.md` biçimi ve boyutu doğrulanır; içerik metin olarak saklanır, içindeki betikler çalıştırılmaz. Ajanlar yalnızca kendilerine atadığın becerileri görür.
            {source === 'standard' && <> Agent Skills sayfası standart belgesidir, katalog değil. Herhangi bir uyumlu GitHub skill klasörünü aşağıdaki alana ekleyebilirsin. <a className="underline" href="https://agentskills.io/home" target="_blank" rel="noreferrer">Standardı oku</a></>}
          </div>
          {source !== 'standard' && <div className="max-h-64 space-y-2 overflow-y-auto">{rows.map((skill) => {
            const installed = skills.some((item) => item.sourceUrl === skill.sourceUrl);
            return <article key={skill.id} className="rounded-xl border border-app-border p-3">
              <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-medium">{skill.name}</h3><p className="mt-1 text-xs text-app-muted">{skill.description}</p></div>
                <button className="shrink-0 rounded-lg border border-app-border px-3 py-2 text-xs disabled:opacity-50" disabled={installed || !!busy} onClick={() => void inspect(skill.sourceUrl)}>{busy === skill.sourceUrl ? 'Yükleniyor…' : installed ? 'Kurulu' : 'Önizle'}</button>
              </div><a href={skill.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 block truncate text-[10px] text-app-accent underline">Kaynak: {skill.sourceUrl}</a>
            </article>;
          })}{!rows.length && <p className="py-3 text-xs text-app-muted">{loadingCatalog ? 'Katalog yükleniyor…' : message || 'Eşleşen beceri yok; aramayı değiştir.'}</p>}</div>}
          <label>GitHub skill klasörünü içe aktar<input type="url" placeholder="https://github.com/owner/repo/tree/main/path/to/skill" value={sourceUrl} onChange={(event) => { setSourceUrl(event.target.value); setMessage(''); }}/></label>
          <button disabled={!!busy} onClick={() => {
            if (sourceUrl.trim()) void inspect(sourceUrl.trim());
            else setMessage('Önce GitHub skill klasör bağlantısını gir.');
          }}>Bağlantıdaki beceriyi doğrula ve kur</button>
          <section className="max-h-64 space-y-2 overflow-y-auto border-t border-app-border pt-4"><h3 className="text-sm font-semibold">Kurulu beceriler · {skills.length}</h3>
            {skills.map((skill) => <div key={skill.id} className="flex items-start justify-between gap-3 rounded-lg border border-app-border p-3"><div><p className="text-sm font-medium">{skill.name}</p><p className="mt-1 text-xs text-app-muted">{skill.description}</p></div><button disabled={!!busy} onClick={() => void uninstall(skill.id)} className="shrink-0 text-xs text-app-danger">Kaldır</button></div>)}
            {!skills.length && <p className="text-xs text-app-muted">Henüz kurulmuş beceri yok.</p>}
          </section>
          {message && <p role="status" className="text-xs text-app-muted">{message}</p>}
        </div>
      </div>
    </div>
    {preview && <div className="office-modal z-[110]" role="dialog" aria-modal="true" aria-label={`${preview.name} beceri önizlemesi`}><div className="office-settings">
      <header><div><h2>{preview.name}</h2><p>{preview.description}</p></div><button onClick={() => setPreview(null)} aria-label="Önizlemeyi kapat"><X size={20}/></button></header>
      <div className="space-y-3 p-5"><p className="break-all text-xs text-app-muted">Kaynak: {preview.sourceUrl}</p><pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-xl border border-app-border bg-app-surface p-3 text-xs">{preview.content}</pre>
        <p className="text-xs text-app-warning">Kurulum, bu önizlemede gösterilen SKILL.md içeriğini onaylar. Kaynak onaydan önce değişirse kurulum reddedilir; hiçbir betik çalıştırılmaz.</p>
        <button className="office-primary" disabled={!!busy} onClick={() => void install()}>{busy === preview.sourceUrl ? 'Kuruluyor…' : 'Bu beceriyi kur'}</button>
      </div>
    </div></div>}
  </div>;
}

function AgentSettings({ agents, settings, skills, initialAgent, onClose, onSaved }: { agents: OfficeAgent[]; settings: Settings; skills: InstalledSkill[]; initialAgent: string; onClose: () => void; onSaved: (agents: OfficeAgent[]) => void }) {
  const [drafts, setDrafts] = useState(agents); const [selected, setSelected] = useState(initialAgent || agents[0].id);
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState('');
  const agent = drafts.find((a) => a.id === selected) || drafts[0];
  function patch(next: Partial<OfficeAgent>) { setDrafts((all) => all.map((a) => a.id === agent.id ? { ...a, ...next } : a)); }
  async function save(test = false) {
    setBusy(true); setNotice('');
    try {
      const data = await officeAction({ action: 'saveAgents', agents: drafts }); onSaved(data.agents); setDrafts(data.agents);
      if (test) { const result = await officeAction({ action: 'testAgent', id: agent.id, settings: settingsForRequest(settings) }); setNotice(`Bağlantı başarılı: ${result.response}`); }
      else setNotice('Ekip kaydedildi. API anahtarları sunucuda şifreli saklanıyor.');
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Ayarlar kaydedilemedi.'); } finally { setBusy(false); }
  }
  return <div className="office-modal" role="dialog" aria-modal="true" aria-label="Ekip ayarları">
    <div className="office-settings">
      <header><div><h2>Ekip ayarları</h2><p>Her ajana farklı bir model, anahtar ve uzmanlık ver.</p></div><button onClick={onClose} aria-label="Ekip ayarlarını kapat"><X size={20}/></button></header>
      <div className="office-settings-body">
        <nav aria-label="Ajanlar">{drafts.map((a) => <button key={a.id} aria-pressed={a.id === agent.id} onClick={() => setSelected(a.id)}><span className="office-initial">{a.name[0]}</span>{a.name}</button>)}
          <button disabled={drafts.length >= 8} onClick={() => { const a: OfficeAgent = { ...DEFAULT_AGENTS[1], id: crypto.randomUUID(), name: 'Yeni ajan' }; setDrafts([...drafts, a]); setSelected(a.id); }}><Plus size={16}/> Ajan ekle</button>
        </nav>
        <div className="office-agent-form">
          <label>Kalıcı kasadan bağlantı seç<select aria-label="Ajan için kayıtlı anahtar" value="" onChange={(event) => {
            const key = settings.savedApiKeys.find((k) => k.id === event.target.value); if (!key) return;
            const profile = settings.savedCustomProviders.find((p) => p.baseUrl.replace(/\/+$/, '') === key.baseUrl.replace(/\/+$/, ''));
            patch({ provider: key.provider, apiKey: key.apiKey, hasKey: true, baseUrl: key.baseUrl,
              model: key.provider === 'custom' ? profile?.model || 'auto' : settings.builtinConnections[key.provider]?.model || CLOUD_MODEL_SUGGESTIONS[key.provider][0],
              supportsTools: profile?.supportsTools ?? true });
            setNotice(`${key.name} seçildi. Bu ajana uygulamak için Kaydet'e bas.`);
          }}><option value="">Mevcut ajan bağlantısını koru</option>{settings.savedApiKeys.map((key) => <option key={key.id} value={key.id}>{key.name}{key.isDefault ? ' · Varsayılan' : ''}</option>)}</select></label>
          <label>Ajan adı<input value={agent.name} maxLength={80} onChange={(e) => patch({ name: e.target.value })}/></label>
          <div className="office-form-row"><label>Rol<select value={agent.role} onChange={(e) => patch({ role: e.target.value as OfficeAgent['role'] })}>{Object.entries(ROLE_LABELS).map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select></label>
            <label>Sağlayıcı<select value={agent.provider} onChange={(e) => { const provider = e.target.value as OfficeAgent['provider']; patch({ provider, apiKey: '', hasKey: false, model: provider === 'inherit' ? '' : provider === 'local' ? 'llama3.2:1b' : provider === 'custom' ? '' : CLOUD_MODEL_SUGGESTIONS[provider][0], baseUrl: provider === 'local' ? 'http://127.0.0.1:11434/v1' : '' }); }}>
              <option value="inherit">Sohbet ayarlarını kullan</option><option value="gemini">Google Gemini</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="custom">OpenAI uyumlu API</option><option value="local">Yerel LLM</option>
            </select></label></div>
          {agent.provider !== 'inherit' && <><label>Model<input value={agent.model} onChange={(e) => patch({ model: e.target.value })} placeholder="Model kimliği"/></label>
            {['custom', 'local'].includes(agent.provider) && <label>API adresi<input value={agent.baseUrl} onChange={(e) => patch({ baseUrl: e.target.value, apiKey: '', hasKey: false })} placeholder="http://127.0.0.1:11434/v1"/></label>}
            {agent.provider !== 'local' && <label>Bu ajanın API anahtarı<input type="password" autoComplete="new-password" value={agent.apiKey || ''} placeholder={agent.hasKey ? 'Anahtar kayıtlı · değiştirmek için yaz' : 'Boşsa bu sağlayıcının sunucu anahtarı kullanılır'} onChange={(e) => patch({ apiKey: e.target.value })}/></label>}
          </>}
          <p className="text-xs text-app-muted">{agent.provider === 'inherit' ? `Ana bağlantıyı izliyor: ${modelLabel(settings)}` : 'Bu ajan ana bağlantıdan bağımsızdır. Sağlayıcı/adres değişince eski anahtar kullanılmaz; yeni anahtarı gir.'}</p>
          <label>Uzmanlık ve davranış<textarea rows={4} value={agent.instructions} maxLength={6000} onChange={(e) => patch({ instructions: e.target.value })} placeholder="Örn. Kaynakları kontrol et, bulgularını kısa ve somut yaz."/></label>
          <fieldset className="space-y-2 rounded-xl border border-app-border p-3"><legend className="px-1 text-sm font-medium">Atanmış beceriler · en fazla 5</legend>
            {skills.map((skill) => <label key={skill.id} className="office-check items-start"><input type="checkbox" checked={(agent.skillIds || []).includes(skill.id)} disabled={!(agent.skillIds || []).includes(skill.id) && (agent.skillIds || []).length >= 5} onChange={(event) => patch({ skillIds: event.target.checked ? [...(agent.skillIds || []), skill.id] : (agent.skillIds || []).filter((id) => id !== skill.id) })}/><span>{skill.name}{roleSuggestion(agent.role, skill) && <small className="ml-1 text-app-accent">· Bu role uygun</small>}<small>{skill.description}</small></span></label>)}
            {!skills.length && <p className="text-xs text-app-muted">Beceri kütüphanesinden önce beceri kur.</p>}
          </fieldset>
          <label className="office-check"><input type="checkbox" checked={agent.enabled} onChange={(e) => patch({ enabled: e.target.checked })}/> Ajan etkin</label>
          {['custom', 'local'].includes(agent.provider) && <label className="office-check"><input type="checkbox" checked={agent.supportsTools !== false} onChange={(e) => patch({ supportsTools: e.target.checked })}/> Model web/dosya araçlarını destekliyor (desteklemiyorsa kapat)</label>}
          {agent.role !== 'coordinator' && drafts.length > 2 && <button className="office-danger" onClick={() => { setDrafts(drafts.filter((a) => a.id !== agent.id)); setSelected(drafts[0].id); }}><Trash2 size={14}/> Ajanı kaldır</button>}
          {agent.hasKey && <button onClick={async () => { setBusy(true); try { const data = await officeAction({ action: 'saveAgents', agents: drafts.map((a) => a.id === agent.id ? { ...a, apiKey: '', clearKey: true } : a) }); onSaved(data.agents); setDrafts(data.agents); setNotice('Bu ajanın anahtarı kaldırıldı.'); } catch (e) { setNotice(String(e)); } finally { setBusy(false); } }}>Kayıtlı anahtarı kaldır</button>}
          {notice && <p role="status" className="office-notice">{notice}</p>}
          <footer><button disabled={busy} onClick={() => save(true)}>{busy ? <LoaderCircle size={16} className="animate-spin"/> : <Play size={15}/>} Kaydet ve bağlantıyı test et</button><button disabled={busy} className="office-primary" onClick={() => save()}>Kaydet</button></footer>
        </div>
      </div>
    </div>
  </div>;
}

export default function AgentOffice({ settings, onClose, onJarvis }: { settings: Settings; onClose: () => void; onJarvis: () => void }) {
  const [agents, setAgents] = useState<OfficeAgent[]>(DEFAULT_AGENTS); const [runs, setRuns] = useState<OfficeRun[]>([]);
  const [skills, setSkills] = useState<InstalledSkill[]>([]);
  const [runId, setRunId] = useState(''); const [prompt, setPrompt] = useState(''); const [workspace, setWorkspace] = useState('');
  const [web, setWeb] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [config, setConfig] = useState(false); const [skillsOpen, setSkillsOpen] = useState(false); const [taskId, setTaskId] = useState(''); const [agentFilter, setAgentFilter] = useState('');
  const [configAgent, setConfigAgent] = useState('');
  const [artifactId, setArtifactId] = useState(''); const mounted = useRef(true);
  const run = runs.find((r) => r.id === runId) || runs[0]; const running = runs.some((r) => ACTIVE.includes(r.status));
  const refresh = useCallback(async () => {
    const response = await fetch('/api/office', { cache: 'no-store' }); const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Ofis yüklenemedi.');
    if (mounted.current) { setAgents(data.agents); setRuns(data.runs); setConnectionError(''); }
  }, []);
  useEffect(() => {
    mounted.current = true; let timer: ReturnType<typeof setTimeout>;
    async function poll() { try { await refresh(); } catch (e) { if (mounted.current) setConnectionError(`Ofise bağlanılamadı; otomatik yeniden deneniyor. ${e instanceof Error ? e.message : ''}`); } if (mounted.current) timer = setTimeout(poll, 2000); }
    void poll();
    void fetch('/api/skills', { cache: 'no-store' }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Beceri kütüphanesi yüklenemedi.');
      if (mounted.current) setSkills(data.skills || []);
    }).catch((e: unknown) => { if (mounted.current) setError(e instanceof Error ? e.message : 'Beceri kütüphanesi yüklenemedi.'); });
    const choose = (event: Event) => { const detail = (event as CustomEvent<{ path?: string }>).detail; if (detail?.path) setWorkspace(detail.path); };
    window.addEventListener('chloeWorkspace', choose);
    return () => { mounted.current = false; clearTimeout(timer); window.removeEventListener('chloeWorkspace', choose); };
  }, [refresh]);
  async function action(body: Record<string, unknown>) { setBusy(true); setError(''); try { const data = await officeAction(body); await refresh(); return data; } catch (e) { setError(e instanceof Error ? e.message : 'İşlem başarısız.'); } finally { setBusy(false); } }
  async function start() { if (!prompt.trim() || busy || running) return; const data = await action({ action: 'start', prompt, workspace, webSearch: web, settings: settingsForRequest(settings) }); if (data?.run) { setRunId(data.run.id); setTaskId(''); } }
  function download() { if (!run) return; const blob = new Blob([`# ${run.prompt}\n\n${run.result || run.tasks.map((t) => `## ${t.title}\n${t.output || t.error || ''}`).join('\n\n')}`], { type: 'text/markdown' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `chloe-${run.id}.md`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  const task = run?.tasks.find((t) => t.id === taskId);
  const artifact = run?.artifacts.find((a) => a.id === artifactId);
  return <main className="office-shell">
    <aside className="office-rail"><strong>{settings.assistantName || 'Chloe'}</strong><nav><button onClick={onClose}><MessageSquare size={18}/> Sohbet</button><button aria-current="page"><Users size={18}/> Ajan Ofisi</button><button onClick={onJarvis}><AudioLines size={18}/> JARVIS</button></nav>
      <div className="office-rail-label">AJANLAR</div>{agents.map((a) => <button className="office-agent-row" key={a.id} onClick={() => { setConfigAgent(a.id); setConfig(true); }}><span className={`office-initial ${a.role}`}>{a.name[0]}</span><span>{a.name}<small>{a.provider === 'inherit' ? modelLabel(settings) : `Ayrı API · ${a.model}`}</small></span><i className={run?.tasks.some((t) => t.agentId === a.id && t.status === 'running') ? 'working' : ''}/></button>)}
      <div className="office-rail-bottom"><FolderOpen size={15}/> Yerel çalışma alanı</div>
    </aside>
    <section className="office-main">
      <header className="office-header"><div><button className="office-mobile-back" onClick={onClose} aria-label="Sohbete dön"><ArrowLeft size={18}/></button><h1>Ajan Ofisi</h1><p>Hedeflerini çoklu ajan ekibiyle birlikte planla, araştır, geliştir ve kontrol et.</p></div><div className="flex gap-2"><button onClick={() => setSkillsOpen(true)}><Search size={16}/><span>Beceriler · {skills.length}</span></button><button onClick={() => setConfig(true)} aria-label="Ekip ayarları"><Settings2 size={16}/><span>Ekip ayarları</span></button></div></header>
      <form className="office-brief" onSubmit={(e) => { e.preventDefault(); void start(); }}>
        <label htmlFor="office-prompt">Ekibin ne üzerinde çalışsın?</label><textarea id="office-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={12000} rows={3} placeholder="Hedefini anlat. Koordinatör işi bölsün, uzmanlar çalışsın, denetçi sonucu kontrol etsin."/>
        <div className="office-workspace"><FolderOpen size={16}/><input aria-label="Çalışma klasörü" value={workspace} onChange={(e) => setWorkspace(e.target.value)} placeholder="Yerel dosyalar için proje klasörü (isteğe bağlı)"/><button type="button" onClick={() => { if (!sendNativeAction('chooseWorkspace', {})) setError('Web sürümünde klasörün tam yolunu yaz. Örn. /Users/.../projem'); }}>Klasör seç</button></div>
        <footer><label className="office-check"><input type="checkbox" checked={web} onChange={(e) => setWeb(e.target.checked)}/><Globe size={15}/> Web’de araştır</label><span className="office-budget">En fazla 4 görev · 2 paralel ajan</span><button className="office-primary" type="submit" disabled={busy || running || !prompt.trim()}>{busy ? <LoaderCircle size={16} className="animate-spin"/> : <Play size={16}/>} Ekibi başlat</button></footer>
      </form>
      {(error || connectionError) && <p className="office-error" role="alert">{error || connectionError}</p>}
      <div className="office-run-bar"><label>Çalışmalar<select aria-label="Çalışma geçmişi" value={run?.id || ''} onChange={(e) => { setRunId(e.target.value); setTaskId(''); setArtifactId(''); }}><option value="" disabled>Henüz çalışma yok</option>{runs.map((r) => <option key={r.id} value={r.id}>{LABELS[r.status]} · {r.prompt.slice(0, 65)}</option>)}</select></label>
        {run && <><span className={`office-run-status ${run.status}`}>{LABELS[run.status]}</span>{ACTIVE.includes(run.status) ? <button disabled={busy} onClick={() => action({ action: 'cancel', id: run.id })}><Square size={14}/> Durdur</button> : <><button onClick={download} aria-label="Çalışmayı indir"><Download size={16}/></button><button onClick={() => { setPrompt(run.prompt); setWorkspace(run.workspace); }}>Tekrar kullan</button></>}</>}
      </div>
      <div className="office-board">{(['queued', 'running', 'completed'] as const).map((state) => {
        const titles = { queued: 'Bekliyor', running: 'Çalışıyor', completed: 'Tamamlandı' };
        const tasks = (run?.tasks || []).filter((t) => state === 'completed' ? ['completed', 'failed', 'cancelled'].includes(t.status) : t.status === state);
        return <section key={state}><h2><i className={state}/>{titles[state]}<span>{tasks.length}</span></h2>{tasks.length ? tasks.map((t) => <button key={t.id} className={`office-task ${t.status} ${taskId === t.id ? 'selected' : ''}`} onClick={() => setTaskId(t.id)}><FileText size={18}/><span>{t.title}<small>{agents.find((a) => a.id === t.agentId)?.name}{t.status === 'failed' ? ' · Hata' : t.status === 'cancelled' ? ' · Durduruldu' : ''}</small></span>{t.status === 'running' ? <LoaderCircle size={15} className="animate-spin"/> : t.status === 'completed' ? <Check size={15}/> : null}</button>) : <p className="office-empty">{state === 'queued' && run?.status === 'planning' ? 'Koordinatör planı hazırlıyor…' : 'Bu sütunda görev yok.'}</p>}</section>;
      })}</div>
      {run?.error && <p role="alert" className="office-error">{run.error}</p>}
      {task && <section className="office-output"><header><h2>{task.title}</h2><button onClick={() => setTaskId('')} aria-label="Görev ayrıntısını kapat"><X size={16}/></button></header><p>{task.instructions}</p><pre>{task.output || task.error || 'Sonuç bekleniyor…'}</pre></section>}
      {run?.result && <section className="office-output"><header><h2>Ekip sonucu</h2><button onClick={download}><Download size={15}/> İndir</button></header><pre>{run.result}</pre></section>}
      {!!run?.artifacts.length && <section className="office-output"><h2>Dosya önerileri</h2><p>İçeriği inceleyip uygula. Var olan dosyanın yedeği alınır; sonradan değişen dosyanın üzerine yazılmaz.</p>{run.artifacts.map((a) => <button key={a.id} onClick={() => setArtifactId(a.id)}><FileText size={16}/>{a.path}{a.applied && <Check size={15}/>}<ChevronDown size={15}/></button>)}{artifact && <><pre>{artifact.content}</pre><button className="office-primary" disabled={busy || artifact.applied || ACTIVE.includes(run.status)} onClick={() => action({ action: 'apply', id: run.id, artifactId: artifact.id })}>{artifact.applied ? 'Uygulandı' : 'Bu dosya içeriğini uygula'}</button></>}</section>}
      <section className="office-log"><header><h2>Çalışma günlüğü</h2><select aria-label="Günlük ajan filtresi" value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)}><option value="">Tüm ajanlar</option>{agents.map((a) => <option key={a.id}>{a.name}</option>)}</select></header>{run?.events.length ? run.events.filter((event) => !agentFilter || event.agent === agentFilter).map((event, i) => <div className="office-event" key={i}><time>{new Date(event.at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</time><span className="office-initial">{event.agent[0]}</span><div><strong>{event.agent}</strong><p>{event.message}</p></div></div>) : <p className="office-empty">Ekibi başlatınca plan, ajan hareketleri ve sonuçlar burada görünür.</p>}{run && <p className="office-usage">{run.calls} model adımı · {run.tokens.toLocaleString('tr-TR')} token · Çalışmalar bu cihazda saklanır.</p>}</section>
    </section>
    {config && <AgentSettings agents={agents} settings={settings} skills={skills} initialAgent={configAgent} onClose={() => { setConfig(false); setConfigAgent(''); }} onSaved={setAgents}/>}
    {skillsOpen && <SkillsManager initialSkills={skills} onChange={setSkills} onClose={() => setSkillsOpen(false)}/>}
  </main>;
}
