#!/usr/bin/env python3
"""Generate polished open-source GitHub Release notes AND concise in-app updater notes.

Sources (in priority order):
  1. Matching version section in CHANGELOG.md (Keep a Changelog format), e.g. `## [0.2.0-beta.1]`
  2. Automatic Conventional Commit grouping since the previous `v*` tag

Outputs:
  --body-out <path>     Full Markdown release description for GitHub Releases
  --updater-out <path>  Concise bullet notes (`- New: ...` / `- Fixed: ...`) for `latest.json`
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
from pathlib import Path

SECTION_ORDER = [
    ("Added", "🚀 Highlights & New Features", "New"),
    ("Changed", "✨ Improvements & Changes", "Improved"),
    ("Fixed", "🐛 Bug Fixes", "Fixed"),
    ("Security", "🛡️ Security", "Improved"),
    ("Performance", "⚡ Performance", "Improved"),
    ("Removed", "🗑️ Removed", "Removed"),
    ("Chore", "🔧 Build, CI & Maintenance", "Changed"),
]

COMMIT_BUCKETS = {
    "feat": "Added",
    "fix": "Fixed",
    "perf": "Performance",
    "security": "Security",
    "refactor": "Changed",
    "style": "Changed",
    "docs": "Chore",
    "ci": "Chore",
    "build": "Chore",
    "chore": "Chore",
    "test": "Chore",
}


def run_git(*args: str) -> str:
    try:
        return subprocess.check_output(
            ["git", *args], text=True, stderr=subprocess.DEVNULL
        ).strip()
    except Exception:
        return ""


def previous_tag(tag: str) -> str:
    # Find the most recent v* tag reachable before `tag` (or HEAD in dry-run)
    rev = f"{tag}^" if run_git("rev-parse", "--verify", f"refs/tags/{tag}") else "HEAD"
    prev = run_git("describe", "--tags", "--abbrev=0", "--match", "v*", rev)
    if prev == tag:
        prev = run_git("describe", "--tags", "--abbrev=0", "--match", "v*", f"{tag}^")
    return prev


def parse_changelog_section(changelog_path: Path, version: str) -> dict[str, list[str]]:
    if not changelog_path.exists():
        return {}
    lines = changelog_path.read_text(encoding="utf-8").splitlines()
    ver_re = re.compile(rf"^##\s+\[?v?{re.escape(version)}\]?(?:\s|$)")
    in_section = False
    cur_bucket = "Changed"
    buckets: dict[str, list[str]] = {}

    for line in lines:
        if line.startswith("## "):
            if in_section:
                break
            if ver_re.match(line):
                in_section = True
            continue
        if not in_section:
            continue
        if line.startswith("### "):
            heading = line[4:].strip()
            cur_bucket = heading
            continue
        m = re.match(r"^\s*[-*]\s+(.+)$", line)
        if m:
            buckets.setdefault(cur_bucket, []).append(m.group(1).strip())
    return buckets


def collect_commits(tag: str, prev: str) -> dict[str, list[str]]:
    end_ref = tag if run_git("rev-parse", "--verify", f"refs/tags/{tag}") else "HEAD"
    rev_range = f"{prev}..{end_ref}" if prev else end_ref
    raw = run_git("log", "--no-merges", "--pretty=format:%h\t%s", rev_range)
    buckets: dict[str, list[str]] = {}
    conv_re = re.compile(r"^([a-zA-Z]+)(?:\(([^)]+)\))?(!)?:\s+(.+)$")

    for line in raw.splitlines():
        if "\t" not in line:
            continue
        sha, subj = line.split("\t", 1)
        subj = subj.strip()
        if not subj or subj.lower().startswith("chore(release):"):
            continue
        m = conv_re.match(subj)
        if m:
            ctype = m.group(1).lower()
            scope = m.group(2)
            breaking = bool(m.group(3))
            desc = m.group(4).strip()
            desc = desc[0].upper() + desc[1:] if desc else desc
            bucket = COMMIT_BUCKETS.get(ctype, "Changed")
            prefix = f"**{scope}:** " if scope else ""
            bang = "⚠️ **BREAKING** — " if breaking else ""
            buckets.setdefault(bucket, []).append(f"{bang}{prefix}{desc} (`{sha}`)")
        else:
            buckets.setdefault("Changed", []).append(f"{subj} (`{sha}`)")
    return buckets


def strip_md_for_updater(item: str) -> str:
    s = re.sub(r"\s*\(`[0-9a-f]{7,12}`\)\s*$", "", item)
    s = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", s)
    s = s.replace("**", "").replace("`", "")
    return s.strip()


def format_assets_table(assets_dir: Path | None, repo: str, tag: str) -> list[str]:
    if not assets_dir or not assets_dir.exists():
        return []
    files = sorted(p.name for p in assets_dir.iterdir() if p.is_file())
    if not files:
        return []

    rows: list[tuple[int, str]] = []
    for name in files:
        url = f"https://github.com/{repo}/releases/download/{tag}/{name}"
        if name.endswith(".dmg"):
            arch = "Apple Silicon (`arm64`)" if ("arm64" in name or "aarch64" in name) else "Intel (`x86_64`)"
            rows.append((10, f"| macOS Installer ({arch}) | [`{name}`]({url}) | First-time install — Developer ID signed & Apple Notarized |"))
        elif name.endswith(".exe"):
            rows.append((20, f"| Windows Installer (`x64`) | [`{name}`]({url}) | NSIS desktop installer |"))
        elif name.endswith(".deb"):
            rows.append((30, f"| Linux Debian/Ubuntu (`amd64`) | [`{name}`]({url}) | `.deb` package |"))
        elif name.endswith(".rpm"):
            rows.append((35, f"| Linux Fedora/RHEL (`x86_64`) | [`{name}`]({url}) | `.rpm` package |"))
        elif name.endswith(".AppImage"):
            rows.append((40, f"| Linux AppImage (`x86_64`) | [`{name}`]({url}) | Portable AppImage & auto-update artifact |"))
        elif name.endswith(".app.tar.gz"):
            rows.append((50, f"| macOS Auto-Update Archive | [`{name}`]({url}) | Used automatically by Sympony's in-app updater |"))
        elif name == "SHA256SUMS.txt":
            rows.append((90, f"| Checksums | [`SHA256SUMS.txt`]({url}) | SHA-256 hashes for verifying downloads |"))

    if not rows:
        return []

    rows.sort(key=lambda r: (r[0], r[1]))
    return [
        "## 📦 Downloads & Verification",
        "",
        "| Target | Asset | Notes |",
        "|---|---|---|",
        *(row for _, row in rows),
        "",
        "Verify download integrity on macOS / Linux:",
        "```bash",
        "shasum -a 256 -c SHA256SUMS.txt --ignore-missing",
        "```",
    ]


def build_notes(
    tag: str,
    repo: str,
    changelog_path: Path,
    assets_dir: Path | None,
) -> tuple[str, str]:
    version = tag.lstrip("v")
    is_beta = "-" in version
    prev = previous_tag(tag)

    buckets = parse_changelog_section(changelog_path, version)
    source = "changelog"
    if not buckets:
        buckets = collect_commits(tag, prev)
        source = "commits"

    # Build GitHub Release Markdown body
    out: list[str] = []
    if is_beta:
        out.extend([
            f"> [!NOTE]",
            f"> **🧪 Beta Pre-Release (`v{version}`)** — Early preview build for testing upcoming features and fixes before they graduate to Stable.",
            f"> Already using Sympony? Enable **Settings → About & Updates → Watch Beta updates** to receive and install this update directly inside the app.",
            "",
        ])
    else:
        out.extend([
            f"> [!TIP]",
            f"> **✨ Stable Release (`v{version}`)** — Signed, notarized, and ready for everyday use.",
            f"> Already using Sympony (Stable or Beta)? Open **Settings → About & Updates** to update in-place without reinstalling.",
            "",
        ])

    wrote_any = False
    for key, title, _ in SECTION_ORDER:
        items = buckets.get(key, [])
        if not items:
            continue
        wrote_any = True
        out.append(f"## {title}")
        out.append("")
        for item in items:
            out.append(f"- {item}")
        out.append("")

    # Include any custom Keep-a-Changelog headings not in SECTION_ORDER
    known_keys = {k for k, _, _ in SECTION_ORDER}
    for key, items in buckets.items():
        if key in known_keys or not items:
            continue
        wrote_any = True
        out.append(f"## {key}")
        out.append("")
        for item in items:
            out.append(f"- {item}")
        out.append("")

    if not wrote_any:
        out.extend([
            "## ✨ Summary",
            "",
            f"- Maintenance and stability improvements for Sympony `v{version}`.",
            "",
        ])

    assets_md = format_assets_table(assets_dir, repo, tag)
    if assets_md:
        out.extend(assets_md)
        out.append("")

    out.extend([
        "## 🔄 How to Install or Update",
        "",
        "- **Existing users (In-App Auto-Updater):** Sympony notifies you automatically when a new release matches your channel (**Stable** or **Beta**). Click **Update & Restart** (or **Install Beta**) — no manual `.dmg` reinstall required.",
        "- **New macOS users:** Download the `.dmg` above, drag **Sympony.app** into **Applications**, and launch it. Official releases are signed with an Apple Developer ID certificate and notarized by Apple.",
        "- **Switching channels:** Toggle **Watch Beta updates** anytime under **Settings → About & Updates**. Turning Beta off never downgrades — you will seamlessly move back to Stable on the next Stable release.",
        "",
    ])

    if prev:
        out.append(f"**Full Changelog:** [`{prev}...{tag}`](https://github.com/{repo}/compare/{prev}...{tag})")
    else:
        out.append(f"**Full Changelog:** [`{tag}`](https://github.com/{repo}/commits/{tag})")
    out.append(f"  \n<sub>Generated from {'CHANGELOG.md' if source == 'changelog' else 'commit history'} · Licensed under GPL-3.0-only · © 2026 Enlabs</sub>")

    # Build concise bullet notes for `latest.json` (rendered in UpdateBanner & What's New)
    updater_lines: list[str] = []
    for key, _, prefix in SECTION_ORDER:
        if key == "Chore":
            continue
        for item in buckets.get(key, []):
            clean = strip_md_for_updater(item)
            if clean:
                updater_lines.append(f"- {prefix}: {clean}")
            if len(updater_lines) >= 8:
                break
        if len(updater_lines) >= 8:
            break
    if not updater_lines:
        for item in buckets.get("Chore", [])[:5]:
            clean = strip_md_for_updater(item)
            if clean:
                updater_lines.append(f"- Changed: {clean}")
    if not updater_lines:
        updater_lines.append(f"- Improved: Sympony v{version} release")

    return "\n".join(out).strip() + "\n", "\n".join(updater_lines).strip() + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate Sympony GitHub Release and updater notes.")
    parser.add_argument("--tag", required=True, help="Release tag (e.g. v0.2.0-beta.1 or v0.2.0)")
    parser.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY", "rheynoapria/sympony-ai"))
    parser.add_argument("--changelog", default="CHANGELOG.md")
    parser.add_argument("--assets-dir", default="")
    parser.add_argument("--body-out", default="")
    parser.add_argument("--updater-out", default="")
    args = parser.parse_args()

    assets_dir = Path(args.assets_dir) if args.assets_dir else None
    body, updater = build_notes(args.tag, args.repo, Path(args.changelog), assets_dir)

    if args.body_out:
        Path(args.body_out).write_text(body, encoding="utf-8")
    else:
        print("=== GITHUB RELEASE BODY ===")
        print(body)

    if args.updater_out:
        Path(args.updater_out).write_text(updater, encoding="utf-8")
    elif not args.body_out:
        print("=== UPDATER NOTES (latest.json) ===")
        print(updater)


if __name__ == "__main__":
    main()
