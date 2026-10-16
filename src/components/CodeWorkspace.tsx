'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Check, ChevronRight, Code2, File, FilePlus2, Folder, FolderOpen,
  Loader2, Play, RefreshCw, Save, Settings2, Sparkles, Terminal, Users, X,
} from 'lucide-react';
import { sendNativeAction } from '@/lib/native-bridge';
import { hasExplicitConnection, modelLabel, settingsForRequest, type Settings } from '@/lib/settings';
import type { OfficeRun } from '@/lib/office-types';

interface CodeWorkspaceProps {
  settings: Settings;
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenOffice: (runId: string, workspace: string) => void;
}

interface WorkspaceEntry {
  path: string;
  type: 'file' | 'directory';
  size?: number;
}

interface WorkspaceTask {
  id: string;
  label: string;
}

const EMPTY_FILE_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function diffPreview(before: string, after: string): string {
  const oldLines = before.split('\n');
  const newLines = after.split('\n');
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) suffix++;
  const removed = oldLines.slice(prefix, oldLines.length - suffix);
  const added = newLines.slice(prefix, newLines.length - suffix);
  const preview = [
    ...removed.slice(0, 100).map((line) => `- ${line}`),
    ...added.slice(0, 100).map((line) => `+ ${line}`),
  ].join('\n');
  return preview + (removed.length > 100 || added.length > 100 ? '\n… Önizleme kısaltıldı; tam dosyayı uygulamadan önce editörde incele.' : '');
}

export default function CodeWorkspace({ settings, onClose, onOpenSettings, onOpenOffice }: CodeWorkspaceProps) {
  const [workspaceInput, setWorkspaceInput] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [tasks, setTasks] = useState<WorkspaceTask[]>([]);
  const [activePath, setActivePath] = useState('');
  const [source, setSource] = useState('');
  const [savedSource, setSavedSource] = useState('');
  const [fileHash, setFileHash] = useState(EMPTY_FILE_HASH);
  const [instruction, setInstruction] = useState('');
  const [draft, setDraft] = useState('');
  const [teamMode, setTeamMode] = useState(false);
  const [teamRun, setTeamRun] = useState<OfficeRun | null>(null);
  const [teamError, setTeamError] = useState('');
  const teamRunning = !!teamRun && ['planning', 'running'].includes(teamRun.status);
  const activeRequest = useRef<AbortController | null>(null);
  const [taskOutput, setTaskOutput] = useState('');
  const [selectedTask, setSelectedTask] = useState('');
  const [busy, setBusy] = useState<'workspace' | 'file' | 'ai' | 'save' | 'task' | ''>('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showOutput, setShowOutput] = useState(false);
  const [showDraft, setShowDraft] = useState(false);
  const [collapsedDirectories, setCollapsedDirectories] = useState<Set<string>>(new Set());
  const workspaceRequest = useRef(0);
  const sourceRef = useRef(source);
  const fileHashRef = useRef(fileHash);
  const workspaceRef = useRef(workspace);
  const activePathRef = useRef(activePath);
  const isDirty = source !== savedSource;

  useEffect(() => {
    sourceRef.current = source;
    fileHashRef.current = fileHash;
    workspaceRef.current = workspace;
    activePathRef.current = activePath;
  }, [activePath, fileHash, source, workspace]);

  const request = useCallback(async <T,>(url: string, body: unknown, timeout = 20_000): Promise<T> => {
    const controller = new AbortController();
    activeRequest.current = controller;
    try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]),
    });
    const data = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(data.error || `İstek başarısız oldu (${response.status}).`);
    return data;
    } catch (error) {
      if (controller.signal.aborted) throw new Error('İşlem durduruldu. Çalışmış proje komutlarının etkileri otomatik geri alınmaz.');
      throw error;
    } finally { if (activeRequest.current === controller) activeRequest.current = null; }
  }, []);

  useEffect(() => () => { activeRequest.current?.abort(); }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (isDirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);

  useEffect(() => {
    if (!teamRun?.id || !teamRunning) return;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch('/api/office', { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Ekip durumu alınamadı.');
        const run = (data.runs as OfficeRun[]).find((item) => item.id === teamRun.id);
        if (!controller.signal.aborted && run) { setTeamRun(run); setTeamError(''); }
      } catch (error) { if (!controller.signal.aborted) setTeamError(error instanceof Error ? error.message : 'Ekip durumu alınamadı.'); }
    };
    const timer = setInterval(() => void refresh(), 2000);
    void refresh();
    return () => { clearInterval(timer); controller.abort(); };
  }, [teamRun?.id, teamRunning]);

  const refreshWorkspace = useCallback(async (pathValue = workspaceInput) => {
    if (busy && busy !== 'workspace') return;
    const candidate = pathValue.trim();
    if (!candidate) {
      setError('Proje klasörünün tam yolunu yaz veya macOS uygulamasında Klasör seç düğmesini kullan.');
      return;
    }
    if (isDirty && !window.confirm('Kaydedilmemiş değişiklikler var. Projeyi yeniden açıp bu değişiklikleri silmek istiyor musun?')) return;
    const requestId = ++workspaceRequest.current;
    setBusy('workspace');
    setError('');
    setNotice('');
    try {
      const result = await request<{ root: string; entries: WorkspaceEntry[]; truncated: boolean }>(
        '/api/codex/workspace',
        { action: 'list', workspace: candidate },
      );
      if (requestId !== workspaceRequest.current) return;
      setWorkspace(result.root);
      setWorkspaceInput(result.root);
      setEntries(result.entries);
      setTruncated(result.truncated);
      setCollapsedDirectories(new Set());
      setActivePath('');
      setSource('');
      setSavedSource('');
      setDraft('');
      setFileHash(EMPTY_FILE_HASH);
      setTasks([]);
      setSelectedTask('');
      const available = await request<{ tasks: WorkspaceTask[] }>('/api/codex/command', { task: 'list', workspace: result.root });
      if (requestId === workspaceRequest.current) {
        setTasks(available.tasks);
        setSelectedTask(available.tasks[0]?.id || '');
      }
    } catch (cause) {
      if (requestId === workspaceRequest.current) setError(cause instanceof Error ? cause.message : 'Proje açılamadı.');
    } finally {
      if (requestId === workspaceRequest.current) setBusy('');
    }
  }, [busy, isDirty, request, workspaceInput]);

  useEffect(() => {
    const onWorkspaceSelected = (event: Event) => {
      const selected = (event as Event & { detail?: { path?: string } }).detail?.path;
      if (selected) {
        setWorkspaceInput(selected);
        void refreshWorkspace(selected);
      }
    };
    window.addEventListener('chloeWorkspace', onWorkspaceSelected);
    return () => window.removeEventListener('chloeWorkspace', onWorkspaceSelected);
  }, [refreshWorkspace]);

  const openFile = useCallback(async (file: string) => {
    if (!workspace) return;
    if (isDirty && !window.confirm('Kaydedilmemiş değişiklikler var. Dosyayı açıp bu değişiklikleri silmek istiyor musun?')) return;
    setBusy('file');
    setError('');
    setNotice('');
    try {
      const result = await request<{ path: string; source: string; hash: string }>(
        '/api/codex/workspace',
        { action: 'read', workspace, path: file },
      );
      setActivePath(result.path);
      setSource(result.source);
      setSavedSource(result.source);
      setFileHash(result.hash);
      setDraft('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Dosya açılamadı.');
    } finally {
      setBusy('');
    }
  }, [isDirty, request, workspace]);

  const saveFile = useCallback(async () => {
    if (!workspace || !activePath || !isDirty || busy) return;
    setBusy('save');
    setError('');
    setNotice('');
    try {
      const result = await request<{ hash: string; source: string }>(
        '/api/codex/workspace',
        { action: 'save', workspace, path: activePath, source, expectedHash: fileHash },
      );
      setFileHash(result.hash);
      setSavedSource(result.source);
      setNotice('Dosya seçtiğin proje klasörüne kaydedildi.');
      setEntries((previous) => previous.some((entry) => entry.path === activePath)
        ? previous.map((entry) => entry.path === activePath ? { ...entry, size: new Blob([source]).size } : entry)
        : [...previous, { path: activePath, type: 'file', size: new Blob([source]).size }]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Dosya kaydedilemedi.');
    } finally {
      setBusy('');
    }
  }, [activePath, busy, fileHash, isDirty, request, source, workspace]);

  const askAI = useCallback(async () => {
    if (!activePath || !instruction.trim() || busy || teamRunning) return;
    if (teamMode && (isDirty || !entries.some((entry) => entry.path === activePath))) {
      setError('Ajan ekibi diskteki projeyi okur. Önce bu dosyayı kaydet.'); return;
    }
    const capturedSource = source;
    const capturedHash = fileHash;
    const capturedPath = activePath;
    const capturedWorkspace = workspace;
    setBusy('ai');
    setError('');
    setNotice('');
    try {
      if (teamMode) {
        const result = await request<{ run: OfficeRun }>('/api/office', {
          action: 'start', workspace, prompt: instruction.trim(), focusFile: activePath, expectedHash: fileHash,
          settings: settingsForRequest(settings), webSearch: false,
        });
        setTeamRun(result.run); setInstruction(''); setTeamError('');
        setNotice('Görev ajan ofisine aktarıldı. Sonuçlar burada görünecek; dosyalar kendiliğinden kaydedilmez.');
        return;
      }
      const result = await request<{ source: string }>('/api/codex', {
        filename: activePath,
        instruction: instruction.trim(),
        source: capturedSource,
        settings: settingsForRequest(settings),
      }, 125_000);
      if (
        sourceRef.current !== capturedSource ||
        fileHashRef.current !== capturedHash ||
        activePathRef.current !== capturedPath ||
        workspaceRef.current !== capturedWorkspace
      ) {
        setError('AI yanıtı hazırlanırken dosya değişti. Öneri uygulanmadı; güncel dosyayla tekrar dene.');
        return;
      }
      setDraft(result.source);
      setShowDraft(true);
      setInstruction('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'AI düzenlemesi başarısız oldu.');
    } finally {
      setBusy('');
    }
  }, [activePath, busy, entries, fileHash, instruction, isDirty, request, settings, source, teamMode, teamRunning, workspace]);

  const runTask = useCallback(async () => {
    if (!workspace || !selectedTask || busy) return;
    const task = tasks.find((item) => item.id === selectedTask);
    if (!task) return;
    if (!window.confirm(`${task.label}\n\nBu işlem seçtiğin projede kod çalıştırabilir. Yalnızca güvendiğin projelerde devam et.`)) return;
    setBusy('task');
    setShowOutput(true);
    setTaskOutput(`${task.label} çalışıyor…`);
    setError('');
    try {
      const result = await request<{
        success: boolean;
        output: string;
        exitCode: number | null;
        timedOut: boolean;
        truncated: boolean;
      }>('/api/codex/command', { workspace, task: selectedTask }, 130_000);
      const summary = result.timedOut
        ? 'Kontrol 120 saniyede zaman aşımına uğradı.'
        : `Çıkış kodu: ${result.exitCode ?? 'bilinmiyor'}${result.success ? ' · Başarılı' : ' · Hata'}`;
      setTaskOutput(`${summary}${result.truncated ? '\nÇıktı boyut sınırı nedeniyle kısaltıldı.' : ''}\n\n${result.output || '(çıktı yok)'}`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Proje kontrolü çalıştırılamadı.';
      setTaskOutput(message);
      setError(message);
    } finally {
      setBusy('');
    }
  }, [busy, request, selectedTask, tasks, workspace]);

  const createFile = () => {
    if (!workspace) return;
    if (isDirty && !window.confirm('Kaydedilmemiş değişiklikler var. Yeni dosyaya geçip bu değişiklikleri silmek istiyor musun?')) return;
    const filePath = window.prompt('Proje içindeki yeni dosyanın yolu (ör. src/new-file.ts):');
    if (!filePath?.trim()) return;
    setActivePath(filePath.trim());
    setSource('');
    setSavedSource('');
    setFileHash(EMPTY_FILE_HASH);
    setDraft('');
    setError('');
    setNotice('Yeni dosya; kaydet düğmesine basınca oluşturulacak.');
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveFile();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saveFile]);

  const entriesByPath = useMemo(() => entries.map((entry) => ({
    ...entry,
    depth: entry.path.split('/').length - 1,
  })), [entries]);
  const visibleEntries = useMemo(() => entriesByPath.filter((entry) => {
    const segments = entry.path.split('/');
    return !segments.slice(1).some((_, index) => collapsedDirectories.has(segments.slice(0, index + 1).join('/')));
  }), [collapsedDirectories, entriesByPath]);
  const connected = hasExplicitConnection(settings);

  return (
    <main className="code-workspace">
      <header className="code-topbar">
        <div className="code-brand">
          <button type="button" className="code-icon-button" onClick={() => {
            if (isDirty && !window.confirm('Kaydedilmemiş değişiklikler var. Çalışma alanından çıkmak istiyor musun?')) return;
            onClose();
          }} aria-label="Sohbete dön" title="Sohbete dön"><ArrowLeft size={18} /></button>
          <div className="code-brand-mark"><Code2 size={18} /></div>
          <div><strong>Chloe Code</strong><span>Proje çalışma alanı</span></div>
        </div>
        <div className="code-project-picker">
          <FolderOpen size={16} aria-hidden="true" />
          <input
            value={workspaceInput}
            onChange={(event) => setWorkspaceInput(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void refreshWorkspace(); }}
            placeholder="Proje klasörünün tam yolu"
            aria-label="Proje klasörünün tam yolu"
          />
          <button type="button" disabled={busy !== ''} onClick={() => {
            if (!sendNativeAction('chooseWorkspace', {})) setError('Web sürümünde klasör yolunu yazıp Projeyi aç düğmesine bas.');
          }} title="macOS Finder ile proje klasörü seç"><FolderOpen size={15} /><span>Klasör seç</span></button>
          <button type="button" className="code-primary" aria-label="Projeyi aç" disabled={busy !== ''} onClick={() => void refreshWorkspace()}>
            {busy === 'workspace' ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            <span>Projeyi aç</span>
          </button>
        </div>
        <button type="button" className="code-icon-button" onClick={onOpenSettings} title="AI model ayarları"><Settings2 size={18} /></button>
      </header>

      <div className="code-body">
        <aside className="code-sidebar">
          <div className="code-sidebar-heading">
            <div><span>PROJE DOSYALARI</span><strong title={workspace}>{workspace ? workspace.split('/').filter(Boolean).at(-1) : 'Proje seçilmedi'}</strong></div>
            <button type="button" className="code-icon-button" disabled={!workspace || busy !== ''} onClick={createFile} title="Yeni dosya"><FilePlus2 size={16} /></button>
          </div>
          {workspace ? (
            <div className="code-file-list custom-scrollbar">
              {visibleEntries.length ? visibleEntries.map((entry) => (
                <button
                  type="button"
                  key={entry.path}
                  title={entry.path}
                  className={`code-file-row ${activePath === entry.path ? 'active' : ''} ${entry.type === 'directory' ? 'directory' : ''}`}
                  style={{ paddingLeft: `${12 + entry.depth * 13}px` }}
                  aria-expanded={entry.type === 'directory' ? !collapsedDirectories.has(entry.path) : undefined}
                  disabled={busy !== ''}
                  onClick={() => {
                    if (entry.type === 'file') void openFile(entry.path);
                    else setCollapsedDirectories((previous) => {
                      const next = new Set(previous);
                      if (next.has(entry.path)) next.delete(entry.path);
                      else next.add(entry.path);
                      return next;
                    });
                  }}
                >
                  {entry.type === 'directory' ? <Folder size={15} /> : <File size={14} />}
                  <span>{entry.path.split('/').at(-1)}</span>
                  {entry.type === 'directory' && <ChevronRight size={13} className={collapsedDirectories.has(entry.path) ? '' : 'rotate-90 transition-transform'} />}
                </button>
              )) : <p className="code-empty">Görüntülenecek proje dosyası yok.</p>}
              {truncated && <p className="code-tree-note">Dosya ağacı 500 öğe sınırında kısaltıldı.</p>}
            </div>
          ) : (
            <div className="code-empty-state">
              <FolderOpen size={24} />
              <strong>Bir proje klasörü seç</strong>
              <p>Mac uygulamasında Finder’dan seçebilir veya tam yolu yukarıya yazabilirsin.</p>
            </div>
          )}
          <div className="code-sidebar-footer">
            <span className={`code-connection-dot ${connected ? 'connected' : ''}`} />
            <span>{connected ? `AI ayarı seçili: ${modelLabel(settings)}` : 'AI için Ayarlar’dan bağlantı seç'}</span>
          </div>
        </aside>

        <section className="code-editor-pane">
          <div className="code-editor-header">
            <div className="code-file-tab">
              <Code2 size={14} aria-hidden="true" />
              <span>{activePath || 'Dosya seçilmedi'}</span>
              {isDirty && <i title="Kaydedilmemiş değişiklik" />}
            </div>
            <div className="code-editor-actions">
              <button type="button" disabled={!activePath || !isDirty || busy !== ''} onClick={() => void saveFile()} className="code-primary">
                {busy === 'save' ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                <span>Kaydet</span>
              </button>
            </div>
          </div>
          {activePath ? (
            <>
              <textarea
                className="code-editor custom-scrollbar"
                value={source}
                readOnly={busy === 'save' || busy === 'file' || busy === 'workspace'}
                onChange={(event) => setSource(event.target.value)}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                aria-label={`${activePath} kod editörü`}
                placeholder="Kodunu buraya yaz…"
              />
              <div className="code-statusbar">
                <span>{activePath.split('.').at(-1)?.toUpperCase() || 'TEXT'}</span>
                <span>{source.split('\n').length} satır · {new Blob([source]).size.toLocaleString('tr-TR')} bayt</span>
                <span>{isDirty ? 'Kaydedilmedi' : 'Kaydedildi'}</span>
              </div>
            </>
          ) : (
            <div className="code-editor-welcome">
              <div><Code2 size={32} /></div>
              <h1>Projen üzerinde çalış</h1>
              <p>Bir klasör aç, soldan dosyaları seç; kodunu düzenle, AI’dan değişiklik önerisi iste ve kaydetmeden önce incele.</p>
              <span>Değişiklikler dosyaya yalnızca sen Kaydet’e bastığında yazılır.</span>
            </div>
          )}
          {error && <div role="alert" className="code-notice error">{error}<button type="button" onClick={() => setError('')} aria-label="Hatayı kapat"><X size={14} /></button></div>}
          {notice && <div role="status" className="code-notice success">{notice}<button type="button" onClick={() => setNotice('')} aria-label="Bildirimi kapat"><X size={14} /></button></div>}
        </section>

        <aside className="code-assistant-pane">
          <div className="code-assistant-heading"><Sparkles size={17} /><strong>AI kod asistanı</strong></div>
          <p className="code-assistant-description">Seçili AI modelinden bu dosya için değişiklik önerisi iste. Öneri kendiliğinden kaydedilmez.</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={teamMode} disabled={!!busy || teamRunning} onChange={(event) => setTeamMode(event.target.checked)}/><Users size={15}/> Ajan ofisiyle birlikte geliştir</label>
          {teamMode && <p className="code-assistant-description">Koordinatör işi ekibe dağıtır; geliştirici ve denetçiler aynı proje üzerinde çalışır. Ekipte bağımsız model seçilmişse o ajanın bağlantısı kullanılır.</p>}
          <label htmlFor="code-instruction">Ne değiştirelim?</label>
          <textarea
            id="code-instruction"
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            maxLength={8000}
            placeholder={activePath ? 'Örn. hata mesajlarını Türkçeleştir ve mevcut davranışı koru…' : 'Önce soldan bir kod dosyası aç.'}
            disabled={!activePath || busy !== ''}
          />
          <button type="button" className="code-primary code-ask-button" disabled={!activePath || !instruction.trim() || busy !== '' || teamRunning} onClick={() => void askAI()}>
            {busy === 'ai' ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {busy === 'ai' ? 'Öneri hazırlanıyor…' : teamMode ? 'Ajan ekibini başlat' : 'AI önerisi oluştur'}
          </button>
          {(busy === 'ai' || busy === 'task') && <button type="button" onClick={() => activeRequest.current?.abort()}>İşlemi durdur</button>}
          {teamRun && <section className="code-draft" aria-label="Codex ajan çalışması">
            <strong>{teamRunning ? 'Ajan ekibi çalışıyor…' : teamRun.status === 'completed' ? 'Ekip tamamladı' : 'Ekip çalışması sonlandı'}</strong>
            <p className="text-xs text-app-muted">{teamRun.tasks.filter((task) => task.status === 'completed').length}/{teamRun.tasks.length} görev · {teamRun.calls} model adımı</p>
            {(teamRun.error || teamError) && <p role="alert">{teamRun.error || teamError}</p>}
            <button type="button" onClick={() => onOpenOffice(teamRun.id, teamRun.workspace)}>Ajan ofisinde izle</button>
            {!teamRunning && teamRun.status !== 'completed' && <button type="button" onClick={() => setInstruction(teamRun.prompt)}>İsteği yeniden düzenle</button>}
            {teamRunning && <button type="button" onClick={async () => {
              try { await request('/api/office', { action: 'cancel', id: teamRun.id }); }
              catch (cause) { setTeamError(cause instanceof Error ? cause.message : 'Ekip durdurulamadı.'); }
            }}>Ekibi durdur</button>}
            {!teamRunning && teamRun.artifacts.map((artifact) => <button key={artifact.id} type="button" disabled={!!busy || artifact.applied} onClick={() => {
              if (artifact.review?.verdict !== 'approved') { setTeamError('Dosya denetimi onaylanmadı. Ajan ofisindeki denetim notlarını incele.'); return; }
              if (workspace !== teamRun.workspace || activePath !== artifact.path || fileHash !== artifact.originalHash || isDirty) {
                setError('Önerinin proje ve dosyasını aç; kaydedilmemiş değişiklikleri önce koru. Dosya sürümü farklıysa yeni çalışma başlat.'); return;
              }
              setDraft(artifact.content); setShowDraft(true);
            }}>{artifact.applied ? 'Uygulandı: ' : 'Öneriyi incele: '}{artifact.path}</button>)}
            {!teamRunning && teamRun.result && <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs">{teamRun.result}</pre>}
          </section>}
          {draft && showDraft && (
            <section className="code-draft">
              <div className="code-draft-heading"><strong>Değişiklik önizlemesi</strong><span>{draft === source ? 'Değişiklik yok' : 'Kaydedilmedi'}</span></div>
              <pre className="custom-scrollbar">{diffPreview(source, draft)}</pre>
              <div className="code-draft-actions">
                <button type="button" onClick={() => { setDraft(''); setShowDraft(false); }}>Reddet</button>
                <button type="button" className="code-primary" disabled={draft === source} onClick={() => {
                  setSource(draft);
                  setDraft('');
                  setShowDraft(false);
                  setNotice('Öneri editöre alındı. Kalıcı olması için Kaydet’e bas.');
                }}><Check size={14} /> Editöre al</button>
              </div>
            </section>
          )}

          <div className="code-checks">
            <div className="code-checks-heading"><Terminal size={15} /><strong>Proje kontrolleri</strong></div>
            <p>Yalnızca proje için tanınan kontroller listelenir. Çalıştırmadan önce onay istenir.</p>
            <div className="code-run-row">
              <select aria-label="Proje kontrolü" value={selectedTask} onChange={(event) => setSelectedTask(event.target.value)} disabled={!tasks.length || busy !== ''}>
                {tasks.length ? tasks.map((task) => <option key={task.id} value={task.id}>{task.label}</option>) : <option value="">Proje açınca kontroller görünür</option>}
              </select>
              <button type="button" className="code-icon-button" disabled={!selectedTask || busy !== ''} onClick={() => void runTask()} title="Kontrolü çalıştır"><Play size={15} /></button>
            </div>
            {showOutput && <pre className="code-task-output custom-scrollbar">{busy === 'task' ? <><Loader2 size={14} className="animate-spin" /> {taskOutput}</> : taskOutput}</pre>}
          </div>
        </aside>
      </div>
    </main>
  );
}
