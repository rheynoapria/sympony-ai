# Third-Party Data, Models & Runtime Licences

All vocabulary and dictionary data files ship as separate runtime resource files under `voice/data/` (never compiled into the binary), so LGPL-derived files remain cleanly separable and replaceable.

| Component | Source | Licence | Notes |
|---|---|---|---|
| Indonesian dictionary (`dict/id_ID.{dic,aff}`) & verb bases (`vocab/id_verb_bases_di.txt`) | LibreOffice `hunspell-id` | **LGPL-3.0-only** | Full text in `LGPL-3.0.txt`. Kept as separate runtime files. |
| English word list (`dict/en_words.txt`) | SCOWL 2020.12.07 (size 50, US + GB) | **SCOWL / BSD-like permissive** | Full copyright/licence in `SCOWL-LICENSE.txt`. |
| Hand-curated Indonesian vocab (`vocab/*.txt`, `vocab/institutions_id.tsv`) | Sympony contributors | **MIT** | Generic terms, not derived from evaluation datasets. |
| Zipformer2-id streaming int8 model | `spacewave/sherpa-onnx-streaming-zipformer2-id` | **MIT** | Downloaded on demand into `~/.sympony/models/`. |
| Qwen3-ASR 0.6B / 1.7B weights | Qwen / `handy-computer/Qwen3-ASR-*-gguf` | **Apache-2.0** | Downloaded on demand into `~/.sympony/models/`. |
| `transcribe-cpp` / ggml runtime | transcribe.cpp | **MIT** | Built & linked by Cargo. |
| `sherpa-onnx` / `onnxruntime` | k2-fsa/sherpa-onnx & Microsoft onnxruntime | **Apache-2.0** / **MIT** | Streaming ASR runtime. |
