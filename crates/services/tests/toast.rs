//! Windows toasts (the payload in Windows' notification database) → notes.
use services::notif::parse_toast;

#[test]
fn a_browser_notification() {
    // (a site's notification as Chrome posts it: its texts, the site as the attribution, its launch argument)
    let xml = br#"<toast launch="--notification-launch-id=0|Default|0|https://example.com/|0|1"><visual><binding template="ToastGeneric"><text>New message</text><text hint-maxLines="2">Lunch at noon?</text><text placement="attribution">example.com</text><image placement="appLogoOverride" src="file:///C:/Temp/icon.png"/></binding></visual></toast>"#;
    let n = parse_toast(xml, "Chrome", 1_700_000_000_000).unwrap();
    assert_eq!((n.app_id.as_str(), n.title.as_str(), n.subtitle.as_str(), n.body.as_str()), ("Chrome", "New message", "example.com", "Lunch at noon?"));
    assert_eq!(n.launch, "--notification-launch-id=0|Default|0|https://example.com/|0|1");
    assert_eq!(n.at, 1_700_000_000_000);
}

#[test]
fn texts_after_the_title_are_the_body_a_line_each() {
    let xml = br#"<toast><visual><binding template="ToastText04"><text id="1">Title</text><text id="2">One</text><text id="3">Two</text></binding></visual></toast>"#;
    let n = parse_toast(xml, "App", 1).unwrap();
    assert_eq!((n.title.as_str(), n.body.as_str()), ("Title", "One\nTwo"));
}

#[test]
fn entities_and_character_references_are_read() {
    let xml = br#"<toast><visual><binding template="ToastGeneric"><text>Tom &amp; Jerry &lt;3</text><text>Caf&#233; &#x2615;</text></binding></visual></toast>"#;
    let n = parse_toast(xml, "App", 1).unwrap();
    assert_eq!((n.title.as_str(), n.body.as_str()), ("Tom & Jerry <3", "Café ☕"));
}

#[test]
fn only_the_first_binding_counts() {
    // (an app may give an old layout too)
    let xml = br#"<toast><visual><binding template="ToastGeneric"><text>New</text></binding><binding template="ToastText01"><text>Old</text></binding></visual></toast>"#;
    let n = parse_toast(xml, "App", 1).unwrap();
    assert_eq!((n.title.as_str(), n.body.as_str()), ("New", ""));
}

#[test]
fn not_a_toast() {
    assert!(parse_toast(b"<tile><visual/></tile>", "App", 1).is_none());
    assert!(parse_toast(b"not xml at all <", "App", 1).is_none());
    assert!(parse_toast(&[0xff, 0xfe, 0x00], "App", 1).is_none());
}

#[test]
fn the_picture_is_the_sender_s_then_an_inline_one_then_the_hero() {
    let toast = |images: &str| format!(r#"<toast><visual><binding template="ToastGeneric"><text>Hi</text>{images}</binding></visual></toast>"#);
    let pic = |images: &str| parse_toast(toast(images).as_bytes(), "App", 1).unwrap().picture;
    let (avatar, inline, hero) = (
        r#"<image placement="appLogoOverride" hint-crop="circle" src="file:///C:/a.png"/>"#,
        r#"<image src="file:///C:/i.png"/>"#,
        r#"<image placement="hero" src="file:///C:/h.png"/>"#,
    );
    assert_eq!(pic(&format!("{hero}{inline}{avatar}")), "file:///C:/a.png");
    assert_eq!(pic(&format!("{hero}{inline}")), "file:///C:/i.png");
    assert_eq!(pic(r#"<image placement="inline" src="file:///C:/i2.png"/>"#), "file:///C:/i2.png");
    assert_eq!(pic(hero), "file:///C:/h.png");
    assert_eq!(pic(""), "");
    // (only the first binding's, and one with no src is none)
    let xml = br#"<toast><visual><binding template="ToastGeneric"><text>New</text><image src=""/></binding><binding template="ToastImageAndText01"><image src="file:///C:/old.png"/><text>Old</text></binding></visual></toast>"#;
    assert_eq!(parse_toast(xml, "App", 1).unwrap().picture, "");
    // (entities in the src are read)
    assert_eq!(pic(r#"<image src="file:///C:/Tom&amp;Jerry.png"/>"#), "file:///C:/Tom&Jerry.png");
}

#[test]
fn a_picture_s_file_on_this_pc() {
    use services::notif::picture_file;
    use std::path::{Path, PathBuf};
    let local = Path::new("L");
    let file = |src: &str| picture_file(src, "App", local);
    // (as Telegram writes it: Windows' own separators, nothing escaped; and as a URI should be)
    assert_eq!(file(r"file:///C:\Users\a b\userpic+1.png"), Some(PathBuf::from(r"C:\Users\a b\userpic+1.png")));
    assert_eq!(file("file:///C:/Temp/My%20Pic%C3%A9.png"), Some(PathBuf::from(r"C:\Temp\My Picé.png")));
    assert_eq!(file("FILE:///d:/x.jpg"), Some(PathBuf::from(r"d:\x.jpg")));
    assert_eq!(file(r"C:\plain\path.png"), Some(PathBuf::from(r"C:\plain\path.png")));
    // a Store app's own folders
    let app = "Contoso.Chat_8wekyb3d8bbwe!App";
    let pkg = local.join("Packages").join("Contoso.Chat_8wekyb3d8bbwe");
    assert_eq!(picture_file("ms-appdata:///local/Images/a%20b.png", app, local), Some(pkg.join("LocalState").join("Images").join("a b.png")));
    assert_eq!(picture_file("ms-appdata:///roaming/p.png", app, local), Some(pkg.join("RoamingState").join("p.png")));
    assert_eq!(picture_file("ms-appdata:///temp/p.png", app, local), Some(pkg.join("TempState").join("p.png")));
    // never out of its folder, and only for a Store app
    assert_eq!(picture_file("ms-appdata:///local/../../x.png", app, local), None);
    assert_eq!(picture_file("ms-appdata:///local/a/%2E%2E/x.png", app, local), None);
    assert_eq!(picture_file("ms-appdata:///other/x.png", app, local), None);
    assert_eq!(file("ms-appdata:///local/x.png"), None);
    // not read: the network (a share would be asked for this account's sign-in), the web, an app's own files, nothing
    for src in [r"file://server/share/a.png", "file:////server/share/a.png", r"file:///\\server\share\a.png", r"\\server\share\a.png",
        "https://example.com/a.png", "ms-appx:///Assets/a.png", "a.png", "file:///", ""] {
        assert_eq!(file(src), None, "{src}");
    }
}

#[test]
fn the_telegram_hint_is_for_a_telegram_that_never_posted_a_windows_notification() {
    use services::notif::telegram_hint;
    let ids = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    assert!(telegram_hint(true, &ids(&["Microsoft.Windows.Explorer", "Chrome"])));
    assert!(telegram_hint(true, &[]));
    for id in ["Telegram.TelegramDesktop", "telegram.telegramdesktop", "Telegram.TelegramDesktop.Store",
        "TelegramMessengerLLP.TelegramDesktop_t4vj0pshhgkwm!Telegram.TelegramDesktop.Store"] {
        assert!(!telegram_hint(true, &ids(&["Chrome", id])), "{id}");
    }
    // (no Telegram here: nothing to say)
    assert!(!telegram_hint(false, &[]));
}
