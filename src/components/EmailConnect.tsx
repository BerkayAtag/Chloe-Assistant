'use client';

import { useState } from 'react';
import { emailProvider, normalizeEmail } from '@/lib/email-provider';

type Provider = 'google' | 'microsoft';
type Status = { provider: Provider; configured: boolean; callbackUrl?: string };

export default function EmailConnect({ integrations, onUpdated }: { integrations: Status[]; onUpdated: () => void }) {
  const [email, setEmail] = useState('');
  const [provider, setProvider] = useState<Provider>('google');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const status = integrations.find((item) => item.provider === provider);
  const field = 'mt-2 w-full rounded-xl border border-app-border bg-app-bg px-3 py-2.5 text-sm text-app-text';

  return <section className="mb-6 rounded-3xl border border-app-border bg-app-surface p-5" aria-label="E-posta hesabı ekle">
    <h2 className="font-semibold">E-posta adresinle bağlan</h2>
    <p className="mt-2 text-sm text-app-muted">Şifreni Chloe’ye yazma. İzinleri Google veya Microsoft hesabında onaylarsın. Her sağlayıcı için şu anda bir hesap bağlanabilir.</p>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <label className="text-sm">E-posta adresi<input className={field} type="email" autoComplete="email" placeholder="ad@gmail.com" value={email} onChange={(event) => {
        setEmail(event.target.value); setMessage('');
        const detected = emailProvider(event.target.value);
        if (detected && detected !== provider) { setProvider(detected); setClientId(''); setClientSecret(''); }
      }}/></label>
      <label className="text-sm">Hesap sağlayıcısı<select className={field} value={provider} onChange={(event) => { setProvider(event.target.value as Provider); setClientId(''); setClientSecret(''); setMessage(''); }}>
        <option value="google">Google · Gmail / Workspace</option><option value="microsoft">Microsoft · Outlook / Microsoft 365</option>
      </select></label>
    </div>
    <p className="mt-2 text-xs text-app-muted">Kurumsal bir adres kullanıyorsan posta kutunu barındıran sağlayıcıyı seç.</p>
    {status && !status.configured && <details className="mt-4 rounded-xl border border-app-border p-3">
      <summary className="cursor-pointer text-sm font-medium">Bir defalık uygulama kurulumu gerekli</summary>
      <p className="mt-3 text-sm text-app-muted">Bu yerel kurulumda OAuth uygulama kimliği henüz yok. Sadece e-posta adresi veya AI API anahtarı posta kutusu erişimi sağlayamaz. Aşağıdaki bağlantıdan kendine ait OAuth uygulamasını oluştur; sonraki girişlerde yalnızca adresin yeterli olacak.</p>
      <a className="mt-2 inline-block text-sm underline" href={provider === 'google' ? 'https://console.cloud.google.com/auth/clients' : 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade'} target="_blank" rel="noreferrer">{provider === 'google' ? 'Google Cloud OAuth istemcileri' : 'Microsoft uygulama kayıtları'}</a>
      <p className="mt-3 text-xs text-app-muted">Web uygulaması oluştur; Gmail ve Calendar API’lerini veya Microsoft Graph posta/takvim izinlerini etkinleştir. Google test modundaysa kendi adresini test kullanıcısı yap. Yönlendirme adresi:</p>
      <code className="mt-2 block break-all rounded-lg bg-app-bg p-2 text-xs">{status.callbackUrl}</code>
      <form className="mt-3 space-y-3" onSubmit={async (event) => {
        event.preventDefault(); setBusy(true); setMessage('');
        try {
          const response = await fetch('/api/integrations/setup', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-chloe-settings': '1' }, body: JSON.stringify({ provider, clientId, clientSecret }), signal: AbortSignal.timeout(15_000) });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'Kurulum kaydedilemedi.');
          setClientId(''); setClientSecret('');
          setMessage(result.configured ? 'Kurulum şifreli kaydedildi. Şimdi hesabını bağlayabilirsin.' : `Kurulum kaydedildi; şu alanları kontrol et: ${result.missing.join(', ')}`);
          onUpdated();
        } catch (error) { setMessage(error instanceof Error ? error.message : 'Kurulum kaydedilemedi.'); }
        finally { setBusy(false); }
      }}>
        <label className="block text-sm">OAuth istemci kimliği<input required className={field} value={clientId} onChange={(event) => setClientId(event.target.value)} autoComplete="off" maxLength={1024}/></label>
        <label className="block text-sm">OAuth istemci sırrı<input required className={field} type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} autoComplete="new-password" maxLength={4096}/></label>
        <button disabled={busy} className="rounded-xl border border-app-border px-4 py-2 text-sm disabled:opacity-50">{busy ? 'Kaydediliyor…' : 'Kurulumu güvenle kaydet'}</button>
      </form>
    </details>}
    <a href={`/api/integrations/connect/${provider}?email=${encodeURIComponent(email.trim())}`} target="_blank" rel="noreferrer" aria-disabled={!status?.configured} className={`mt-4 inline-flex rounded-xl px-4 py-2.5 text-sm font-semibold ${status?.configured ? 'bg-app-accent text-app-on-accent' : 'border border-app-border text-app-muted'}`} onClick={(event) => {
      try {
        normalizeEmail(email);
        if (!status?.configured) throw new Error('Önce yukarıdaki bir defalık OAuth uygulama kurulumunu tamamla.');
        setMessage('Hesap onayı tarayıcıda açılıyor. İşlem bitince bu sayfaya dön; bağlantı durumu yenilenecek.');
      } catch (error) { event.preventDefault(); setMessage(error instanceof Error ? error.message : 'Adres geçersiz.'); }
    }}>Hesabımı bağla</a>
    {message && <p role="status" className="mt-3 text-sm text-app-muted">{message}</p>}
  </section>;
}
