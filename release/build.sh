#!/bin/bash
# Build Sympony's installer for the OS this runs on, into release/out/<version>/:
#   macOS   Sympony_<v>_<arch>.dmg      (signed with tools/sign-mac.sh's local identity when present)
#   Windows Sympony_<v>_x64-setup.exe   (NSIS; run from Git Bash)
#   Linux   sympony_<v>_amd64.deb, sympony-<v>-1.x86_64.rpm
# Tauri can't cross-build installers, so each OS builds its own (locally or .github/workflows/release.yml).
#   release/build.sh [--clean]   --clean: drop target/ afterwards (a fresh release tree is a few GB; next build is from scratch)
# target/ never prunes itself: each profile, dependency or Cargo.lock change builds a new copy of every affected crate
# beside the old one (objc2-app-kit alone is ~250 MB a copy), so a busy day of dev + release builds reaches 10+ GB.
set -euo pipefail
cd "$(dirname "$0")/.."
V=$(python3 -I -c 'import json; print(json.load(open("src-tauri/tauri.conf.json"))["version"])')
OUT="release/out/$V"; mkdir -p "$OUT"
OAUTH="$PWD/.signing/oauth.env"
if [ -f "$OAUTH" ]; then set -a; . "$OAUTH"; set +a; echo "Google sign-in: built in"; fi
# Sympony AI (the hosted router) is built into official builds only: its address lives outside the repo
AI_ENV="$PWD/.signing/sympony-ai.env"
if [ -f "$AI_ENV" ]; then set -a; . "$AI_ENV"; set +a; echo "Sympony AI: built in"; else echo "Sympony AI: not built in (no .signing/sympony-ai.env)"; fi
bun install --cwd settings-ui --frozen-lockfile && bun run --cwd settings-ui build
B=target/release/bundle
case "$(uname -s)" in
  Darwin)
    cargo tauri build --bundles app
    tools/sign-mac.sh "$B/macos/Sympony.app"
    # ponytail: plain hdiutil dmg (app + /Applications link) so the signed .app goes in as-is
    STAGE=$(mktemp -d); trap 'rm -rf "$STAGE"' EXIT
    ditto "$B/macos/Sympony.app" "$STAGE/Sympony.app"; ln -s /Applications "$STAGE/Applications"
    hdiutil create -volname Sympony -srcfolder "$STAGE" -ov -format UDZO "$OUT/Sympony_${V}_$(uname -m).dmg" ;;
  Linux)
    cargo tauri build --bundles deb,rpm
    cp "$B"/deb/*.deb "$B"/rpm/*.rpm "$OUT/" ;;
  MINGW*|MSYS*|CYGWIN*)
    cargo tauri build --bundles nsis
    cp "$B"/nsis/*.exe "$OUT/" ;;
  *) echo "unsupported OS $(uname -s)"; exit 1 ;;
esac
ls -lh "$OUT"
if [ "${1:-}" = --clean ]; then cargo clean; fi
