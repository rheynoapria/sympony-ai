#!/bin/bash
# Build Sympony and install it as /Applications/Sympony.app.
# Signed with tools/make-cert.sh's stable local identity when .signing/ has it.
#   ./install.sh [--fresh-data]
#   --fresh-data   delete ~/Library/Application Support/Sympony before launching
set -euo pipefail
cd "$(dirname "$0")"
FRESH=0
for a in "$@"; do case "$a" in --fresh-data) FRESH=1 ;; *) echo "unknown option $a"; exit 2 ;; esac; done
DEST=/Applications/Sympony.app

# Sympony's own Google OAuth client for to-do sync (docs/google-oauth-setup.md), built in when present
OAUTH="$PWD/.signing/oauth.env"
if [ -f "$OAUTH" ]; then set -a; . "$OAUTH"; set +a; echo "Google sign-in: built in"; fi
# Sympony AI (optional hosted router) is built into official builds only: its address lives outside the repo
AI_ENV="$PWD/.signing/sympony-ai.env"
if [ -f "$AI_ENV" ]; then set -a; . "$AI_ENV"; set +a; echo "Sympony AI: built in"; else echo "Sympony AI: not built in (no .signing/sympony-ai.env)"; fi

bun install --cwd settings-ui --frozen-lockfile && bun run --cwd settings-ui build
cargo tauri build --bundles app
APP=target/release/bundle/macos/Sympony.app
tools/sign-mac.sh "$APP"

if [ -d "$DEST" ]; then
  ID_THERE=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$DEST/Contents/Info.plist" 2>/dev/null || true)
  case "$ID_THERE" in app.sympony) ;; *) echo "$DEST is $ID_THERE, not Sympony: not touching it"; exit 1 ;; esac
fi
osascript -e 'tell application id "app.sympony" to quit' 2>/dev/null || true
sleep 0.5
rm -rf "$DEST"
ditto "$APP" "$DEST"
if [ $FRESH = 1 ]; then rm -rf "$HOME/Library/Application Support/Sympony"; fi
open "$DEST"
echo "installed $DEST"
