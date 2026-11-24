//! Pony's Eyes in vision mode on Windows, where macOS has screencapture, sips and Vision: a picture of a window
//! (PrintWindow, so the window draws itself even under other windows), made smaller as a JPEG for the AI
//! (Windows.Graphics.Imaging), and the text in it (Windows.Media.Ocr, on this PC with the user's own languages).
//! The picture stays in memory: nothing is written to disk.
use std::borrow::Cow;

use windows_sys::Win32::Foundation::{HWND, RECT};
use windows_sys::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows_sys::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS, HDC, SRCCOPY,
};
use windows_sys::Win32::Storage::Xps::PrintWindow;
use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowRect, IsIconic, IsWindow};

/// PrintWindow's flag for windows drawn by the GPU (browsers, Electron, WinUI): without it they come out black.
const PW_RENDERFULLCONTENT: u32 = 2;

/// A picture of a window.
pub struct Picture {
    pub width: u32,
    pub height: u32,
    /// Blue, green, red and alpha (opaque) for each pixel, rows from the top.
    pub bgra: Vec<u8>,
    /// Where the picture sits in the window's rectangle (`GetWindowRect`, the frame `ax` gives), in pixels: its left
    /// and top, then the rectangle's width and height. The picture leaves out the invisible borders Windows keeps
    /// around a window for resizing.
    pub within: (u32, u32, u32, u32),
}

/// A picture of window `id` (`ax::window_id_matching`): the window draws itself into it, also when other windows
/// cover it. Taken from the screen instead when the window can't draw itself and is the one in front.
pub fn window(id: u32) -> Result<Picture, String> {
    let hwnd = id as usize as HWND;
    // SAFETY: plain queries about a window handle, into locals
    let (wr, shown) = unsafe {
        if IsWindow(hwnd) == 0 {
            return Err("The window is gone".into());
        }
        if IsIconic(hwnd) != 0 {
            return Err("The window is minimized".into());
        }
        let mut wr: RECT = std::mem::zeroed();
        if GetWindowRect(hwnd, &mut wr) == 0 {
            return Err("The window isn't on screen".into());
        }
        let mut shown: RECT = std::mem::zeroed();
        let framed = DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS as u32, (&raw mut shown).cast(), std::mem::size_of::<RECT>() as u32) == 0;
        (wr, if framed { shown } else { wr })
    };
    let (w, h) = (wr.right - wr.left, wr.bottom - wr.top);
    if w <= 0 || h <= 0 || w > 16384 || h > 16384 {
        return Err("The window isn't on screen".into());
    }
    // SAFETY: the window draws into our own bitmap; a failed draw leaves it black (checked below)
    let drawn = unsafe { bitmap(w, h, |dc, _| PrintWindow(hwnd, dc, PW_RENDERFULLCONTENT) != 0) }.filter(|px| !blank(px));
    let px = match drawn {
        Some(px) => px,
        // SAFETY: copies the screen under the window's rectangle into our own bitmap
        None if unsafe { GetForegroundWindow() } == hwnd => unsafe { bitmap(w, h, |dc, screen| BitBlt(dc, 0, 0, w, h, screen, wr.left, wr.top, SRCCOPY | CAPTUREBLT) != 0) }
            .filter(|px| !blank(px))
            .ok_or("Couldn't take a picture of the window")?,
        None => return Err("Couldn't take a picture of the window (it can't draw itself while covered: bring it to the front)".into()),
    };
    Ok(cut(&px, (w as u32, h as u32), visible_part(wr, shown)))
}

/// The visible part of the window's rectangle `wr` (its frame `shown`, within it), relative to it:
/// (left, top, width, height) in pixels. The whole rectangle when the frame says nothing sensible.
fn visible_part(wr: RECT, shown: RECT) -> (u32, u32, u32, u32) {
    let (l, t) = (shown.left.max(wr.left), shown.top.max(wr.top));
    let (r, b) = (shown.right.min(wr.right), shown.bottom.min(wr.bottom));
    if r - l < 8 || b - t < 8 {
        return (0, 0, (wr.right - wr.left) as u32, (wr.bottom - wr.top) as u32);
    }
    ((l - wr.left) as u32, (t - wr.top) as u32, (r - l) as u32, (b - t) as u32)
}

/// The part `(x, y, w, h)` of a picture `size` big, made opaque.
fn cut(px: &[u8], size: (u32, u32), (x, y, w, h): (u32, u32, u32, u32)) -> Picture {
    let mut out = Vec::with_capacity((w * h * 4) as usize);
    for row in y..y + h {
        let start = ((row * size.0 + x) * 4) as usize;
        out.extend_from_slice(&px[start..start + (w * 4) as usize]);
    }
    for a in out.iter_mut().skip(3).step_by(4) {
        *a = 255;
    }
    Picture { width: w, height: h, bgra: out, within: (x, y, size.0, size.1) }
}

/// Whether nothing was drawn: every pixel black.
fn blank(px: &[u8]) -> bool {
    px.chunks_exact(4).all(|p| p[0] == 0 && p[1] == 0 && p[2] == 0)
}

/// A `w` × `h` bitmap (32-bit, rows from the top) that `paint` draws into (given our device context and the
/// screen's), read back; `None` when it couldn't be made or `paint` failed.
unsafe fn bitmap(w: i32, h: i32, paint: impl FnOnce(HDC, HDC) -> bool) -> Option<Vec<u8>> {
    let screen = GetDC(std::ptr::null_mut());
    let dc = CreateCompatibleDC(screen);
    let mut info: BITMAPINFO = std::mem::zeroed();
    info.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
    info.bmiHeader.biWidth = w;
    info.bmiHeader.biHeight = -h;
    info.bmiHeader.biPlanes = 1;
    info.bmiHeader.biBitCount = 32;
    info.bmiHeader.biCompression = BI_RGB;
    let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
    let bmp = CreateDIBSection(dc, &info, DIB_RGB_COLORS, &mut bits, std::ptr::null_mut(), 0);
    let mut out = None;
    if !dc.is_null() && !bmp.is_null() && !bits.is_null() {
        let old = SelectObject(dc, bmp);
        if paint(dc, screen) {
            out = Some(std::slice::from_raw_parts(bits as *const u8, (w * h * 4) as usize).to_vec());
        }
        SelectObject(dc, old);
    }
    if !bmp.is_null() {
        DeleteObject(bmp);
    }
    if !dc.is_null() {
        DeleteDC(dc);
    }
    ReleaseDC(std::ptr::null_mut(), screen);
    out
}

/// The picture made to fit `longest` pixels on its longer side (each new pixel the average of the ones it covers),
/// or as it is when it fits: (width, height, pixels).
fn fit(p: &Picture, longest: u32) -> (u32, u32, Cow<'_, [u8]>) {
    let (w, h) = (p.width, p.height);
    if w.max(h) <= longest || longest == 0 {
        return (w, h, Cow::Borrowed(&p.bgra));
    }
    let k = longest as f64 / w.max(h) as f64;
    let (nw, nh) = (((w as f64 * k).round() as u32).max(1), ((h as f64 * k).round() as u32).max(1));
    let mut out = vec![0u8; (nw * nh * 4) as usize];
    for ty in 0..nh {
        let (y0, y1) = (ty * h / nh, ((ty + 1) * h / nh).max(ty * h / nh + 1));
        for tx in 0..nw {
            let (x0, x1) = (tx * w / nw, ((tx + 1) * w / nw).max(tx * w / nw + 1));
            let mut sum = [0u32; 4];
            for y in y0..y1 {
                for x in x0..x1 {
                    let i = ((y * w + x) * 4) as usize;
                    for c in 0..4 {
                        sum[c] += p.bgra[i + c] as u32;
                    }
                }
            }
            let n = (x1 - x0) * (y1 - y0);
            let o = ((ty * nw + tx) * 4) as usize;
            for c in 0..4 {
                out[o + c] = ((sum[c] + n / 2) / n) as u8;
            }
        }
    }
    (nw, nh, Cow::Owned(out))
}

/// The picture as a JPEG at most `longest` pixels on its longer side, for the AI to look at.
pub fn jpeg(p: &Picture, longest: u32) -> Result<Vec<u8>, String> {
    use windows::Graphics::Imaging::{BitmapAlphaMode, BitmapEncoder, BitmapPixelFormat};
    use windows::Storage::Streams::{DataReader, InMemoryRandomAccessStream};
    super::mta();
    let (w, h, px) = fit(p, longest);
    let encode = || -> windows::core::Result<Vec<u8>> {
        let stream = InMemoryRandomAccessStream::new()?;
        let enc = BitmapEncoder::CreateAsync(BitmapEncoder::JpegEncoderId()?, &stream)?.join()?;
        enc.SetPixelData(BitmapPixelFormat::Bgra8, BitmapAlphaMode::Ignore, w, h, 96.0, 96.0, &px)?;
        enc.FlushAsync()?.join()?;
        let size = stream.Size()? as u32;
        let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0)?)?;
        reader.LoadAsync(size)?.join()?;
        let mut out = vec![0u8; size as usize];
        reader.ReadBytes(&mut out)?;
        Ok(out)
    };
    encode().map_err(|e| format!("Couldn't make a picture of the window ({})", e.message()))
}

/// The lines of text in the picture, read on this PC by Windows' text recognition in the user's languages:
/// `(text, x, y, w, h)` with the box normalized to the window's rectangle and its origin at the bottom left, as
/// macOS's Vision gives them (services::eyes::spots).
pub fn text(p: &Picture) -> Result<Vec<(String, f64, f64, f64, f64)>, String> {
    use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::DataWriter;
    super::mta();
    let Ok(engine) = OcrEngine::TryCreateFromUserProfileLanguages() else {
        return Err("Windows can't read text in your languages yet. Tell the user to add one with text recognition in Settings → Time & language → Language & region (English has it), then ask again.".into());
    };
    let (w, h, px) = fit(p, OcrEngine::MaxImageDimension().unwrap_or(2600));
    let read = || -> windows::core::Result<Vec<(String, f64, f64, f64, f64)>> {
        let writer = DataWriter::new()?;
        writer.WriteBytes(&px)?;
        let bitmap = SoftwareBitmap::CreateCopyFromBuffer(&writer.DetachBuffer()?, BitmapPixelFormat::Bgra8, w as i32, h as i32)?;
        let result = engine.RecognizeAsync(&bitmap)?.join()?;
        let mut out = Vec::new();
        for line in result.Lines()? {
            // (a line's box: around its words)
            let mut b: Option<(f64, f64, f64, f64)> = None;
            for word in line.Words()? {
                let r = word.BoundingRect()?;
                let (l, t, rr, bb) = (r.X as f64, r.Y as f64, (r.X + r.Width) as f64, (r.Y + r.Height) as f64);
                b = Some(b.map_or((l, t, rr, bb), |o| (o.0.min(l), o.1.min(t), o.2.max(rr), o.3.max(bb))));
            }
            let Some((l, t, r, bb)) = b else { continue };
            let (x, y, bw, bh) = in_window((l, t, r - l, bb - t), (w, h), p);
            out.push((line.Text()?.to_string_lossy(), x, y, bw, bh));
        }
        Ok(out)
    };
    read().map_err(|e| format!("Couldn't read the text in the picture ({})", e.message()))
}

/// A box `(x, y, w, h)` in the picture made `scaled` big (top-left origin, pixels) → normalized to the window's
/// rectangle, origin at the bottom left.
fn in_window(b: (f64, f64, f64, f64), scaled: (u32, u32), p: &Picture) -> (f64, f64, f64, f64) {
    let (sx, sy) = (p.width as f64 / scaled.0 as f64, p.height as f64 / scaled.1 as f64);
    let (ww, wh) = (p.within.2.max(1) as f64, p.within.3.max(1) as f64);
    let (x, y) = (p.within.0 as f64 + b.0 * sx, p.within.1 as f64 + b.1 * sy);
    let (w, h) = (b.2 * sx, b.3 * sy);
    (x / ww, 1.0 - (y + h) / wh, w / ww, h / wh)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(left: i32, top: i32, right: i32, bottom: i32) -> RECT {
        RECT { left, top, right, bottom }
    }

    #[test]
    fn the_invisible_borders_are_left_out() {
        // (Windows 11: 7 px on the left, right and bottom, none on top)
        assert_eq!(visible_part(rect(100, 50, 914, 650), rect(107, 50, 907, 643)), (7, 0, 800, 593));
        // (a maximized window reaches past the screen; its frame is the screen)
        assert_eq!(visible_part(rect(-8, -8, 1928, 1088), rect(0, 0, 1920, 1080)), (8, 8, 1920, 1080));
        // (no frame from DWM: the whole rectangle)
        assert_eq!(visible_part(rect(10, 10, 410, 310), rect(0, 0, 0, 0)), (0, 0, 400, 300));
    }

    #[test]
    fn a_cut_is_opaque_and_in_place() {
        // a 3 × 2 picture, pixel (x, y) = [x, y, 9, 0]
        let px: Vec<u8> = (0..2u8).flat_map(|y| (0..3u8).flat_map(move |x| [x, y, 9, 0])).collect();
        let p = cut(&px, (3, 2), (1, 1, 2, 1));
        assert_eq!((p.width, p.height, p.within), (2, 1, (1, 1, 3, 2)));
        assert_eq!(p.bgra, vec![1, 1, 9, 255, 2, 1, 9, 255]);
    }

    #[test]
    fn nothing_drawn_is_blank() {
        assert!(blank(&[0, 0, 0, 0, 0, 0, 0, 255]));
        assert!(!blank(&[0, 0, 0, 0, 0, 1, 0, 255]));
    }

    #[test]
    fn a_picture_fits_by_averaging() {
        // 4 × 2: the left half white, the right half black → 2 × 1 at 2 px: one white, one black
        let px: Vec<u8> = (0..2).flat_map(|_| (0..4).flat_map(|x| if x < 2 { [255u8; 4] } else { [0, 0, 0, 255] })).collect();
        let p = Picture { width: 4, height: 2, bgra: px, within: (0, 0, 4, 2) };
        let (w, h, out) = fit(&p, 2);
        assert_eq!((w, h), (2, 1));
        assert_eq!(&*out, &[255, 255, 255, 255, 0, 0, 0, 255]);
        // (one that fits stays as it is)
        assert!(matches!(fit(&p, 4).2, Cow::Borrowed(_)));
    }

    #[test]
    fn boxes_land_where_vision_puts_them() {
        // an 800 × 593 picture 7 px into an 814 × 600 window, read at half size
        let p = Picture { width: 800, height: 593, bgra: Vec::new(), within: (7, 0, 814, 600) };
        let (x, y, w, h) = in_window((10.0, 0.0, 50.0, 10.0), (400, 296), &p);
        // (20 px in the picture + 7 = 27; the box is 100 × ~20 px from the top edge)
        assert!((x - 27.0 / 814.0).abs() < 1e-6);
        assert!((w - 100.0 / 814.0).abs() < 1e-6);
        let hp = 10.0 * 593.0 / 296.0;
        assert!((h - hp / 600.0).abs() < 1e-6);
        assert!((y - (1.0 - hp / 600.0)).abs() < 1e-6, "a box at the top has y + h = 1");
    }
}
