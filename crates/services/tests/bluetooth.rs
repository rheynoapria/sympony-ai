use services::bluetooth::kind;

#[test]
fn device_kinds() {
    // (major, minor) from the Bluetooth class of device; the frontend's icon names
    assert_eq!(kind(4, 6), ("headphones", true));
    assert_eq!(kind(4, 1), ("headphones", true));
    assert_eq!(kind(4, 5), ("speaker", true));
    assert_eq!(kind(5, 0x10), ("keyboard", false));
    assert_eq!(kind(5, 0x20), ("mouse", false));
    assert_eq!(kind(5, 0x02), ("gamepad", false));
    assert_eq!(kind(2, 3), ("phone", false));
    assert_eq!(kind(1, 3), ("computer", false));
    assert_eq!(kind(7, 1), ("watch", false));
    assert_eq!(kind(0, 0), ("device", false));
}

#[test]
fn connect_errors_in_words() {
    use services::bluetooth::connect_error;
    assert_eq!(connect_error(0xe00002d6u32 as i32), "The device isn’t nearby, or it’s off");
    assert!(connect_error(0x1234).contains("0x1234"));
}
