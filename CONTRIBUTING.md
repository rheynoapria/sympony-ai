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

## Guidelines

- **Code of Conduct**: All contributors and participants are expected to follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
- **Changelog**: Note user-facing changes under `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md).
- **Small, focused PRs**: Keep each PR scoped to one bug fix, hardening item, or feature with unit tests covering the behaviour or regression.
- **Security-sensitive areas**: Changes touching `crates/services/src/exec.rs`, `backup.rs`, `http.rs`, `mcp_client.rs`, `hooks.rs`, `phone.rs`, `src-tauri/src/brain.rs`, `hands.rs`, `eyes.rs`, or `tauri.conf.json` require explicit regression tests.
- **UI & Motion**: Follow `DESIGN.md` — animate only `transform` and `opacity` (never layout properties), respect `prefers-reduced-motion`, and escape all dynamic text/attributes rendered into HTML.
- **Hosted AI Endpoint**: Do not hardcode hosted API domains in source code. Official releases inject `SYMPONY_AI_URL` at build time; local testing can set the `SYMPONY_AI_URL` environment variable.
