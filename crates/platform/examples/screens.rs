//! Prints every display and its camera notch: `cargo run -p platform --example screens` (macOS: it reads AppKit's
//! screens too).
#[cfg(target_os = "macos")]
fn main() {
    let mtm = objc2::MainThreadMarker::new().unwrap();
    for d in platform::macos::displays::displays(mtm) {
        println!("{d:?}");
    }
    for s in objc2_app_kit::NSScreen::screens(mtm).iter() {
        println!("frame {:?} left {:?} right {:?} inset {}", s.frame(), s.auxiliaryTopLeftArea(), s.auxiliaryTopRightArea(), s.safeAreaInsets().top);
    }
}

#[cfg(not(target_os = "macos"))]
fn main() {
    let mtm = platform::os::MainThreadMarker::new().unwrap();
    for d in platform::os::displays::displays(mtm) {
        println!("{d:?}");
    }
}
