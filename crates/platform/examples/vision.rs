//! Eyes' vision mode on Windows: `cargo run -p platform --example vision -- <pid> [picture.jpg]` takes a picture of
//! the app's window as Eyes does, prints its size and how many lines of text Windows reads in it (with the first
//! few), and saves the JPEG the AI would get when a path is given. Reads only.
#[cfg(windows)]
fn main() {
    use windows_sys::Win32::UI::HiDpi::{SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2};
    // (pixels as Sympony sees them: it is per-monitor aware)
    // SAFETY: a process-wide setting, before any window is touched
    unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let args: Vec<String> = std::env::args().skip(1).collect();
    let pid: i32 = args.first().and_then(|p| p.parse().ok()).expect("vision <pid> [picture.jpg]");
    let win = platform::ax::window(pid).expect("the app has no window");
    let id = platform::ax::window_id_matching(pid, win.frame()).expect("the window isn't on screen");
    let t0 = std::time::Instant::now();
    let pic = platform::os::vision::window(id).expect("picture");
    println!("picture {}×{} at {:?} of the window, {} ms", pic.width, pic.height, pic.within, t0.elapsed().as_millis());
    let t1 = std::time::Instant::now();
    let jpeg = platform::os::vision::jpeg(&pic, 1280).expect("jpeg");
    println!("jpeg {} KB, {} ms", jpeg.len() / 1024, t1.elapsed().as_millis());
    if let Some(path) = args.get(1) {
        std::fs::write(path, &jpeg).expect("save");
    }
    let t2 = std::time::Instant::now();
    match platform::os::vision::text(&pic) {
        Ok(lines) => {
            println!("{} lines of text, {} ms", lines.len(), t2.elapsed().as_millis());
            for (t, x, y, w, h) in lines.iter().take(8) {
                println!("  {:?} at ({x:.3}, {y:.3}) {w:.3}×{h:.3}", t.chars().take(50).collect::<String>());
            }
        }
        Err(e) => println!("text: {e}"),
    }
}

#[cfg(not(windows))]
fn main() {}
