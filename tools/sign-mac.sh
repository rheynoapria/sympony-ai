#!/bin/bash
# Sign a .app with tools/make-cert.sh's local identity when .signing/ has it, then verify.
#   tools/sign-mac.sh path/to/Sympony.app
set -euo pipefail
APP="$1"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KC="$ROOT/.signing/sympony-signing.keychain-db"
ENT="$ROOT/src-tauri/entitlements.plist"
if [ -f "$KC" ]; then
  security unlock-keychain -p sympony-local "$KC"
  OLD_LIST=(); while IFS= read -r k; do OLD_LIST+=("$k"); done < <(security list-keychains -d user | sed 's/^ *"//; s/"$//')
  trap 'security lock-keychain "$KC" 2>/dev/null || true; security list-keychains -d user -s "${OLD_LIST[@]}"' EXIT
  security list-keychains -d user -s "$KC" "${OLD_LIST[@]}"
  ID=$(security find-identity -p codesigning "$KC" | awk '/Sympony Local Signing/ { print $2; exit }')
  # Sign nested native libraries/binaries inside-out before signing the main .app bundle with Hardened Runtime.
  while IFS= read -r -d '' bin; do
    codesign --force --options runtime --keychain "$KC" -s "$ID" "$bin"
  done < <(find "$APP/Contents" -type f \( -name "*.dylib" -o -name "*.so" \) -print0)
  codesign --force --options runtime --entitlements "$ENT" --keychain "$KC" -s "$ID" "$APP"
fi
codesign --verify --deep --strict "$APP"
