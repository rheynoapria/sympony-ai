use std::path::{Path, PathBuf};

use voice::engine::{read_wav_16k, Engine, Hints, Lang, StreamEngine};
use voice::engine_local::{LocalQwen, LocalZipformer};

fn find_fixture() -> (PathBuf, String) {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let tsv = manifest_dir.join("eval/test.tsv");
    let raw = std::fs::read_to_string(&tsv).expect("read eval/test.tsv");
    let line = raw
        .lines()
        .filter(|l| !l.trim().is_empty() && !l.starts_with('#'))
        .nth(3) // header + 3rd row (t002)
        .expect("t002 row in eval/test.tsv");
    let mut cols = line.split('\t');
    let id = cols.next().expect("id col").trim();
    let _src = cols.next();
    let reference = cols.next().expect("ref col").trim().to_string();
    let fname = format!("{id}.wav");

    let cache_path = manifest_dir.join("eval/.cache/test").join(&fname);
    if cache_path.exists() {
        return (cache_path, reference);
    }
    panic!("FLEURS fixture {fname} not found in eval/.cache/test (run crates/voice/eval/fetch.sh)");
}

fn simple_wer(reference: &str, hyp: &str) -> f64 {
    let norm = |s: &str| -> Vec<String> {
        s.to_lowercase()
            .chars()
            .map(|c| if c.is_alphanumeric() || c.is_whitespace() { c } else { ' ' })
            .collect::<String>()
            .split_whitespace()
            .map(str::to_string)
            .collect()
    };
    let r = norm(reference);
    let h = norm(hyp);
    let mut prev: Vec<usize> = (0..=h.len()).collect();
    let mut cur = vec![0usize; h.len() + 1];
    for (i, rw) in r.iter().enumerate() {
        cur[0] = i + 1;
        for (j, hw) in h.iter().enumerate() {
            let cost = usize::from(rw != hw);
            cur[j + 1] = (prev[j + 1] + 1).min(cur[j] + 1).min(prev[j] + cost);
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev[h.len()] as f64 / r.len().max(1) as f64
}

fn find_zipformer_dir() -> PathBuf {
    let p = voice::models::path("zf-id");
    if p.join("tokens.txt").exists() {
        return p;
    }
    let spike = PathBuf::from("/tmp/sympony-stt-spike/models/zipformer2-id");
    if spike.join("tokens.txt").exists() {
        return spike;
    }
    panic!("Zipformer2-id model not found");
}

fn find_qwen_model() -> PathBuf {
    let p = voice::models::path("0.6b");
    if p.exists() {
        return p;
    }
    let spike = PathBuf::from("/tmp/sympony-stt-spike/models/Qwen3-ASR-0.6B-Q4_K_M.gguf");
    if spike.exists() {
        return spike;
    }
    panic!("Qwen3-ASR-0.6B model not found");
}

#[test]
#[ignore]
fn local_zipformer_streams_fixture() {
    let (wav_path, reference) = find_fixture();
    let pcm = read_wav_16k(&wav_path).expect("read wav");
    let engine = LocalZipformer::load(&find_zipformer_dir(), 4).expect("load zipformer");
    let mut stream = engine.start();

    let mut prev_words: Vec<String> = Vec::new();
    for chunk in pcm.chunks(1600) {
        // 100 ms chunks at 16 kHz.
        stream.accept(chunk);
        let p = stream.partial();
        let words: Vec<String> = p.split_whitespace().map(|w| w.to_lowercase()).collect();
        // Earlier words (all except the last word) must grow monotonically.
        if prev_words.len() >= 2 && words.len() >= prev_words.len() - 1 {
            let stable_len = prev_words.len() - 1;
            assert_eq!(
                &words[..stable_len],
                &prev_words[..stable_len],
                "non-monotonic earlier words: prev={prev_words:?} cur={words:?}"
            );
        }
        if !words.is_empty() {
            prev_words = words;
        }
    }
    let final_text = stream.finish();
    let err = simple_wer(&reference, &final_text);
    assert!(
        err < 0.3,
        "Zipformer WER {err:.3} >= 0.3 (ref={reference:?}, hyp={final_text:?})"
    );
}

#[test]
#[ignore]
fn local_qwen_transcribes_fixture() {
    let (wav_path, reference) = find_fixture();
    let pcm = read_wav_16k(&wav_path).expect("read wav");
    let engine = LocalQwen::load(&find_qwen_model(), 4, 2048).expect("load qwen");
    let hints = Hints {
        language: Lang::Id,
        terms: Vec::new(),
    };
    let out = engine.transcribe(&pcm, &hints).expect("transcribe");
    let err = simple_wer(&reference, &out.text);
    assert!(
        err < 0.3,
        "Qwen WER {err:.3} >= 0.3 (ref={reference:?}, hyp={:?})",
        out.text
    );
}

#[test]
#[ignore]
fn hybrid_dictation_number_url_loanword() {
    let wav = PathBuf::from("/tmp/sympony-live-check/dictation.wav");
    assert!(wav.exists(), "generate {wav:?} first");
    let pcm = read_wav_16k(&wav).expect("read wav");

    assert!(voice::models::is_downloaded("zf-id"), "zf-id downloaded");
    assert!(voice::models::is_downloaded("0.6b"), "0.6b downloaded");

    let zf = LocalZipformer::load(&find_zipformer_dir(), 4).expect("load zf");
    let mut stream = zf.start();
    let mut first_partial_ms: Option<usize> = None;
    let mut last_partial = String::new();
    for (idx, chunk) in pcm.chunks(1600).enumerate() {
        stream.accept(chunk);
        let p = stream.partial();
        if !p.is_empty() {
            if first_partial_ms.is_none() {
                first_partial_ms = Some((idx + 1) * 100);
            }
            last_partial = p;
        }
    }
    let zf_final = stream.finish();

    let qwen = LocalQwen::load(&find_qwen_model(), 4, 2048).expect("load qwen");
    let raw = qwen
        .transcribe(
            &pcm,
            &Hints {
                language: Lang::Id,
                terms: vec!["invoice".into(), "google.com".into()],
            },
        )
        .expect("qwen transcribe");

    let data_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("data");
    let vocab = voice::vocab::Vocab::load(&data_dir);
    let dict = voice::dictionary::UserDict::default();
    let pipe = voice::pipeline::Pipeline {
        vocab: &vocab,
        dict: &dict,
        norm: voice::normalize::NormOptions::user_default(),
    };
    let cleaned = pipe.run(&raw.text);

    let zf_cleaned = pipe.run(&zf_final);
    println!(
        "LIVE HYBRID:\n  first_partial_ms = {:?}\n  zf_last_partial  = {:?}\n  zf_final         = {:?}\n  zf_pipeline_out  = {:?}\n  qwen_raw         = {:?}\n  pipeline_out     = {:?}\n  corrections      = {:?}",
        first_partial_ms, last_partial, zf_final, zf_cleaned.text, raw.text, cleaned.text, cleaned.corrections
    );
    assert!(first_partial_ms.is_some(), "expected live partials from Zipformer");
    let low = cleaned.text.to_lowercase();
    assert!(low.contains("invoice"), "expected loanword 'invoice' in {:?}", cleaned.text);
    assert!(low.contains("25.000") || low.contains("25000"), "expected number in {:?}", cleaned.text);
    assert!(
        low.contains("google.com") || zf_cleaned.text.to_lowercase().contains("google.com"),
        "expected URL 'google.com' in qwen={:?} or zf={:?}",
        cleaned.text,
        zf_cleaned.text
    );
}
