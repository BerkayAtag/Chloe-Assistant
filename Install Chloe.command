#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
trap 'echo; echo "Kurulum durdu. Yukarıdaki hata çözülmeden mevcut veriler silinmez."' ERR
if [[ "$(uname -s)" != Darwin ]]; then
  echo "Bu kurucu macOS içindir. Web sürümü için README dosyasını aç."
  exit 1
fi
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  echo "Önce https://nodejs.org adresinden Node.js 22 veya daha yenisini kur."
  exit 1
fi
node -e 'if (+process.versions.node.split(".")[0] < 22) { console.error("Node.js 22 veya daha yeni sürüm gerekli."); process.exit(1); }'
if ! xcrun --find swift >/dev/null 2>&1; then
  echo "Apple Command Line Tools gerekli. Terminal: xcode-select --install"
  echo "Kurulumdan sonra bu dosyayı yeniden aç. Tam Xcode zorunlu değil."
  exit 1
fi
echo "Chloe bu klasörde derlenecek, ardından Applications içine kurulacak."
echo "Bu kaynak klasörünü kalıcı bir yerde tut; kurulumdan sonra silme veya taşıma."
echo "Mevcut API anahtar kasası korunur. npm bağımlılıkları ve otomasyon tarayıcısı indirilecek."
npm ci
npx --no-install playwright install chromium
bash ./script/build_and_run.sh --verify
echo "Hazır: Finder > Uygulamalar > Chloe. Güncelleme için aynı kaynak klasörünü kullan."
