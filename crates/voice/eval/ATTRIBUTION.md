# Evaluation Dataset Attribution

The evaluation manifests `dev.tsv`, `test.tsv`, and `sanity.tsv` reference audio utterances and transcriptions from:

- **Dataset:** FLEURS (`google/fleurs`), Indonesian split (`id_id`)
- **Paper:** Conneau et al., *FLEURS: Few-shot Learning Evaluation of Universal Representations of Speech*, IEEE SLT 2022
- **Licence:** Creative Commons Attribution 4.0 International (CC-BY-4.0)
- **URL:** https://huggingface.co/datasets/google/fleurs

Audio files are NOT committed to this repository; `fetch.sh` downloads only the listed utterances on demand into `crates/voice/eval/.cache/` (git-ignored).
