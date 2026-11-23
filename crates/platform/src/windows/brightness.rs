//! The built-in screen's brightness (a laptop's), read and set through WMI's `root\wmi` WmiMonitorBrightness, where
//! Windows' own brightness slider sets it: Control's slider and the brightness HUD. As on macOS, where only a display
//! macOS can dim counts, an external monitor's (DDC/CI) isn't read.
//!
//! The watcher asks for the level every 200 ms, too often to ask WMI each time: the level is kept here, read once,
//! then updated by WMI's brightness events (the keys, Windows' slider, this one) and read again every 30 s.
use ::windows::core::{w, BSTR, PCWSTR};
use ::windows::Win32::System::Com::{CoCreateInstance, CoSetProxyBlanket, CLSCTX_INPROC_SERVER, EOAC_NONE, RPC_C_AUTHN_LEVEL_CALL, RPC_C_IMP_LEVEL_IMPERSONATE};
use ::windows::Win32::System::Variant::VARIANT;
use ::windows::Win32::System::Wmi::{
    IWbemClassObject, IWbemLocator, IWbemServices, WbemLocator, WBEM_FLAG_FORWARD_ONLY, WBEM_FLAG_RETURN_IMMEDIATELY, WBEM_GENERIC_FLAG_TYPE,
    WBEM_INFINITE,
};
use std::sync::{Mutex, Once};
use std::time::Duration;

/// The level last read; None while there's no screen Windows can dim.
static LEVEL: Mutex<Option<u8>> = Mutex::new(None);

/// 0-100; None without a screen Windows can dim (a desktop's monitors).
pub fn brightness() -> Option<u8> {
    static START: Once = Once::new();
    START.call_once(|| {
        *LEVEL.lock().unwrap() = connect().and_then(|s| read(&s));
        std::thread::spawn(watch);
    });
    *LEVEL.lock().unwrap()
}

pub fn set_brightness(level: u8) {
    let level = level.min(100);
    if connect().is_some_and(|s| set(&s, level).is_some()) {
        // (the event that follows has the level the screen took: some take steps of 10)
        *LEVEL.lock().unwrap() = Some(level);
    }
}

/// Keeps LEVEL up to date: each brightness event's level, and a fresh reading when none came for 30 s (the screen
/// went away or came back). Its own thread, for as long as Sympony runs.
fn watch() {
    loop {
        if let Some(s) = connect() {
            // SAFETY: WMI's COM calls on this thread's apartment (mta); each object is released when dropped
            unsafe {
                let query = s.ExecNotificationQuery(&BSTR::from("WQL"), &BSTR::from("SELECT * FROM WmiMonitorBrightnessEvent"), FORWARD, None);
                if let Ok(events) = query {
                    loop {
                        let (mut row, mut n) = ([None], 0);
                        if events.Next(30_000, &mut row, &mut n).is_err() {
                            break;
                        }
                        let event = row[0].take().filter(|_| n == 1);
                        *LEVEL.lock().unwrap() = event.and_then(|e| number(&e, w!("Brightness"))).or_else(|| read(&s));
                    }
                }
            }
        }
        std::thread::sleep(Duration::from_secs(30));
    }
}

const FORWARD: WBEM_GENERIC_FLAG_TYPE = WBEM_GENERIC_FLAG_TYPE(WBEM_FLAG_FORWARD_ONLY.0 | WBEM_FLAG_RETURN_IMMEDIATELY.0);

/// WMI's `root\wmi`, with the calls on it made as this user (WMI refuses them otherwise).
fn connect() -> Option<IWbemServices> {
    super::mta();
    // SAFETY: COM objects created on this thread's apartment (mta), released when dropped; the proxy's security is
    // set on the proxy itself
    unsafe {
        let locator: IWbemLocator = CoCreateInstance(&WbemLocator, None, CLSCTX_INPROC_SERVER).ok()?;
        let none = BSTR::new();
        let s = locator.ConnectServer(&BSTR::from(r"ROOT\WMI"), &none, &none, &none, 0, &none, None).ok()?;
        // (RPC_C_AUTHN_WINNT, RPC_C_AUTHZ_NONE)
        CoSetProxyBlanket(&s, 10, 0, PCWSTR::null(), RPC_C_AUTHN_LEVEL_CALL, RPC_C_IMP_LEVEL_IMPERSONATE, None, EOAC_NONE).ok()?;
        Some(s)
    }
}

/// The first object `wql` finds.
unsafe fn first(s: &IWbemServices, wql: &str) -> Option<IWbemClassObject> {
    let found = s.ExecQuery(&BSTR::from("WQL"), &BSTR::from(wql), FORWARD, None).ok()?;
    let (mut row, mut n) = ([None], 0);
    found.Next(WBEM_INFINITE, &mut row, &mut n).ok().ok()?;
    if n == 1 { row[0].take() } else { None }
}

unsafe fn number(o: &IWbemClassObject, name: PCWSTR) -> Option<u8> {
    let mut v = VARIANT::default();
    o.Get(name, 0, &mut v, None, None).ok()?;
    u32::try_from(&v).ok().map(|n| n.min(100) as u8)
}

fn read(s: &IWbemServices) -> Option<u8> {
    // SAFETY: as in `watch`
    unsafe { number(&first(s, "SELECT CurrentBrightness FROM WmiMonitorBrightness WHERE Active=TRUE")?, w!("CurrentBrightness")) }
}

/// WmiMonitorBrightnessMethods.WmiSetBrightness(Timeout 0, Brightness `level`) on the screen that has it.
fn set(s: &IWbemServices, level: u8) -> Option<()> {
    // SAFETY: as in `watch`; the out-pointers are this function's locals
    unsafe {
        let screen = first(s, "SELECT * FROM WmiMonitorBrightnessMethods WHERE Active=TRUE")?;
        let mut path = VARIANT::default();
        screen.Get(w!("__PATH"), 0, &mut path, None, None).ok()?;
        let path = BSTR::try_from(&path).ok()?;
        let mut class = None;
        s.GetObject(&BSTR::from("WmiMonitorBrightnessMethods"), WBEM_GENERIC_FLAG_TYPE(0), None, Some(&mut class), None).ok()?;
        let mut takes = None;
        class?.GetMethod(w!("WmiSetBrightness"), 0, &mut takes, std::ptr::null_mut()).ok()?;
        let args = takes?.SpawnInstance(0).ok()?;
        // (WMI passes a uint32 as VT_I4, a uint8 as VT_UI1)
        args.Put(w!("Timeout"), 0, &VARIANT::from(0i32), 0).ok()?;
        args.Put(w!("Brightness"), 0, &VARIANT::from(level), 0).ok()?;
        s.ExecMethod(&path, &BSTR::from("WmiSetBrightness"), WBEM_GENERIC_FLAG_TYPE(0), None, &args, None, None).ok()
    }
}
