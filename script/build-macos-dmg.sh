#!/bin/bash
# Builds a self-contained Chloe.app (native shell + bundled Node + standalone
# Next server) and packs it into a drag-to-Applications DMG:
#   dist/macos/Chloe-Assistant-<version>-macOS-<arch>.dmg
# Runs on macOS with Node 22+, npm dependencies installed and Xcode command line tools.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

APP_NAME="ChloeDesktop"
BUNDLE_ID="com.chloe.personal-assistant"
MIN_SYSTEM_VERSION="15.0"
VERSION="$(node -p "require('./package.json').version")"
ARCH="$(uname -m)"
OUT="$ROOT_DIR/dist/macos"
APP="$OUT/Chloe.app"
RES="$APP/Contents/Resources"

echo "Chloe $VERSION ($ARCH): standalone server"
rm -rf .next-mac "$OUT"
CHLOE_STANDALONE=1 NEXT_DIST_DIR=.next-mac NEXT_TELEMETRY_DISABLED=1 node node_modules/next/dist/bin/next build

echo "Native shell"
(cd macos && swift build -c release)
BINARY="$(cd macos && swift build -c release --show-bin-path)/$APP_NAME"

mkdir -p "$APP/Contents/MacOS" "$RES/runtime" "$RES/licenses"
cp "$BINARY" "$APP/Contents/MacOS/$APP_NAME"
cp macos/Resources/Chloe.icns "$RES/Chloe.icns"
# ditto keeps Turbopack's bracketed chunk names and symlinks intact.
ditto .next-mac/standalone "$RES/server"
ditto .next-mac/static "$RES/server/.next-mac/static"
ditto public "$RES/server/public"
rm -rf "$RES/server/data" "$RES/server/.env" "$RES/server/.env.local"
cp "$(command -v node)" "$RES/runtime/node"
chmod +x "$RES/runtime/node"
echo "Node.js $(node -v) - MIT License - https://github.com/nodejs/node/blob/main/LICENSE" > "$RES/runtime/NODE-LICENSE.txt"
cp LICENSE "$RES/LICENSE.txt"
cp THIRD_PARTY_NOTICES.md "$RES/THIRD_PARTY_NOTICES.md"
cp licenses/*.txt "$RES/licenses/"

cat >"$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>$APP_NAME</string>
<key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
<key>CFBundleName</key><string>Chloe</string>
<key>CFBundleDisplayName</key><string>Chloe Assistant</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>$VERSION</string>
<key>CFBundleVersion</key><string>$VERSION</string>
<key>LSMinimumSystemVersion</key><string>$MIN_SYSTEM_VERSION</string>
<key>NSPrincipalClass</key><string>NSApplication</string>
<key>CFBundleIconFile</key><string>Chloe</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSHumanReadableCopyright</key><string>© 2026 Berkay Atağ · Chloe Assistant</string>
<key>NSMicrophoneUsageDescription</key><string>Chloe, JARVIS sesli asistanı için konuşmanı metne çevirmek üzere mikrofonu kullanır.</string>
<key>NSSpeechRecognitionUsageDescription</key><string>Chloe, JARVIS sesli asistanı için konuşmanı metne çevirmek üzere macOS Konuşma Tanıma'yı kullanır.</string>
</dict></plist>
PLIST

# Ad-hoc signature: required for Apple Silicon. Not notarized (no Apple Developer ID).
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"

echo "Packaged server smoke test"
SMOKE="$(mktemp -d)"
LOG="$SMOKE/server.log"
(cd "$RES/server" && PORT=3099 HOSTNAME=127.0.0.1 NODE_ENV=production CHLOE_DATA_DIR="$SMOKE/data" \
  CHLOE_CONNECTION_DIR="$SMOKE/conn" CHLOE_OAUTH_DIR="$SMOKE/oauth" "$RES/runtime/node" server.js >"$LOG" 2>&1) &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -fsS -o /dev/null http://127.0.0.1:3099/ && break; sleep 0.5; done
FAILED=0
for path in / /chloe-portrait.jpg /icon.png /manifest.webmanifest /api/avatar /api/identity /api/conversations /api/projects /api/skills /api/office; do
  code="$(curl -s -o /dev/null -w '%{http_code}' -H 'X-Chloe-Client: smoke' "http://127.0.0.1:3099$path")"
  echo "  $path $code"; [[ "$code" == 200 ]] || FAILED=1
done
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H 'x-chloe-settings: 1' -H 'Origin: http://127.0.0.1:3099' \
  -d '{"action":"migrate","patch":{},"revision":0}' http://127.0.0.1:3099/api/settings)"
echo "  /api/settings $code"; [[ "$code" == 200 ]] || FAILED=1
[[ -s "$SMOKE/data/identity.json" ]] || { echo "  data was not written to CHLOE_DATA_DIR"; FAILED=1; }
if grep -E "Cannot find module|Failed to load" "$LOG"; then FAILED=1; fi
kill $SERVER_PID 2>/dev/null || true; trap - EXIT
[[ "$FAILED" == 0 ]] || { cat "$LOG"; echo "Packaged server smoke test failed" >&2; exit 1; }

echo "DMG"
STAGE="$(mktemp -d)"
ditto "$APP" "$STAGE/Chloe.app"
ln -s /Applications "$STAGE/Applications"
DMG="$OUT/Chloe-Assistant-$VERSION-macOS-$ARCH.dmg"
hdiutil create -volname "Chloe Assistant" -srcfolder "$STAGE" -ov -format UDZO "$DMG"
(cd "$OUT" && shasum -a 256 "$(basename "$DMG")" > "$(basename "$DMG").sha256")
echo "Ready: $DMG"
