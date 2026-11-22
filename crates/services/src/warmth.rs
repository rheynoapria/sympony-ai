//! Warm colours after sunset (pure): how warm Sympony's own colours are, 0 to 1.

const EASE: f64 = 45.0 * 60_000.0;

/// At `now` (ms), with today's sunrise and sunset (ms) and the strength (%): full from 45 minutes after sunset until
/// sunrise, easing back over 45 minutes from sunrise.
pub fn level(now: i64, sunrise: i64, sunset: i64, strength: u64) -> f64 {
    // (broken times: not warm, rather than warm all day)
    if sunset <= sunrise {
        return 0.0;
    }
    let s = strength.min(100) as f64 / 100.0;
    let f = if now < sunrise {
        1.0
    } else if (now as f64) < sunrise as f64 + EASE {
        1.0 - (now - sunrise) as f64 / EASE
    } else if now < sunset {
        0.0
    } else if (now as f64) < sunset as f64 + EASE {
        (now - sunset) as f64 / EASE
    } else {
        1.0
    };
    s * f
}
