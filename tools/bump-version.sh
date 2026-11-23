#!/usr/bin/env bash
# Sympony version manager & consistency checker.
#
# Keeps all version-bearing manifests in lockstep:
#   - Cargo.toml                  ([workspace.package] version)
#   - src-tauri/tauri.conf.json   (.version)
#   - settings-ui/package.json    (.version)
#   - CHANGELOG.md                (promotes [Unreleased] -> [X.Y.Z] on bump)
#
# Usage:
#   ./tools/bump-version.sh --check [--tag vX.Y.Z]   Verify all manifests match (and match tag if given)
#   ./tools/bump-version.sh beta                     0.1.0 -> 0.2.0-beta.1 | 0.2.0-beta.1 -> 0.2.0-beta.2
#   ./tools/bump-version.sh graduate                 0.2.0-beta.N -> 0.2.0 (promote Beta to Stable)
#   ./tools/bump-version.sh patch|minor|major        Bump Stable SemVer
#   ./tools/bump-version.sh <X.Y.Z[-beta.N]>         Set an explicit SemVer 2.0.0 version
#   Flags: --dry-run (preview without editing), --no-changelog (skip CHANGELOG.md update)

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

exec python3 -I - "$@" <<'PY'
import datetime
import json
import re
import subprocess
import sys
from pathlib import Path

SEMVER_RE = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)\.(0|[1-9]\d*))?$")
REPO_URL = "https://github.com/rheynoapria/sympony-ai"

CARGO_TOML = Path("Cargo.toml")
TAURI_CONF = Path("src-tauri/tauri.conf.json")
SETTINGS_PKG = Path("settings-ui/package.json")
CHANGELOG = Path("CHANGELOG.md")


def read_cargo_version() -> str:
    txt = CARGO_TOML.read_text(encoding="utf-8")
    m = re.search(r'(?ms)^\[workspace\.package\].*?^version\s*=\s*"([^"]+)"', txt)
    if not m:
        raise SystemExit("ERROR: Could not find [workspace.package] version in Cargo.toml")
    return m.group(1)


def read_tauri_version() -> str:
    return json.loads(TAURI_CONF.read_text(encoding="utf-8"))["version"]


def read_settings_version() -> str:
    return json.loads(SETTINGS_PKG.read_text(encoding="utf-8"))["version"]


def validate_semver(v: str) -> tuple[int, int, int, str | None, int | None]:
    m = SEMVER_RE.match(v)
    if not m:
        raise SystemExit(
            f"ERROR: Invalid version '{v}'. Expected SemVer 2.0.0: X.Y.Z or X.Y.Z-(alpha|beta|rc).N"
        )
    return (
        int(m.group(1)),
        int(m.group(2)),
        int(m.group(3)),
        m.group(4),
        int(m.group(5)) if m.group(5) is not None else None,
    )


def compute_next(current: str, target: str) -> str:
    maj, min_, pat, pre_kind, pre_num = validate_semver(current)
    if target == "beta":
        if pre_kind == "beta" and pre_num is not None:
            return f"{maj}.{min_}.{pat}-beta.{pre_num + 1}"
        if pre_kind is not None:
            return f"{maj}.{min_}.{pat}-beta.1"
        return f"{maj}.{min_ + 1}.0-beta.1"
    if target == "graduate":
        if pre_kind is None:
            raise SystemExit(f"ERROR: Current version {current} is already Stable (nothing to graduate).")
        return f"{maj}.{min_}.{pat}"
    if target == "patch":
        return f"{maj}.{min_}.{pat + 1}" if pre_kind is None else f"{maj}.{min_}.{pat}"
    if target == "minor":
        return f"{maj}.{min_ + 1}.0"
    if target == "major":
        return f"{maj + 1}.0.0"
    cleaned = target.lstrip("v")
    validate_semver(cleaned)
    return cleaned


def check_consistency(expected_tag: str | None) -> None:
    v_cargo = read_cargo_version()
    v_tauri = read_tauri_version()
    v_ui = read_settings_version()
    validate_semver(v_cargo)

    mismatches = []
    if v_tauri != v_cargo:
        mismatches.append(f"src-tauri/tauri.conf.json ({v_tauri}) != Cargo.toml ({v_cargo})")
    if v_ui != v_cargo:
        mismatches.append(f"settings-ui/package.json ({v_ui}) != Cargo.toml ({v_cargo})")
    if expected_tag:
        tag_ver = expected_tag.lstrip("v")
        validate_semver(tag_ver)
        if not expected_tag.startswith("v"):
            mismatches.append(f"Git tag '{expected_tag}' must start with 'v'")
        if tag_ver != v_cargo:
            mismatches.append(f"Git tag {expected_tag} ({tag_ver}) != Cargo.toml ({v_cargo})")

    if mismatches:
        print("Version consistency check FAILED:", file=sys.stderr)
        for line in mismatches:
            print(f"  - {line}", file=sys.stderr)
        raise SystemExit(1)

    channel = "Beta (pre-release)" if "-" in v_cargo else "Stable"
    print(f"Version check OK: v{v_cargo} [{channel}] across Cargo.toml, tauri.conf.json, settings-ui/package.json")


def update_cargo(new_ver: str) -> None:
    txt = CARGO_TOML.read_text(encoding="utf-8")
    out, count = re.subn(
        r'(?ms)(^\[workspace\.package\].*?^version\s*=\s*")([^"]+)(")',
        rf'\g<1>{new_ver}\g<3>',
        txt,
        count=1,
    )
    if count != 1:
        raise SystemExit("ERROR: Failed to update Cargo.toml")
    CARGO_TOML.write_text(out, encoding="utf-8")


def update_json_version(path: Path, new_ver: str) -> None:
    txt = path.read_text(encoding="utf-8")
    out, count = re.subn(r'("version"\s*:\s*")([^"]+)(")', rf'\g<1>{new_ver}\g<3>', txt, count=1)
    if count != 1:
        raise SystemExit(f"ERROR: Failed to update {path}")
    path.write_text(out, encoding="utf-8")


def update_changelog(old_ver: str, new_ver: str) -> None:
    if not CHANGELOG.exists():
        return
    txt = CHANGELOG.read_text(encoding="utf-8")
    today = datetime.date.today().isoformat()
    header = f"## [{new_ver}] - {today}"
    if header in txt or f"## [{new_ver}]" in txt:
        print(f"CHANGELOG.md already has a section for [{new_ver}]; leaving changelog untouched.")
        return

    marker = "## [Unreleased]"
    if marker not in txt:
        raise SystemExit("ERROR: CHANGELOG.md is missing '## [Unreleased]' heading.")

    txt = txt.replace(marker, f"{marker}\n\n{header}", 1)

    # Refresh Keep-a-Changelog reference links at bottom of CHANGELOG.md
    unreleased_link = f"[Unreleased]: {REPO_URL}/compare/v{new_ver}...HEAD"
    new_ver_link = f"[{new_ver}]: {REPO_URL}/compare/v{old_ver}...v{new_ver}"
    if re.search(r"^\[Unreleased\]:", txt, flags=re.M):
        txt = re.sub(
            r"^\[Unreleased\]:.*$",
            f"{unreleased_link}\n{new_ver_link}",
            txt,
            count=1,
            flags=re.M,
        )
    else:
        txt = txt.rstrip() + f"\n\n{unreleased_link}\n{new_ver_link}\n[{old_ver}]: {REPO_URL}/releases/tag/v{old_ver}\n"

    CHANGELOG.write_text(txt, encoding="utf-8")


def main() -> None:
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help"):
        print(__doc__ or "Usage: ./tools/bump-version.sh [--check [--tag vX.Y.Z] | beta | graduate | patch | minor | major | X.Y.Z]")
        return

    if args[0] == "--check":
        tag = None
        if len(args) >= 3 and args[1] == "--tag":
            tag = args[2]
        elif len(args) == 2 and args[1].startswith("--tag="):
            tag = args[1].split("=", 1)[1]
        check_consistency(tag)
        return

    dry_run = "--dry-run" in args
    no_changelog = "--no-changelog" in args
    pos = [a for a in args if not a.startswith("--")]
    if len(pos) != 1:
        raise SystemExit("ERROR: Specify exactly one target: beta | graduate | patch | minor | major | X.Y.Z[-beta.N]")

    current = read_cargo_version()
    next_ver = compute_next(current, pos[0])
    is_beta = "-" in next_ver
    channel = "Beta (pre-release)" if is_beta else "Stable"
    branch_hint = "beta" if is_beta else "main"

    print(f"Sympony version bump: v{current} -> v{next_ver} [{channel}]")
    if dry_run:
        print("(dry-run: no files modified)")
        return

    update_cargo(next_ver)
    update_json_version(TAURI_CONF, next_ver)
    update_json_version(SETTINGS_PKG, next_ver)
    if not no_changelog:
        update_changelog(current, next_ver)

    # Sync Cargo.lock cleanly offline so workspace crates reflect the new version
    try:
        subprocess.run(["cargo", "metadata", "--format-version", "1", "--offline"], check=True, stdout=subprocess.DEVNULL)
    except Exception:
        print("Note: run `cargo check` to refresh Cargo.lock if needed.")

    check_consistency(f"v{next_ver}")
    print()
    print("Next steps:")
    print(f"  1. Review CHANGELOG.md and polish highlights under [{next_ver}]")
    print(f"  2. Commit on `{branch_hint}`:")
    print(f'       git add Cargo.toml Cargo.lock src-tauri/tauri.conf.json settings-ui/package.json CHANGELOG.md')
    print(f'       git commit -m "chore(release): prepare v{next_ver}"')
    print(f"  3. Tag & push to trigger GitHub Release + Auto-Updater:")
    print(f'       git tag -a v{next_ver} -m "Sympony v{next_ver}"')
    print(f"       git push origin {branch_hint} --follow-tags")


if __name__ == "__main__":
    main()
PY
