# Security Policy

## Supported Versions

Security fixes are maintained on the `main` branch and included in official release builds.

| Version | Supported |
|---|---|
| `main` / latest release | Yes |
| Older snapshots | No |

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, report vulnerabilities privately via GitHub Security Advisories on this repository (or contact the maintainer directly via the security contact published on the repository profile) with:

- Affected component (`src-tauri`, `crates/services`, `crates/platform`, `crates/voice`, `settings-ui`, or `frontend`)
- Steps to reproduce or a minimal proof-of-concept
- Expected vs. actual security impact

We aim to acknowledge reports within 72 hours and coordinate a fix before public disclosure.

## Security Model & Local Privileges

Sympony is a local-first cross-platform desktop application (shipping first on macOS, with Windows and Linux planned) that can optionally interact with high-privilege OS capabilities when explicitly enabled by the user:

- **AI Assistant (Pony) Shell & File Tools (`ponyExec`)**: Disabled by default (`off`) and disarmed automatically on backup import. Sensitive credential directories (`.ssh`, `.aws`, `.gnupg`, Keychains, shell profiles, LaunchAgents, Sympony's own data directory, etc.) always require explicit confirmation and cannot be auto-approved via "Always allow". Commands executed after reading untrusted external content (web pages, screen content, external MCP tools) remain tainted for the session and require approval.
- **Screen Reading & Automation (`ponyEyes` / `ponyHands`)**: Opt-in. Password managers, 2FA authenticators, Sympony itself, and secure password fields (`IsSecureEventInputEnabled` / `AXSecureTextField`) are excluded. Destructive or irreversible actions require explicit confirmation.
- **External MCP Servers (`ponyMcp`)**: Disabled and reset to `ask` mode on backup import. Stdio MCP servers launch with a scrubbed environment (`env_clear`) containing only safe baseline variables so parent credentials are not inherited.
- **Local Network Phone Bridge**: Protected by a random bearer token (constant-time verified) and `X-Sympony-Request` CSRF checks on state-changing endpoints.
- **Local Data & Secrets**: Settings, history, and backup extracts are stored with owner-only permissions (`0600` files / `0700` directories). API keys are stored in macOS Keychain or an owner-only local secrets file.
- **Hosted AI Router**: Open-source / source builds do not include any hosted AI endpoint (`SYMPONY_AI_URL` is only injected in official Enlabs release builds and never committed to source).
