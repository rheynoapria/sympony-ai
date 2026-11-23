//! Child processes that bring helpers along (an agent CLI and the MCP servers it starts): started in a group of their
//! own and ended as a whole; and whether a process is alive.
use std::process::Command;

#[cfg(windows)]
const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Starts `cmd` in a process group of its own, so `kill_group(child.id())` ends its helpers too. On Windows the
/// child also gets no console window of its own (Sympony is a windowed app: each CLI run would flash one).
pub fn own_group(cmd: &mut Command) -> &mut Command {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0)
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW)
    }
}

/// Ends the group `own_group` started as `pid`, whatever it left running included.
pub fn kill_group(pid: u32) {
    #[cfg(unix)]
    if let Ok(pgid) = i32::try_from(pid) {
        if pgid > 0 {
            // SAFETY: sending SIGKILL to the child's own dedicated process group (`process_group(0)`).
            unsafe { libc::kill(-pgid, libc::SIGKILL) };
        }
    }
    #[cfg(windows)]
    {
        // (no group to signal on Windows: taskkill ends the tree of processes under pid)
        use std::os::windows::process::CommandExt;
        use std::process::Stdio;
        if pid > 0 {
            let _ = Command::new("taskkill")
                .args(["/T", "/F", "/PID", &pid.to_string()])
                .creation_flags(CREATE_NO_WINDOW)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
    }
}

/// The process that started this one (an agent's hook: the agent), 0 when not known.
pub fn parent_pid() -> i32 {
    #[cfg(unix)]
    {
        // SAFETY: getppid takes nothing and can't fail.
        unsafe { libc::getppid() }
    }
    #[cfg(windows)]
    {
        // (Windows keeps no parent link a process can ask for cheaply; the hook's terminal isn't brought forward yet)
        0
    }
}

/// Whether `pid` names a live process (one this account may not touch counts too).
pub fn alive(pid: i32) -> bool {
    if pid <= 0 {
        return false;
    }
    #[cfg(unix)]
    {
        // SAFETY: signal 0 only checks process existence without sending a signal.
        let r = unsafe { libc::kill(pid, 0) };
        r == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ACCESS_DENIED, STILL_ACTIVE};
        use windows_sys::Win32::System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
        // SAFETY: a query-only handle, closed before returning; GetExitCodeProcess writes one u32.
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid as u32);
            if h.is_null() {
                return GetLastError() == ERROR_ACCESS_DENIED;
            }
            let mut code = 0u32;
            let ok = GetExitCodeProcess(h, &mut code) != 0;
            CloseHandle(h);
            ok && code == STILL_ACTIVE as u32
        }
    }
}
