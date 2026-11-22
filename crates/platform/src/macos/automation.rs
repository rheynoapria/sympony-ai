//! macOS Automation (Apple Events) permission check & request via `AEDeterminePermissionToAutomateTarget`.
use std::ffi::c_void;

// Verified via clang against <CoreServices/CoreServices.h> on arm64 macOS:
// sizeof(AEDesc) == 12, offset(descriptorType) == 0, offset(dataHandle) == 4.
#[repr(C, packed(2))]
struct AEDesc {
    descriptor_type: u32,
    data_handle: *mut c_void,
}

const TYPE_APPLICATION_BUNDLE_ID: u32 = 0x6275_6e64; // 'bund'
const TYPE_WILD_CARD: u32 = 0x2a2a_2a2a; // '****'
const NO_ERR: i32 = 0;
const PROC_NOT_FOUND: i32 = -600;
const ERR_AE_EVENT_NOT_PERMITTED: i32 = -1743;
const ERR_AE_EVENT_WOULD_REQUIRE_USER_CONSENT: i32 = -1744;

#[link(name = "CoreServices", kind = "framework")]
unsafe extern "C" {
    fn AECreateDesc(type_code: u32, data_ptr: *const c_void, data_size: isize, result: *mut AEDesc) -> i16;
    fn AEDisposeDesc(the_ae_desc: *mut AEDesc) -> i16;
    fn AEDeterminePermissionToAutomateTarget(
        target: *const AEDesc,
        the_ae_event_class: u32,
        the_ae_event_id: u32,
        ask_user_if_needed: bool,
    ) -> i32;
}

/// Checks (or requests when `ask` is true) Automation permission for `bundle_id`.
/// Returns `"granted" | "denied" | "notAsked" | "notRunning"`.
/// Note: when `ask` is true, this call may block while macOS shows the consent dialog.
pub fn status(bundle_id: &str, ask: bool) -> &'static str {
    let bytes = bundle_id.as_bytes();
    let mut desc = AEDesc {
        descriptor_type: 0,
        data_handle: std::ptr::null_mut(),
    };
    let err = unsafe {
        AECreateDesc(
            TYPE_APPLICATION_BUNDLE_ID,
            bytes.as_ptr() as *const c_void,
            bytes.len() as isize,
            &mut desc,
        )
    };
    if err != 0 {
        return "notRunning";
    }
    let st = unsafe {
        AEDeterminePermissionToAutomateTarget(&desc, TYPE_WILD_CARD, TYPE_WILD_CARD, ask)
    };
    unsafe {
        let _ = AEDisposeDesc(&mut desc);
    }
    match st {
        NO_ERR => "granted",
        ERR_AE_EVENT_WOULD_REQUIRE_USER_CONSENT => "notAsked",
        ERR_AE_EVENT_NOT_PERMITTED => "denied",
        PROC_NOT_FOUND => "notRunning",
        _ => "denied",
    }
}
