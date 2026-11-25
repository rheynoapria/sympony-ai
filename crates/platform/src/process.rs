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

/// Every process a command started, ended as one, those whose parent has gone too. On Windows that takes a job
/// object: Git Bash's `cmd &` (MSYS's fork) leaves the child with a parent that has already exited, so taskkill /T
/// never finds it, while a job holds everything started inside it. Elsewhere it's the group `own_group` made.
/// Closing it leaves them running: only `end` ends them.
pub struct Tree {
    pid: u32,
    #[cfg(windows)]
    job: windows_sys::Win32::Foundation::HANDLE,
}

impl Tree {
    /// Holds `pid` and whatever it starts from now on (call it right after the spawn).
    pub fn hold(pid: u32) -> Tree {
        #[cfg(windows)]
        {
            use windows_sys::Win32::Foundation::CloseHandle;
            use windows_sys::Win32::System::JobObjects::{AssignProcessToJobObject, CreateJobObjectW};
            use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};
            // SAFETY: a new unnamed job; the process handle is opened, used and closed here
            let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            if !job.is_null() {
                let p = unsafe { OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid) };
                if !p.is_null() {
                    unsafe {
                        AssignProcessToJobObject(job, p);
                        CloseHandle(p);
                    }
                }
            }
            Tree { pid, job }
        }
        #[cfg(not(windows))]
        Tree { pid }
    }

    /// Ends them all, now.
    pub fn end(&self) {
        #[cfg(windows)]
        if !self.job.is_null() {
            // SAFETY: the job this Tree made and still holds
            unsafe { windows_sys::Win32::System::JobObjects::TerminateJobObject(self.job, 1) };
        }
        kill_group(self.pid);
    }
}

#[cfg(windows)]
impl Drop for Tree {
    fn drop(&mut self) {
        if !self.job.is_null() {
            // SAFETY: the job's own handle, closed once (no kill-on-close: what's still running goes on)
            unsafe { windows_sys::Win32::Foundation::CloseHandle(self.job) };
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
        parent_of(std::process::id() as i32).unwrap_or(0)
    }
}

/// The process that started `pid` (None: `pid` isn't running, or its parent isn't any more). On Windows a parent
/// that's gone leaves its number behind, which a later process may have taken: one started after `pid` isn't it.
pub fn parent_of(pid: i32) -> Option<i32> {
    if pid <= 0 {
        return None;
    }
    #[cfg(unix)]
    {
        let out = Command::new("/bin/ps").args(["-o", "ppid=", "-p", &pid.to_string()]).output().ok()?;
        String::from_utf8_lossy(&out.stdout).trim().parse().ok().filter(|p: &i32| *p > 0)
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
        use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
        // SAFETY: the snapshot is checked, walked with a correctly sized entry and closed
        let parent = unsafe {
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snap == INVALID_HANDLE_VALUE {
                return None;
            }
            let mut e: PROCESSENTRY32W = std::mem::zeroed();
            e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            let mut found = None;
            let mut more = Process32FirstW(snap, &mut e) != 0;
            while more {
                if e.th32ProcessID == pid as u32 {
                    found = Some(e.th32ParentProcessID as i32);
                    break;
                }
                more = Process32NextW(snap, &mut e) != 0;
            }
            CloseHandle(snap);
            found
        }?;
        // (a number reused since: that process started after this one; when either can't be asked, it's taken)
        match (started(parent), started(pid)) {
            (Some(p), Some(c)) if p > c => None,
            _ => Some(parent).filter(|p| *p > 0),
        }
    }
}

/// `pid` and the processes above it, nearest first, at most `max` (it stops where a parent isn't known).
pub fn ancestors(pid: i32, max: usize) -> Vec<i32> {
    let mut out = Vec::new();
    let mut p = pid;
    while p > 0 && out.len() < max && !out.contains(&p) {
        out.push(p);
        p = parent_of(p).unwrap_or(0);
    }
    out
}

/// When process `pid` started (Windows' 100 ns ticks), when this account may ask.
#[cfg(windows)]
fn started(pid: i32) -> Option<u64> {
    use windows_sys::Win32::Foundation::{CloseHandle, FILETIME};
    use windows_sys::Win32::System::Threading::{GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    // SAFETY: a query-only handle, closed before returning; GetProcessTimes fills four FILETIMEs
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid as u32);
        if h.is_null() {
            return None;
        }
        let z = FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
        let (mut created, mut exited, mut kernel, mut user) = (z, z, z, z);
        let ok = GetProcessTimes(h, &mut created, &mut exited, &mut kernel, &mut user) != 0;
        CloseHandle(h);
        ok.then(|| (u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_child_s_parent_is_the_process_that_started_it() {
        let mut cmd = if cfg!(windows) { Command::new("ping") } else { Command::new("sleep") };
        if cfg!(windows) {
            cmd.args(["-n", "3", "127.0.0.1"]);
        } else {
            cmd.arg("2");
        }
        let mut child = cmd.stdout(std::process::Stdio::null()).spawn().unwrap();
        assert_eq!(parent_of(child.id() as i32), Some(std::process::id() as i32));
        let _ = child.kill();
        let _ = child.wait();
        // this process's own parent (cargo's test runner, or a shell): known, and what parent_pid says
        let mine = parent_of(std::process::id() as i32);
        assert!(mine.is_some_and(|p| p > 0), "{mine:?}");
        assert_eq!(Some(parent_pid()), mine);
        // nothing there: none
        assert_eq!(parent_of(-5), None);
        assert_eq!(parent_of(0), None);
    }

    #[test]
    fn the_line_of_parents_starts_at_the_process_and_goes_up() {
        let me = std::process::id() as i32;
        let up = ancestors(me, 20);
        assert!(up.len() >= 2, "{up:?}");
        assert_eq!((up[0], Some(up[1])), (me, parent_of(me)));
        assert!(up.len() <= 20);
        assert_eq!(ancestors(me, 1), [me]);
        assert!(ancestors(0, 20).is_empty());
    }
}
