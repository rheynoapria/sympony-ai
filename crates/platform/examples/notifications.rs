//! Is the notification database readable from here: `cargo run -p platform --example notifications`.
fn main() {
    use platform::os::notifications::*;
    println!("{:?} max {:?}", db_path(), max_rowid());
}
