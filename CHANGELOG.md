# Changelog

All notable changes to **Sympony** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **Notch notifications:** Added a visible close (`×`) button to single-notification banners in `#below` and made the close button on stacked/piled notification cards visible at rest (`opacity: 0.72` → `1` on hover).

### Chore
- Added GitHub open-source governance, templates (Issue Forms, PR Template, CODEOWNERS, Dependabot, release notes config, Code of Conduct), upgraded CI/Release workflows (Rust caching, parallel frontend hygiene job, automatic GitHub Releases with `SHA256SUMS.txt`), and opt-in local `.githooks/pre-commit`.

## [0.1.0] - 2026-11-22

### Added
- **Initial open-source release** under `GPL-3.0-only` by [Enlabs](https://enlabs.my.id).
- **OLED Desktop Notch Hub** with 24 modular widgets (Media + YouTube Video Mode, Calendar, Todo + Google Tasks sync, Pomodoro, Teleprompter, Shelf, Notes, Prayer Times, Weather, System Monitor, GitHub PRs, AI Usage, Speed Test, Translate, World Clock, Health, Screen Time, Radio, Bookmarks, Launcher, Notifications, Control Center, Day Progress, Pony).
- **Pony AI Companion:** OpenAI-compatible streaming brain, local CLI agent bridge, Agent Skills (`agentskills.io`), transparent memory & chat recall, stdio/HTTP MCP client + QuickJS Code Mode, opt-in Eyes (`screen_read` + Vision OCR), Hands (`screen_do` + Routine Replay), Ask Other AIs, and HITL notch cards.
- **Voice V1:** On-device Indonesian-first hybrid STT (`Zipformer2-id` live partials + `Qwen3-ASR` Metal final pass) with deterministic KBBI/phonetic post-processing and custom user dictionary.
- **Security Hardening:** Per-turn taint tracking (including YOLO mode), home-anchored secret & shell-profile protection, `0600`/`0700` data permissions, Hardened Runtime, backup disarming, SSRF-safe redirects, and scrubbed stdio MCP environments.
