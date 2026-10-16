'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { jarvisBrowserUrl, jarvisCommand, officeReport, officeStatusText, type JarvisCommand, type JarvisWorkMode } from '@/lib/jarvis-command';
import type { OfficeRun } from '@/lib/office-types';
import { settingsForRequest, type Settings } from '@/lib/settings';
import { sendNativeAction } from '@/lib/native-bridge';

const STORAGE = 'chloe:jarvis-work:v1';
export function useJarvisWork(settings: Settings, enabled: boolean) {
  const [mode, setMode] = useState<JarvisWorkMode>('auto');
  const [workspace, setWorkspace] = useState('');
  const [focusFile, setFocusFile] = useState('');
  const [runId, setRunId] = useState('');
  const [run, setRun] = useState<OfficeRun | null>(null);
  const [pending, setPending] = useState<JarvisCommand | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [output, setOutput] = useState('');
  const [commandDraft, setCommandDraft] = useState('');
  const [checks, setChecks] = useState<{ id: string; label: string }[]>([]);
  const [checkResult, setCheckResult] = useState('');
  const request = useRef<AbortController | null>(null);
  const selecting = useRef(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE) || '{}');
      const timer = setTimeout(() => {
        if (typeof saved.workspace === 'string') setWorkspace(saved.workspace);
        if (typeof saved.runId === 'string') setRunId(saved.runId);
      }, 0);
      return () => clearTimeout(timer);
    } catch { /* A damaged UI preference is not an instruction or a credential. */ }
  }, []);
  const remember = (folder: string, id: string) => {
    try { localStorage.setItem(STORAGE, JSON.stringify({ workspace: folder, runId: id })); } catch { /* Optional UI preference. */ }
  };
  useEffect(() => {
    if (!enabled) return;
    const chosen = (event: Event) => {
      if (!selecting.current) return;
      selecting.current = false;
      const path = (event as CustomEvent<{ path?: string }>).detail?.path;
      if (path) { setWorkspace(path); setFocusFile(''); setChecks([]); setCheckResult(''); remember(path, runId); }
    };
    window.addEventListener('chloeWorkspace', chosen);
    return () => { selecting.current = false; window.removeEventListener('chloeWorkspace', chosen); };
  }, [enabled, runId]);
  useEffect(() => () => request.current?.abort(), []);
  // A prepared command belongs to the provider that proposed it. Invalidate it
  // when the selected connection changes; background teams keep their snapshot.
  useEffect(() => {
    const timer = setTimeout(() => { setCommandDraft(''); setError(''); }, 0);
    return () => { clearTimeout(timer); request.current?.abort(); };
  }, [settings.provider, settings.cloudProvider, settings.apiKey, settings.apiBaseUrl, settings.customModel, settings.cloudModel]);
  useEffect(() => {
    if (!runId || !enabled) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const response = await fetch('/api/office', { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Ekip durumu alınamadı.');
        if (controller.signal.aborted) return;
        const found = (data.runs as OfficeRun[]).find((item) => item.id === runId) || null;
        setRun(found);
        if (!found) { setError('Kaydedilmiş çalışma bulunamadı.'); return; }
        if (['planning', 'running'].includes(found.status)) timer = setTimeout(refresh, 1500);
      } catch (cause) {
        if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : 'Durum alınamadı.'); timer = setTimeout(refresh, 3000); }
      }
    };
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [enabled, runId]);

  const post = useCallback(async (url: string, body: object, signal?: AbortSignal) => {
    const timeout = AbortSignal.timeout(url === '/api/codex/command' ? 130000 : url === '/api/jarvis/command' ? 65000 : 45000);
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `İşlem başarısız (${response.status}).`);
    return data;
  }, []);
  const cancelTeam = useCallback(async () => {
    if (!runId) return;
    try { await post('/api/office', { action: 'cancel', id: runId }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Ekip durdurulamadı.'); }
  }, [post, runId]);

  const route = (text: string): string | null => {
    const cleanNorm = text.trim().toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i');
    const isStartConfirmed = /^(?:(?:ekibi|calismayi|ajanlari|ekip\s+calismasini)\s+)?(?:baslat|calistir|basla)[.!]?$/iu.test(cleanNorm) ||
      /^(?:evet|onayliyorum|tamam|yap|onay)[.!]?$/iu.test(cleanNorm);
    if (isStartConfirmed && pending && ['team', 'report'].includes(pending.kind)) {
      if (request.current) return 'Başlatma isteğini zaten işliyorum.';
      if (run && ['planning', 'running'].includes(run.status)) return 'Bağlı ekip hâlâ çalışıyor; önce tamamlanmasını bekle veya ekibi durdur.';
      if (pending.requiresWorkspace && !workspace.trim()) return 'Kodlama için iş panelinden proje klasörünü seçmelisin.';
      void execute();
      return 'Hazırladığımız işi seçili kapsamda ekibe gönderiyorum. Gerçek ilerleme iş panelinde görünecek; dosyaya yazma ayrıca onay gerektirir.';
    }
    const command = jarvisCommand(text, mode);
    if (!command) return null;
    setExpanded(true); setError('');
    if (command.kind === 'status') { if (run) setOutput(officeReport(run)); return officeStatusText(run); }
    if (command.kind === 'cancel') { void cancelTeam(); return runId ? 'Ekibe durdurma isteği gönderiyorum; sonucu iş panelinden izleyebilirsin.' : 'Durdurulacak bağlı ekip çalışması yok.'; }
    if (request.current) return 'Önce iş panelindeki mevcut işlemi bitir veya durdur.';
    setPending(command); setOutput(''); setCommandDraft('');
    if (command.requiresWorkspace && !workspace.trim()) {
      selecting.current = true;
      sendNativeAction('chooseWorkspace');
    }
    return command.kind === 'team' || command.kind === 'report'
      ? (workspace.trim() ? 'İşi ekip için hazırladım. İş panelindeki kapsamı kontrol ettikten sonra "başlat" veya "ekibi başlat" diyebilirsin. Dosyalar ayrıca onayın olmadan değişmez.' : 'Kodlama için önce proje klasörünü seçmelisin. Klasör seçildikten sonra ekibi başlat diyebilirsin.')
      : 'Yönetim isteğini iş paneline aldım. Hedefi kontrol edip onaylayabilirsin.';
  };

  const execute = async () => {
    if (!pending || request.current) return;
    const captured = pending; const folder = workspace.trim(); const file = focusFile.trim();
    if (['team', 'report'].includes(captured.kind) && run && ['planning', 'running'].includes(run.status)) { setError('Bağlı ekip hâlâ çalışıyor.'); return; }
    if (captured.requiresWorkspace && !folder) { setError('Kodlama için önce proje klasörü seç.'); return; }
    const controller = new AbortController(); request.current = controller; setBusy(true); setError('');
    try {
      if (captured.kind === 'team' || captured.kind === 'report') {
        let focus = {};
        if (file) {
          if (!folder) throw new Error('Dosya bağlamı için proje klasörü gerekli.');
          const snapshot = await post('/api/codex/workspace', { action: 'read', workspace: folder, path: file }, controller.signal);
          focus = { focusFile: snapshot.path, expectedHash: snapshot.hash };
        }
        const data = await post('/api/office', { action: 'start', prompt: captured.prompt, workspace: folder, ...focus, settings: settingsForRequest(settings), webSearch: settings.webSearch }, controller.signal);
        setRun(data.run); setRunId(data.run.id); remember(folder, data.run.id); setPending(null);
        setChecks([]); setCheckResult('');
        setOutput('Ekip çalışması başladı. Burada konuşmaya devam edebilirsin. Dosyalar öneri olarak hazırlanır.');
      } else if (captured.kind === 'browser') {
        const url = jarvisBrowserUrl(captured.prompt);
        if (sendNativeAction('openBrowser', { url })) setOutput(`Tarayıcıya açma isteği gönderildi: ${url}. Yükleme sonucu tarayıcı penceresinde gösterilir.`);
        else {
          const data = await post('/api/browser', { action: 'read_page', url }, controller.signal);
          setOutput(`${data.title}\n${data.url}\n\n${data.content}`);
        }
        setPending(null);
      } else if (captured.kind === 'computer') {
        if (!commandDraft) {
          const data = await post('/api/jarvis/command', { instruction: captured.prompt, settings: settingsForRequest(settings) }, controller.signal);
          setCommandDraft(data.command); setOutput(data.explanation); return;
        }
        if (!sendNativeAction('openMacManagement', { command: commandDraft })) throw new Error('Bilgisayar yönetimi yalnız macOS Chloe uygulamasında çalışır. Komut çalıştırılmadı.');
        setOutput('Komut Bilgisayar Yönetimi penceresine iletildi. Sistem onayı ve gerçek çıkış sonucu orada gösterilir.'); setPending(null); setCommandDraft('');
      }
    } catch (cause) {
      setError(controller.signal.aborted ? 'İsteği bekleme durduruldu. Başlatılmış ekip işi varsa ekip durumunu kontrol et.' : cause instanceof Error ? cause.message : 'İşlem başarısız.');
    } finally { if (request.current === controller) request.current = null; setBusy(false); }
  };
  const runCheck = async (task = 'list') => {
    if (request.current) return;
    const folder = run?.workspace || workspace.trim();
    if (!folder) { setError('Kontrol için proje klasörü gerekli.'); return; }
    if (task !== 'list' && !window.confirm(`${folder}\n${task} projenin gerçek yerel komutunu çalıştırır. Güvendiğin projede devam edilsin mi?`)) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError('');
    try {
      const data = await post('/api/codex/command', { workspace: folder, task }, controller.signal);
      if (task === 'list') setChecks(data.tasks);
      else setCheckResult(`${folder}\n${task}: ${data.success ? 'BAŞARILI' : 'BAŞARISIZ'} · çıkış ${data.exitCode ?? 'yok'}${data.timedOut ? ' · zaman aşımı' : ''}${data.truncated ? ' · çıktı sınırı' : ''}\n${data.output}`);
    } catch (cause) { setError(controller.signal.aborted ? 'Kontrol isteği iptal edildi.' : cause instanceof Error ? cause.message : 'Kontrol başarısız.'); }
    finally { request.current = null; setBusy(false); }
  };

  const apply = async (artifactId: string) => {
    if (request.current || !run) return;
    const artifact = run.artifacts.find((item) => item.id === artifactId);
    if (!artifact || !window.confirm(`${run.workspace}/${artifact.path}\nİncelediğin öneri dosyaya yazılsın mı? Önceki içerik yedeklenir.`)) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError('');
    try {
      const data = await post('/api/office', { action: 'apply', id: run.id, artifactId }, controller.signal);
      setCheckResult('');
      setRun((previous) => previous ? { ...previous, artifacts: previous.artifacts.map((item) => item.id === artifactId ? data.artifact : item) } : previous);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Dosya uygulanamadı.'); }
    finally { request.current = null; setBusy(false); }
  };
  return { mode, setMode, workspace, setWorkspace: (value: string) => { setWorkspace(value); setFocusFile(''); setChecks([]); setCheckResult(''); remember(value, runId); }, focusFile, setFocusFile, run, pending, expanded, setExpanded, busy, error, output, commandDraft, checks, checkResult, runCheck,
    route, execute, apply, cancelTeam, cancelRequest: () => request.current?.abort(), dismiss: () => { if (!busy) { setPending(null); setCommandDraft(''); } },
    chooseWorkspace: () => { selecting.current = true; if (!sendNativeAction('chooseWorkspace')) { selecting.current = false; setError('Web sürümünde proje klasörünün tam yolunu yaz.'); } },
  };
}
