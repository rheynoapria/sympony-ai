//! Apps and the clipboard as Sympony sees them: `cargo run -p platform --example apps` prints the app in front and
//! the open ones; `-- icon <id or path> <out.png>` saves an app's or a file's icon; `-- name <id>` prints an app's
//! name; `-- clip` tells what's on the clipboard (its kind and size, not what it says).
use platform::os::{apps, files};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("icon") => {
            let (id, out) = (&args[1], &args[2]);
            let png = apps::icon_png(id, 64.0).or_else(|| files::icon_png(id, 64.0));
            match png {
                Some(b) => {
                    std::fs::write(out, &b).expect("write the icon");
                    println!("{id}: {} bytes -> {out}", b.len());
                }
                None => println!("{id}: no icon"),
            }
        }
        Some("name") => println!("{}: {:?}", args[1], apps::app_name(&args[1])),
        Some("clip") => {
            let what = match files::read_clip() {
                files::Clip::Skip => "kept out (private, or files)".to_string(),
                files::Clip::Text(t) => format!("text, {} characters", t.chars().count()),
                files::Clip::Image(png) => format!("a picture, {} bytes of PNG", png.len()),
                files::Clip::None => "nothing Sympony keeps".to_string(),
            };
            println!("clipboard #{}: {what}", files::change_count());
        }
        _ => {
            println!("in front: {:?} (pid {:?})", apps::frontmost(), apps::frontmost_pid());
            for (id, name) in apps::open_apps() {
                println!("open: {id} = {name} (pid {:?})", apps::pid_of(&id));
            }
        }
    }
}
