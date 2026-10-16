'use client';
import type { useJarvisWork } from '@/hooks/useJarvisWork';
import { officeReport, officeStatusText, type JarvisWorkMode } from '@/lib/jarvis-command';

export default function JarvisWorkPanel({ work, onOpenOffice, onReadReport }: {
  work: ReturnType<typeof useJarvisWork>;
  onOpenOffice: (runId: string, workspace: string) => void;
  onReadReport: (text: string) => void;
}) {
  const active = work.run && ['planning', 'running'].includes(work.run.status);
  const download = () => {
    if (!work.run) return;
    const url = URL.createObjectURL(new Blob([officeReport(work.run), work.checkResult ? `\n## Yerel kontrol sonucu\n\n${work.checkResult}\n` : ''], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'chloe-jarvis-rapor.md'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <details className="jarvis-work" open={work.expanded} onToggle={(event) => work.setExpanded(event.currentTarget.open)}>
    <summary>İş alanı · Kodlama, ekip, yönetim ve rapor {active ? '· Ekip çalışıyor' : ''}</summary>
    <div className="jarvis-work-body custom-scrollbar">
      <div className="flex flex-wrap gap-2" role="group" aria-label="JARVIS görev modu">
        {([['auto', 'Otomatik'], ['team', 'Ajan ekibi'], ['browser', 'Tarayıcı'], ['computer', 'Bilgisayar'], ['report', 'Rapor']] as [JarvisWorkMode, string][]).map(([mode, label]) =>
          <button key={mode} type="button" aria-pressed={work.mode === mode} onClick={() => work.setMode(mode)} className={work.mode === mode ? 'is-active' : ''}>{label}</button>)}
      </div>
      <p>Seçimin sesli ve yazılı isteklerine uygulanır. “hello.js dosyasını düzenle” işini hazırladıktan sonra “Ekibi başlat”, “Ekibin durumu ne?” veya “Raporu oku” diyebilirsin. Dosyaya yazma ayrı, görsel onay ister.</p>
      <div className="flex flex-wrap gap-2">
        <input aria-label="JARVIS proje klasörü" placeholder="Proje klasörünün tam yolu" value={work.workspace} onChange={(event) => work.setWorkspace(event.target.value)} disabled={work.busy} />
        <button type="button" onClick={work.chooseWorkspace} disabled={work.busy}>Klasör seç</button>
      </div>
      <input aria-label="JARVIS çalışma dosyası" placeholder="İsteğe bağlı mevcut dosya: src/app.ts" value={work.focusFile} onChange={(event) => work.setFocusFile(event.target.value)} disabled={work.busy} />
      <p>Dosya seçilirse mevcut içeriği ekibe gönderilir. Ekip ana modelini veya ajan başına ayarladığın bağlantıları kullanır; başka sağlayıcıya sessiz geçilmez.</p>
      {work.pending && <section aria-label="İş onayı" className="jarvis-work-result">
        <strong>İstek hazır — henüz başlatılmadı</strong>
        <p>{work.pending.prompt}</p>
        {work.commandDraft && <><pre>{work.commandDraft}</pre><p>Bu gerçek bir bilgisayar komutudur. Mac’e gönderdiğinde mevcut onay/tam erişim ayarına göre çalışabilir. Etkisini kontrol et.</p></>}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={work.busy || Boolean(active && ['team', 'report'].includes(work.pending.kind))} onClick={() => void work.execute()}>
            {work.busy ? 'Hazırlanıyor…' : ['team', 'report'].includes(work.pending.kind) ? 'Ekibi başlat' : work.pending.kind === 'browser' ? 'Adresi aç / oku' : work.commandDraft ? 'İnceledim, Mac’e gönder' : 'Komut önerisi hazırla'}
          </button>
          <button type="button" onClick={work.busy ? work.cancelRequest : work.dismiss}>{work.busy ? 'İsteği durdur' : 'Vazgeç'}</button>
        </div>
      </section>}
      {work.error && <p role="alert" className="text-app-danger">{work.error}</p>}
      {work.output && <pre className="jarvis-work-result">{work.output}</pre>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={work.busy} onClick={() => void work.runCheck()}>Proje kontrollerini getir</button>
        {work.checks.map((check) => <button key={check.id} type="button" disabled={work.busy} onClick={() => void work.runCheck(check.id)}>{check.label}</button>)}
        {work.busy && !work.pending && <button type="button" onClick={work.cancelRequest}>Kontrolü durdur</button>}
      </div>
      {work.checkResult && <pre className="jarvis-work-result">{work.checkResult}</pre>}
      {work.run && <section aria-label="JARVIS ekip çalışması" className="jarvis-work-result">
        <strong>{officeStatusText(work.run)}</strong>
        <p>{work.run.prompt}</p>
        {work.run.tasks.map((task) => <p key={task.id}>{task.title} · {task.status}{task.error ? ` — ${task.error}` : ''}</p>)}
        <div className="flex flex-wrap gap-2">
          {active && <button type="button" onClick={() => void work.cancelTeam()}>Ekibi durdur</button>}
          <button type="button" onClick={download}>Raporu indir</button>
          <button type="button" onClick={() => onReadReport(`${officeStatusText(work.run)} ${work.run?.result || ''}`)}>Raporu seslendir</button>
          <button type="button" onClick={() => onOpenOffice(work.run!.id, work.run!.workspace)}>Ofiste ayrıntıları aç</button>
        </div>
        {work.run.result && <details><summary>Ekip raporunu göster</summary><pre>{work.run.result}</pre></details>}
        {work.run.artifacts.map((artifact) => <details key={artifact.id}>
          <summary>{artifact.path} · {artifact.applied ? 'Uygulandı' : artifact.review?.verdict === 'approved' ? 'Denetlendi, öneri' : 'Denetim gerekli'}</summary>
          <p>{artifact.review?.summary} Otomatik test çalıştırılmadı.</p>
          <pre>{artifact.content}</pre>
          <button type="button" disabled={work.busy || work.run?.status !== 'completed' || artifact.applied || artifact.review?.verdict !== 'approved'} onClick={() => void work.apply(artifact.id)}>{artifact.applied ? 'Uygulandı' : 'İnceledim, dosyaya uygula'}</button>
        </details>)}
      </section>}
    </div>
  </details>;
}
