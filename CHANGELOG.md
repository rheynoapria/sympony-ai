# Changelog

All notable changes to **Sympony** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0-beta.1] - 2026-11-23

### Added
- **Dual-Channel In-App Auto-Updater (Stable & Beta):** Automatically checks GitHub Releases manifests (`latest.json` for Stable, floating `beta-channel/latest.json` for Beta), downloads signed binaries in-place with live progress (`0–100%`), verifies cryptographic signatures via `tauri-plugin-updater`, and restarts cleanly without manual `.dmg` re-installs.
- **Distinct Stable & Beta Update UX:** Global Settings update banner (Sky/Blue **New Release** vs Amber **Beta · Early preview**), sidebar `BETA` build chip & update dot, full **Updates** card in *Settings → About & Updates* (auto-check, auto-download, **Watch Beta updates** with non-downgrade protection), plus subtle notch gear badge dot and one-time toast.
- **Apple Developer ID Signing & Notarization Pipeline:** Automated macOS code signing, Apple Notary submission, stapling for both `.dmg` and `.app`, version-bound updater `.app.tar.gz` signing (`--app-version`), and GitHub `Production` environment release automation.
- **Release & Versioning Tooling:** Added `tools/bump-version.sh` (manifest lockstep & changelog promotion), `tools/release-notes.py` (structured GitHub Release & `latest.json` notes), CI version-consistency enforcement, and [docs/RELEASING.md](docs/RELEASING.md).
- **Voice UX & Open-Notch Dictation:** Audio-reactive Pony eyes during listening/transcribing, floating open-notch `#openVoice` pill, and macOS Accessibility auto-recovery watcher.

### Changed
- **Slimmer Camera Notch:** Tightened closed camera-notch wing padding and typography so date strings (e.g. `Mon 23`) render cleanly without ellipsis truncation while staying slimmer around the MacBook notch.
- **Silent Voice Screen Context:** Voice commands to Pony now pass active front-window context quietly as background intent instead of attaching a visible `Screen:` chip on every prompt.

### Fixed
- **Pony Eyes & Hands Multi-Step Automation:** Improved system prompts for cross-app/browser multi-step workflows (`open` → `screen_read` → `screen_do`), fixed `hands.html` aurora glow & live Pony cursor visibility across monitors (`orderFrontRegardless` + monitor-aware offsets), and improved web input focusing during `fill`.
- **Pony Persona & Memory Hygiene:** Prevented Pony from addressing the user by its own name (`Pony` / `pon`) or persisting assistant nicknames and temporary tool failures into `~/.sympony/memory.json`.
- **macOS Animations, Shortcuts & Notch Controls:** Restored `#btnHide` and untuck via `toggleShortcut`, exposed Keyboard Shortcuts on macOS Settings, fixed `#outlineFx` glow/timer animations, `fxTabSlide`, `fxHudBounce`, and `fxShelfFly`, and cleared stuck `Writing…` voice state after commands.
- **Notch notifications:** Added a visible close (`×`) button to single-notification banners in `#below` and made the close button on stacked/piled notification cards visible at rest (`opacity: 0.72` → `1` on hover).

## [0.1.0] - 2026-11-22

### Added
- **Initial open-source release** under `GPL-3.0-only` by [Enlabs](https://enlabs.my.id).
- **OLED Desktop Notch Hub** with 24 modular widgets (Media + YouTube Video Mode, Calendar, Todo + Google Tasks sync, Pomodoro, Teleprompter, Shelf, Notes, Prayer Times, Weather, System Monitor, GitHub PRs, AI Usage, Speed Test, Translate, World Clock, Health, Screen Time, Radio, Bookmarks, Launcher, Notifications, Control Center, Day Progress, Pony).
- **Pony AI Companion:** OpenAI-compatible streaming brain, local CLI agent bridge, Agent Skills (`agentskills.io`), transparent memory & chat recall, stdio/HTTP MCP client + QuickJS Code Mode, opt-in Eyes (`screen_read` + Vision OCR), Hands (`screen_do` + Routine Replay), Ask Other AIs, and HITL notch cards.
- **Voice V1:** On-device Indonesian-first hybrid STT (`Zipformer2-id` live partials + `Qwen3-ASR` Metal final pass) with deterministic KBBI/phonetic post-processing and custom user dictionary.
- **Security Hardening:** Per-turn taint tracking (including YOLO mode), home-anchored secret & shell-profile protection, `0600`/`0700` data permissions, Hardened Runtime, backup disarming, SSRF-safe redirects, and scrubbed stdio MCP environments.

[Unreleased]: https://github.com/rheynoapria/sympony-ai/compare/v0.2.0-beta.1...HEAD
[0.2.0-beta.1]: https://github.com/rheynoapria/sympony-ai/compare/v0.1.0...v0.2.0-beta.1
[0.1.0]: https://github.com/rheynoapria/sympony-ai/releases/tag/v0.1.0
