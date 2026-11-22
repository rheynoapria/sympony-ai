#!/bin/bash
# One-time: a self-signed code-signing identity in a keychain of its own (.signing/, not the login keychain), so builds
# sign without any prompt and every build has the same signature (macOS keeps "Always Allow" and permissions).
# The keychain password is fixed and known: it only guards this throwaway local self-signed key. Copy .signing/ to
# another Mac to build there with the same identity.
set -euo pipefail
cd "$(dirname "$0")/.."
KC="$PWD/.signing/sympony-signing.keychain-db"; PW=sympony-local; NAME="Sympony Local Signing"
[ -f "$KC" ] && { echo "already there: $KC"; exit 0; }
mkdir -p .signing
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
printf '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=%s\n[ext]\nbasicConstraints=critical,CA:false\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=critical,codeSigning\n' "$NAME" > "$T/c.cnf"
/usr/bin/openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -config "$T/c.cnf" -keyout "$T/k.pem" -out "$T/c.pem" 2>/dev/null
/usr/bin/openssl pkcs12 -export -inkey "$T/k.pem" -in "$T/c.pem" -out "$T/id.p12" -passout pass:sympony
security create-keychain -p "$PW" "$KC"
security unlock-keychain -p "$PW" "$KC"
security import "$T/id.p12" -k "$KC" -P sympony -T /usr/bin/codesign >/dev/null
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$PW" "$KC" >/dev/null
security find-identity -p codesigning "$KC" | grep -q "$NAME" || { echo "import failed: no identity in $KC" >&2; rm -f "$KC"; exit 1; }
echo "created: $NAME in $KC"
