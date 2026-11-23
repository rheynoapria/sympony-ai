#!/bin/bash
# Sign a macOS .app bundle (inside-out) and verify its code signature:
#   1. Official Apple Developer ID when APPLE_SIGNING_IDENTITY is set (CI or local release)
#   2. Local self-signed identity (.signing/sympony-signing.keychain-db) for local dev builds
#   3. Ad-hoc (-s -) fallback for open-source / community builds without signing secrets
# Usage:
#   tools/sign-mac.sh path/to/Sympony.app
set -euo pipefail
APP="$1"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KC="$ROOT/.signing/sympony-signing.keychain-db"
ENT="$ROOT/src-tauri/entitlements.plist"

sign_nested() {
  local extra=("$@")
  # Sign nested dynamic libraries, frameworks, and helper Mach-O binaries inside-out.
  while IFS= read -r -d '' bin; do
    codesign --force --options runtime "${extra[@]}" "$bin"
  done < <(find "$APP/Contents" -type f \( -name "*.dylib" -o -name "*.so" \) -print0)
}

if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
  EXTRA=(--timestamp -s "$APPLE_SIGNING_IDENTITY")
  if [ -n "${APPLE_KEYCHAIN:-}" ]; then
    EXTRA+=(--keychain "$APPLE_KEYCHAIN")
  fi
  echo "Signing $APP with Developer ID: $APPLE_SIGNING_IDENTITY"
  sign_nested "${EXTRA[@]}"
  codesign --force --options runtime --entitlements "$ENT" "${EXTRA[@]}" "$APP"
elif [ -f "$KC" ]; then
  security unlock-keychain -p sympony-local "$KC"
  OLD_LIST=(); while IFS= read -r k; do OLD_LIST+=("$k"); done < <(security list-keychains -d user | sed 's/^ *"//; s/"$//')
  trap 'security lock-keychain "$KC" 2>/dev/null || true; security list-keychains -d user -s "${OLD_LIST[@]}"' EXIT
  security list-keychains -d user -s "$KC" "${OLD_LIST[@]}"
  ID=$(security find-identity -p codesigning "$KC" | awk '/Sympony Local Signing/ { print $2; exit }')
  echo "Signing $APP with local identity: Sympony Local Signing"
  sign_nested --keychain "$KC" -s "$ID"
  codesign --force --options runtime --entitlements "$ENT" --keychain "$KC" -s "$ID" "$APP"
else
  echo "Signing $APP with ad-hoc signature"
  sign_nested -s -
  codesign --force --options runtime --entitlements "$ENT" -s - "$APP"
fi

codesign --verify --deep --strict --verbose=2 "$APP"
