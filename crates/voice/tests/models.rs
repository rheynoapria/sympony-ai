use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;

use sha2::{Digest, Sha256};
use voice::engine::VoiceError;
use voice::models::{default_threads, download_file_resumable, offered, registry};

#[test]
fn offered_hides_17b_under_16gb() {
    let reg = registry();
    assert!(reg.iter().any(|m| m.id == "zf-id"));
    assert!(reg.iter().any(|m| m.id == "0.6b"));
    assert!(reg.iter().any(|m| m.id == "1.7b"));

    let ram_8g = 8 * 1024 * 1024 * 1024u64;
    let under = offered(ram_8g);
    assert!(under.iter().any(|m| m.id == "zf-id"));
    assert!(under.iter().any(|m| m.id == "0.6b"));
    assert!(
        !under.iter().any(|m| m.id == "1.7b"),
        "1.7b must not be offered under 16 GiB"
    );

    let ram_16g = 16 * 1024 * 1024 * 1024u64;
    let over = offered(ram_16g);
    assert!(over.iter().any(|m| m.id == "1.7b"));
}

#[test]
fn default_threads_cases() {
    assert_eq!(default_threads(2), 2);
    assert_eq!(default_threads(4), 3);
    assert_eq!(default_threads(10), 4);
    assert_eq!(default_threads(1), 2);
}

#[test]
fn download_resume_and_checksum() {
    // Prepare a deterministic payload (64 KiB).
    let payload: Vec<u8> = (0..65_536u32).map(|i| (i % 251) as u8).collect();
    let expected_sha = format!("{:x}", Sha256::digest(&payload));

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let payload_srv = Arc::new(payload.clone());
    let req_count = Arc::new(AtomicUsize::new(0));
    let req_count_srv = Arc::clone(&req_count);

    // Serve 3 requests:
    //   1) Full request -> intentionally truncate at half & close (simulates mid-download drop)
    //   2) Range request -> serve remainder with 206 Partial Content
    //   3) Full request -> serve full body (for bad-checksum test)
    let handle = thread::spawn(move || {
        for _ in 0..3 {
            let Ok((mut stream, _)) = listener.accept() else {
                break;
            };
            let mut buf = [0u8; 2048];
            let n = stream.read(&mut buf).unwrap_or(0);
            let req = String::from_utf8_lossy(&buf[..n]);
            let attempt = req_count_srv.fetch_add(1, Ordering::SeqCst);

            let range_start = req
                .lines()
                .find(|l| l.to_ascii_lowercase().starts_with("range:"))
                .and_then(|l| l.split('=').nth(1))
                .and_then(|r| r.split('-').next())
                .and_then(|s| s.trim().parse::<usize>().ok());

            let total = payload_srv.len();
            if attempt == 0 && range_start.is_none() {
                let half = total / 2;
                let hdr = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {total}\r\nAccept-Ranges: bytes\r\nConnection: close\r\n\r\n"
                );
                let _ = stream.write_all(hdr.as_bytes());
                let _ = stream.write_all(&payload_srv[..half]);
                let _ = stream.flush();
            } else if let Some(start) = range_start {
                let slice = &payload_srv[start..];
                let hdr = format!(
                    "HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {}-{}/{}\r\nConnection: close\r\n\r\n",
                    slice.len(),
                    start,
                    total - 1,
                    total
                );
                let _ = stream.write_all(hdr.as_bytes());
                let _ = stream.write_all(slice);
                let _ = stream.flush();
            } else {
                let hdr = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {total}\r\nConnection: close\r\n\r\n"
                );
                let _ = stream.write_all(hdr.as_bytes());
                let _ = stream.write_all(&payload_srv);
                let _ = stream.flush();
            }
        }
    });

    let tmp = tempfile::tempdir().unwrap();
    let dest = tmp.path().join("model.bin");
    let url = format!("http://{addr}/model.bin");
    let cancel = AtomicBool::new(false);

    // 1. First call gets interrupted halfway -> returns error and leaves `.part` on disk.
    let first = download_file_resumable(&url, &dest, &expected_sha, |_, _| {}, &cancel);
    assert!(first.is_err(), "truncated transfer must return an error");
    assert!(!dest.exists(), "final file must not exist after partial fail");
    let part = tmp.path().join("model.bin.part");
    assert!(part.exists(), ".part file should remain for resume");
    assert!(std::fs::metadata(&part).unwrap().len() > 0);

    // 2. Second call resumes via Range header and completes cleanly.
    let second = download_file_resumable(&url, &dest, &expected_sha, |_, _| {}, &cancel);
    assert!(second.is_ok(), "resumed download should succeed: {second:?}");
    assert_eq!(std::fs::read(&dest).unwrap(), payload);
    assert!(!part.exists(), ".part should be renamed into final path");

    // 3. Wrong checksum -> returns VoiceError::Checksum and leaves no file behind.
    let bad_dest = tmp.path().join("bad.bin");
    let bad_res = download_file_resumable(
        &url,
        &bad_dest,
        "0000000000000000000000000000000000000000000000000000000000000000",
        |_, _| {},
        &cancel,
    );
    assert_eq!(bad_res, Err(VoiceError::Checksum));
    assert!(!bad_dest.exists());
    assert!(!tmp.path().join("bad.bin.part").exists());

    let _ = handle.join();
}
