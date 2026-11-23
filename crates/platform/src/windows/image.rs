//! Pictures between Windows and PNG: a bitmap (an icon, the clipboard's) as PNG, a PNG as a bitmap the clipboard can
//! hold, and the icon Explorer shows for a file, an app or a Start menu entry.
use ::windows::core::HSTRING;
use ::windows::Win32::Foundation::SIZE;
use ::windows::Win32::Graphics::Gdi::{DeleteObject, HBITMAP, HGDIOBJ};
use ::windows::Win32::UI::Shell::{IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_ICONONLY};

/// A bitmap's pixels as 32-bit BGRA rows from the top: (width, height, pixels). Windows converts any bitmap to that.
///
/// # Safety
/// `bitmap` must be a live bitmap handle not selected into a device context.
pub(crate) unsafe fn bgra(bitmap: *mut core::ffi::c_void) -> Option<(u32, u32, Vec<u8>)> {
    use windows_sys::Win32::Graphics::Gdi::{CreateCompatibleDC, DeleteDC, GetDIBits, GetObjectW, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS};
    // SAFETY: the caller's live bitmap; the structures and the buffer are sized for what's asked
    unsafe {
        let mut bm: BITMAP = std::mem::zeroed();
        if GetObjectW(bitmap, std::mem::size_of::<BITMAP>() as i32, (&raw mut bm).cast()) == 0 || bm.bmWidth <= 0 || bm.bmHeight == 0 {
            return None;
        }
        let (w, h) = (bm.bmWidth, bm.bmHeight.abs());
        let mut info: BITMAPINFO = std::mem::zeroed();
        // (a negative height: rows from the top)
        info.bmiHeader = BITMAPINFOHEADER { biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32, biWidth: w, biHeight: -h, biPlanes: 1, biBitCount: 32, biCompression: BI_RGB, ..std::mem::zeroed() };
        let mut px = vec![0u8; w as usize * h as usize * 4];
        let dc = CreateCompatibleDC(std::ptr::null_mut());
        let rows = GetDIBits(dc, bitmap, 0, h as u32, px.as_mut_ptr().cast(), &mut info, DIB_RGB_COLORS);
        DeleteDC(dc);
        (rows == h).then_some((w as u32, h as u32, px))
    }
}

/// BGRA rows from the top as a PNG. `premultiplied`: the colours are already multiplied by the alpha (an icon's). A
/// bitmap whose alpha is 0 everywhere has none (a screenshot's): it's opaque.
pub(crate) fn png(w: u32, h: u32, mut px: Vec<u8>, premultiplied: bool) -> Option<Vec<u8>> {
    let no_alpha = px.chunks_exact(4).all(|p| p[3] == 0);
    for p in px.chunks_exact_mut(4) {
        p.swap(0, 2);
        if no_alpha {
            p[3] = 255;
        } else if premultiplied && p[3] > 0 && p[3] < 255 {
            for c in 0..3 {
                p[c] = (p[c] as u32 * 255 / p[3] as u32).min(255) as u8;
            }
        }
    }
    let mut out = Vec::new();
    let mut e = png::Encoder::new(&mut out, w, h);
    e.set_color(png::ColorType::Rgba);
    e.set_depth(png::BitDepth::Eight);
    let mut writer = e.write_header().ok()?;
    writer.write_image_data(&px).ok()?;
    writer.finish().ok()?;
    Some(out)
}

/// A PNG as BGRA rows from the bottom, as a clipboard bitmap (CF_DIB) has them: (width, height, pixels).
pub(crate) fn bgra_of_png(bytes: &[u8]) -> Option<(u32, u32, Vec<u8>)> {
    let mut d = png::Decoder::new(std::io::Cursor::new(bytes));
    d.set_transformations(png::Transformations::normalize_to_color8() | png::Transformations::ALPHA);
    let mut reader = d.read_info().ok()?;
    let mut buf = vec![0; reader.output_buffer_size()?];
    let info = reader.next_frame(&mut buf).ok()?;
    let channels = match info.color_type {
        png::ColorType::Rgba => 4,
        png::ColorType::GrayscaleAlpha => 2,
        _ => return None,
    };
    let (w, h) = (info.width as usize, info.height as usize);
    let mut out = Vec::with_capacity(w * h * 4);
    for row in buf[..info.line_size * h].chunks_exact(info.line_size).rev() {
        for p in row[..w * channels].chunks_exact(channels) {
            if channels == 4 {
                out.extend_from_slice(&[p[2], p[1], p[0], p[3]]);
            } else {
                out.extend_from_slice(&[p[0], p[0], p[0], p[1]]);
            }
        }
    }
    Some((info.width, info.height, out))
}

/// The icon Explorer shows for `name` (a path, or a shell name such as `shell:AppsFolder\<app id>`), a PNG about
/// `px` wide.
pub(crate) fn shell_icon(name: &str, px: f64) -> Option<Vec<u8>> {
    super::mta();
    let side = px.round().clamp(16.0, 256.0) as i32;
    // SAFETY: COM calls on this thread's apartment; the bitmap the factory hands over is read, then deleted once
    unsafe {
        let factory: IShellItemImageFactory = SHCreateItemFromParsingName::<_, _, IShellItemImageFactory>(&HSTRING::from(name), None).ok()?;
        let bitmap: HBITMAP = factory.GetImage(SIZE { cx: side, cy: side }, SIIGBF_ICONONLY).ok()?;
        let read = bgra(bitmap.0);
        let _ = DeleteObject(HGDIOBJ(bitmap.0));
        let (w, h, pixels) = read?;
        png(w, h, pixels, true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_png_comes_back_as_the_bitmap_it_was() {
        // 2×2, BGRA from the top: blue, green / red, half-transparent white
        let top = vec![255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 128];
        let made = png(2, 2, top, false).unwrap();
        let (w, h, back) = bgra_of_png(&made).unwrap();
        assert_eq!((w, h), (2, 2));
        // (rows from the bottom now)
        assert_eq!(back, vec![0, 0, 255, 255, 255, 255, 255, 128, 255, 0, 0, 255, 0, 255, 0, 255]);
    }

    #[test]
    fn a_bitmap_without_alpha_is_opaque() {
        let made = png(1, 1, vec![10, 20, 30, 0], false).unwrap();
        assert_eq!(bgra_of_png(&made).unwrap().2, vec![10, 20, 30, 255]);
    }

    #[test]
    fn premultiplied_colours_are_undone() {
        // (a 50% red over a transparent pixel, premultiplied: 128 of red)
        let made = png(2, 1, vec![0, 0, 128, 128, 0, 0, 0, 0], true).unwrap();
        assert_eq!(bgra_of_png(&made).unwrap().2, vec![0, 0, 255, 128, 0, 0, 0, 0]);
    }
}
