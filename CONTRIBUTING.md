# Contributing to Sympony

Thank you for your interest in contributing to Sympony!

## Licence

- Sympony is licensed under the **GNU General Public License v3.0 only (`GPL-3.0-only`)**. By submitting a pull request, you agree that your contributions are licensed under `GPL-3.0-only`.
- **Original contributions**: Contributions to Sympony must be original work or properly attributed under GPL-3.0-compatible licences.
- **No secrets or personal data**: Never commit `.signing/`, OAuth client secrets, API keys, local backups, or personal logs.

## Development Setup (macOS)

Prerequisites:
- Rust toolchain (stable)
- Bun (`bun`)
- Xcode Command Line Tools

Run the app in development:

```bash
# Optional (recommended once): enable fast local pre-commit hygiene & frontend checks
git config core.hooksPath .githooks

cargo tauri dev
```

## Verification Checklist

Run the full test suite before opening a pull request:

```bash
cargo test --workspace
cargo run -q -p services --bin parity
bun test --cwd settings-ui
bun run --cwd settings-ui build
bun test ./frontend/tests
```

### Live checks in a test build (Windows)

To drive the running app from a script, build it with the `dev-drive` feature (never the shipped app) and run it on its own data folder:

```bash
cargo build --release -p sympony --features dev-drive
export SYMPONY_DATA_DIR="$TEMP/sympony-check"
target/release/sympony.exe &
target/release/sympony.exe --dev-eval notch.html "N.api.svc('lang', 'state')"
```

`--dev-eval <window> <script | @file>` runs the script in the window with that label or page (as the DevTools protocol's `Runtime.evaluate`, promises awaited) and prints its value as JSON, or `{"error": …}` with exit code 1. Don't start WebView2 with `--remote-debugging-port` for this: Microsoft Defender's behaviour monitoring ends the app (#73).

## Public Roadmap & AI Agent Workflow

All planned features, active work, and release milestones are tracked transparently on the **[Sympony Roadmap](https://github.com/users/rheynoapria/projects/1)** (linked in the repository's **Projects** tab).

- **Using an AI coding agent (Claude Code, Codex, Paseo, Antigravity, Cursor, etc.)?** Read [AGENTS.md](AGENTS.md) first — it defines our GitHub Project board workflow (`Status`, `Area`, `Platform`, `Priority`), `gh project` CLI commands, and macOS ↔ Windows parity rules.
- **Collaborators managing the board via CLI:** run `gh auth refresh -s project,read:project` once so you (and your coding agent) can list, add, and update items on Project `#1`.

## Guidelines

- **Branch targeting**: Open feature and bugfix pull requests against **`beta`** (active integration branch). Reserve **`main`** for Stable releases graduated from `beta` and urgent production hotfixes. See [docs/RELEASING.md](docs/RELEASING.md) for our full branching and SemVer standard.
- **Commit style**: Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat(scope):`, `fix(scope):`, `perf(scope):`, `docs:`, `ci:`, `chore:`) so automated release notes stay clean and categorized.
- **Code of Conduct**: All contributors and participants are expected to follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
- **Changelog**: Note user-facing changes under `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md).
- **Version lockstep**: Never hand-edit version numbers in only one file — use `./tools/bump-version.sh` (checked automatically in CI with `./tools/bump-version.sh --check`).
- **Small, focused PRs**: Keep each PR scoped to one bug fix, hardening item, or feature with unit tests covering the behaviour or regression.
- **Security-sensitive areas**: Changes touching `crates/services/src/exec.rs`, `backup.rs`, `http.rs`, `mcp_client.rs`, `hooks.rs`, `phone.rs`, `src-tauri/src/brain.rs`, `hands.rs`, `eyes.rs`, or `tauri.conf.json` require explicit regression tests.
- **UI & Motion**: Follow `DESIGN.md` — animate only `transform` and `opacity` (never layout properties), respect `prefers-reduced-motion`, and escape all dynamic text/attributes rendered into HTML.
- **Hosted AI Endpoint**: Do not hardcode hosted API domains in source code. Official releases inject `SYMPONY_AI_URL` at build time; local testing can set the `SYMPONY_AI_URL` environment variable.
