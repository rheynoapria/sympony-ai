//! The notification banners on screen now: `cargo run -p platform --example banners [close]`.
fn main() {
    use platform::os::banners::*;
    println!("trusted {}", trusted(false));
    for b in banners() {
        println!("{} | {:?} | {:?} {:?} {:?}", b.id, b.description, b.title, b.subtitle, b.body);
        if std::env::args().nth(1).as_deref() == Some("close") {
            println!("closed {}", close(&b));
        }
    }
}
