pub mod apps;
pub mod automation;
pub mod displays;
pub mod keychain;
pub mod location;
pub mod window;
pub mod system;
pub mod notifications;
pub mod banners;
pub mod ax;
pub mod radios;
pub mod calendar;
pub mod files;
pub mod player;
pub mod voice;

/// AppKit's proof of being on the main thread, under the name `platform::os` gives it on every OS.
pub use objc2::MainThreadMarker;
