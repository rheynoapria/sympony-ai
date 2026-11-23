#!/bin/bash
# Build Sympony's installer for the OS this runs on, into release/out/<version>/:
#   macOS   Sympony_<v>_<arch>.dmg      (Developer ID + Apple Notarization when configured, else local/ad-hoc)
#   Windows Sympony_<v>_x64-setup.exe   (NSIS; run from Git Bash)
#   Linux   sympony_<v>_amd64.deb, sympony-<v>-1.x86_64.rpm
# Tauri can't cross-build installers, so each OS builds its own (locally or .github/workflows/release.yml).
#   release/build.sh [--clean]   --clean: drop target/ afterwards
set -euo pipefail
cd "$(dirname "$0")/.."
PY=$(command -v python3 || command -v python)
V=$("$PY" -I -c 'import json; print(json.load(open("src-tauri/tauri.conf.json"))["version"])')
OUT="release/out/$V"; mkdir -p "$OUT"

OAUTH="$PWD/.signing/oauth.env"
if [ -f "$OAUTH" ]; then set -a; . "$OAUTH"; set +a; fi
if [ -n "${SYMPONY_GOOGLE_CLIENT_ID:-}" ] && [ -n "${SYMPONY_GOOGLE_CLIENT_SECRET:-}" ]; then
  echo "Google sign-in: built in"
else
  echo "Google sign-in: not built in (paste Desktop OAuth client in Settings -> Todo)"
fi

# Sympony AI (the hosted router) is built into official builds only: its address lives outside the repo
AI_ENV="$PWD/.signing/sympony-ai.env"
if [ -f "$AI_ENV" ]; then set -a; . "$AI_ENV"; set +a; fi
if [ -n "${SYMPONY_AI_URL:-}" ]; then
  echo "Sympony AI: built in"
else
  echo "Sympony AI: not built in (SYMPONY_AI_URL unset)"
fi

# Optional local notarization env (.signing/notary.env)
NOTARY_ENV="$PWD/.signing/notary.env"
if [ -f "$NOTARY_ENV" ]; then set -a; . "$NOTARY_ENV"; set +a; fi

# Optional local Tauri updater signing key (.signing/updater.key + .signing/updater.pass)
if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ] && [ -f "$PWD/.signing/updater.key" ]; then
  export TAURI_SIGNING_PRIVATE_KEY="$(cat "$PWD/.signing/updater.key")"
  if [ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" ] && [ -f "$PWD/.signing/updater.pass" ]; then
    export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat "$PWD/.signing/updater.pass")"
  fi
fi

bun install --cwd settings-ui --frozen-lockfile && bun run --cwd settings-ui build
B=target/release/bundle

sign_updater_artifact() {
  local target="$1"
  local artifact="$2"
  if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
    echo "Updater signing: skipped for $artifact (TAURI_SIGNING_PRIVATE_KEY unset)"
    return 0
  fi
  echo "Signing updater artifact $artifact for $target (v$V)..."
  cargo tauri signer sign --app-version "$V" "$artifact"
  local sig_file="${artifact}.sig"
  if [ ! -f "$sig_file" ]; then
    echo "ERROR: expected signature file $sig_file was not generated" >&2
    exit 1
  fi
  "$PY" -I - "$target" "$V" "$(basename "$artifact")" "$sig_file" "$OUT/updater-${target}.json" <<'PY'
import json, sys
target, version, filename, sig_path, out_path = sys.argv[1:6]
sig = open(sig_path, "r", encoding="utf-8").read().strip()
with open(out_path, "w", encoding="utf-8") as f:
    json.dump({"target": target, "version": version, "file": filename, "signature": sig}, f, indent=2)
    f.write("\n")
PY
  echo "Wrote $OUT/updater-${target}.json"
}

notary_auth_args() {
  if [ -n "${APPLE_API_KEY_PATH:-}" ] && [ -f "${APPLE_API_KEY_PATH}" ] && [ -n "${APPLE_API_KEY_ID:-}" ] && [ -n "${APPLE_API_ISSUER:-}" ]; then
    NOTARY_ARGS=(--key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER")
    return 0
  elif [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ] && [ -n "${APPLE_PASSWORD:-}" ]; then
    NOTARY_ARGS=(--apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_PASSWORD")
    return 0
  fi
  NOTARY_ARGS=()
  return 1
}

notarize_and_staple() {
  local submit_file="$1"
  local staple_target="$2"
  local assess_type="${3:-exec}"
  if ! notary_auth_args; then
    echo "Apple Notarization: skipped for $staple_target (no App Store Connect API key or Apple ID credentials configured)"
    return 0
  fi

  echo "Submitting $submit_file to Apple Notary service..."
  local out_json
  out_json=$(xcrun notarytool submit "$submit_file" "${NOTARY_ARGS[@]}" --wait --output-format json)
  echo "$out_json"
  local status id
  status=$("$PY" -I -c 'import json,sys; d=json.loads(sys.stdin.read()); print(d.get("status",""))' <<< "$out_json")
  id=$("$PY" -I -c 'import json,sys; d=json.loads(sys.stdin.read()); print(d.get("id",""))' <<< "$out_json")
  if [ "$status" != "Accepted" ]; then
    echo "Notarization failed with status: $status (id=$id). Fetching Apple notary log..."
    if [ -n "$id" ]; then
      xcrun notarytool log "$id" "${NOTARY_ARGS[@]}" || true
    fi
    exit 1
  fi

  echo "Stapling notarization ticket to $staple_target..."
  xcrun stapler staple "$staple_target"
  xcrun stapler validate "$staple_target"
  if [ "$assess_type" = "open" ]; then
    spctl --assess --type open --context context:primary-signature -v "$staple_target"
  else
    spctl --assess --type exec -v "$staple_target"
  fi
}

case "$(uname -s)" in
  Darwin)
    # Strip Apple signing/notarization env vars during `cargo tauri build` so Tauri CLI does not
    # run its built-in codesign/notarytool prematurely; tools/sign-mac.sh + notarize_and_staple handle
    # inside-out Developer ID signing, app notarization+stapling BEFORE DMG packing, and DMG notarization cleanly.
    env -u APPLE_SIGNING_IDENTITY -u APPLE_ID -u APPLE_PASSWORD -u APPLE_TEAM_ID \
        -u APPLE_API_KEY -u APPLE_API_KEY_PATH -u APPLE_API_ISSUER -u APPLE_API_KEY_ID \
        cargo tauri build --bundles app
    tools/sign-mac.sh "$B/macos/Sympony.app"
    RAW_ARCH="$(uname -m)"
    case "$RAW_ARCH" in
      arm64|aarch64) TAURI_ARCH="aarch64" ;;
      x86_64) TAURI_ARCH="x86_64" ;;
      *) TAURI_ARCH="$RAW_ARCH" ;;
    esac
    STAGE=$(mktemp -d); trap 'rm -rf "$STAGE"' EXIT
    # Notarize and staple Sympony.app BEFORE packaging into the .dmg so users dragging the app out
    # of the .dmg get an offline-verified stapled ticket (prevents slow online Gatekeeper hangs).
    if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
      APP_ZIP="$STAGE/Sympony-app.zip"
      ditto -c -k --sequesterRsrc --keepParent "$B/macos/Sympony.app" "$APP_ZIP"
      notarize_and_staple "$APP_ZIP" "$B/macos/Sympony.app" exec
      rm -f "$APP_ZIP"
    fi
    # Plain hdiutil dmg (already-stapled app + /Applications link) using HFS+ for fast universal mounting
    DMG_ROOT="$STAGE/dmg"; mkdir -p "$DMG_ROOT"
    ditto "$B/macos/Sympony.app" "$DMG_ROOT/Sympony.app"; ln -s /Applications "$DMG_ROOT/Applications"
    DMG="$OUT/Sympony_${V}_${RAW_ARCH}.dmg"
    hdiutil create -volname Sympony -srcfolder "$DMG_ROOT" -ov -format UDZO -fs HFS+ "$DMG"
    if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
      DMG_SIGN=(--force --timestamp -s "$APPLE_SIGNING_IDENTITY")
      if [ -n "${APPLE_KEYCHAIN:-}" ]; then DMG_SIGN+=(--keychain "$APPLE_KEYCHAIN"); fi
      codesign "${DMG_SIGN[@]}" "$DMG"
      codesign --verify --verbose=2 "$DMG"
      notarize_and_staple "$DMG" "$DMG" open
    fi
    # Pack signed & stapled Sympony.app for in-app auto-updater
    TARBALL="$OUT/Sympony_${V}_${TAURI_ARCH}.app.tar.gz"
    COPYFILE_DISABLE=1 tar -czf "$TARBALL" -C "$B/macos" Sympony.app
    sign_updater_artifact "darwin-${TAURI_ARCH}" "$TARBALL" ;;
  Linux)
    cargo tauri build --bundles deb,rpm,appimage
    cp "$B"/deb/*.deb "$B"/rpm/*.rpm "$OUT/"
    for appimg in "$B"/appimage/*.AppImage; do
      if [ -f "$appimg" ]; then
        cp "$appimg" "$OUT/"
        sign_updater_artifact "linux-x86_64" "$OUT/$(basename "$appimg")"
      fi
    done ;;
  MINGW*|MSYS*|CYGWIN*)
    # Self-heal if Cargo cached sherpa-onnx-sys build script outputs without target/sherpa-onnx-prebuilt
    if [ ! -d target/sherpa-onnx-prebuilt ] || [ -z "$(find target/sherpa-onnx-prebuilt -name 'sherpa-onnx-c-api.lib' 2>/dev/null)" ]; then
      rm -rf target/release/build/sherpa-onnx-sys* target/release/.fingerprint/sherpa-onnx-sys* target/release/deps/libsherpa_onnx_sys*
    fi
    cargo build --release -p sympony
    # Bundle sherpa-onnx / onnxruntime shared DLLs right alongside Sympony.exe inside the NSIS installer
    DLL_STAGE="target/windows-dlls"
    rm -rf "$DLL_STAGE" && mkdir -p "$DLL_STAGE"
    find target/release -maxdepth 1 -name '*.dll' -exec cp {} "$DLL_STAGE/" \;
    find target/sherpa-onnx-prebuilt -name '*.dll' -exec cp {} "$DLL_STAGE/" \; 2>/dev/null || true
    if [ ! -f "$DLL_STAGE/sherpa-onnx-c-api.dll" ] || [ ! -f "$DLL_STAGE/onnxruntime.dll" ]; then
      echo "ERROR: missing required Windows runtime DLLs in $DLL_STAGE" >&2
      ls -la "$DLL_STAGE" >&2 || true
      exit 1
    fi
    ls -lh "$DLL_STAGE"
    WIN_CFG="target/tauri-windows-bundle.json"
    "$PY" -I - "$DLL_STAGE" "$WIN_CFG" <<'PY'
import json, os, sys
dll_dir, out_path = sys.argv[1:3]
resources = {"../crates/voice/data/**/*": "voice/data/"}
for name in sorted(os.listdir(dll_dir)):
    if name.lower().endswith(".dll"):
        resources[f"../{dll_dir}/{name}"] = name
with open(out_path, "w", encoding="utf-8") as f:
    json.dump({"bundle": {"resources": resources}}, f, indent=2)
    f.write("\n")
print("Windows NSIS resource map:", json.dumps(resources, indent=2))
PY
    cargo tauri build --bundles nsis --config "$WIN_CFG"
    for exe in "$B"/nsis/*.exe; do
      if [ -f "$exe" ]; then
        cp "$exe" "$OUT/"
        sign_updater_artifact "windows-x86_64" "$OUT/$(basename "$exe")"
      fi
    done ;;
  *) echo "unsupported OS $(uname -s)"; exit 1 ;;
esac

ls -lh "$OUT"
if [ "${1:-}" = --clean ]; then cargo clean; fi
