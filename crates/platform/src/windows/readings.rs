//! The System tab's readings on Windows and the battery: power, the CPU's times, memory, the system drive and the
//! network's byte counters, as Task Manager reads them. Reached as `system::…`, the names macOS has; where macOS
//! gives something Windows has no twin for (purgeable or compressed memory, pressure levels), the nearest reading
//! stands in, as each function says.
use serde_json::{json, Value};

/// `{hasBattery, level, pluggedIn, charging, saver, secondsLeft}` (the frontend's `power` message without its type).
pub fn power() -> Value {
    use windows_sys::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    let mut s: SYSTEM_POWER_STATUS = unsafe { std::mem::zeroed() };
    // SAFETY: a struct for Windows to fill, outliving the call
    if unsafe { GetSystemPowerStatus(&mut s) } == 0 {
        return json!({ "hasBattery": false, "level": 100, "pluggedIn": true, "charging": false, "saver": false });
    }
    // (BatteryFlag: 128 no battery, 255 unknown, 8 charging; SystemStatusFlag 1: battery saver)
    let has = s.BatteryFlag != 128 && s.BatteryFlag != 255 && s.BatteryLifePercent <= 100;
    let saver = s.SystemStatusFlag == 1;
    if !has {
        return json!({ "hasBattery": false, "level": 100, "pluggedIn": true, "charging": false, "saver": saver });
    }
    let plugged = s.ACLineStatus == 1;
    json!({
        "hasBattery": true, "level": s.BatteryLifePercent, "pluggedIn": plugged,
        "charging": s.BatteryFlag & 8 != 0, "saver": saver,
        "secondsLeft": if !plugged && s.BatteryLifeTime != u32::MAX { i64::from(s.BatteryLifeTime) } else { -1 },
    })
}

/// The CPU's time since boot, all cores together, as macOS' tick counters (user, system, idle, nice), in 10 ms steps:
/// the counters wrap at 32 bits and `services::stats::cpu_busy` takes their differences.
pub fn cpu_ticks() -> Option<[u32; 4]> {
    use windows_sys::Win32::Foundation::FILETIME;
    use windows_sys::Win32::System::Threading::GetSystemTimes;
    let (mut idle, mut kernel, mut user) = (FILETIME::default(), FILETIME::default(), FILETIME::default());
    // SAFETY: three FILETIMEs for Windows to fill, outliving the call
    if unsafe { GetSystemTimes(&mut idle, &mut kernel, &mut user) } == 0 {
        return None;
    }
    let t = |f: FILETIME| (u64::from(f.dwHighDateTime) << 32 | u64::from(f.dwLowDateTime)) / 100_000;
    // (kernel time counts the idle time too)
    let (idle, kernel, user) = (t(idle), t(kernel), t(user));
    Some([user as u32, kernel.saturating_sub(idle) as u32, idle as u32, 0])
}

/// The processor's name, e.g. "11th Gen Intel(R) Core(TM) i5-1135G7 @ 2.40GHz".
pub fn cpu_model() -> String {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};
    let key = super::shell::wide(r"HARDWARE\DESCRIPTION\System\CentralProcessor\0");
    let name = super::shell::wide("ProcessorNameString");
    let (mut buf, mut size) = ([0u16; 256], 512u32);
    // SAFETY: NUL-terminated names and a buffer with its size in bytes, all outliving the call
    let read = unsafe { RegGetValueW(HKEY_LOCAL_MACHINE, key.as_ptr(), name.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut size) };
    if read != 0 {
        return String::new();
    }
    let n = buf.iter().position(|c| *c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..n]).trim().to_string()
}

/// Total memory and what's in use, in macOS' shape: (total, [page size, internal, purgeable, wired, compressed]),
/// here in bytes (page size 1). In use is Task Manager's (total less available); "wired" is the kernel's memory that
/// can't be paged out (its non-paged pool), the rest is the apps'. Windows' compressed memory has no public reading.
pub fn memory() -> Option<(u64, [u64; 5])> {
    let m = status()?;
    let used = m.ullTotalPhys.saturating_sub(m.ullAvailPhys);
    let wired = performance().map_or(0, |p| (p.KernelNonpaged as u64).saturating_mul(p.PageSize as u64));
    Some((m.ullTotalPhys, [1, used.saturating_sub(wired), 0, wired, 0]))
}

/// A pressure level in macOS' numbers (1 normal, 2 warn, 4 critical), from how full memory is: Windows has no
/// levels of its own. Past 85% it pages more, past 95% apps slow down.
pub fn memory_pressure() -> Option<u32> {
    let load = status()?.dwMemoryLoad;
    Some(match load {
        0..85 => 1,
        85..95 => 2,
        _ => 4,
    })
}

/// The memory installed, in bytes, as the firmware lists it (what macOS' hw.memsize gives): a 16 GB PC reads 16 GB,
/// where `memory`'s total is what Windows can use, a little less once hardware has its part. Falls back to that.
pub fn installed_memory() -> Option<u64> {
    use windows_sys::Win32::System::SystemInformation::GetPhysicallyInstalledSystemMemory;
    let mut kb = 0u64;
    // SAFETY: a u64 for Windows to fill
    if unsafe { GetPhysicallyInstalledSystemMemory(&mut kb) } != 0 && kb > 0 {
        return Some(kb.saturating_mul(1024));
    }
    status().map(|m| m.ullTotalPhys)
}

fn status() -> Option<windows_sys::Win32::System::SystemInformation::MEMORYSTATUSEX> {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    let mut m: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
    m.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
    // SAFETY: a struct whose dwLength says its size, for Windows to fill
    (unsafe { GlobalMemoryStatusEx(&mut m) } != 0).then_some(m)
}

fn performance() -> Option<windows_sys::Win32::System::ProcessStatus::PERFORMANCE_INFORMATION> {
    use windows_sys::Win32::System::ProcessStatus::{GetPerformanceInfo, PERFORMANCE_INFORMATION};
    let mut p: PERFORMANCE_INFORMATION = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<PERFORMANCE_INFORMATION>() as u32;
    p.cb = size;
    // SAFETY: a struct with its size, for Windows to fill
    (unsafe { GetPerformanceInfo(&mut p, size) } != 0).then_some(p)
}

/// The system drive's root ("C:\").
fn system_drive() -> Vec<u16> {
    let drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into());
    super::shell::wide(&format!("{}\\", drive.trim_end_matches('\\')))
}

/// (total, free) bytes of the system drive (free as this user may use it).
pub fn disk() -> Option<(u64, u64)> {
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let (mut free, mut total, mut all_free) = (0u64, 0u64, 0u64);
    // SAFETY: a NUL-terminated root and three counters, all outliving the call
    (unsafe { GetDiskFreeSpaceExW(system_drive().as_ptr(), &mut free, &mut total, &mut all_free) } != 0).then_some((total, free))
}

/// The system drive as Explorer names it: its label (or "Local Disk") and letter, e.g. "Windows (C:)".
pub fn disk_name() -> Option<String> {
    use windows_sys::Win32::Storage::FileSystem::GetVolumeInformationW;
    let root = system_drive();
    let mut label = [0u16; 261];
    // SAFETY: a NUL-terminated root and a buffer with its length; the other answers aren't asked for
    let ok = unsafe {
        GetVolumeInformationW(root.as_ptr(), label.as_mut_ptr(), label.len() as u32, std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut(), 0)
    } != 0;
    let n = label.iter().position(|c| *c == 0).unwrap_or(0);
    let label = if ok { String::from_utf16_lossy(&label[..n]).trim().to_string() } else { String::new() };
    let letter = String::from_utf16_lossy(&root[..2]);
    Some(format!("{} ({letter})", if label.is_empty() { "Local Disk" } else { label.as_str() }))
}

/// Bytes received and sent since boot over the network adapters (Wi-Fi and Ethernet, not virtual ones), and
/// whether a wired one is connected.
pub fn network() -> (u64, u64, bool) {
    use windows_sys::Win32::NetworkManagement::IpHelper::{FreeMibTable, GetIfTable2, MIB_IF_TABLE2};
    use windows_sys::Win32::NetworkManagement::Ndis::{IfOperStatusUp, MediaConnectStateConnected};
    // (IF_TYPE_ETHERNET_CSMACD, IF_TYPE_IEEE80211)
    const ETHERNET: u32 = 6;
    const WIFI: u32 = 71;
    let mut table: *mut MIB_IF_TABLE2 = std::ptr::null_mut();
    // SAFETY: Windows allocates the table, read while it's held and freed once
    unsafe {
        if GetIfTable2(&mut table) != 0 || table.is_null() {
            return (0, 0, false);
        }
        let rows = std::slice::from_raw_parts((*table).Table.as_ptr(), (*table).NumEntries as usize);
        let (mut rx, mut tx, mut wired) = (0u64, 0u64, false);
        for r in rows {
            // (bit 0 of the flags: HardwareInterface, a real adapter rather than a filter or a virtual one)
            let hardware = r.InterfaceAndOperStatusFlags._bitfield & 1 != 0;
            if !hardware || !(r.Type == ETHERNET || r.Type == WIFI) {
                continue;
            }
            rx += r.InOctets;
            tx += r.OutOctets;
            wired |= r.Type == ETHERNET && r.OperStatus == IfOperStatusUp && r.MediaConnectState == MediaConnectStateConnected;
        }
        FreeMibTable(table as *const _);
        (rx, tx, wired)
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn installed_memory_covers_what_windows_can_use() {
        let installed = super::installed_memory().expect("installed memory");
        let (usable, _) = super::memory().expect("memory");
        assert!(installed >= usable, "installed {installed} < usable {usable}");
        assert!(installed >= 1 << 30, "installed {installed}");
    }
}
