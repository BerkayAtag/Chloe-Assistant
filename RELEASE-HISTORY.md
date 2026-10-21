# Chloe Assistant — Sürüm Geçmişi ve Devir Notları

> **Bu dosya, farklı yapay zekâ modelleri/araçları arasında devir teslim içindir.**
> Yeni bir oturuma başlarken ÖNCE bu dosyayı oku: nerede kalındı, ne yapıldı,
> ne yarım, ne sırada. Her anlamlı işten sonra buraya bir madde ekle.

- **Proje:** `/Users/n64800/Documents/antigravity/aiasistant/kisisel-ai-asistan`
- **Paket:** `chloe-assistant` v0.2.7 · Next.js 16.4 · React 19 · TypeScript 5 · Tailwind v4
- **Dağıtım:** macOS native `Chloe.app` (Swift WebView) + yerel Next.js sunucusu
- **Sunucu adresi:** `http://127.0.0.1:3004` (native app kendi sunucusunu başlatır)
- **Son güncelleme:** 2026-10-21 — v0.2.7 yayınlandı ve kurulu uygulama açıldı; GitHub kalite kontrolleri geçti; güvenlik incelemesi kısmi

## 2026-10-21 — Jarvis entegrasyonu: Prompt sistemi (Phase 1)

- [Jarvis AI Assistant](https://github.com/akshayaggarwal99/jarvis-ai-assistant) projesinin `src/prompts/prompts.ts`'indeki **signature preservation** ve **dictation cleaning** kuralları Chloe'ye port edildi.
- Yeni `src/lib/speech-text.ts` fonksiyonu: `jarvisDictationClean()` — filler kelime temizliği, homophone düzeltmesi (their is → they're), "readme dot md" → "readme.md" dosya uzantısı dönüşümü, sözlü emoji çevirisi (🔥, 👍, ❤️, 😊).
- `src/lib/jarvis-prompts.ts` oluşturuldu: dictation prompt, email formatting prompt, assistant prompt ve code assistant prompt'ları içerir.
- `useVoice` hook'unda TTS gönderiminden önce metin `jarvisDictationClean()` ile temizlenir.
- Yeni test paketi: `script/dictation-clean.test.mjs` (9 test, hepsi geçti).
- `package.json` test scriptlerine `test:dictation-clean` eklendi.
- **Doğrulama:** 9/9 dictation test, 27/27 voice-ui test, 34/34 jarvis test, 25/25 speech-text test — **95/95 toplam.** Lint, tsc, production build temiz.


## 2026-10-21 — GitHub kalite ve yayın kontrolü

- `05589bb` kaynak sürümü için [GitHub Actions 39542583988](https://github.com/BerkayAtag/chloe-assistant/actions/runs/39542583988) tamamlandı: Node 22 temiz kurulum, lint, anahtarsız birim/güvenlik regresyonları ve üretim derlemesi başarılı.
- README indirme bağlantıları v0.2.7 olarak güncellendi; mevcut gerçek uygulama ekran görüntüleri korundu. Dağıtım kaynak ZIP + macOS kurucudur, bağımsız/noter onaylı bir DMG değildir.
- Kaynak incelemesi OAuth PKCE/state dönüşü, şifreli bağlantı kasası, Codex komut sınırları ve native köprü/onay kontrolleri üzerinde sürdürüldü. Bağımsız güvenlik işçilerinden tamamlanmış rapor alınamadı; tam depo taraması hâlâ tamamlanmış sayılmaz. Bu sürüm için sıfır güvenlik açığı veya bütün cihazlarda kusursuz çalışma garantisi verilmez.
- Uçtan uca insan konuşması gecikmesi ayrıca ölçülmeli: önceki ayrı metin/ses istek süreleri mikrofon→hoparlör toplamı olarak sunulmamalı.
- v0.2.7 GitHub yayını oluşturuldu. Kaynak ZIP `f7415cd` commit'inden üretildi; 3.677.027 bayt, SHA-256 `c586d359cf04b805796e0d314279bb24f393c4688cb9103535fe97cc4d8ba533`. ZIP ve ayrı kurucu GitHub'dan yeniden indirilerek yerel dosyalarla hash eşleşmesi doğrulandı. Kişisel veri/anahtar kasası arşive eklenmedi.
- `/Applications/Chloe.app` paket sürümü 0.2.7 olarak doğrulandı. Yeniden açılış sonrası yerel sayfa HTTP 200 döndü; native uygulamada sohbet arayüzü ekran görüntüsüyle görüldü. Ana sohbet sağlayıcısı FreeLLMAPI olarak korunuyor.

## 2026-10-21 — Jarvis entegrasyonu: Prompt sistemi + Command Parser (Phase 1 & 5)

- [akshayaggarwal99/jarvis-ai-assistant](https://github.com/akshayaggarwal99/jarvis-ai-assistant) projesinin prompt sistemi ve command parser'ı Chloe'ye port edildi.
- **`src/lib/jarvis-prompts.ts`** (yeni): Dictation prompt, email formatting prompt, assistant prompt, code assistant prompt — signature preservation kuralı (kullanıcının imzasını asla değiştirme, farklı imza ekleme) aktif.
- **`src/lib/command-parser.ts`** (yeni): 12 intent tipi (open_app, open_browser, code_start, team_start/stop, report, dictation_start/stop, search, file_edit, play_pause, volume). Offline regex matching + LLM fallback fallback.
- **`src/app/api/jarvis/command/route.ts`** güncellendi: İlk önce `parseCommand()` ile offline intent çözümlemesi; düşük confidence veya belirsiz komutta LLM'ye fallback. Yeni response şeması: `{ intent, entities, confidence, command, explanation }`.
- **`src/lib/speech-text.ts`**: `jarvisDictationClean()` fonksiyonu eklendi — filler ("um", "uh"), homophones ("their is" → "they're"), dosya uzantıları ("readme dot md" → "readme.md"), sözlü emojiler (🔥, 👍, ❤️).
- **`src/hooks/useVoice.ts`** güncellendi: TTS gönderiminden önce `jarvisDictationClean()` uygulanıyor.
- Yeni test: **`script/dictation-clean.test.mjs`** (9 test), **`script/command-parser.test.mjs`** (15 test).
- **Doğrulama:** Toplam 95/95 test geçti (27 runtime + 27 voice-ui + 34 jarvis + 9 dictation-clean). Lint 0 hata, tsc temiz, production build başarılı.

## 2026-10-20 — Jarvis yanıt gecikmesi takip düzeltmesi

- Referans: [Jarvis Gemini sağlayıcısı](https://github.com/akshayaggarwal99/jarvis-ai-assistant/blob/main/src/core/providers/gemini-provider.ts) akışlı yanıt ve Flash-Lite modeli kullanıyor. Aynı API anahtarı; aynı model, düşünme süresi, sessizlik eşiği veya ses sentezi yolu anlamına gelmez. Sitenin yerel dikte gecikmesi, bütün sesli sohbet gecikmesiyle eş tutulmadı.
- Kısa tamamlanmış ilk ifadeler (`Merhaba!` gibi) artık 24 karaktere veya yanıtın tamamlanmasına kadar bekletilmiyor. Kısaltma, sayı ve tamamlanmamış kod blokları için korumalar/testler mevcut.
- Basit hızlı sesli turlarda eski geçmiş son 8 mesaj / 8.000 karakter bütçesiyle sınırlı. En yeni talimat ve ekleri kesilmez; kayıtlı sohbetler silinmez. Normal sohbet ve araç gerektiren işler tam bağlamını korur.
- Jarvis ayarlarına 900 / 1.200 ms seçenekleri ve “Seri konuşmayı seç (1,2 sn)” düğmesi eklendi. Bu Mac'teki kullanıcı profilinde 2,5 sn yerine 1,2 sn etkinleştirildi; varsayılan tüm kullanıcılar için zorla değiştirilmedi. Uzun duraklamalı talimatlarda süreyi artırmak veya otomatik göndermeyi kapatmak hâlâ mümkün.
- Kullanıcının sağladığı yeni anahtar yalnız Jarvis metin/ses bağlantılarına şifreli kasa üzerinden kaydedildi. Önceki kayıtlar korunuyor. Ana sohbet/kodlama sağlayıcısı, modeli ve anahtarı değişmediği API üzerinden doğrulandı. Anahtar kaynak dosyalara veya bu günlüğe yazılmadı.
- Canlı model seçimi: `gemini-3.8-flash` yoğunluk kaynaklı 503 verdi. Aynı yeni anahtarla `gemini-3.5-flash-lite` ilk metni 735 ms'de verdi. Ses modeli `gemini-3.8-flash-lite-tts` doğrudan testte ilk PCM verisini 1.040 ms'de verdi. Eski `gemini-2.5-flash-lite` test edilen yollarda 404/400 döndürdüğünden seçilmedi.
- Chloe üretim API'si üzerinden canlı doğrulama: `/api/chat` sesli tur HTTP 200, ilk metin **848 ms**, toplam **861 ms**; ayrı `/api/voice` PCM isteği HTTP 200, ilk ses verisi **724 ms**, toplam **1.211 ms**, 103.680 bayt. Bunlar tek örneklem ve ayrı istek ölçümleridir; mikrofon başlangıcından hoparlöre uçtan uca gecikme veya Jarvis ile eşzamanlı karşılaştırma değildir.
- Doğrulama: **179/179 birim testi**, **15 Jarvis API + 28 anahtar/yönlendirme + 12 Codex API + 17 workbench API kontrolü** geçti. Lint, TypeScript ve `git diff --check` başarılı. API regresyonları sentetik sağlayıcı kullanır; yukarıdaki iki ölçüm gerçek Gemini bağlantısıdır. Workbench ayrı veri alanında, Codex geçici proje klasöründe test edildi.
- Üretim derlemesi ve macOS kurulum/açılış doğrulaması başarılı. `/Applications/Chloe.app` güncellendi; yeniden açılan native arayüzde `gemini-3.5-flash-lite` ve 1,2 sn seçimi görüldü. “Sesi dene” hazırlıktan hazır durumuna hata göstermeden döndü. Canlı insan konuşmasının doğallığı ve duraklamalarda mikrofon davranışı kullanıcı denemesi gerektirir; bütün fonksiyonların kusursuz olduğu iddia edilmez.

## 2026-10-21 — Ekip düzeltme döngüsü doğrulaması

- Denetçi geri bildirimi geliştiriciye bir kez gönderilir; yalnız reddedilen dosyalar değiştirilebilir ve yeni içerik tekrar denetlenir. İkinci ret veya bütçe/süre sınırı işi durdurur. Olumsuz karar otomatik onaya çevrilmez.
- Düzeltme yanıtında eksik/fazladan/tekrarlanan dosya yolları ve büyük içerik reddedilir. Düzeltme sırasında dosyanın dışarıdan değiştirilmesi ayrıca denetlenir; yeni sürümün üzerine sessizce yazılmaz.
- **181/181 birim testi**, ayrı test ofisinde **42/42 API kontrolü**, lint ve üretim derlemesi geçti. Test sunucusu kapatıldı; gerçek kullanıcı ekibi değiştirilmedi.
- Gerçek seçili sağlayıcıyla ekip planı → kod inceleme → açık uygulama → üretilen kodu çalıştırma testi **78.530 ms / 7 model adımında geçti**. Bu canlı tur ilk denetimde onaylandı; ret/düzeltme/yeniden denetim yolları sentetik API testleriyle ayrıca doğrulandı. Önceki başarısız denemeler tarihsel kanıt olarak aşağıda korunuyor.
- Son kaynak derlemesi Applications'a kuruldu. GitHub yayını ve kapsamlı güvenlik taramasının tamamlanması hâlâ bekliyor; tüm hedef tamamlanmış değildir.
- GitHub Actions kalite akışı eklendi: salt okunur depo izniyle Node 22 üzerinde anahtarsız birim testleri, lint ve üretim derlemesi. Uzak CI sonucu yayın öncesi ayrıca kontrol edilmeli.

## 2026-10-20 — Kodlama ve yayın denetimi (devam ediyor)

- Gerçek seçili sağlayıcıyla geçici klasörde kod üretme → kaydetme → proje testini çalıştırma akışı **8/8** geçti.
- Gerçek ekip denemesinde denetçi, açıkça kapsam dışı bırakılan `null/undefined` desteğini zorunlu sayıp doğru string düzenlemesini reddetti. Denetim istemi artık kabul koşullarını isteğe bağlı iyileştirmelerden ayırıyor; gerçek güvenlik ihlalleri/veri kaybı/regresyonlar yine ret sebebi. Olumlu, güncel içerik hash'ine bağlı denetim kapısı kaldırılmadı. İlk başarısız deneme inceleme için korunuyor.
- Canlı tekrar **başarısız**: `b9d32135-62a5-499b-a43b-7fc9f6e0a671` çalışmasında sağlayıcı yine kapsam dışı null desteğini güvenlik gerekçesiyle reddetti; yalnız istem düzeltmesi yeterli olmadı. `/tmp/chloe-team-live.IGMMCJ` test klasörü korunuyor, öneri uygulanmadı. Sonraki adım: denetçi geri bildirimini geliştiriciye aktaran bütçeli düzeltme/yeniden denetim akışı; hiçbir olumsuz karar otomatik onaya çevrilmemeli. Ekip kodlama uçtan uca başarılı olarak raporlanmamalı.
- Codex'in model tarafından kesilmiş veya içerik filtresinde yarım kalmış çıktıyı tam kod olarak sunması engellendi. Üretilen UTF-8 dosyanın editörün 120 KB sınırına uyduğu da yanıt verilmeden kontrol ediliyor.
- **180 birim testi**, **15 Codex API kontrolü**, lint ve üretim TypeScript/derleme başarılı. Codex API testlerinde üç yeni olumsuz senaryo: çıktı kesilmesi, içerik filtresi, çok baytlı büyük çıktı.
- Son kaynak derlemesi `/Applications/Chloe.app` üzerine kuruldu; önceki paket kurtarılabilir yedek ZIP/Çöp üzerinden korunuyor. Native pencerenin içerik yüklediği doğrulandı.
- GitHub API canlı kontrolünde son yayın hâlâ **v0.2.6**, kaynak ZIP ve kurucu mevcut. Bu devam eden düzeltmeler henüz yeni yayına alınmadı; yayın/indirme doğrulaması ve son sürüm numarası yükseltmesi bekliyor.
- Güvenlik taraması `b977c31a-e0b2-48ec-8142-9eb703f315cb`: ön kontrol hazır; bağımsız temel inceleme ve mimari işçileri kullanım sınırında sonuç döndüremedi. İlk kaynak destekli tehdit haritası ve eksik kapsam kalıcı ara kayda alındı. Tarama tamamlandı veya açık yok denemez; kalan kaynak incelemesi sürdürülmeli.
- Referans incelemesinde Cline'ın geri alma noktaları ve OpenHands'ın kontrollü yerel yürütme yaklaşımı değerlendirildi. Kalıcı geri alma arayüzü bu turda uygulanmadı; güvenli kodlama geliştirmesi olarak sonraki işlerde tutuluyor.

---

## 1. Nasıl çalıştırılır / erişilir

```bash
cd /Users/n64800/Documents/antigravity/aiasistant/kisisel-ai-asistan

# 1) Üretim derlemesi + native paket + kurulum + açılış (ÖNERİLEN)
./script/build_and_run.sh --verify

# 2) Sadece web sunucusunu yeniden başlat (derleme hazırsa, hızlı)
./script/build_and_run.sh --restart-web

# 3) Geliştirme modu (tarayıcıdan canlı çalışma)
npm run dev -- -H 127.0.0.1 -p 3004
```

- **Uygulama:** Finder → Applications → **Chloe** (ya da `open /Applications/Chloe.app`)
- **Tarayıcı:** `http://127.0.0.1:3004`
- Desteklenen geliştirme/üretim/native başlangıç yolları `127.0.0.1` dinler.
  Host/Origin denetimi kimlik doğrulama değildir; ağ arayüzünü değiştirmeyin.

### Erişim sorununda ilk kontrol edilecekler

| Belirti | Neden | Çözüm |
| --- | --- | --- |
| Tarayıcı "bağlanamadı" | Sunucu/uygulama kapalı (3004 boş) | `./script/build_and_run.sh --verify` |
| Port 3000 dolu | Docker Desktop 3000'i tutuyor | Uygulama zaten **3004** kullanır; 3000'i kullanma |
| Uygulama açılıyor ama sayfa boş | Eski `.next` derlemesi | `./script/build_and_run.sh --verify` |
| Port 3004 "başka süreç" diyor | Port çakışması veya eski sunucu | Önce PID, komut ve çalışma klasörünü doğrula. Kurucu yalnız bu projeye ait Next.js sürecini durdurur; toplu `kill` kullanma. |

---

## 2. Mimari özet (dosya haritası)

```
src/
├── app/
│   ├── page.tsx                 # Tek sayfa uygulama: sohbet + Jarvis + ofis + kod modu
│   ├── layout.tsx               # Tema başlatma + metadata
│   ├── globals.css              # Tailwind v4, gece/siyah/beyaz tema değişkenleri
│   └── api/
│       ├── chat/                # Ana sohbet + araç çağırma + Jarvis olay protokolü
│       ├── voice/               # Bulut TTS (Gemini/uyumlu API) üretimi
│       ├── jarvis/command/      # Jarvis sesli komut yönlendirme
│       ├── office/, skills/, files/, generate/   # Ajan ofisi, beceriler, dosya, medya
│       ├── integrations/        # Google/Microsoft mail + takvim OAuth
│       ├── codex/               # Yerel kod çalışma alanı (proje, komut, görev)
│       ├── projects/, conversations/, memory/, expertise/  # Veri katmanı
│       └── settings/            # Şifreli anahtar kasası (AES-256-GCM)
├── components/                  # Sidebar, JarvisConsole, AgentOffice, CodeWorkspace,
│                                # OfficeWorkbench, VoiceOrb, SettingsModal, EmailConnect
├── hooks/                       # useVoice (STT+TTS), useSettings, useJarvisWork
└── lib/                         # settings, llm-provider, jarvis-model, media-provider,
                                 # speech-queue, speech-text, office-*, skills, research…
macos/                           # Swift native paket (ChloeDesktop)
script/                          # build_and_run.sh + tüm test paketleri
data/                            # JSON veri + şifreli kasa (data/office/.key)
```

---

## 3. Sürüm geçmişi

### v0.2.6 — 2026-10-19

18–19 Ekim'deki devam çalışması. Önceki araçların değişiklikleri korunarak güncel
çalışma ağacı incelendi; aşağıdaki maddeler eski sürümlerdeki genel vaatlerden
ayrı, bu turda yapılan değişiklik ve kanıtlardır.

**Mikrofon ve tur kontrolü**
- Web Speech `isFinal` artık bütün konuşmanın sonu sayılmıyor. Jarvis ara
  segmentleri birleştiriyor, sessizlik sayacını yeniliyor; beklenmeyen tanıyıcı
  kapanışında önceki metni koruyarak sınırlı yeniden başlatma yapıyor.
- Native Apple tanıyıcısı final segmentten sonra yeni segmente geçiyor;
  ses etkinliği RMS ile izleniyor. Geç/iptal edilmiş oturum olayları yok sayılıyor.
- Otomatik gönderim kapatılabiliyor; **Bitir ve gönder** düğmesi mevcut metni
  hemen teslim ediyor. İptal etmek mesaj göndermiyor. Varsayılan sessizlik
  eşiği 2,5 saniye; bunu sırf hız için düşürüp uzun talimatları kesmedik.
- Kullanıcı önceki insan testinde kesilme değil geç yanıt bildirdi. Her ortamda
  mikrofon kalitesi/konuşma sonu tespiti kusursuz doğrulanmış değildir.

**Yanıt gecikmesi ve doğal ses**
- Yeni `gemini-pcm-stream.ts` Gemini Interactions SSE ses parçalarını boyut
  sınırlarıyla 24 kHz mono PCM'e dönüştürüyor; `pcm-player.ts` tüm ses dosyası
  tamamlanmadan sırayla oynatıyor. Ağ okuması, oynatıcı ve kaynaklar iptalde
  temizleniyor. Uyumlu özel API'lerin MP3/WAV yolu korunuyor.
- Canlı sağlayıcıda gelen ek `data: [DONE]` işaretinin JSON sanılması bulundu
  ve düzeltildi. Yalnız bu işaret başarı sayılmıyor; typed completion da gerekli.
- Kota/anahtar/yapılandırma 4xx hataları korunuyor; aynı başarısız ses bölümü
  ve sonraki cümleler tekrar tekrar istenmiyor. Ücretli plana veya başka
  sağlayıcıya otomatik geçiş yapılmadı.
- 18 Ekim tekil ölçümü: doğrudan Jarvis Gemini ilk metin 3542 ms; unary TTS
  2434 ms. Ayrı PCM sağlayıcı probunda ilk parça 825 ms, tüm aktarım 1206 ms.
  Bunlar farklı isteklerdir; toplam konuşma gecikmesi veya garantili hızlanma
  ölçümü değildir. Mikrofon sessizlik süresi bu ölçümlere dahil değildir.
- 19 Ekim canlı denemelerinde Google `gemini-3.8-flash-tts` ücretsiz günlük
  10 istek kotası doldu (HTTP 429). Son PCM düzeltmesinin gerçek hoparlör
  zinciri kotadan sonra yeniden denenmeli. UI kota hatasını gösterip hazır
  duruma döndü; test tamamlandı diye yanlış raporlanmadı.
- `minimal` düşünme seviyesi denemesi canlı model tarafından 400 ile
  reddedildi; değişiklik geri alındı. Desteklenmeyen seçenek yayımlanmıyor.
- Sunucunun `meta.connection` olayı artık arayüzde gösteriliyor. Yazılı
  tur ana bağlantıya giderken üstte yalnız Gemini yazması yanıltıcıydı;
  **Son yanıt / Yanıt bağlantısı** gerçek seçilen bağlantıyı gösterir.

**Kodlama ve ekip**
- Odak dosyası için `proposeFile` başarıyla tamamlandığında geliştiricinin
  gereksiz ikinci model turuna gitmesi engellendi. Bu tur bazen token sınırına
  takılıp doğru dosya önerisini başarısız gösteriyordu. Son denetçi, içerik
  hash kontrolü ve kullanıcının uygulama onayı korunuyor.
- `test:code-e2e`: gerçek kayıtlı ana bağlantıyla geçici klasörü açma, kod
  üretme, hash kontrollü kaydetme ve gerçek proje testini çalıştırma: 8/8.
- `test:team-e2e`: geçici klasörde plan → dosya önerisi → zorunlu denetim →
  açık uygulama → üretilen fonksiyonu çalıştırma. 18 Ekim başarılı tur 50.289 ms,
  8 model adımı. 19 Ekim tekrarı `null/undefined` sözleşmesi belirsiz diye
  denetçi tarafından reddedildi; dosya yazılmadı. Testin string-girdi
  sözleşmesi netleştirildi; denetçi kararını geçersiz kılan bir bypass eklenmedi.
- Planlar çalışan başlamadan doğrulanıyor: kayıtlı ajan kimliği, benzersiz
  görev kimliği, önceki göreve bağımlılık ve en fazla 4 görev. Semantik plan
  hatasında tek düzeltme turu var; ikinci geçersiz plan güvenli biçimde durur.
- Araç kullanan ajanın son adımı metin raporuna ayrılıyor; yalnız araç
  okuyup boş yanıtla bitme regresyonu kapatıldı. Uyumlu gateway'e her
  çalışma/ajan için sabit oturum kimliği veriliyor; model tercihi değişmiyor.
- 19 Ekim son canlı ekip testi: **62.388 ms, 8 model adımı**, tüm zincir
  ve üretilen fonksiyonun gerçek çalıştırılması geçti. Önceki denemelerde
  sağlayıcı çıktı sınırı ve hatalı plan görüldü; bunlar başarı sayılmadı ve
  onaysız dosya yazılmadı. Tek başarılı tur her isteğin başarılı olacağını
  veya aynı hızda biteceğini garanti etmez.

**Güvenlik ve kurulum**
- `npm dev/start` artık açıkça `127.0.0.1` dinliyor; Host/Origin bir
  kimlik doğrulama sistemi olmadığı için LAN'a varsayılan yayın kaldırıldı.
- Jarvis LLM/TTS sağlayıcısı veya uç noktası değişince eski anahtar/model
  yeni sunucuya taşınmıyor. Aynı kural sunucu kasasında da uygulanıyor;
  eski anahtar kendi kapsamında arşivli kalıyor, kasa silinmiyor.
- 24 doğrulanmış eski uygulama kopyası kurtarılabilir Çöp Sepeti'ne taşındı.
  Yeni derleme `.build.noindex` içinde; önceki kurulu sürüm ZIP olarak
  korunuyor. Kullanıcı sohbetleri ve API anahtarları silinmedi.
- Uygulama `/Applications/Chloe.app` yoluna kurulur. Paket kaynak klasörüne
  bağlı yerel kurulumdur; taşınabilir/notarize edilmiş ikili dağıtım değildir.
- Güvenlik incelemesi iki kaynak-temelli bulguyu düzeltti (ağ dinleyicisi,
  kimlik bilgisi kapsam değişimi). Kapsam kısmi; OAuth sağlayıcıları, kötü
  niyetli dosya sistemi yarışları ve üçüncü taraf servisler için sıfır açık
  garantisi verilmez.
- Yerel Git remote adresindeki gömülü kimlik bilgisi kaldırıldı; mevcut
  yetki macOS Keychain üzerinden doğrulandı. Anahtar kaynak dosyaya eklenmedi.

**19 Ekim son doğrulama ve dağıtım**
- `lint`, TypeScript, üretim/native derleme ve imza doğrulaması geçti.
- **174/174** birim/regresyon; **108/108** API kontrolü
  (Ofis 38, Jarvis bağlantı 28, Jarvis protokol 13, Codex 12, atölye 17).
- **4/4** native komut sınırı/iptal kontrolü; gerçek sağlayıcıyla Codex **8/8**,
  yukarıdaki gerçek ekip testi başarılı. Sentetik API testleri canlı servis
  erişilebilirliği veya canlı e-posta/medya üretimi testi değildir.
- `npm audit --omit=dev`: bilinen üretim bağımlılığı açığı 0. Bu sonuç,
  uygulamanın hiç güvenlik açığı olmadığı anlamına gelmez.
- Gerçek arayüzde Jarvis → odak görünümü → iş alanı → Ajan Ofisi geçişleri
  kontrol edildi. 1280×800 ve 390×844 ekranlarında küre ve yazı alanı görünür;
  kontrol edilen tarayıcı konsolunda hata/uyarı ve framework hata katmanı yok.
- `/Applications/Chloe.app` v0.2.6 kurulu; Command-Q native uygulamayı
  kapatıyor, tekrar açılıyor. Paylaşılan loopback web sunucusu açık tarayıcı
  oturumunu bozmamak için çalışmaya devam ediyor. Spotlight'ta yalnız bu
  uygulama kaydı bulundu; mikrofon açık bırakılmadı.
- README'nin gerçek Jarvis/ofis ekran görüntüleri yenilendi. v0.2.6 GitHub
  dağıtımı kaynak ZIP + `Install Chloe.command` biçimindedir; kurucu kaynak
  klasöründe derler. Klasörü sonradan silmeyin/taşımayın. Taşınabilir,
  notarize edilmiş DMG dağıtımı henüz yoktur.

**Devam edilebilecek işler / kabul sınırları**
- Kota yenilenince Türkçe doğal sesin gerçek hoparlör + söze girme testi;
  son ses akışı düzeltmesi için kalan temel kabul kontrolü budur.
- Doğrudan çift yönlü realtime speech adaptörü, adaptif VAD ve isteğe bağlı
  yerel Whisper/Parakeet ayrı geliştirmelerdir; bu sürümde kurulu değiller.
- API anahtarı olmadan bulut medya üretimi, canlı e-posta gönderimi ve
  sağlayıcının kota/erişilebilirlik garantisi verilemez. Testler bunları
  yapılmış saymaz; gerçek hesaplarda yan etkili test mesajı gönderilmedi.

### v0.2.0 — 2026-10-15 (önceki oturumlar: Codex / Claude / Gemini)
- Ajan Ofisi (koordinatör/araştırmacı/geliştirici/denetçi), çalışma atölyesi,
  beceri kataloğu, JARVIS sesli asistan, Chloe Code çalışma alanı, Office Workbench.
- Şifreli anahtar kasası (AES-256-GCM), SSRF/origin korumaları, açık onay akışları.
- FreeLLMAPI `auto:fast` yönlendirmesi (Jarvis sesli turlar), akışlı cümle kuyruğu,
  cihaz sesi desteği.
- QA: 165 otomatik kontrol + gerçek etkileşim senaryoları (`QA-2026-10-15.md`).

### v0.2.1 (devam ediyor) — 2026-10-17 (deepseek-flash)

**A. Erişim sorunu çözüldü.** Sunucu 3004 portunda çalışmıyordu (Docker 3000'i
tutuyor, 3915'te yetim bir `next-server` kalmıştı). Yetim süreç kapatıldı,
`./script/build_and_run.sh --verify` ile derleme + kurulum + açılış yapıldı.

- Native uygulama: `/Applications/Chloe.app` (çalışıyor)
- Tarayıcı: **http://127.0.0.1:3004** (HTTP 200)

**B. Jarvis'e özel API anahtarı (kredisi biten iş tamamlandı).**

| Parça | Durum |
| --- | --- |
| `src/lib/settings.ts`: `jarvisProvider/jarvisApiKey/jarvisModel/jarvisApiBaseUrl` + varsayılanlar + load/save + `settingsForRequest` sızıntı koruması | ✅ |
| `src/lib/jarvis-model.ts`: `jarvisModelSettings` (`auto:fast`) + `jarvisEffectiveSettings` (özel sağlayıcı çözümleme) | ✅ |
| `src/app/api/chat/route.ts`: **sesli tur → Jarvis bağlantısı, yazılı sohbet/internet → ana bağlantı** ayrımı | ✅ (bu oturumda eklendi) |
| `src/app/api/voice/route.ts`: TTS Jarvis modunda Jarvis anahtarını kullanır | ✅ |
| `src/components/JarvisConsole.tsx`: "JARVIS Hızlı Bağlantı" paneli | ✅ |
| `src/lib/connection-store.ts` + `model-error.ts`: kasa alanları ve redaksiyon | ✅ |
| `npm run test:jarvis-key` (yeni, 15 kontrol) | ✅ 15/15 PASS |

**C. Sağlayıcı sağlığı ve model durumu (freellmapi uyarlaması).**

- Yeni `POST /api/providers/health`: `/livez`, `/readyz` (kimliksiz), `/providers`,
  `/quota-forecast` (anahtarlı) uçlarını özetler; geçersiz anahtarı ayrıca bildirir.
- `POST /api/providers/models` artık `details` döndürür: `executionStatus`
  (`ready`/`needsKey`/`exhausted`), `contextWindow`, `supportsTools`.
- Ayarlar panelinde "Sağlayıcı sağlığı ve kota" düğmesi + model durumu özeti.
- **Gerçek FreeLLMAPI ile doğrulandı** (127.0.0.1:31415, v0.4.1): `live: ok`,
  `ready: 8 upstream`.

**D. Oturum sabitleme (freellmapi uyarlaması).** `X-Session-Id` başlığı konuşma
kimliğinden (yoksa ilk kullanıcı mesajından) deterministik üretilip özel
sağlayıcı isteklerine eklenir; aynı sohbette model değişimi azalır.

**E. Sesli yanıt sertleştirmesi (kullanıcı önceliği).**

Bağımsız bir ses-sistemi denetimi yapıldı (salt okuma) ve bulunan kritik hatalar
düzeltildi:

| # | Hata | Düzeltme | Kanıt |
| --- | --- | --- | --- |
| B1 | TTS hatası `onEnd` çağırmıyordu → **tek hata hands-free döngüsünü kalıcı öldürüyordu** | `failed` artık `onEnd` çağırır | `voice-ui.test.mjs` |
| B1b | `voice.error` dolu olduğu sürece dinlemeye dönüş engelleniyordu | Yalnız **mikrofon** hataları bloklar; TTS hatası temizlenip döngü sürer | `page.tsx` resume efekti |
| B2 | Jarvis sağlayıcısı `openai`/`anthropic`/`local` iken ses **hiç çalışmıyordu (422)** | Ses üretemeyen Jarvis bağlantısında ses **ana bağlantının kendi anahtarıyla** üretilir; Jarvis anahtarı asla başka sağlayıcıya gitmez | `test:jarvis-key` #18-20 |
| B5 | Tek klip hatası **tüm** yanıtın seslendirmesini iptal ediyordu | Aynı metinle 1 kez yeniden denenir, yine olursa yalnız o klip atlanır; okuma sürer | `jarvis.test.mjs` |
| B6 | İstemcide zaman aşımı yoktu → "Ses hazırlanıyor" kalıcı takılabiliyordu | `AbortSignal.timeout(60 sn)` | `useVoice.ts` |
| B8 | Cihaz sesi ham metni okuyordu (markdown/kod/tablo) | Cihaz yolu da `cleanSpeechText` kullanır | `useVoice.ts` |
| B9 | Üst çubuktaki ses düğmesi çalan sesi durdurmuyordu | Kapatınca `stopSpeaking()` çağrılır | `page.tsx` |
| B11 | Yalnızca kod/bağlantıdan oluşan yanıt tam sessizdi | "Yanıt ekranda." bilgisi verilir | `useVoice.ts` |
| B12 | Jarvis anahtarı boşken **ana anahtar başka sağlayıcıya** gidiyordu (yanıltıcı 400) | Net yapılandırma hatası; hiçbir sağlayıcıya istek gitmez | `test:jarvis-key` #16-17 |
| B13 | `prepare` senkron fırlatırsa kuyruk `TypeError` ile ölüyordu | Senkron fırlatma yakalanır (zamanlama korunarak) | `jarvis.test.mjs` |
| B10 | Sayfadan çıkışta cihaz sesi susmuyordu | Unmount'ta `stopSpeaking` + `speechSynthesis.cancel()` | `useVoice.ts` |
| B3 | Ses kimliği (voice) seçimi sunucuda yok sayılabiliyordu | Uyumlu adaptör `body.voice \| settings.customSpeechVoice \| 'nova'` kullanır | `voice/route.ts` |

Ayrıca (önceki turdan): `onerror` sonrası `recognitionRef` temizlenmezse mikrofon
kalıcı ölü kalıyordu → düzeltildi; sessizce düşen oturum için 45 sn bekçi
eklendi; takılı "başlatılıyor" durumu artık düğmeyle iptal edilebiliyor;
`cleanSpeechText` emoji/tablo/madde imi/HTML temizliği + 11 yeni test.

**Ses testleri:** `test:voice-ui` 22/22 · `test:jarvis` 31/31 ·
`test:speech-text` 11/11 · `test:jarvis-key` 20/20.

**Bilinen (henüz yapılmayan) ses işleri:**
- Jarvis konsolundaki ses listesi/etiketleri hâlâ ANA sağlayıcıya bakıyor
  (`JarvisConsole.tsx` `modalityStatus`), etkin Jarvis sağlayıcısına bağlanmalı (B3 kalanı).
- Konuşma sırasında **sesle kesme (barge-in/VAD) yok**; kullanıcı mikrofon
  düğmesiyle kesebiliyor. VAD tabanlı barge-in tasarlanmalı.
- `jarvisSpeechApiKey` alanı kullanılmıyor (ölü alan); ses, LLM anahtarını kullanır (B4).

**F. Sıradaki adımlar:** teslim kapısı (drain gate) ve `humanQA` desenlerinin
Ajan Ofisi'ne uyarlanması; sesli turda barge-in'in VAD ile sertleştirilmesi.

**G. Uygulanan yönlendirme kuralı (kanıtlı):**

| Tur tipi | Kullanılan bağlantı | Kanıt |
| --- | --- | --- |
| Sesli tur (`voiceTurn: true`), araç gerekmiyor | **Jarvis'e özel sağlayıcı/anahtar** | `jarvis-key-qa.mjs` #5-8 |
| Yazılı sohbet (Jarvis modu dahil) | **Ana bağlantı (FreeLLMAPI)** | `jarvis-key-qa.mjs` #1-4 |
| İnternet/araştırma/araç gerektiren sesli tur | **Ana bağlantı + araçlar** | `jarvis-key-qa.mjs` #9-10 |
| `jarvisProvider: inherit` | Ana bağlantı (FreeLLMAPI ise `auto:fast`) | `jarvis-key-qa.mjs` #11 |
| Ses sentezi (TTS) — Jarvis modu açık | **Jarvis anahtarı** | `jarvis-key-qa.mjs` #12-14 |
| Ses sentezi (TTS) — Jarvis modu kapalı | Ana bağlantı | `jarvis-key-qa.mjs` #15 |

`voiceTurn` yalnızca mikrofon/hands-free girişlerinden gönderilir
(`page.tsx` satır 580/597/639); yazılı girişler (769/958/972) göndermez.

**Tasarım kararı:** Jarvis modu için ayrı sağlayıcı + anahtar tanımlanabilir.
`inherit` seçilirse ana bağlantı kullanılır (FreeLLMAPI ise otomatik `auto:fast`).
Normal sohbet, web araması ve ajan işleri **ana bağlantıyı** kullanmaya devam eder;
Jarvis anahtarı yalnızca Jarvis sesli/kısa turlarında geçerlidir. Anahtar şifreli
kasada saklanır, istemciye sızmaz.

---

### v0.2.2 — 2026-10-17 (deepseek-flash) · ACİL DÜZELTME + SES İÇİN AYRI API

#### 🐞 ÇÖKME (kullanıcı bildirdi): "Jarvis'te Gemini seçtim, uygulama çöktü"

**Kök neden:** `src/app/page.tsx` model etiketini **render sırasında**
`jarvisEffectiveSettings(settings)` ile üretiyordu. v0.2.1'de bu fonksiyona
"Jarvis anahtarı yoksa hata fırlat" davranışı eklenmişti. Kullanıcı Jarvis
sağlayıcısı olarak **Gemini** seçip **anahtar girmediği** için render fırladı ve
**tüm arayüz çöktü**; ardından uygulama kapatılınca sunucu da durdu (3004 kapandı).

**Düzeltme (kalıcı tasarım değişikliği):**

| Kural | Uygulama |
| --- | --- |
| Ayarları çözen fonksiyonlar **asla fırlatmaz** | `jarvisEffectiveSettings` ve yeni `jarvisSpeechSettings` her koşulda ayar döner |
| Eksik anahtar → sessizce **ana bağlantıya düş**, çökme yok | `jarvisEffectiveSettings` ana bağlantıyı korur |
| Kullanıcı **bilgilendirilir** (sessiz düşüş yok) | Yeni `jarvisModelIssue()` + Jarvis panelinde ⚠️ uyarı satırı |
| Ana anahtar **başka sağlayıcıya gönderilmez** | Yalnız aynı sağlayıcıdaki ana anahtar kullanılabilir; aksi hâlde ana bağlantı korunur |
| Regresyon koruması | `jarvis.test.mjs`: "jarvis settings never throw during render" (6 sağlayıcı senaryosu) + `jarvis-key-qa.mjs` #7 |

#### 🎙️ YENİ ÖZELLİK: "Ses Modeli İçin Ayrı API (TTS)"

Kullanıcının baştan beri istediği özellik tamamlandı: **konuşma sentezini
(voice) sohbet API'sinden bağımsız, ayrı bir API anahtarıyla** yapabilme.

Yeni ayarlar (`Settings` + şifreli kasa + `settingsForRequest`):

| Alan | Anlam |
| --- | --- |
| `jarvisSpeechProvider` | `inherit` (Jarvis/ana bağlantı) · `gemini` (doğal ses) · `custom` (OpenAI uyumlu `/audio/speech`) |
| `jarvisSpeechApiKey` | Ses için ayrı anahtar (eskiden "ölü alan"dı, artık gerçekten kullanılıyor) |
| `jarvisSpeechModel` | Ses modeli kimliği (örn. `gemini-3.8-flash-tts`, `tts-1`) |
| `jarvisSpeechApiBaseUrl` | Özel ses servisi adresi (yalnız `custom` için) |

**Ses bağlantısı öncelik sırası** (`jarvisSpeechSettings`):
1. Ses için ayrı API (yukarıdaki alanlar doluysa)
2. Jarvis'e özel LLM bağlantısı (ses üretebiliyorsa: Gemini/Özel API)
3. Ana bağlantı (ses üretebiliyorsa)
4. Hiçbiri yoksa → **net açıklama** ("ses için ayrı API bağla veya cihaz sesini seç")

**Arayüz:** Jarvis Konsolu → *Ses ve davranış ayarları* → *Ses bağlantısı ve asistan
davranışı* → **"Ses Modeli İçin Ayrı API (TTS)"** bölümü. Eksik yapılandırmada
kırmızı uyarı gösterilir; çökme yerine bilgi verilir.

#### Doğrulama (uçtan uca)

| Kontrol | Sonuç |
| --- | --- |
| Birim testleri (8 paket) | **143/143** ✓ |
| API testleri (5 paket) | **101/101** ✓ |
| `test:jarvis-key` (yeni ses API senaryoları dahil) | **26/26** ✓ |
| `tsc --noEmit` / `lint` | temiz / 0 uyarı |
| **Çökme senaryosu (tarayıcı):** Jarvis=Gemini + anahtar yok | ✅ sayfa açılıyor, çökme yok, uyarı görünüyor, konsol hatası yok |
| Ayrı ses API alanları (tarayıcı) | ✅ bölüm + sağlayıcı seçimi + anahtar/model alanları + eksik uyarısı |
| `/Applications/Chloe.app` | ✅ güncel sürüm kurulu, native uygulama açık, `http://127.0.0.1:3004` HTTP 200 |

#### Kullanıcı için not: Gemini ses anahtarı nasıl bağlanır?

1. Chloe → **Jarvis** modunu aç → *Ses ve davranış ayarları* → *Ses bağlantısı ve asistan davranışı*.
2. **Ses Modeli İçin Ayrı API (TTS)** → *Ses sağlayıcısı* = **Google Gemini (doğal ses)**.
3. **Ses API Anahtarı** alanına Google AI Studio anahtarını yapıştır (sohbet anahtarından bağımsızdır).
4. (İsteğe bağlı) **Ses Modeli** alanına model kimliğini yaz.
5. Uyarı kaybolur ve ses bu anahtarla üretilir; sohbet ve internet işleri ana API'de (FreeLLMAPI) kalır.

### v0.2.3 — 2026-10-17 (deepseek-flash) · JARVIS AYAR MODERNİZASYONU + BARGE-IN

#### 🎛️ Kullanıcı geri bildirimi: "Ses motoru freellmapi yazıyor, karışık olmuş, sayfanın ortasında olmasın"

Üç sorun birden çözüldü:

| Sorun | Çözüm |
| --- | --- |
| "Ses motoru: Ana API · FreeLLMAPI" etiketi anlaşılmıyordu (sağlayıcı adı motor adıyla karışıyordu) | Yeni **"Nasıl konuşsun?"** seçimi: **Yapay zeka sesi (bulut)** / **Cihaz sesi (çevrimdışı)** — her kart ne yaptığını ve hangi bağlantıyı kullandığını yazıyla anlatıyor |
| Ayarlar sayfanın ortasında kalabalık yapıyordu | Tüm ayarlar **"Jarvis Ayarları" modalına** taşındı; ana ekranda yalnızca tek satır özet + düğme kaldı |
| Ses listesi ana sağlayıcıya bakıyordu (yanlış ses adları) | Ses listesi artık **etkin ses bağlantısına** göre belirleniyor (ayrı ses API'si Gemini ise Gemini sesleri gelir) — eski denetim maddesi **B3** kapandı |

**Yeni modal yapısı** (`src/components/JarvisSettingsModal.tsx`):
1. **Şu anki bağlantılar** — tek bakışta: sohbet/internet, Jarvis hızlı yanıt, ses (konuşma) + durum rozetleri (Bağlı / Ana bağlantı / Eksik / Çevrimdışı)
2. **Nasıl konuşsun?** — bulut sesi vs cihaz sesi (kart seçimi)
3. **Hızlı sohbet bağlantısı (Jarvis)** — sağlayıcı + anahtar + model + adres
4. **Ses (konuşma) bağlantısı** — ayrı TTS API'si (sağlayıcı + anahtar + model + adres)
5. **Konuşma davranışı** — ses/ton/hızlı mod/talimat + yeni barge-in anahtarı
6. **İzinler ve sorun giderme** — mikrofon ve konuşma tanıma izin düğmeleri

#### 🎙️ Yeni (deneysel, varsayılan KAPALI): Barge-in — konuşurken sözünü kesme

- Yeni `src/lib/barge-in.ts`: RMS enerji ölçümü + "eşik üstünde `holdMs` (220 ms) kalma" kuralı.
  Tek karelik ses, oda gürültüsü ve geçersiz değerler **tetiklemez**.
- `useVoice`: bulut sesi çalarken mikrofon enerjisi izlenir; kullanıcı söze girerse ses durur ve
  dinlemeye geçilir. Mikrofon izni yoksa **sessizce devre dışı** kalır (mevcut akış bozulmaz).
- Ayar: **Jarvis Ayarları → Konuşma davranışı → "Konuşurken sözümü kesebilsin (deneysel)"**.
- Neden kapalı: hoparlör sesi mikrofona dönebilir (yankı) ve ortam gürültüsü değişkendir; kullanıcı
  isterse açar. Manuel kesme (mikrofon düğmesi / Space) zaten her zaman çalışıyor.
- Test: `npm run test:barge-in` → **6/6** (tek kare, süre dolması, gürültü, sıfır bekleme, geçersiz değer, RMS).

#### Doğrulama (v0.2.3)

| Kontrol | Sonuç |
| --- | --- |
| Birim testleri (9 paket) | **149/149** ✓ |
| API testleri (5 paket) | **101/101** ✓ |
| `tsc --noEmit` / `lint` | temiz / 0 uyarı ✓ |
| Tarayıcı: özet şeridi + modal + 6 bölüm | ✅ hepsi görünüyor, orta alan temiz |
| Tarayıcı: ses listesi etkin sağlayıcıya bağlı | ✅ Gemini ses API'si seçiliyken Gemini sesleri (Kore vb.) listeleniyor |
| Tarayıcı: konsol hataları | ✅ YOK |
| `/Applications/Chloe.app` | ✅ güncel kuruldu, native uygulama açık, `http://127.0.0.1:3004` HTTP 200 |

#### Kullanıcı için özet: hangi ayar ne yapar?

| Ayar | Ne işe yarar |
| --- | --- |
| **Sohbet ve internet** (Ayarlar → Model) | Normal sohbet, web araması, ajan işleri. FreeLLMAPI burada kalır. |
| **Hızlı sohbet bağlantısı (Jarvis)** | Yalnız **Jarvis modunda konuşurken** yanıtı üretir. Yavaşsa buraya ayrı hızlı anahtar gir. |
| **Ses (konuşma) bağlantısı** | Konuşmayı sese çeviren API. Ayrı anahtar girersen ses, sohbet API'sinden bağımsız üretilir. |
| **Nasıl konuşsun?** | "Yapay zeka sesi" = bulut TTS; "Cihaz sesi" = macOS'in yerleşik sesi (internetsiz). |
| **Barge-in** | Konuşurken sözünü kesme (deneysel, kapalı gelir). |

---

### v0.2.4 — 2026-10-17 (deepseek-flash) · MİKROFON KESİLMESİ + GECİKME + SES SİNYALLERİ

#### 🎤 Kullanıcı bildirimi: "Jarvis modunda bir anda mikrofonum kesiliyor"

**Kök neden bulundu:** Native (Swift) tarafta tur sonunu belirleyen sessizlik
zamanlayıcısı Jarvis **hızlı modda 0,9 saniyeydi** (`main.swift`). Kullanıcı cümle
ortasında doğal olarak durakladığında (0,6–1,5 sn) dikte oturumu kapanıyor ve
mikrofon "aniden kesiliyordu".

| Düzeltme | Ayrıntı |
| --- | --- |
| Sessizlik eşiği yükseltildi | Hızlı mod **1,9 sn**, normal mod **2,4 sn** (önce 0,9 / 1,4) |
| İstemciden ayarlanabilir | `startDictation` artık `silenceMs` parametresi alıyor (0,6–8 sn arası); Swift yeniden derlemeden ayar mümkün |
| Kazara çift dokunuş koruması | Mikrofon düğmesine başlatmadan sonraki **ilk 1,2 sn** içinde ikinci kez basmak oturumu artık iptal etmiyor (önce hemen iptal ediyordu) |
| Etkinliğe duyarlı bekçi | 45 sn'lik "sessiz oturum" bekçisi her konuşma sonucunda yeniden kurulur; canlı ama uzun oturumlar kapanmaz (60 sn) |
| Mikrofon aç/kapa ses sinyali | Yeni `src/lib/audio-cues.ts`: Web Audio osilatörüyle "dinliyorum / bitti / engellendi" tonları — mikrofonun ne zaman açık olduğu artık **duyulur** |

#### ⚡ Gecikme iyileştirmeleri (1-2 sn → daha kısa)

| Değişiklik | Kazanç |
| --- | --- |
| Dinlemeye dönüş gecikmesi **450 ms → 200 ms** | Asistan sustuğunda mikrofon çok daha erken açılır |
| İlk ses parçası eşiği **36 → 24 karakter** (`speech-text.ts`) | İlk cümle daha erken seslendirilmeye başlar (ilk ses gecikmesi düşer) |
| Sessizlik eşiği (yukarıda) | Erken kapanma olmadığı için kullanıcı tek seferde konuşur; gereksiz tur tekrarı azalır |

#### 🔬 Referans repo (jarvis-ai-assistant) incelemesinden uyarlananlar

Rapor, o deponun güçlü yanının **ses hattı mühendisliği** olduğunu gösteriyordu
(TTS/barge-in orada yok, bizde var). Uyarlananlar:

1. **Web Audio ile dosyasız ses geri bildirimi** (oradaki "buduppp/poop" deseni) → `audio-cues.ts`
2. **VAD/eşik mantığını saf fonksiyona ayırma** (test edilebilirlik) → `barge-in.ts`
3. **Sessizlik/ön kontrol ayarlarının istemciden yönetilmesi** → `silenceMs` parametresi
4. Daha önce uyarlanmıştı: kısmi↔final kanal ayrımı, metin seviyesinde tetikleyici,
   ultra-hızlı yol (araçsız sesli tur), hata sınıflandırma (PII'siz mesajlar)

#### Doğrulama (v0.2.4)

| Kontrol | Sonuç |
| --- | --- |
| Swift native derleme (`swift build`) | ✅ Build complete |
| Birim testleri (11 paket) | **158/158** ✓ (audio-cues 3, barge-in 6 dahil) |
| `tsc --noEmit` / `lint` | temiz / 0 uyarı ✓ |
| API testleri (5 paket) | **101/101** ✓ |
| `/Applications/Chloe.app` | ✅ güncel (Swift düzeltmesi dahil) |

---

### v0.2.5 — 2026-10-17 · JARVIS DÖNGÜSÜNÜN KURTARILMASI + GERÇEK KODLAMA QA

#### 🎤 Eller-serbest modda mikrofonun durması

- **Sessizlik toleransı ayarlanabilir:** Jarvis Ayarları → Konuşma davranışı'nda
  1,5–3,5 saniye seçenekleri; varsayılan **2,5 saniye**. Kısa değer yanıtı
  hızlandırır, uzun değer doğal duraklamalarda erken tur bitmesini azaltır.
  Ayar native `startDictation` çağrısına taşınır ve eski ayarlarla uyumludur.
- **Konuşma hataları da turu kapatır:** macOS/cihaz sesi başarısız olduğunda,
  sesli yanıt başlatılamadığında veya provider/model isteği hata/zaman aşımına
  uğradığında eller-serbest mod mikrofonu yeniden açar. Kullanıcı iptali yeniden
  dinlemeyi başlatmaz; geçersiz mikrofon izinleri için mevcut uyarı korunur.
- **Doğru bağlantı ön kontrolü:** Jarvis özel API'si tek başına tanımlıysa
  mikrofon başlatılabilir; kontrol artık yanlışlıkla yalnızca ana API'ye bağlı
  değildir.
- Barge-in monitor deneysel/kapalı kalır. Gerçek mikrofon donanımıyla akustik
  eşik kalibrasyonu bu test çalışmasının kapsamı değildir.

#### ⚡ Gecikme ve referans uygulama

- Seçilen modelin ilk token süresi (`firstTokenMs`) ile ilk sesin başlaması
  (`audioStartMs`) ayrı ölçülür; böylece model/provider gecikmesi ile Chloe'nin
  ses kuyruğu gecikmesi birbirine karıştırılmaz. Upstream model hızını istemci
  kodu tek başına garanti edemez.
- `akshayaggarwal99/jarvis-ai-assistant` güncel README'si tekrar incelendi:
  proje öncelikle basılı-tut-konuş diktesi; yerel Whisper/Parakeet ve Deepgram
  seçenekleri onun hızlı dikte yoludur. Chloe'nin akışlı, yanıtı seslendiren
  asistanıyla aynı iş değildir; bu nedenle kaynak kodu kopyalanmadı. Ses hattı,
  kısmi transkripsiyon ve yerel model seçenekleri için fikir referansı olarak
  kullanıldı.

#### 💻 Kullanıcının verdiği klasörde kodlama doğrulaması

- `npm run test:code-e2e`: mevcut etkin özel API bağlantısıyla, yalnızca
  `/tmp` altındaki geçici proje üzerinde gerçek uçtan uca kontrol yapıldı:
  klasör açma/listeleme → model kod üretimi → hash-kontrollü kaydetme → proje
  test komutunu çalıştırma. **8/8 adım geçti**; geçici proje testi sonunda silindi.
- Ayrı Codex API doğrulaması: **12/12**, kod/workbench API QA: **17/17** geçti.

#### Doğrulama (v0.2.5)

| Kontrol | Sonuç |
| --- | --- |
| Runtime, ses arayüzü, Jarvis, konuşma metni, barge-in, ses sinyali, bağlantılar, Skills, Codex, Workbench birim testleri | **156/156 geçti** |
| Jarvis API / anahtar izolasyonu / Codex API / Workbench API / gerçek klasörde model kodlama | **76/76 geçti** |
| `npx tsc --noEmit` / `npm run lint` | geçti; ESLint uyarısı yok |
| Next.js production build / `swift build` | geçti |
| `/Applications/Chloe.app` | güncellendi ve açıldı; `http://127.0.0.1:3004` HTTP 200 |

---

---

## 4. Bilinen durumlar / dikkat edilecekler

- **Port 3004** native uygulamanın sabit portudur; 3000 Docker tarafından tutulur.
- `data/office/.key` kasa anahtarıdır; **silinirse kayıtlı API anahtarları açılamaz**.
- Anahtarlar `saveSettings(..., vaultSaved=true)` sonrası localStorage'da boş tutulur;
  asıl kayıt `/api/settings` üzerinden kasaya yazılır.
- `hasExplicitConnection` kontrolü: istemciden ayar gelmezse sunucu varsayılan
  sağlayıcıya **otomatik geçmez**, 400 döner (bilinçli davranış).
- Test paketleri `CHLOE_TEST_URL` ile farklı sunucuya yönlendirilebilir (varsayılan
  `http://127.0.0.1:3004`).

---

## 5. Sırada bekleyen işler

1. **Ses:** Barge-in eklendi ama **varsayılan kapalı** — gerçek ortamda yankı/gürültü
   ayarı yapılıp (eşik kalibrasyonu) varsayılan açık hâle getirilebilir.
   *(Ses listesinin etkin sağlayıcıya bağlanması — eski B3 — v0.2.3'te tamamlandı.)*
2. **3 referans repo uyarlaması:** teslim kapısı (drain gate) + `humanQA`
   (munder-difflin), canlı model listesinde `execution_status` filtreleri
   (freellmapi — kısmen yapıldı), akıllı boşluk/düzeltme öğrenme döngüsü
   (jarvis-ai-assistant).
3. **Doğrulama alışkanlığı:** her değişiklikten sonra
   `npm run test:runtime && npm run test:voice-ui && npm run test:jarvis &&
   npm run test:speech-text && npx tsc --noEmit && npm run lint`, ardından
   `./script/build_and_run.sh --verify` ve API testleri
   (`test:jarvis-api`, `test:jarvis-key`, `test:workbench-api`, `test:codex-api`, `test:office`).

### Bu oturumun son doğrulama durumu (2026-10-17)

| Kontrol | Sonuç |
| --- | --- |
| Birim testleri (9 paket) | **149/149 geçti** |
| API testleri (5 paket) | **101/101 geçti** (jarvis-key 26 dahil) |
| `npx tsc --noEmit` | temiz |
| `npm run lint` | 0 hata, 0 uyarı |
| Üretim derlemesi + kurulum | ✅ `/Applications/Chloe.app` |
| Sunucu | ✅ `http://127.0.0.1:3004` (HTTP 200) |
| Tarayıcı duman testi | ✅ konsol hatası yok, Projeler/Konuşmalar sekmeleri, sağlık paneli canlı veri gösteriyor |

---

## 6. Referans repo araştırma sonuçları

### 6.1 `tashfeenahmed/freellmapi` — çok sağlayıcılı OpenAI-uyumlu gateway

Repo doğrulandı (MIT, ~36k yıldız, TypeScript/Express + SQLite, varsayılan port **3001**).
Tek `freellmapi-…` anahtarı arkasında ~34 ücretsiz sağlayıcıyı birleştirir.

**Uygulamamıza doğrudan faydalı uçlar ve başlıklar:**

| Ne | Nasıl | Kazanç |
| --- | --- | --- |
| Canlı model listesi | `GET {base}/models?available=true&execution_status=ready` → `id, name, context_window, available, unavailable_reason, execution_status, supported_parameters` | Sabit model listesi yerine gerçek modeller; `exhausted`/`needsKey` ayrımı gösterilebilir |
| Sağlayıcı sağlığı | `GET {base}/providers` (unified key) → `{providers[], counts{healthy,rate_limited,invalid,unknown}}` + `resume_at` | "Hangi sağlayıcı ayakta, ne zaman açılır" paneli |
| Kota tahmini | `GET {base}/quota-forecast` → `pools[]`, `low_balance_threshold` | 429 yemeden "kota azaldı" uyarısı |
| Kimliksiz sağlık | `GET {origin}/livez`, `/readyz` | Anahtarsız "bağlantıyı test et" |
| Yönlendirme şeffaflığı | Yanıt başlığı `X-Routed-Via: platform/model`, `X-Fallback-Attempts`, `X-Fallback-Trail` | Sohbet balonunda "kim servis etti" rozeti (altyapı zaten var: `llm-provider.ts` `onResponse`) |
| Oturum sabitleme | İstek başlığı `X-Session-Id` (30 dk sticky) | Konuşma ortasında model değişimini azaltır |
| Güvenli tekrar | `Idempotency-Key` (non-streaming, 24 saat) | Ağ hatasında ikinci kez kota harcamaz |
| Görev tipi | `X-FreeLLM-Task-Type: code\|chat` | Kod işlerinde zeki, sohbette hızlı model seçimi — **ancak `auto:fast` (fastest preset) bu başlığı yok sayar** |

**Model adları (kesin):** `auto`, `auto:smart`, `auto:fast`, `auto:reliable`, `auto:balanced`,
`auto:cheap`, `auto:<profil>`, `fusion`. Bizim `jarvisModelSettings` zaten `auto:fast` kullanıyor. ✓

**Dikkat:** Ücretsiz kurulumun model kataloğu ~30 gün geriden gelir; `RESPONSE_CACHE_PERSIST=true`
yanıtları DB'ye düz metin yazar.

### 6.2 `akshayaggarwal99/jarvis-ai-assistant` — Electron dikte uygulaması

Repo doğrulandı (MIT, v1.3.11, Electron 44 + TypeScript, native macOS eklentileri).
**Önemli:** Bu proje öncelikle bir **dikte** uygulamasıdır — **TTS yok, barge-in yok,
gerçek wake-word yok, konuşma hafızası yok.** Bizim sesli asistan tarafında mimari
referans değil, **ses hattı mühendisliği** referansıdır.

**Bizim için değerli olan (uyarlanabilir):**

| # | Desen | Bizdeki karşılığı |
| --- | --- | --- |
| 1 | Kayıt her şeyden önce başlar ("INSTANT AUDIO START"), bağlam/streaming kurulumu `setImmediate` ile arkaya atılır | `useVoice.startListening` — ilk sesi kaybetmemek için |
| 2 | Kısmi (interim) sonuçlar **yalnızca UI'a**, commit yolu sadece finalize metni kullanır | Akışlı cümle kuyruğumuzda `previewQueue` / `commitQueue` ayrımı |
| 3 | Ultra-fast yol: streaming metni hazırsa LLM temizliğini atlayıp doğrudan kullan | Jarvis hızlı modda gereksiz işlemeyi atlama |
| 4 | Metin seviyesinde tetikleyici (`/^(hey\|ok)\s*jarvis/i`) — akustik wake-word yok | Jarvis komut yönlendirmemiz zaten metin tabanlı ✓ |
| 5 | Prompt koruma hiyerarşisi: imza koruma > içerik koruma > öz-düzeltme > bağlam biçimlendirme + `===USER_SPEECH_START===` sınırlayıcı | Sesli yanıt/temizleme prompt'larına eklenebilir |
| 6 | Akıllı boşluk: son 10 sn içinde ardışık dikte → otomatik boşluk/büyük harf | Hands-free çok turlu oturumlarda |
| 7 | Panoyu koruyan yapıştırma (kaydet → yaz → yapıştır → geri yükle) | Native köprü komutlarında |
| 8 | Ön kontrol kapısı: izin/anahtar yoksa kaydı hiç başlatma | Mikrofon izni kontrolü |
| 9 | Ses kapısı: <150 ms veya sessiz buffer'ı ağa hiç göndermeme | Bulut TTS/STT israfını önler |
| 10 | Ses efektlerini Web Audio osilatörle sentezle (dosya yok) | Konsol aç/kapa sesleri |
| 11 | Hata sınıflandırma + PII'siz imza (`<path>`, `<url>`, `<hex>`) | Log/telemetri temizliği |
| 12 | Rolling decode: uzun kaydı konuşma sırasında parça parça çöz | Uzun sesli girdide algılanan gecikme |

### 6.3 `HarnessMD/munder-difflin` — çok-ajanlı "The Office" parodisi

Repo doğrulandı (MIT, 8.8k yıldız, Electron + React + pixi.js + SQLite/WAL).
**Önemli:** Bu proje NBC'nin *The Office* dizisinin parodisidir — **Microsoft Office ile
ilgisi yoktur.** Kaynak ağaçta `.docx/.xlsx/.pptx` üretimi **yoktur** (grep: 0 sonuç).
Ayrıca README 0.5.6'yı pazarlar ama açık kaynak `main` = **0.4.6** kodu; README'deki
0.5.x vaatleri (Stapler toplantı transkripti, 2.347'lik yetenek pazaryeri, Teams,
gömülü Whisper) kaynakta **yok**.

**Bizim için değerli desenler:**

| # | Desen | Neden değerli | Bizdeki karşılık |
| --- | --- | --- | --- |
| 1 | **Tek teslim kapısı (drain gate):** tüm otomatik yazımlar tek kuyruktan geçer; teslim için `idle && !draft && !hitlPending && cooldown` şartlarının TÜMÜ gerekir; onay ancak iki yazım da başarılıysa verilir | Yarım cümle üstüne yazma / bozuk prompt üretme hatasını yapısal olarak önler | Sesli yanıt sonrası otomatik dinlemeye dönüş kapısı |
| 2 | **FIPA-lite mesaj şeması + `HOP_CAP=12`:** yalnız `request/query/propose` yanıt zorunlu kılar; hop sayacı sınırı aşınca koordinatör devralır | Çok-ajan sistemlerinin 1 numaralı ölüm sebebi (livelock) | Ajan Ofisi görev zincirleri |
| 3 | **`humanQA` + ASK ME:** insan sorusu ayrı dosyada değil, kart üstünde kalıcı; bağımlı kart zinciri gösterilir; "bir paragraftan uzun soru rapor sayılır" | Onay/karar tarihçesi kaybolmaz | Kod/Office onay akışları |
| 4 | **Yıkıcı olmayan defter birleştirme:** kartın bahsetmediği alan diskte kalır; "bilinmeyen alan = bilmiyorum" vs "açık null = temizle" | UI'ın tanımadığı alanı silmesi gerçek bir olay | `data/*.json` yazımları |
| 5 | **Boş-korumalı dayanıklı state:** her yazım öncesi yedek + temp/atomik rename + "boş snapshot dolu state'i ezemez" | Paketlenmiş build'de localStorage boş açılınca roster sıfırlanmıştı | `avatar.json`, `projects.json`, kimlik |
| 6 | **`secretRef` / `hasSecret`:** renderer'a sır yerine tutamaç gider; gerçek sır yalnız kullanım anında main'de çözülür | Sır sızıntısını mimari olarak engeller | Kasamız (`data/office/.key`) zaten benzer |
| 7 | **Circuit breaker merdiveni:** tek beat'te tek kademe; aksiyon yalnız kademe yükselirken; **maliyet ölçümünde `cacheRead` hariç tutulur** | Önbellekten okunan bağlam her istekte yeniden faturalanır | Ajan bütçe limitleri |
| 8 | **Koşullu birleştirilen sistem prompt'u** (tek dev metin değil) + iş sözleşmesi: OBJECTIVE · OUTPUT · TOOLS · BOUNDARIES | Prompt bakımı ve token tasarrufu | Ajan Ofisi prompt'ları |
| 9 | **Kalıcı rol ≠ geçici durum** (`agents.role` vs `agents.status`; canlı durum asla role yazılmaz) | Durum/rol karışması hataları | Ajan kayıtları |
| 10 | **Edge-triggered uyandırma:** `announced_message_ids` ile aynı posta tekrar duyurulmaz + `idle_since` + `boot_grace` | Arka planda kısılan `setInterval` yüzünden sonsuz bekleme | Jarvis çalışma paneli |

**Kopyalanmayacaklar:** Electron/IPC'e özgü her şey (`window.cth`, `contextBridge`,
`node-pty`); `SPEC.md` (tarihî doküman — tmux anlatır, kod `node-pty` kullanır);
LimeZu pixel-art (ayrı lisans); 5.5k satırlık tek `index.ts` (modülerlik değil desen alınır).
