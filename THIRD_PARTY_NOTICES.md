# Third-Party Notices

Sympony incorporates or downloads the following third-party components and datasets under their respective licences. All bundled licences are compatible with Sympony's **GPL-3.0-only** licence.

## Voice Dictionaries, Vocabularies & ASR Models

See [crates/voice/data/LICENSES/THIRD_PARTY.md](crates/voice/data/LICENSES/THIRD_PARTY.md) for full details and verbatim licence texts (`LGPL-3.0.txt`, `SCOWL-LICENSE.txt`).

| Component | Source | Licence | Delivery |
|---|---|---|---|
| Indonesian dictionary (`id_ID.dic`, `id_ID.aff`) & verb bases (`id_verb_bases_di.txt`) | LibreOffice `hunspell-id` | LGPL-3.0-only | Separate runtime resource files under `voice/data/` (never compiled into binary) |
| English word list (`en_words.txt`) | SCOWL 2020.12.07 (size 50) | SCOWL / BSD-like permissive | Separate runtime resource file |
| Zipformer2-id streaming model | `spacewave/sherpa-onnx-streaming-zipformer2-id` | MIT | Downloaded on demand to `~/.sympony/models/` |
| Qwen3-ASR 0.6B / 1.7B GGUF weights | Qwen / `handy-computer/Qwen3-ASR-*-gguf` | Apache-2.0 | Downloaded on demand to `~/.sympony/models/` |

## Frontend Icons & UI Libraries

| Component | Location / Package | Licence |
|---|---|---|
| Font Awesome Free | `frontend/vendor/fontawesome/` | Icons: CC BY 4.0 · Fonts: SIL OFL 1.1 · Code: MIT |
| Lobe Icons (AI provider icons) | `frontend/vendor/ai-icons/` | MIT |
| three.js (optional 3D Pony; used by the brand boards in `docs/brand/`) | `frontend/vendor/three/` | MIT |
| Fluent UI System Icons | `@fluentui/react-icons` (`settings-ui/`) | MIT |
| React, Vite, Tailwind CSS | `settings-ui/package.json` | MIT |

## Rust & Native Dependencies

Sympony is built with Tauri 2 and open-source Rust/C++ crates (including `tauri`, `objc2`, `serde`, `ureq`, `rquickjs`, `aes-gcm`, `zip`, `rusqlite`, `cpal`, `transcribe-cpp`, and `sherpa-onnx`), licensed under MIT, Apache-2.0, BSD, ISC, or Zlib licences. Refer to `Cargo.lock` and `settings-ui/bun.lock` for exact resolved versions.
