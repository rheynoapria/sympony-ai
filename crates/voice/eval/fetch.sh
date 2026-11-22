#!/usr/bin/env bash
set -euo pipefail

# Download (or copy from local spike cache) only the FLEURS Indonesian audio clips listed in
# dev.tsv, test.tsv, and sanity.tsv into crates/voice/eval/.cache/ (git-ignored).
DIR="$(cd "$(dirname "$0")" && pwd)"
CACHE="$DIR/.cache"
SPIKE_DATA="/tmp/sympony-stt-spike/data"

mkdir -p "$CACHE/dev" "$CACHE/test" "$CACHE/sanity" "$CACHE/codeswitch"

copy_or_fetch() {
  local setname="$1"
  local tsv="$DIR/$setname.tsv"
  local out="$CACHE/$setname"
  local spike_src="$SPIKE_DATA/$setname"
  if [ "$setname" = "sanity" ]; then
    spike_src="$SPIKE_DATA/fleurs"
  fi

  local missing=0
  while IFS=$'\t' read -r id src _ref; do
    [ "$id" = "id" ] && continue
    [ -z "$id" ] && continue
    local dst="$out/$id.wav"
    if [ -f "$dst" ]; then
      continue
    fi
    if [ -f "$spike_src/$id.wav" ]; then
      cp "$spike_src/$id.wav" "$dst"
    else
      missing=$((missing + 1))
    fi
  done < "$tsv"

  if [ "$missing" -eq 0 ]; then
    echo "[$setname] all clips cached in $out"
    return 0
  fi

  local tar_split="test"
  [ "$setname" = "dev" ] && tar_split="dev"
  local url="https://huggingface.co/datasets/google/fleurs/resolve/main/data/id_id/audio/${tar_split}.tar.gz"
  echo "[$setname] fetching $missing clips from $url ..."
  curl -sL "$url" | python3 -I - "$tsv" "$out" <<'PY'
import sys, tarfile, os, subprocess, tempfile

tsv, out = sys.argv[1], sys.argv[2]
want = {}
with open(tsv, encoding="utf-8") as f:
    for line in f.read().splitlines()[1:]:
        parts = line.split("\t")
        if len(parts) >= 2:
            want[parts[1]] = parts[0]

found = 0
with tarfile.open(fileobj=sys.stdin.buffer, mode="r|gz") as tf:
    for m in tf:
        if not m.isfile():
            continue
        base = os.path.basename(m.name)
        if base not in want:
            continue
        rid = want[base]
        dst = os.path.join(out, f"{rid}.wav")
        if os.path.exists(dst):
            found += 1
            continue
        raw = tf.extractfile(m).read()
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp.write(raw)
            tmp_path = tmp.name
        try:
            subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-i", tmp_path, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", dst],
                check=True,
            )
        finally:
            os.unlink(tmp_path)
        found += 1
        if found >= len(want):
            break
print(f"extracted {found}/{len(want)} clips")
PY
}

copy_or_fetch dev
copy_or_fetch test
copy_or_fetch sanity
