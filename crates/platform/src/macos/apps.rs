use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication, NSWorkspace};

/// The app in front now (its pid), to give the keyboard back to it later.
pub fn frontmost_pid() -> Option<i32> {
    NSWorkspace::sharedWorkspace().frontmostApplication().map(|a| a.processIdentifier())
}

pub fn activate_pid(pid: i32) {
    if let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(pid) {
        app.activateWithOptions(NSApplicationActivationOptions::empty());
    }
}

/// Whether an app with this bundle id is running.
pub fn running(bundle_id: &str) -> bool {
    NSRunningApplication::runningApplicationsWithBundleIdentifier(&objc2_foundation::NSString::from_str(bundle_id)).count() > 0
}

/// The pid of a running app with this bundle id.
/// Called from a background thread every second: its own autorelease pool, or AppKit's temporaries pile up.
pub fn pid_of(bundle_id: &str) -> Option<i32> {
    objc2::rc::autoreleasepool(|_| {
        NSRunningApplication::runningApplicationsWithBundleIdentifier(&objc2_foundation::NSString::from_str(bundle_id))
            .firstObject()
            .map(|a| a.processIdentifier())
    })
}

/// An installed app's icon as a PNG about `px` pixels wide (None when no app has this bundle id).
pub fn icon_png(bundle_id: &str, px: f64) -> Option<Vec<u8>> {
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep};
    use objc2_foundation::{NSDictionary, NSPoint, NSRect, NSSize, NSString};
    objc2::rc::autoreleasepool(|_| {
        let ws = NSWorkspace::sharedWorkspace();
        let url = ws.URLForApplicationWithBundleIdentifier(&NSString::from_str(bundle_id))?;
        let path = url.path()?;
        let image = ws.iconForFile(&path);
        let mut rect = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(px, px));
        let cg = unsafe { image.CGImageForProposedRect_context_hints(&mut rect, None, None) }?;
        let rep = NSBitmapImageRep::initWithCGImage(objc2::AnyThread::alloc(), &cg);
        let png = unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new()) }?;
        Some(png.to_vec())
    })
}

/// An installed app's name (its bundle's file name), e.g. "Mail".
pub fn app_name(bundle_id: &str) -> Option<String> {
    use objc2_foundation::NSString;
    objc2::rc::autoreleasepool(|_| {
        let url = NSWorkspace::sharedWorkspace().URLForApplicationWithBundleIdentifier(&NSString::from_str(bundle_id))?;
        let name = url.lastPathComponent()?.to_string();
        Some(name.trim_end_matches(".app").to_string())
    })
}

/// The bundle id of a running app by its shown name (a banner names its app only so).
pub fn bundle_for_name(name: &str) -> Option<String> {
    objc2::rc::autoreleasepool(|_| {
        NSWorkspace::sharedWorkspace().runningApplications().iter().find_map(|a| {
            (a.localizedName().map(|n| n.to_string()).as_deref() == Some(name)).then(|| a.bundleIdentifier().map(|b| b.to_string())).flatten()
        })
    })
}

/// The app in front: (bundle id, name). Its own autorelease pool (called every second from a background thread).
pub fn frontmost() -> Option<(String, String)> {
    objc2::rc::autoreleasepool(|_| {
        let a = NSWorkspace::sharedWorkspace().frontmostApplication()?;
        let id = a.bundleIdentifier()?.to_string();
        let name = a.localizedName().map(|n| n.to_string()).unwrap_or_else(|| id.clone());
        Some((id, name))
    })
}

/// Whether a process is an app with windows (a terminal, an editor): the one to bring forward for it.
pub fn is_app(pid: i32) -> bool {
    objc2::rc::autoreleasepool(|_| {
        NSRunningApplication::runningApplicationWithProcessIdentifier(pid)
            .is_some_and(|a| a.activationPolicy() == objc2_app_kit::NSApplicationActivationPolicy::Regular)
    })
}

/// The apps open now (with windows, in the Dock): (bundle id, name).
pub fn open_apps() -> Vec<(String, String)> {
    objc2::rc::autoreleasepool(|_| {
        NSWorkspace::sharedWorkspace().runningApplications().iter().filter(|a| a.activationPolicy() == objc2_app_kit::NSApplicationActivationPolicy::Regular)
            .filter_map(|a| {
                let id = a.bundleIdentifier()?.to_string();
                Some((id.clone(), a.localizedName().map(|n| n.to_string()).unwrap_or(id)))
            })
            .collect()
    })
}
