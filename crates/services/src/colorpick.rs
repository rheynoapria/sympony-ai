//! What the screen colour picker copies (setting `colorPickFormat`): `#4A90E2`, `rgb(74, 144, 226)` or
//! `hsl(212, 72%, 59%)`, as Settings shows them.

/// (the code to copy, the swatch's CSS colour)
pub fn code(rgb: [u8; 3], format: &str) -> (String, String) {
    let [r, g, b] = rgb;
    let hex = format!("#{r:02X}{g:02X}{b:02X}");
    let code = match format {
        "rgb" => format!("rgb({r}, {g}, {b})"),
        "hsl" => {
            let (h, s, l) = hsl(rgb);
            format!("hsl({h}, {s}%, {l}%)")
        }
        _ => hex.clone(),
    };
    (code, hex)
}

/// Hue (degrees), saturation and lightness (percent), rounded.
fn hsl(rgb: [u8; 3]) -> (u32, u32, u32) {
    let [r, g, b] = rgb.map(|c| f64::from(c) / 255.0);
    let (max, min) = (r.max(g).max(b), r.min(g).min(b));
    let (l, d) = ((max + min) / 2.0, max - min);
    let pct = |v: f64| (v * 100.0).round() as u32;
    if d == 0.0 {
        return (0, 0, pct(l));
    }
    let s = d / (1.0 - (2.0 * l - 1.0).abs());
    let h = if max == r {
        ((g - b) / d).rem_euclid(6.0)
    } else if max == g {
        (b - r) / d + 2.0
    } else {
        (r - g) / d + 4.0
    };
    ((h * 60.0).round() as u32 % 360, pct(s), pct(l))
}

#[cfg(test)]
mod tests {
    use super::code;

    #[test]
    fn settings_example_in_each_format() {
        let blue = [74, 144, 226];
        assert_eq!(code(blue, "hex"), ("#4A90E2".into(), "#4A90E2".into()));
        assert_eq!(code(blue, "rgb").0, "rgb(74, 144, 226)");
        assert_eq!(code(blue, "hsl").0, "hsl(212, 72%, 59%)");
    }

    #[test]
    fn greys_and_primaries() {
        assert_eq!(code([0, 0, 0], "hsl").0, "hsl(0, 0%, 0%)");
        assert_eq!(code([255, 255, 255], "hsl").0, "hsl(0, 0%, 100%)");
        assert_eq!(code([255, 0, 0], "hsl").0, "hsl(0, 100%, 50%)");
        assert_eq!(code([0, 255, 0], "hsl").0, "hsl(120, 100%, 50%)");
        assert_eq!(code([255, 0, 255], "hsl").0, "hsl(300, 100%, 50%)");
    }

    #[test]
    fn an_unknown_format_copies_hex() {
        assert_eq!(code([1, 2, 3], "cmyk").0, "#010203");
    }
}
