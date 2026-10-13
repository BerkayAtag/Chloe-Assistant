#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
APP_NAME="ChloeDesktop"
BUNDLE_ID="com.chloe.personal-assistant"
MIN_SYSTEM_VERSION="15.0"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MACOS_DIR="$ROOT_DIR/macos"
DIST_DIR="$ROOT_DIR/dist"
APP_BUNDLE="$DIST_DIR/$APP_NAME.app"
APP_CONTENTS="$APP_BUNDLE/Contents"
APP_MACOS="$APP_CONTENTS/MacOS"
APP_BINARY="$APP_MACOS/$APP_NAME"
ICON_SOURCE="$ROOT_DIR/macos/Resources/Chloe.icns"
SERVER_PORT="3004"
SERVER_URL="http://127.0.0.1:$SERVER_PORT"
BUILD_ID_FILE="$ROOT_DIR/.next/BUILD_ID"

server_pid() {
  lsof -t -nP -iTCP:"$SERVER_PORT" -sTCP:LISTEN 2>/dev/null | head -n 1
}

stop_web_server() {
  local pid command cwd
  pid="$(server_pid)"
  [[ -n "$pid" ]] || return 0

  command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
  if [[ "$command" != *"next-server"* || "$cwd" != "$ROOT_DIR" ]]; then
    echo "Port $SERVER_PORT is not owned by this Chloe Next.js server; nothing was stopped." >&2
    exit 1
  fi

  if ! kill "$pid"; then
    echo "The existing Chloe server (PID $pid, port $SERVER_PORT) could not be stopped by this user." >&2
    echo "The active build was preserved. Stop that exact process in Terminal or Activity Monitor, then rerun this script." >&2
    return 1
  fi
  for _ in {1..20}; do
    [[ -z "$(server_pid)" ]] && return 0
    sleep 1
  done
  echo "Chloe web server did not release port $SERVER_PORT." >&2
  exit 1
}

start_web_server() {
  echo "Starting Chloe web server on $SERVER_URL..."
  (cd "$ROOT_DIR" && nohup npm start -- -H 127.0.0.1 -p "$SERVER_PORT" >"$ROOT_DIR/.next/chloe-server.log" 2>&1 </dev/null &)
  READY=false
  for _ in {1..30}; do
    SERVER_PAGE="$(curl -fsS --max-time 1 "$SERVER_URL" 2>/dev/null || true)"
    if grep -q "Chloe" <<<"$SERVER_PAGE"; then
      READY=true
      break
    fi
    sleep 1
  done
  if [[ "$READY" != true ]]; then
    echo "Chloe web server did not start. See $ROOT_DIR/.next/chloe-server.log" >&2
    return 1
  fi
}

if [[ "$MODE" == "--restart-web" ]]; then
  [[ -s "$BUILD_ID_FILE" ]] || { echo "No production build found in $ROOT_DIR/.next." >&2; exit 1; }
  stop_web_server
  start_web_server || exit 1
  exit 0
fi

SERVER_PAGE="$(curl -fsS --max-time 2 "$SERVER_URL" 2>/dev/null || true)"
SERVER_HEALTHY=false
grep -q "Chloe" <<<"$SERVER_PAGE" && SERVER_HEALTHY=true
NEEDS_BUILD=false
if [[ ! -s "$BUILD_ID_FILE" ]]; then
  NEEDS_BUILD=true
elif find "$ROOT_DIR/src" "$ROOT_DIR/public" "$MACOS_DIR/Sources" "$MACOS_DIR/Package.swift" \
    "$ROOT_DIR/script/build_and_run.sh" "$ROOT_DIR/next.config.ts" \
    "$ROOT_DIR/package.json" "$ROOT_DIR/package-lock.json" \
    -type f -newer "$BUILD_ID_FILE" -print -quit | grep -q .; then
  NEEDS_BUILD=true
fi

if [[ "$NEEDS_BUILD" == true ]]; then
  BACKUP_DIR=""
  # Keep Next from appending a new tsconfig entry on every build.
  # Next's own build lock prevents concurrent builds in this directory.
  STAGED_DIR=".next-staging"
  echo "Building Chloe web app in an isolated directory..."
  (cd "$ROOT_DIR" && NEXT_DIST_DIR="$STAGED_DIR" npm run build)
  if [[ "$SERVER_HEALTHY" == true ]]; then
    stop_web_server
  elif [[ -n "$(server_pid)" ]]; then
    stop_web_server
  fi

  BACKUP_DIR=".next-backup-$(date +%Y%m%d-%H%M%S)"
  if [[ -d "$ROOT_DIR/.next" ]]; then
    mv "$ROOT_DIR/.next" "$ROOT_DIR/$BACKUP_DIR"
  fi
  if ! mv "$ROOT_DIR/$STAGED_DIR" "$ROOT_DIR/.next"; then
    [[ -d "$ROOT_DIR/$BACKUP_DIR" ]] && mv "$ROOT_DIR/$BACKUP_DIR" "$ROOT_DIR/.next"
    echo "Could not install the new production build; the previous build was preserved." >&2
    exit 1
  fi
  echo "Production build installed. Previous build: $ROOT_DIR/$BACKUP_DIR"
fi

if [[ "$SERVER_HEALTHY" != true || "$NEEDS_BUILD" == true ]]; then
  if [[ "$SERVER_HEALTHY" != true && -n "$(server_pid)" ]]; then
    stop_web_server
  fi
  # GUI launches own their detached server startup. Starting another one here
  # races the native app and can leave it connected to a short-lived server.
  if [[ "$MODE" == "--debug" || "$MODE" == "debug" ]] && ! start_web_server; then
    if [[ "$NEEDS_BUILD" == true ]]; then
      FAILED_DIR=".next-failed-$(date +%Y%m%d-%H%M%S)"
      if [[ -d "$ROOT_DIR/.next" ]]; then
        mv "$ROOT_DIR/.next" "$ROOT_DIR/$FAILED_DIR"
      fi
      if [[ -n "$BACKUP_DIR" && -d "$ROOT_DIR/$BACKUP_DIR" ]]; then
        mv "$ROOT_DIR/$BACKUP_DIR" "$ROOT_DIR/.next"
        echo "New server failed; restored the previous production build." >&2
        if [[ -n "$(server_pid)" ]]; then stop_web_server; fi
        start_web_server || true
      fi
    fi
    exit 1
  fi
fi

NEEDS_NATIVE_BUILD=false
if [[ ! -x "$APP_BINARY" ]] ||
    find "$MACOS_DIR/Sources" "$MACOS_DIR/Package.swift" -type f -newer "$APP_BINARY" -print -quit | grep -q .; then
  NEEDS_NATIVE_BUILD=true
fi

# Stop only this bundle before replacing or launching its executable/resources.
if [[ "$MODE" != "--debug" && "$MODE" != "debug" ]]; then
  while read -r pid; do
    [[ -n "$pid" ]] || continue
    if [[ "$(ps -p "$pid" -o comm=)" == "$APP_BINARY" ]]; then
      kill "$pid"
      for _ in {1..50}; do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.1
      done
      if kill -0 "$pid" 2>/dev/null; then
        echo "Chloe could not stop safely; the running bundle was not overwritten." >&2
        exit 1
      fi
    fi
  done < <(pgrep -x "$APP_NAME" || true)
fi

if [[ "$MODE" == "--build" || "$NEEDS_NATIVE_BUILD" == true ]]; then
  (cd "$MACOS_DIR" && swift build)
  BUILD_BINARY="$(cd "$MACOS_DIR" && swift build --show-bin-path)/$APP_NAME"
  mkdir -p "$APP_MACOS" "$APP_CONTENTS/Resources"
  cp "$BUILD_BINARY" "$APP_BINARY"
  chmod +x "$APP_BINARY"
  cp "$ICON_SOURCE" "$APP_CONTENTS/Resources/Chloe.icns"
  cp "$ICON_SOURCE" "$APP_CONTENTS/Resources/ChloeGraphite.icns"

  cat >"$APP_CONTENTS/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>$APP_NAME</string>
<key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
<key>CFBundleName</key><string>Chloe</string>
<key>CFBundleDisplayName</key><string>Chloe</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSMinimumSystemVersion</key><string>$MIN_SYSTEM_VERSION</string>
<key>NSPrincipalClass</key><string>NSApplication</string>
<key>CFBundleIconFile</key><string>ChloeGraphite</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSMicrophoneUsageDescription</key><string>Chloe, JARVIS sesli asistanı için konuşmanı metne çevirmek üzere mikrofonu kullanır.</string>
<key>NSSpeechRecognitionUsageDescription</key><string>Chloe, JARVIS sesli asistanı için konuşmanı metne çevirmek üzere macOS Konuşma Tanıma'yı kullanır.</string>
<key>NSDocumentsFolderUsageDescription</key><string>Chloe, Belgeler içindeki yerel proje dosyalarını okuyarak uygulamanın web servisini başlatır. Dosya düzenlemeleri ayrıca kullanıcı tarafından seçilir.</string>
</dict></plist>
PLIST
fi

if [[ -d "$APP_CONTENTS" && -s "$ICON_SOURCE" ]]; then
  mkdir -p "$APP_CONTENTS/Resources"
  cp "$ICON_SOURCE" "$APP_CONTENTS/Resources/Chloe.icns"
  cp "$ICON_SOURCE" "$APP_CONTENTS/Resources/ChloeGraphite.icns"
  /usr/libexec/PlistBuddy -c 'Set :CFBundleIconFile ChloeGraphite' "$APP_CONTENTS/Info.plist"
  swift "$ROOT_DIR/script/apply_bundle_icon.swift" "$ICON_SOURCE" "$APP_BUNDLE"
  touch "$APP_BUNDLE"
fi

open_app() { /usr/bin/open "$APP_BUNDLE"; }
case "$MODE" in
  run) open_app ;;
  --verify|verify)
    open_app
    for _ in {1..30}; do
      if pgrep -x "$APP_NAME" >/dev/null && curl -fsS --max-time 1 "$SERVER_URL" >/dev/null 2>&1; then
        exit 0
      fi
      sleep 1
    done
    echo "Chloe or its web server failed to start; see $ROOT_DIR/.next/chloe-server.log" >&2
    exit 1 ;;
  --logs|logs) open_app; /usr/bin/log stream --info --style compact --predicate "process == \"$APP_NAME\"" ;;
  --telemetry|telemetry) open_app; /usr/bin/log stream --info --style compact --predicate "subsystem == \"$BUNDLE_ID\"" ;;
  --debug|debug) lldb -- "$APP_BINARY" ;;
  --build) open_app ;;
  *) echo "usage: $0 [run|--verify|--build|--restart-web|--logs|--telemetry|--debug]" >&2; exit 2 ;;
esac
