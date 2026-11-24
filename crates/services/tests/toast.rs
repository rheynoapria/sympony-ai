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
