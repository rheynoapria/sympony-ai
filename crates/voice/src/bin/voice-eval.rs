//! `voice-eval` — Indonesian ASR evaluation, ablation, RTF, and 8 GB footprint harness.
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use serde_json::{json, Value};
use voice::dictionary::UserDict;
use voice::engine::{read_wav_16k, Engine, Hints, Lang, StreamEngine};
use voice::engine_local::{LocalQwen, LocalZipformer};
use voice::models;
use voice::normalize::{normalize, rule_groups, NormOptions};
use voice::pipeline::{prompt_terms, Pipeline};
use voice::postcorrect::PostcorrectIndex;
use voice::vocab::Vocab;
use voice::wer::{eval_normalize, wer};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EngineMode {
    Qwen,
    Zipformer,
    Hybrid,
}

struct Args {
    set: String,
    tier: String,
    threads: usize,
    cpu_only: bool,
    no_pipeline: bool,
    ablate: Option<String>,
    jargon: bool,
    engine: EngineMode,
    limit: Option<usize>,
    unload_zf_before_final: bool,
}

fn parse_args() -> Args {
    let mut a = Args {
        set: "test".into(),
        tier: "0.6b".into(),
        threads: 4,
        cpu_only: false,
        no_pipeline: false,
        ablate: None,
        jargon: false,
        engine: EngineMode::Qwen,
        limit: None,
        unload_zf_before_final: false,
    };
    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--set" => a.set = it.next().expect("--set needs value"),
            "--tier" => a.tier = it.next().expect("--tier needs value"),
            "--threads" => {
                a.threads = it
                    .next()
                    .expect("--threads needs value")
                    .parse()
                    .expect("invalid --threads");
            }
            "--backend" => {
                let v = it.next().expect("--backend needs value");
                a.cpu_only = v.eq_ignore_ascii_case("cpu");
            }
            "--no-pipeline" => a.no_pipeline = true,
            "--ablate" => a.ablate = Some(it.next().expect("--ablate needs value")),
            "--jargon" => a.jargon = true,
            "--engine" => {
                let v = it.next().expect("--engine needs value");
                a.engine = match v.as_str() {
                    "qwen" => EngineMode::Qwen,
                    "zipformer" => EngineMode::Zipformer,
                    "hybrid" => EngineMode::Hybrid,
                    other => panic!("unknown --engine {other}"),
                };
            }
            "--limit" => {
                a.limit = Some(
                    it.next()
                        .expect("--limit needs value")
                        .parse()
                        .expect("invalid --limit"),
                );
            }
            "--unload-zf-before-final" => a.unload_zf_before_final = true,
            other => panic!("unknown flag: {other}"),
        }
    }
    a
}

#[cfg(target_os = "macos")]
fn peak_phys_footprint_bytes() -> u64 {
    extern "C" {
        fn proc_pid_rusage(
            pid: libc::c_int,
            flavor: libc::c_int,
            buffer: *mut libc::rusage_info_v4,
        ) -> libc::c_int;
    }
    unsafe {
        let mut info: libc::rusage_info_v4 = std::mem::zeroed();
        let rc = proc_pid_rusage(libc::getpid(), libc::RUSAGE_INFO_V4, &mut info);
        if rc == 0 {
            info.ri_lifetime_max_phys_footprint.max(info.ri_phys_footprint)
        } else {
            0
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn peak_phys_footprint_bytes() -> u64 {
    0
}

fn resolve_qwen_model(tier: &str) -> PathBuf {
    let p = models::path(tier);
    if p.exists() {
        return p;
    }
    let fname = match tier {
        "1.7b" => "Qwen3-ASR-1.7B-Q4_K_M.gguf",
        _ => "Qwen3-ASR-0.6B-Q4_K_M.gguf",
    };
    let spike = PathBuf::from("/tmp/sympony-stt-spike/models").join(fname);
    if spike.exists() {
        return spike;
    }
    panic!("Qwen model ({tier}) not found at {} or {}", p.display(), spike.display());
}

fn resolve_zipformer_dir() -> PathBuf {
    let p = models::path("zf-id");
    if p.join("tokens.txt").exists() {
        return p;
    }
    let spike = PathBuf::from("/tmp/sympony-stt-spike/models/zipformer2-id");
    if spike.join("tokens.txt").exists() {
        return spike;
    }
    panic!(
        "Zipformer model not found at {} or {}",
        p.display(),
        spike.display()
    );
}

fn dir_or_file_size(p: &Path) -> u64 {
    if p.is_file() {
        fs::metadata(p).map(|m| m.len()).unwrap_or(0)
    } else if p.is_dir() {
        fs::read_dir(p)
            .ok()
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|e| e.metadata().ok())
            .filter(|m| m.is_file())
            .map(|m| m.len())
            .sum()
    } else {
        0
    }
}

struct Row {
    id: String,
    reference: String,
    wav_path: PathBuf,
}

fn load_set(eval_dir: &Path, set: &str, limit: Option<usize>) -> Vec<Row> {
    let tsv = eval_dir.join(format!("{set}.tsv"));
    let raw = fs::read_to_string(&tsv)
        .unwrap_or_else(|e| panic!("failed to read {}: {e}", tsv.display()));
    let cache_dir = eval_dir.join(".cache").join(set);
    let spike_dir = PathBuf::from("/tmp/sympony-stt-spike/data").join(if set == "sanity" {
        "fleurs"
    } else {
        set
    });

    let mut rows = Vec::new();
    for line in raw.lines().skip(1) {
        if line.trim().is_empty() {
            continue;
        }
        let mut parts = line.splitn(3, '\t');
        let id = parts.next().unwrap_or("").trim().to_string();
        let _fleurs_file = parts.next().unwrap_or("").trim();
        let reference = parts.next().unwrap_or("").trim().to_string();
        if id.is_empty() || reference.is_empty() {
            continue;
        }
        let mut wav_path = cache_dir.join(format!("{id}.wav"));
        if !wav_path.exists() {
            let alt = spike_dir.join(format!("{id}.wav"));
            if alt.exists() {
                wav_path = alt;
            }
        }
        rows.push(Row {
            id,
            reference,
            wav_path,
        });
        if let Some(lim) = limit {
            if rows.len() >= lim {
                break;
            }
        }
    }
    rows
}

fn score_corpus(pairs: &[(&str, &str)]) -> (f64, usize, usize) {
    let mut edits = 0usize;
    let mut words = 0usize;
    for &(r, h) in pairs {
        let (e, n) = wer(r, h);
        edits += e;
        words += n;
    }
    let pct = if words > 0 {
        100.0 * edits as f64 / words as f64
    } else {
        0.0
    };
    (pct, edits, words)
}

fn main() {
    let args = parse_args();
    let crate_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let data_dir = crate_dir.join("data");
    let eval_dir = crate_dir.join("eval");

    let vocab = Vocab::load(&data_dir);
    assert!(
        vocab.missing.is_empty(),
        "missing vocab files: {:?}",
        vocab.missing
    );
    let dict = UserDict::default();
    let rows = load_set(&eval_dir, &args.set, args.limit);
    assert!(!rows.is_empty(), "eval set '{}' has 0 rows", args.set);

    let terms = prompt_terms(&vocab, &dict, args.jargon, 150);
    let hints = Hints {
        language: Lang::Id,
        terms,
    };

    let mut mapped_model_bytes = 0u64;
    let mut raw_outputs: Vec<(String, String, String)> = Vec::with_capacity(rows.len());
    let mut total_audio_s = 0.0f64;
    let mut total_compute_s = 0.0f64;

    // Hybrid streaming metrics
    let mut first_partial_ms_list: Vec<f64> = Vec::new();
    let mut total_revisions = 0usize;
    let mut total_partial_updates = 0usize;

    match args.engine {
        EngineMode::Qwen => {
            let model_path = resolve_qwen_model(&args.tier);
            mapped_model_bytes = dir_or_file_size(&model_path);
            let qwen = LocalQwen::load_with_backend(&model_path, args.threads, 2048, args.cpu_only)
                .expect("load LocalQwen");
            eprintln!(
                "Loaded {} (backend={}, threads={})",
                qwen.info().name,
                qwen.info().backend,
                args.threads
            );
            for row in &rows {
                let pcm = read_wav_16k(&row.wav_path).unwrap_or_else(|e| {
                    panic!("read {}: {e}", row.wav_path.display())
                });
                total_audio_s += pcm.len() as f64 / 16_000.0;
                let t0 = Instant::now();
                let hyp = match qwen.transcribe(&pcm, &hints) {
                    Ok(t) => t.text,
                    Err(_) => String::new(),
                };
                total_compute_s += t0.elapsed().as_secs_f64();
                raw_outputs.push((row.id.clone(), row.reference.clone(), hyp));
            }
        }
        EngineMode::Zipformer => {
            let zf_dir = resolve_zipformer_dir();
            // Zipformer loads via ONNX Runtime (not mmap of a single large GGUF; memory is in phys_footprint).
            let zf = LocalZipformer::load(&zf_dir, args.threads).expect("load LocalZipformer");
            eprintln!(
                "Loaded {} (threads={})",
                zf.info().name,
                args.threads
            );
            for row in &rows {
                let pcm = read_wav_16k(&row.wav_path).unwrap_or_else(|e| {
                    panic!("read {}: {e}", row.wav_path.display())
                });
                total_audio_s += pcm.len() as f64 / 16_000.0;
                let t0 = Instant::now();
                let hyp = match zf.transcribe(&pcm, &hints) {
                    Ok(t) => t.text,
                    Err(_) => String::new(),
                };
                total_compute_s += t0.elapsed().as_secs_f64();
                raw_outputs.push((row.id.clone(), row.reference.clone(), hyp));
            }
        }
        EngineMode::Hybrid => {
            let zf_dir = resolve_zipformer_dir();
            let model_path = resolve_qwen_model(&args.tier);
            mapped_model_bytes = dir_or_file_size(&model_path);

            let mut zf_opt = Some(LocalZipformer::load(&zf_dir, 2).expect("load LocalZipformer"));
            let mut qwen_opt = if args.unload_zf_before_final {
                None
            } else {
                Some(
                    LocalQwen::load_with_backend(&model_path, args.threads, 2048, args.cpu_only)
                        .expect("load LocalQwen"),
                )
            };

            for row in &rows {
                let pcm = read_wav_16k(&row.wav_path).unwrap_or_else(|e| {
                    panic!("read {}: {e}", row.wav_path.display())
                });
                total_audio_s += pcm.len() as f64 / 16_000.0;

                // 1. Stream 100 ms chunks through Zipformer
                if zf_opt.is_none() {
                    zf_opt = Some(LocalZipformer::load(&zf_dir, 2).expect("reload LocalZipformer"));
                }
                let t_stream_start = Instant::now();
                let mut stream = zf_opt.as_ref().unwrap().start();
                let mut got_first = false;
                let mut prev_words: Vec<String> = Vec::new();
                for (ci, chunk) in pcm.chunks(1600).enumerate() {
                    stream.accept(chunk);
                    let p = stream.partial();
                    let words: Vec<String> =
                        p.split_whitespace().map(|w| w.to_lowercase()).collect();
                    if !words.is_empty() {
                        if !got_first {
                            got_first = true;
                            // Audio position + compute overhead at first partial.
                            let audio_ms = (ci + 1) as f64 * 100.0;
                            let compute_ms = t_stream_start.elapsed().as_secs_f64() * 1000.0;
                            first_partial_ms_list.push(audio_ms + compute_ms);
                        }
                        if prev_words.len() >= 2 {
                            let stable = prev_words.len() - 1;
                            if words.len() < stable || words[..stable] != prev_words[..stable] {
                                total_revisions += 1;
                            }
                        }
                        if words != prev_words {
                            total_partial_updates += 1;
                            prev_words = words;
                        }
                    }
                }
                let _zf_final = stream.finish();
                let stream_s = t_stream_start.elapsed().as_secs_f64();

                if args.unload_zf_before_final {
                    zf_opt = None;
                }
                if qwen_opt.is_none() {
                    qwen_opt = Some(
                        LocalQwen::load_with_backend(
                            &model_path,
                            args.threads,
                            2048,
                            args.cpu_only,
                        )
                        .expect("load LocalQwen"),
                    );
                }

                // 2. Finalize with Qwen
                let t0 = Instant::now();
                let hyp = match qwen_opt.as_ref().unwrap().transcribe(&pcm, &hints) {
                    Ok(t) => t.text,
                    Err(_) => String::new(),
                };
                let qwen_s = t0.elapsed().as_secs_f64();
                total_compute_s += stream_s + qwen_s;
                raw_outputs.push((row.id.clone(), row.reference.clone(), hyp));
            }
        }
    }

    let rtf = if total_audio_s > 0.0 {
        total_compute_s / total_audio_s
    } else {
        0.0
    };
    let peak_phys_bytes = peak_phys_footprint_bytes();
    let total_mem_bytes = peak_phys_bytes + mapped_model_bytes;

    // Score raw WER.
    let raw_pairs: Vec<(&str, &str)> = raw_outputs
        .iter()
        .map(|(_, r, h)| (r.as_str(), h.as_str()))
        .collect();
    let (raw_wer, raw_edits, ref_words) = score_corpus(&raw_pairs);

    // Score pipeline WER (eval profile) + post-correction audit.
    let pc_idx = PostcorrectIndex::build(&vocab, &[]);
    let eval_norm = NormOptions::eval_profile();
    let mut pc_good = 0usize;
    let mut pc_bad = 0usize;
    let mut pc_neutral = 0usize;
    let mut pc_good_ex: Vec<(String, String)> = Vec::new();
    let mut pc_bad_ex: Vec<(String, String)> = Vec::new();

    let pipe_hyps: Vec<String> = if args.no_pipeline {
        raw_outputs.iter().map(|(_, _, h)| h.clone()).collect()
    } else {
        let pipe = Pipeline {
            vocab: &vocab,
            dict: &dict,
            norm: eval_norm.clone(),
        };
        raw_outputs
            .iter()
            .map(|(_, reference, raw)| {
                let (pc_text, corrs) = pc_idx.correct(raw, &vocab);
                let ref_set: HashSet<String> = eval_normalize(reference).into_iter().collect();
                for c in &corrs {
                    let tw = eval_normalize(&c.to);
                    let sw = eval_normalize(&c.from);
                    let target_in_ref = !tw.is_empty() && tw.iter().all(|w| ref_set.contains(w));
                    let surface_in_ref = !sw.is_empty() && sw.iter().all(|w| ref_set.contains(w));
                    if target_in_ref && !surface_in_ref {
                        pc_good += 1;
                        pc_good_ex.push((c.from.clone(), c.to.clone()));
                    } else if !target_in_ref {
                        pc_bad += 1;
                        pc_bad_ex.push((c.from.clone(), c.to.clone()));
                    } else {
                        pc_neutral += 1;
                    }
                }
                let _ = &pipe;
                normalize(&pc_text, &vocab, &eval_norm)
            })
            .collect()
    };

    let pipe_pairs: Vec<(&str, &str)> = raw_outputs
        .iter()
        .zip(pipe_hyps.iter())
        .map(|((_, r, _), h)| (r.as_str(), h.as_str()))
        .collect();
    let (pipe_wer, pipe_edits, _) = score_corpus(&pipe_pairs);

    // Optional ablation.
    let mut ablation_json = serde_json::Map::new();
    if let Some(ref ablate) = args.ablate {
        let pc_only: Vec<String> = raw_outputs
            .iter()
            .map(|(_, _, raw)| pc_idx.correct(raw, &vocab).0)
            .collect();

        let groups_to_test: Vec<&str> = if ablate == "all" {
            let mut g = vec!["postcorrect"];
            g.extend_from_slice(rule_groups());
            g
        } else {
            vec![ablate.as_str()]
        };

        println!("\nAblation (delta = pipeline_wer - without_group_wer; negative = group helps):");
        for grp in groups_to_test {
            let hyps: Vec<String> = if grp == "postcorrect" {
                raw_outputs
                    .iter()
                    .map(|(_, _, raw)| normalize(raw, &vocab, &eval_norm))
                    .collect()
            } else {
                let mut opts = eval_norm.clone();
                opts.disable_group(grp);
                pc_only
                    .iter()
                    .map(|pc| normalize(pc, &vocab, &opts))
                    .collect()
            };
            let pairs: Vec<(&str, &str)> = raw_outputs
                .iter()
                .zip(hyps.iter())
                .map(|((_, r, _), h)| (r.as_str(), h.as_str()))
                .collect();
            let (without_wer, _, _) = score_corpus(&pairs);
            let delta = pipe_wer - without_wer;
            println!(
                "  {grp:<14} without={without_wer:6.2}%  delta={delta:+6.2} pp"
            );
            ablation_json.insert(
                grp.to_string(),
                json!({
                    "without_wer": (without_wer * 100.0).round() / 100.0,
                    "delta_pp": (delta * 100.0).round() / 100.0,
                }),
            );
        }
    }

    let peak_phys_mb = peak_phys_bytes as f64 / (1024.0 * 1024.0);
    let mapped_mb = mapped_model_bytes as f64 / (1024.0 * 1024.0);
    let total_mem_mb = total_mem_bytes as f64 / (1024.0 * 1024.0);
    let avg_first_partial_ms = if first_partial_ms_list.is_empty() {
        0.0
    } else {
        first_partial_ms_list.iter().sum::<f64>() / first_partial_ms_list.len() as f64
    };

    println!("\n=== voice-eval summary ===");
    println!(
        "set={} engine={:?} tier={} backend={} threads={} n={} ref_words={}",
        args.set,
        args.engine,
        args.tier,
        if args.cpu_only { "cpu" } else { "auto" },
        args.threads,
        rows.len(),
        ref_words
    );
    println!("raw WER:      {raw_wer:.2}% ({raw_edits}/{ref_words})");
    println!("pipeline WER: {pipe_wer:.2}% ({pipe_edits}/{ref_words})");
    println!(
        "postcorrect:  good={pc_good} bad={pc_bad} neutral={pc_neutral}"
    );
    if !pc_good_ex.is_empty() {
        println!("  good: {:?}", &pc_good_ex[..pc_good_ex.len().min(10)]);
    }
    if !pc_bad_ex.is_empty() {
        println!("  bad:  {:?}", &pc_bad_ex[..pc_bad_ex.len().min(10)]);
    }
    println!(
        "RTF:          {rtf:.3} (compute={total_compute_s:.2}s audio={total_audio_s:.2}s)"
    );
    println!(
        "Memory:       peak_phys={peak_phys_mb:.1} MB + mapped_model={mapped_mb:.1} MB = {total_mem_mb:.1} MB (budget <= 1536 MB)"
    );
    if args.engine == EngineMode::Hybrid {
        println!(
            "Streaming:    avg_first_partial={avg_first_partial_ms:.0} ms  revisions={total_revisions}/{total_partial_updates}"
        );
    }

    let report = json!({
        "set": args.set,
        "engine": format!("{:?}", args.engine).to_lowercase(),
        "tier": args.tier,
        "backend": if args.cpu_only { "cpu" } else { "auto" },
        "threads": args.threads,
        "jargon": args.jargon,
        "n": rows.len(),
        "ref_words": ref_words,
        "raw_wer": raw_wer,
        "pipeline_wer": pipe_wer,
        "pc_good": pc_good,
        "pc_bad": pc_bad,
        "pc_neutral": pc_neutral,
        "pc_good_ex": pc_good_ex,
        "pc_bad_ex": pc_bad_ex,
        "rtf": rtf,
        "peak_phys_mb": peak_phys_mb,
        "mapped_model_mb": mapped_mb,
        "total_mem_mb": total_mem_mb,
        "avg_first_partial_ms": avg_first_partial_ms,
        "stream_revisions": total_revisions,
        "stream_updates": total_partial_updates,
        "ablation": Value::Object(ablation_json),
    });

    let out_dir = eval_dir.join(".cache");
    let _ = fs::create_dir_all(&out_dir);
    let out_file = out_dir.join(format!(
        "eval_{:?}_{}_{}_t{}.json",
        args.engine,
        args.set,
        if args.cpu_only { "cpu" } else { "auto" },
        args.threads
    ));
    let _ = fs::write(&out_file, serde_json::to_string_pretty(&report).unwrap());
    println!("Wrote {}", out_file.display());
}
