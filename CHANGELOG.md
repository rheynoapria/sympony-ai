# Changelog

All notable changes to **Sympony** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0-beta.2] - 2026-11-23

### Added
- **Module Styling Library & Minimalist Notch Sizing:** 18 distinct visual layouts across 6 core modules (*Prayer*, *Music*, *Weather*, *Calendar*, *Pomodoro*, *Control*), 3 one-click style packs (*Bento Studio*, *Compact OLED*, *Minimal Focus*), custom per-module width/height sliders (down to `420×116 px`), global card surface/radius/density controls, and custom Dashboard 4×2 card sizing.
- **Maximized Claude Code Engine in Pony AI:** Full parity with Sympony AI — real-time word-by-word text streaming (`stream-json`), live *WebSearch* & *WebFetch* step chips with automatic source cards, **Commands & files** (`run_command`, `read_file`, `write_file`, `edit_file`, `list_dir` with Ask/YOLO approval cards and web-taint protection), active ability rules (*Eyes*, *Hands*, *Other Agents*, *Ask AI*, *External MCP*), and multimodal image attachments.
- **Notch Style & Color Customization:** Restored *Black*, *Glass*, and custom *Color* notch themes with a live color picker and safe settings migration.
- **Interactive Pony Eyes & Hands Upgrade:** Smoother cursor feedback, focused click targeting, and clearer overlay visuals across apps.

### Changed
- **Ultra-Slim Minimalist Notch Profiles:** Lowered compact/minimal heights across styled modules (`124–172 px`), reduced minimum custom height to `116 px` (`420 px` width), and redesigned *Control* with a sleek *Minimal OLED* default (icon toggles, output pill, horizontal capsule sliders).
- **13-inch MacBook Closed Notch Layout:** Optimized closed camera-notch wing math (`camClosedLayout` & `closedWidthNoCam`) so clock and activity indicators hug the camera compactly.

### Fixed
- **macOS `.dmg` Slow Opening / Gatekeeper Hang:** Updated `release/build.sh` to notarize and staple `Sympony.app` **before** creating the HFS+ `.dmg` (then signing, notarizing, and stapling the `.dmg`), eliminating slow online Gatekeeper verification hangs after installation.
- **YouTube Video Fast-Forward & Scrubber Seeking:** Routed `←` / `→` (±5s), `J` / `L` (±10s), and `Space` / `K` to YouTube playback while video mode is active (`Shift + ←/→` still slides tabs), added `−10s` / `+10s` overlay buttons with HUD feedback, and fixed progress-bar seek dispatch (`media` / `media.seek`).
- **Claude Code & Codex Live Web Summarization:** Fixed Claude Code `--allowedTools` merging (`mcp__sympony,WebSearch,WebFetch`) and variadic `--tools` ordering so live web queries are never auto-denied, enabled live web search for Codex, and instructed CLI agents to summarize concrete live numbers/facts directly instead of returning bare links.
- **Responsive Notch Layouts & `.sl-pane` Flex Stacking:** Fixed vertical stacking on *Pomodoro Minimal Strip* & *Weather Big Temp Minimal*, fixed `[hidden]` overrides, and removed leftover hardcoded `218 px` stage heights.

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

[Unreleased]: https://github.com/rheynoapria/sympony-ai/compare/v0.2.0-beta.2...HEAD
[0.2.0-beta.2]: https://github.com/rheynoapria/sympony-ai/compare/v0.2.0-beta.1...v0.2.0-beta.2
[0.2.0-beta.1]: https://github.com/rheynoapria/sympony-ai/compare/v0.1.0...v0.2.0-beta.1
[0.1.0]: https://github.com/rheynoapria/sympony-ai/releases/tag/v0.1.0
