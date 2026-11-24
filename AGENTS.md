# Sympony — Agent & Collaborator Guide (`AGENTS.md`)

This repository (`rheynoapria/sympony-ai`) is developed collaboratively across **macOS** (`@rheynoapria`) and **Windows** (`@mrerren`) with both human developers and AI coding agents (Claude Code, Codex, Paseo, Antigravity, Cursor, Gemini CLI, etc.).

Follow this guide so work stays **transparent, coordinated, and cross-platform safe**.

---

## 1. Public Project Board & Issue Tracking (Mandatory Workflow)

All active work, bugs, features, and release milestones are tracked publicly on **GitHub Projects v2**:

- **Project Board:** **Sympony Roadmap** — https://github.com/users/rheynoapria/projects/1 (also linked at https://github.com/rheynoapria/sympony-ai/projects)
- **Owner:** `rheynoapria` · **Project Number:** `1` · **Repo:** `rheynoapria/sympony-ai`

### One-Time CLI Auth (macOS & Windows)
Before managing the board from an AI agent or terminal, ensure `gh` has `project` scope:

```bash
gh auth refresh -s project,read:project
```

### Standard Fields & Taxonomy
| Field | Allowed Values |
| :--- | :--- |
| **Status** | `Backlog` · `Planned` · `In Progress` · `In Beta` · `Done` |
| **Area** | `Pony AI` · `Voice` · `Notch UI` · `Modules` · `Platform` · `Security` · `Portal & Docs` |
| **Platform** | `Cross-Platform` · `macOS` · `Windows` · `Linux` |
| **Priority** | `P0 Critical` · `P1 High` · `P2 Normal` |

Matching repo labels:
- **Area:** `area:pony-ai`, `area:voice`, `area:notch-ui`, `area:modules`, `area:platform`, `area:security`, `area:portal`
- **Platform:** `os:macos`, `os:windows`, `os:linux`, `os:cross-platform`
- **Priority:** `priority:p0`, `priority:p1`, `priority:p2`

### Required Agent Protocol (Before, During & After Work)
1. **Before starting a feature or fix:**
   - Check active items on the board so macOS & Windows work never collides:
     ```bash
     gh project item-list 1 --owner rheynoapria --limit 50
     gh issue list -R rheynoapria/sympony-ai --state open
     ```
   - Pick an existing issue (assign yourself / add a brief note) **or** create a new issue with the matching `area:*`, `os:*`, `priority:*` labels and active milestone (e.g., `v0.2.0-beta.5` or `v0.2.0 (Stable)`).
   - Add the issue to Project #1 and set **Status = `In Progress`** (plus `Area`, `Platform`, `Priority`):
     ```bash
     # Inspect field & option IDs
     gh project field-list 1 --owner rheynoapria --format json

     # Add issue/PR to Project #1
     gh project item-add 1 --owner rheynoapria --url <ISSUE_OR_PR_URL>

     # Update Status / Area / Platform / Priority
     gh project item-edit --project-id PVT_kwHOAlN1cM4Bs9Ls --id <ITEM_ID> \
       --field-id <FIELD_ID> --single-select-option-id <OPTION_ID>
     ```
2. **While working:**
   - Update checklist items in the issue body as sub-tasks complete so other devs/agents see live progress.
3. **When opening a PR or finishing work:**
   - Target **`beta`** for normal features/fixes (never push work-in-progress directly to `main`; `main` is reserved for Stable promotions and urgent hotfixes).
   - Reference the issue in commit messages / PR description (`Refs #<num>` while in progress or beta; `Closes #<num>` when complete).
   - Move the board item to **`In Beta`** once merged & shipped in a beta tag, or **`Done`** once completed/released.

---

## 2. Architecture & Cross-Platform Parity Rules

Sympony is a Rust + Tauri 2 workspace (`src-tauri`, `crates/platform`, `crates/services`, `crates/contract`, `crates/voice`) with a vanilla JS notch/floating-chat frontend (`frontend/`) and a React/Vite Settings app (`settings-ui/` → compiled into `frontend/settings-dist/`).

- **macOS ↔ Windows trait parity:**
  - Any public function added to `crates/platform/src/macos/ax.rs` (or `window.rs`, `apps.rs`, `media.rs`, etc.) **MUST** also exist with a matching signature in `crates/platform/src/windows/` (and vice versa) so CI stays green on both macOS and Windows.
  - Keep pure business logic inside `crates/services/` with unit tests so it runs identically on every OS.
- **IPC Contract Parity (`crates/contract`):**
  - `cargo test -p contract` runs `counts_match_the_frontend` against `frontend/`. Do not introduce unapproved core `invoke(...)` or `on(...)` calls outside `symponyInvoke` / `symponyListen` or the documented `pony:*` / `voice:*` / `brain:*` namespaces without updating the contract.
- **Settings UI (`settings-ui/`):**
  - Whenever editing `settings-ui/src/`, rebuild with `bun run --cwd settings-ui build` and add Indonesian translations for every new `t("...")` string in `frontend/i18n.js` (verified by `bun test --cwd settings-ui`, specifically `i18n.id.test.ts`).
- **Security & Privacy Invariants:**
  - Never hardcode hosted AI URLs, secrets, OAuth credentials, or tokens in source code.
  - Any new automation or elevated capability setting (like `ponyHands`, `ponyAutoUi`, `voiceAutoUi`) **must** be disarmed on backup import in `crates/services/src/backup.rs` with regression tests.
  - Any tool returning untrusted external/screen content **must** taint the active session (`mcp::tool_taints_turn` & `brain.rs`).
- **Version Lockstep:**
  - Never hand-edit version numbers in only one file — always use `./tools/bump-version.sh` (verified in CI).

---

## 3. Verification Checklist Before Pushing

Run these checks locally before committing or opening a PR:

```bash
cargo test --workspace
cargo run -q -p services --bin parity
bun test --cwd settings-ui
bun run --cwd settings-ui build
```

On Windows, also verify `cargo check --workspace` (and `release/build.sh` when touching packaging/DLL bundling).
