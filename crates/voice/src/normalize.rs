//! Deterministic Indonesian ASR post-processing normalizer.
//! Pure char-scan tokenizer + ordered rule tables, no regex lookbehind.
use crate::vocab::Vocab;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnitsStyle {
    Symbols,
    Words,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormOptions {
    pub spelling: bool,
    pub numbers: bool,
    pub spoken_punct: bool,
    pub acronyms: bool,
    pub urls: bool,
    pub dates: bool,
    pub di_join: bool,
    pub nya_hyphen: bool,
    pub units: UnitsStyle,
    pub casing: bool,
}

impl NormOptions {
    pub fn user_default() -> Self {
        Self {
            spelling: true,
            numbers: true,
            spoken_punct: true,
            acronyms: true,
            urls: true,
            dates: true,
            di_join: true,
            nya_hyphen: true,
            units: UnitsStyle::Symbols,
            casing: true,
        }
    }

    pub fn eval_profile() -> Self {
        Self {
            units: UnitsStyle::Words,
            spoken_punct: false,
            ..Self::user_default()
        }
    }

    /// Turn off a single rule group by name (used by `voice-eval --ablate`).
    pub fn disable_group(&mut self, group: &str) -> bool {
        match group {
            "spoken_punct" => self.spoken_punct = false,
            "acronyms" => self.acronyms = false,
            "numbers" => self.numbers = false,
            "units" => self.units = UnitsStyle::Words,
            "dates" | "datetime" => self.dates = false,
            "urls" => self.urls = false,
            "di_join" => self.di_join = false,
            "nya_hyphen" => self.nya_hyphen = false,
            "spelling" => self.spelling = false,
            "casing" | "case_punct" => self.casing = false,
            _ => return false,
        }
        true
    }
}

pub fn rule_groups() -> &'static [&'static str] {
    &[
        "spoken_punct",
        "acronyms",
        "numbers",
        "units",
        "dates",
        "urls",
        "di_join",
        "nya_hyphen",
        "spelling",
        "casing",
    ]
}

// ---------------------------------------------------------------------------
// Constant tables
// ---------------------------------------------------------------------------

fn unit_val(w: &str) -> Option<u64> {
    Some(match w {
        "nol" | "kosong" => 0,
        "satu" => 1,
        "dua" => 2,
        "tiga" => 3,
        "empat" => 4,
        "lima" => 5,
        "enam" => 6,
        "tujuh" => 7,
        "delapan" => 8,
        "sembilan" => 9,
        _ => return None,
    })
}

fn teens_se_val(w: &str) -> Option<u64> {
    Some(match w {
        "sepuluh" => 10,
        "sebelas" => 11,
        "seratus" => 100,
        _ => return None,
    })
}

fn scale_val(w: &str) -> Option<u64> {
    Some(match w {
        "ribu" => 1_000,
        "juta" => 1_000_000,
        "miliar" | "milyar" => 1_000_000_000,
        "triliun" => 1_000_000_000_000,
        _ => return None,
    })
}

fn se_scale_val(w: &str) -> Option<u64> {
    Some(match w {
        "seribu" => 1_000,
        "sejuta" => 1_000_000,
        "semiliar" => 1_000_000_000,
        _ => return None,
    })
}

fn is_mult(w: &str) -> bool {
    matches!(w, "belas" | "puluh" | "ratus")
}

fn is_number_word(w: &str) -> bool {
    unit_val(w).is_some()
        || teens_se_val(w).is_some()
        || scale_val(w).is_some()
        || se_scale_val(w).is_some()
        || is_mult(w)
}

const MIN_STANDALONE: u64 = 11;

fn is_num_context_before(w: &str) -> bool {
    matches!(
        w,
        "nomor"
            | "nomer"
            | "no"
            | "halaman"
            | "pasal"
            | "ayat"
            | "tahun"
            | "abad"
            | "rp"
            | "angka"
            | "skor"
            | "versi"
            | "level"
            | "lantai"
            | "gate"
            | "kode"
            | "ke"
    )
}

fn is_time_context_before(w: &str) -> bool {
    matches!(w, "jam" | "pukul" | "tanggal" | "tgl")
}

fn is_year_context_before(w: &str) -> bool {
    matches!(
        w,
        "tahun" | "sejak" | "era" | "dekade" | "abad" | "medio" | "akhir" | "awal" | "pertengahan"
    )
}

fn is_month(w: &str) -> bool {
    matches!(
        w,
        "januari"
            | "februari"
            | "maret"
            | "april"
            | "mei"
            | "juni"
            | "juli"
            | "agustus"
            | "september"
            | "oktober"
            | "november"
            | "desember"
    )
}

fn fix_month_or_day(w: &str) -> &str {
    match w {
        "pebruari" => "februari",
        "nopember" => "november",
        "agustu" => "agustus",
        "jum'at" | "jum’at" => "jumat",
        other => other,
    }
}

fn is_day(w: &str) -> bool {
    matches!(
        w,
        "senin" | "selasa" | "rabu" | "kamis" | "jumat" | "sabtu" | "minggu" | "ahad"
    )
}

fn is_scale_word_kept(w: &str) -> bool {
    matches!(w, "juta" | "miliar" | "triliun")
}

const UNIT_TABLE: &[(&[&str], &str)] = &[
    (&["derajat", "celsius"], "°C"),
    (&["derajat", "celcius"], "°C"),
    (&["derajat", "fahrenheit"], "°F"),
    (&["kilometer", "per", "jam"], "km/jam"),
    (&["meter", "persegi"], "m²"),
    (&["kilometer", "persegi"], "km²"),
    (&["meter", "kubik"], "m³"),
    (&["persen"], "%"),
    (&["kilometer"], "km"),
    (&["kilogram"], "kg"),
    (&["sentimeter"], "cm"),
    (&["centimeter"], "cm"),
    (&["milimeter"], "mm"),
    (&["miligram"], "mg"),
    (&["mililiter"], "ml"),
    (&["gigabyte"], "GB"),
    (&["giga"], "GB"),
    (&["megabyte"], "MB"),
    (&["terabyte"], "TB"),
    (&["kilobyte"], "KB"),
    (&["megapiksel"], "MP"),
    (&["gigahertz"], "GHz"),
    (&["megahertz"], "MHz"),
    (&["mbps"], "Mbps"),
    (&["kilowatt"], "kW"),
    (&["watt"], "W"),
    (&["hektare"], "ha"),
    (&["hektar"], "ha"),
    (&["derajat"], "°"),
];

const CURRENCY_AFTER: &[(&[&str], &str)] = &[
    (&["dolar", "as"], "US$"),
    (&["dolar", "amerika", "serikat"], "US$"),
    (&["dolar", "amerika"], "US$"),
    (&["dollar", "as"], "US$"),
    (&["dolar", "singapura"], "S$"),
    (&["dolar", "australia"], "A$"),
    (&["rupiah"], "Rp"),
    (&["dolar"], "$"),
    (&["dollar"], "$"),
    (&["euro"], "€"),
    (&["poundsterling"], "£"),
    (&["pound"], "£"),
    (&["yen"], "¥"),
];

fn is_unit_head(w: &str) -> bool {
    UNIT_TABLE.iter().any(|(seq, _)| seq[0] == w)
}

fn is_currency_head(w: &str) -> bool {
    CURRENCY_AFTER.iter().any(|(seq, _)| seq[0] == w)
}

fn letter_name(w: &str) -> Option<&'static str> {
    Some(match w {
        "a" => "A",
        "be" | "bi" => "B",
        "ce" | "si" => "C",
        "de" | "di" => "D",
        "e" => "E",
        "ef" => "F",
        "ge" | "ji" => "G",
        "ha" | "ech" => "H",
        "i" => "I",
        "je" | "jei" => "J",
        "ka" | "kei" => "K",
        "el" => "L",
        "em" => "M",
        "en" => "N",
        "o" => "O",
        "pe" | "pi" => "P",
        "ki" | "kyu" => "Q",
        "er" => "R",
        "es" => "S",
        "te" | "ti" => "T",
        "u" | "yu" => "U",
        "ve" | "fe" | "vi" => "V",
        "we" | "dabel" => "W",
        "eks" => "X",
        "ye" | "wai" => "Y",
        "zet" | "zed" => "Z",
        _ => return None,
    })
}

fn is_ambiguous_letter(w: &str) -> bool {
    matches!(
        w,
        "a" | "di"
            | "e"
            | "i"
            | "o"
            | "u"
            | "si"
            | "ha"
            | "es"
            | "ki"
            | "en"
            | "el"
            | "em"
            | "ti"
            | "bi"
            | "pi"
            | "ji"
            | "te"
            | "ka"
            | "ye"
            | "we"
            | "be"
            | "de"
            | "er"
    )
}

const MIN_SPELLED: usize = 2;
const MIN_STRONG_LETTERS: usize = 1;

fn is_tld(w: &str) -> bool {
    matches!(
        w,
        "com"
            | "co"
            | "id"
            | "org"
            | "net"
            | "io"
            | "ai"
            | "ac"
            | "go"
            | "or"
            | "sch"
            | "my"
            | "sg"
            | "edu"
            | "gov"
            | "dev"
            | "app"
            | "xyz"
            | "info"
            | "biz"
            | "me"
            | "tv"
            | "web"
    )
}

const URL_WORDS: &[(&[&str], &str)] = &[
    (&["garis", "miring"], "/"),
    (&["titik", "dua"], ":"),
    (&["garis", "bawah"], "_"),
    (&["tanda", "hubung"], "-"),
    (&["strip"], "-"),
];

fn is_at_word(w: &str) -> bool {
    matches!(w, "et" | "at" | "add")
}

fn is_di_split(w: &str) -> bool {
    matches!(
        w,
        "sini"
            | "sana"
            | "situ"
            | "mana"
            | "atas"
            | "bawah"
            | "dalam"
            | "luar"
            | "antara"
            | "depan"
            | "belakang"
            | "samping"
            | "tengah"
            | "sekitar"
            | "rumah"
            | "kantor"
            | "sekolah"
            | "pasar"
            | "kota"
            | "desa"
            | "kampus"
            | "jalan"
            | "sebelah"
            | "seberang"
            | "balik"
            | "dekat"
            | "akhir"
            | "awal"
            | "masa"
            | "era"
            | "bulan"
            | "tahun"
            | "hari"
            | "pagi"
            | "siang"
            | "sore"
            | "malam"
            | "antar"
            | "sisi"
            | "ujung"
            | "puncak"
            | "pinggir"
            | "tepi"
            | "pusat"
            | "bagian"
            | "wilayah"
            | "daerah"
            | "negara"
            | "kawasan"
            | "sana-sini"
    )
}

fn is_ke_split(w: &str) -> bool {
    matches!(
        w,
        "sini"
            | "sana"
            | "situ"
            | "mana"
            | "atas"
            | "bawah"
            | "dalam"
            | "depan"
            | "belakang"
            | "samping"
            | "tengah"
            | "rumah"
            | "kantor"
            | "sekolah"
            | "pasar"
            | "kota"
            | "kampus"
    )
}

fn spelling_fix(w: &str) -> Option<&'static str> {
    Some(match w {
        "aktifitas" => "aktivitas",
        "analisa" => "analisis",
        "apotik" => "apotek",
        "atlit" => "atlet",
        "nasehat" => "nasihat",
        "resiko" => "risiko",
        "sekedar" => "sekadar",
        "praktek" => "praktik",
        "merubah" => "mengubah",
        "ijin" => "izin",
        "jaman" => "zaman",
        "jadual" => "jadwal",
        "kwitansi" => "kuitansi",
        "karir" => "karier",
        "obyek" => "objek",
        "subyek" => "subjek",
        "sistim" => "sistem",
        "telpon" => "telepon",
        "menelpon" => "menelepon",
        "ditelpon" => "ditelepon",
        "ilmuan" => "ilmuwan",
        "survey" => "survei",
        "disurvey" => "disurvei",
        "standarisasi" => "standardisasi",
        "hutang" => "utang",
        "silahkan" => "silakan",
        "nafas" => "napas",
        "fikir" => "pikir",
        "faham" => "paham",
        "samudera" => "samudra",
        "propinsi" => "provinsi",
        "efektifitas" => "efektivitas",
        "produktifitas" => "produktivitas",
        "kreatifitas" => "kreativitas",
        "tehnik" => "teknik",
        "tehnologi" => "teknologi",
        "ekstrim" => "ekstrem",
        "frekwensi" => "frekuensi",
        "kwalitas" => "kualitas",
        "kwartal" => "kuartal",
        "trampil" => "terampil",
        "terlanjur" => "telanjur",
        "antri" => "antre",
        "cidera" => "cedera",
        "jenasah" => "jenazah",
        "himbauan" => "imbauan",
        "menghimbau" => "mengimbau",
        "detil" => "detail",
        "mengkonfirmasi" => "mengonfirmasi",
        "mengkonsumsi" => "mengonsumsi",
        "mempesona" => "memesona",
        "mentaati" => "menaati",
        "mensukseskan" => "menyukseskan",
        "konkrit" | "kongkrit" => "konkret",
        "lembab" => "lembap",
        "nampak" => "tampak",
        "negri" => "negeri",
        "pebruari" => "Februari",
        "nopember" => "November",
        "rejeki" => "rezeki",
        "sholat" | "shalat" => "salat",
        "ramadhan" => "Ramadan",
        "do'a" => "doa",
        "sorga" => "surga",
        "walikota" => "wali kota",
        "satupun" => "satu pun",
        "kadaluarsa" | "kadaluwarsa" => "kedaluwarsa",
        "orangtua" => "orang tua",
        "tanggungjawab" => "tanggung jawab",
        "kerjasama" => "kerja sama",
        "sepakbola" => "sepak bola",
        "seksama" => "saksama",
        "mempengaruhi" => "memengaruhi",
        "mengenyampingkan" => "mengesampingkan",
        _ => return None,
    })
}

const SPOKEN_PUNCT: &[(&[&str], &str)] = &[
    (&["buka", "tanda", "petik"], "\""),
    (&["tutup", "tanda", "petik"], "\""),
    (&["tanda", "petik"], "\""),
    (&["buka", "kurung"], "("),
    (&["dalam", "kurung"], "("),
    (&["tutup", "kurung"], ")"),
    (&["tanda", "tanya"], "?"),
    (&["tanda", "seru"], "!"),
    (&["titik", "koma"], ";"),
    (&["baris", "baru"], "\n"),
];

fn is_punct_attach_left(t: &str) -> bool {
    matches!(t, "," | "." | "?" | "!" | ";" | ":" | ")" | "%")
}

fn is_punct_attach_right(c: char) -> bool {
    c == '('
}

// ---------------------------------------------------------------------------
// Tokenizer / detokenizer (char scan)
// ---------------------------------------------------------------------------

fn is_word_extra(ch: char) -> bool {
    matches!(
        ch,
        '-' | '\'' | '’' | '@' | '/' | '&' | '_' | '+' | '²' | '³' | '°' | '$' | '€' | '£' | '¥'
    )
}

fn tokenize(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let n = chars.len();
    let mut toks = Vec::new();
    let mut cur = String::new();

    for i in 0..n {
        let ch = chars[i];
        if ch == '\n' {
            if !cur.is_empty() {
                toks.push(std::mem::take(&mut cur));
            }
            toks.push("\n".to_string());
        } else if ch.is_alphanumeric() || is_word_extra(ch) {
            cur.push(ch);
        } else if ch == '.'
            && !cur.is_empty()
            && cur.chars().last().is_some_and(|c| c.is_alphanumeric())
            && i + 1 < n
            && chars[i + 1].is_alphanumeric()
        {
            // Keep '.' inside numbers (25.000, 10.30) and domains/emails (tokopedia.co.id).
            cur.push(ch);
        } else if ch == ','
            && !cur.is_empty()
            && cur.chars().last().is_some_and(|c| c.is_ascii_digit())
            && i + 1 < n
            && chars[i + 1].is_ascii_digit()
        {
            // Keep ',' inside Indonesian decimals (2,5).
            cur.push(ch);
        } else {
            if !cur.is_empty() {
                toks.push(std::mem::take(&mut cur));
            }
            if !ch.is_whitespace() {
                toks.push(ch.to_string());
            }
        }
    }
    if !cur.is_empty() {
        toks.push(cur);
    }
    toks
}

fn detokenize(toks: &[String]) -> String {
    let mut out = String::new();
    for t in toks {
        if t == "\n" {
            out.push('\n');
        } else if out.is_empty() || out.ends_with('\n') {
            out.push_str(t);
        } else if is_punct_attach_left(t) {
            out.push_str(t);
        } else if out.chars().last().is_some_and(is_punct_attach_right) {
            out.push_str(t);
        } else {
            out.push(' ');
            out.push_str(t);
        }
    }
    out
}

fn is_word(t: &str) -> bool {
    t.chars().any(|c| c.is_alphabetic())
}

fn starts_with_digit(t: &str) -> bool {
    t.chars().next().is_some_and(|c| c.is_ascii_digit())
}

fn is_all_ascii_digits(t: &str) -> bool {
    !t.is_empty() && t.bytes().all(|b| b.is_ascii_digit())
}

fn capitalize_first(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        None => String::new(),
        Some(first) => {
            let mut res = String::with_capacity(s.len());
            for u in first.to_uppercase() {
                res.push(u);
            }
            res.push_str(chars.as_str());
            res
        }
    }
}

fn match_seq(toks: &[String], i: usize, seq: &[&str]) -> bool {
    if i + seq.len() > toks.len() {
        return false;
    }
    seq.iter()
        .enumerate()
        .all(|(k, &want)| toks[i + k].to_lowercase() == want)
}

// ---------------------------------------------------------------------------
// Number helpers
// ---------------------------------------------------------------------------

fn parse_number_run(words: &[String]) -> Option<(u64, usize)> {
    let mut total: u64 = 0;
    let mut small: u64 = 0;
    let mut pending: Option<u64> = None;
    let mut best: Option<(u64, usize)> = None;

    for (i, w) in words.iter().enumerate() {
        let w = w.as_str();
        let teen_or_ten = (10..20).contains(&(small % 100));
        if let Some(u) = unit_val(w) {
            if pending.is_some() || small % 10 != 0 || teen_or_ten {
                break;
            }
            pending = Some(u);
        } else if let Some(v) = teens_se_val(w) {
            if pending.is_some() || (v == 100 && small != 0) || (v < 100 && small % 100 != 0) {
                break;
            }
            small += v;
        } else if w == "belas" {
            match pending {
                Some(p) if p > 0 && small % 100 == 0 => {
                    small += 10 + p;
                    pending = None;
                }
                _ => break,
            }
        } else if w == "puluh" {
            match pending {
                Some(p) if p >= 2 && small % 100 == 0 => {
                    small += p * 10;
                    pending = None;
                }
                _ => break,
            }
        } else if w == "ratus" {
            match pending {
                Some(p) if p >= 2 && small == 0 => {
                    small += p * 100;
                    pending = None;
                }
                _ => break,
            }
        } else if let Some(sc) = se_scale_val(w) {
            if pending.is_some() || small != 0 {
                break;
            }
            total = total.saturating_add(sc);
            small = 0;
            pending = None;
        } else if let Some(sc) = scale_val(w) {
            let base = small + pending.unwrap_or(0);
            if base == 0 {
                break;
            }
            total = total.saturating_add(base.saturating_mul(sc));
            small = 0;
            pending = None;
        } else {
            break;
        }
        best = Some((total + small + pending.unwrap_or(0), i + 1));
    }
    best
}

fn fmt_int(v: u64, year_like: bool) -> String {
    let s = v.to_string();
    if year_like || v < 1000 {
        return s;
    }
    if v < 10_000 && v % 100 != 0 {
        return s;
    }
    let bytes = s.as_bytes();
    let mut parts: Vec<&str> = Vec::new();
    let mut end = bytes.len();
    while end > 3 {
        parts.push(std::str::from_utf8(&bytes[end - 3..end]).unwrap());
        end -= 3;
    }
    parts.push(std::str::from_utf8(&bytes[0..end]).unwrap());
    parts.reverse();
    parts.join(".")
}

// ---------------------------------------------------------------------------
// Passes
// ---------------------------------------------------------------------------

fn pass_spoken_punct(toks: Vec<String>) -> Vec<String> {
    let mut out = Vec::with_capacity(toks.len());
    let mut i = 0;
    while i < toks.len() {
        let mut matched = false;
        for &(seq, sym) in SPOKEN_PUNCT {
            if match_seq(&toks, i, seq) {
                out.push(sym.to_string());
                i += seq.len();
                matched = true;
                break;
            }
        }
        if matched {
            continue;
        }
        // Single-word "koma" -> "," unless it is an Indonesian decimal ("dua koma lima" / "2 koma 5").
        if toks[i].to_lowercase() == "koma" {
            let prev_is_num = out.last().is_some_and(|p| {
                let lp = p.to_lowercase();
                is_number_word(&lp) || starts_with_digit(p)
            });
            let next_is_unit = toks.get(i + 1).is_some_and(|n| {
                let ln = n.to_lowercase();
                unit_val(&ln).is_some() || starts_with_digit(n)
            });
            if !(prev_is_num && next_is_unit) {
                out.push(",".to_string());
                i += 1;
                continue;
            }
        }
        out.push(toks[i].clone());
        i += 1;
    }
    out
}

fn pass_spelled(toks: Vec<String>) -> Vec<String> {
    let mut out = Vec::with_capacity(toks.len());
    let mut i = 0;
    while i < toks.len() {
        let mut j = i;
        while j < toks.len() && letter_name(&toks[j].to_lowercase()).is_some() {
            j += 1;
        }
        let run = &toks[i..j];
        let strong = run
            .iter()
            .filter(|t| !is_ambiguous_letter(&t.to_lowercase()))
            .count();
        if run.len() >= MIN_SPELLED && strong >= MIN_STRONG_LETTERS {
            let mut joined = String::with_capacity(run.len());
            for t in run {
                joined.push_str(letter_name(&t.to_lowercase()).unwrap());
            }
            out.push(joined);
            i = j;
            continue;
        }

        // Single capital letters written by ASR: "M P" / "P. D. F."
        let mut k = i;
        let mut letters = String::new();
        while k < toks.len() {
            let mut chs = toks[k].chars();
            let is_single_upper = match (chs.next(), chs.next()) {
                (Some(c), None) => c.is_alphabetic() && c.is_uppercase(),
                _ => false,
            };
            if !is_single_upper {
                break;
            }
            letters.push_str(&toks[k]);
            k += 1;
            if k + 1 < toks.len() && toks[k] == "." {
                let mut nchs = toks[k + 1].chars();
                let next_upper = match (nchs.next(), nchs.next()) {
                    (Some(c), None) => c.is_alphabetic() && c.is_uppercase(),
                    _ => false,
                };
                if next_upper {
                    k += 1;
                }
            }
        }
        if letters.chars().count() >= 2 {
            out.push(letters);
            i = k;
            continue;
        }

        out.push(toks[i].clone());
        i += 1;
    }
    out
}

fn pass_numbers(toks: Vec<String>, datetime_ctx: bool) -> Vec<String> {
    let mut out: Vec<String> = Vec::with_capacity(toks.len());
    let mut i = 0;
    while i < toks.len() {
        let t = toks[i].to_lowercase();
        let mut ke_prefix = false;
        let end = (i + 12).min(toks.len());
        let mut words: Vec<String> = toks[i..end].iter().map(|x| x.to_lowercase()).collect();

        if let Some(rest) = t.strip_prefix("ke") {
            if unit_val(rest).is_some()
                && i + 1 < toks.len()
                && is_mult(&toks[i + 1].to_lowercase())
            {
                words[0] = rest.to_string();
                ke_prefix = true;
            }
        }

        if !words.is_empty() && is_number_word(&words[0]) && !is_mult(&words[0]) {
            if let Some((mut val, n)) = parse_number_run(&words) {
                if n > 0 {
                    let nxt = toks
                        .get(i + n)
                        .map(|s| s.to_lowercase())
                        .unwrap_or_default();
                    let prev = out.last().map(|s| s.to_lowercase()).unwrap_or_default();

                    let mut dec = String::new();
                    let mut k = i + n;
                    if nxt == "koma"
                        && k + 1 < toks.len()
                        && unit_val(&toks[k + 1].to_lowercase()).is_some()
                    {
                        k += 1;
                        while k < toks.len() {
                            if let Some(d) = unit_val(&toks[k].to_lowercase()) {
                                dec.push_str(&d.to_string());
                                k += 1;
                            } else {
                                break;
                            }
                        }
                    }

                    let mut force = n > 1
                        || val >= MIN_STANDALONE
                        || !dec.is_empty()
                        || ke_prefix
                        || is_num_context_before(&prev)
                        || is_unit_head(&nxt)
                        || is_currency_head(&nxt)
                        || (datetime_ctx && (is_time_context_before(&prev) || is_month(&nxt)));

                    if words[0] == "satu" && n == 1 && prev == "salah" {
                        force = false;
                    }

                    if force {
                        let mut scale_word: Option<String> = None;
                        let last = words[n - 1].as_str();
                        if is_scale_word_kept(last) && dec.is_empty() && val >= 1_000_000 {
                            if let Some(sc) = scale_val(last) {
                                if val % sc == 0 {
                                    val /= sc;
                                    scale_word = Some(last.to_string());
                                }
                            }
                        }
                        let year_like = is_year_context_before(&prev)
                            || ((1000..2100).contains(&val) && val % 100 != 0);
                        let mut s = fmt_int(val, year_like);
                        if !dec.is_empty() {
                            s.push(',');
                            s.push_str(&dec);
                        }
                        if ke_prefix {
                            s = format!("ke-{s}");
                        }
                        out.push(s);
                        if let Some(sw) = scale_word {
                            out.push(sw);
                        }
                        i = if !dec.is_empty() { k } else { i + n };
                        continue;
                    }
                }
            }
        }
        out.push(toks[i].clone());
        i += 1;
    }

    // "ke 24" -> "ke-24"
    let mut res: Vec<String> = Vec::with_capacity(out.len());
    for t in out {
        if let Some(last) = res.last_mut() {
            if last.to_lowercase() == "ke" && starts_with_digit(&t) {
                last.push('-');
                last.push_str(&t);
                continue;
            }
        }
        res.push(t);
    }
    res
}

fn pass_units(toks: Vec<String>) -> Vec<String> {
    let mut out = Vec::with_capacity(toks.len());
    let mut i = 0;
    while i < toks.len() {
        let t = &toks[i];
        if starts_with_digit(t) {
            let mut j = i + 1;
            let mut scale = String::new();
            if j < toks.len() && is_scale_word_kept(&toks[j].to_lowercase()) {
                scale = format!(" {}", toks[j].to_lowercase());
                j += 1;
            }
            let mut done = false;
            for &(seq, sym) in CURRENCY_AFTER {
                if match_seq(&toks, j, seq) {
                    out.push(format!("{sym}{t}{scale}"));
                    i = j + seq.len();
                    done = true;
                    break;
                }
            }
            if !done && scale.is_empty() {
                for &(seq, sym) in UNIT_TABLE {
                    if match_seq(&toks, j, seq) {
                        if matches!(sym, "%" | "°C" | "°F" | "°") {
                            out.push(format!("{t}{sym}"));
                        } else {
                            out.push(t.clone());
                            out.push(sym.to_string());
                        }
                        i = j + seq.len();
                        done = true;
                        break;
                    }
                }
            }
            if done {
                continue;
            }
        }
        let lt = t.to_lowercase();
        if matches!(lt.as_str(), "rp" | "rupiah")
            && i + 1 < toks.len()
            && starts_with_digit(&toks[i + 1])
        {
            out.push(format!("Rp{}", toks[i + 1]));
            i += 2;
            continue;
        }
        if matches!(t.as_str(), "$" | "US$" | "€")
            && i + 1 < toks.len()
            && starts_with_digit(&toks[i + 1])
        {
            out.push(format!("{t}{}", toks[i + 1]));
            i += 2;
            continue;
        }
        out.push(t.clone());
        i += 1;
    }
    out
}

fn pass_datetime(toks: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::with_capacity(toks.len());
    let mut i = 0;
    while i < toks.len() {
        let t = &toks[i];
        let lt = t.to_lowercase();
        if matches!(lt.as_str(), "jam" | "pukul") && i + 1 < toks.len() {
            if toks[i + 1].to_lowercase() == "setengah"
                && i + 2 < toks.len()
                && is_all_ascii_digits(&toks[i + 2])
            {
                if let Ok(h_raw) = toks[i + 2].parse::<i32>() {
                    let h = (h_raw - 1).rem_euclid(24);
                    out.push(t.clone());
                    out.push(format!("{h}.30"));
                    i += 3;
                    continue;
                }
            }
            if is_all_ascii_digits(&toks[i + 1]) {
                if let Ok(h) = toks[i + 1].parse::<u32>() {
                    if h < 25 {
                        let mut j = i + 2;
                        if j < toks.len()
                            && matches!(toks[j].to_lowercase().as_str(), "lewat" | "lebih")
                        {
                            j += 1;
                        }
                        if j < toks.len() && is_all_ascii_digits(&toks[j]) {
                            if let Ok(m) = toks[j].parse::<u32>() {
                                if m < 60 && (j > i + 2 || toks[j].len() == 2 || m >= 10) {
                                    let after = toks
                                        .get(j + 1)
                                        .map(|s| s.to_lowercase())
                                        .unwrap_or_default();
                                    if after != "menit" {
                                        out.push(t.clone());
                                        out.push(format!("{h}.{m:02}"));
                                        i = j + 1;
                                        continue;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        let fixed = fix_month_or_day(&lt);
        if is_month(fixed) || is_day(fixed) {
            let prev = out.last().map(|s| s.to_lowercase()).unwrap_or_default();
            let nxt = toks
                .get(i + 1)
                .map(|s| s.to_lowercase())
                .unwrap_or_default();
            if is_month(fixed)
                && (starts_with_digit(&prev)
                    || matches!(
                        prev.as_str(),
                        "bulan" | "tanggal" | "akhir" | "awal" | "pertengahan"
                    )
                    || starts_with_digit(&nxt))
            {
                out.push(capitalize_first(fixed));
                i += 1;
                continue;
            }
            if is_day(fixed) && fixed != "minggu" {
                out.push(capitalize_first(fixed));
                i += 1;
                continue;
            }
            if fixed == "minggu" && prev == "hari" {
                out.push("Minggu".to_string());
                i += 1;
                continue;
            }
        }

        out.push(t.clone());
        i += 1;
    }
    out
}

fn pass_urls(toks: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::with_capacity(toks.len());
    let mut i = 0;
    while i < toks.len() {
        if toks[i].to_lowercase() == "titik"
            && out.last().is_some_and(|p| is_word(p))
            && i + 1 < toks.len()
            && is_tld(&toks[i + 1].to_lowercase())
        {
            let tld = toks[i + 1].to_lowercase();
            let last = out.last_mut().unwrap();
            last.push('.');
            last.push_str(&tld);
            i += 2;
            continue;
        }
        if toks[i].to_lowercase() == "www" || match_seq(&toks, i, &["w", "w", "w"]) {
            let step = if toks[i].to_lowercase() == "www" { 1 } else { 3 };
            if i + step < toks.len() && toks[i + step].to_lowercase() == "titik" {
                out.push("www".to_string());
                i += step;
                continue;
            }
        }
        out.push(toks[i].clone());
        i += 1;
    }

    // Second sweep: '@' and URL path words next to a dotted host.
    let mut res: Vec<String> = Vec::with_capacity(out.len());
    let mut i = 0;
    while i < out.len() {
        let t = &out[i];
        if is_at_word(&t.to_lowercase())
            && res.last().is_some_and(|p| is_word(p))
            && i + 1 < out.len()
            && out[i + 1].contains('.')
        {
            let host = out[i + 1].to_lowercase();
            let last = res.last_mut().unwrap();
            last.push('@');
            last.push_str(&host);
            i += 2;
            continue;
        }
        let mut joined = false;
        for &(seq, sym) in URL_WORDS {
            if match_seq(&out, i, seq)
                && res.last().is_some_and(|p| p.contains('.'))
                && i + seq.len() < out.len()
            {
                let next_seg = out[i + seq.len()].clone();
                let last = res.last_mut().unwrap();
                last.push_str(sym);
                last.push_str(&next_seg);
                i += seq.len() + 1;
                joined = true;
                break;
            }
        }
        if joined {
            continue;
        }
        res.push(t.clone());
        i += 1;
    }
    res
}

fn pass_affix(toks: Vec<String>, v: &Vocab, di_join: bool, nya_hyphen: bool) -> Vec<String> {
    let mut out = Vec::with_capacity(toks.len());
    let mut i = 0;
    while i < toks.len() {
        let t = &toks[i];
        let lt = t.to_lowercase();

        if di_join {
            if lt == "di" {
                if let Some(nxt) = toks.get(i + 1) {
                    let nxt_alpha_lower = !nxt.is_empty()
                        && nxt.chars().all(|c| c.is_alphabetic() && c.is_lowercase());
                    let lnxt = nxt.to_lowercase();
                    if nxt_alpha_lower && !is_di_split(&lnxt) && v.di_derivable(&lnxt) {
                        out.push(format!("{t}{nxt}"));
                        i += 2;
                        continue;
                    }
                }
            }
            if let Some(rest) = lt.strip_prefix("di") {
                if is_di_split(rest) {
                    let split_at = t.char_indices().nth(2).map(|(idx, _)| idx).unwrap_or(t.len());
                    out.push(t[..split_at].to_string());
                    out.push(t[split_at..].to_string());
                    i += 1;
                    continue;
                }
            }
            if let Some(rest) = lt.strip_prefix("ke") {
                if is_ke_split(rest) {
                    let split_at = t.char_indices().nth(2).map(|(idx, _)| idx).unwrap_or(t.len());
                    out.push(t[..split_at].to_string());
                    out.push(t[split_at..].to_string());
                    i += 1;
                    continue;
                }
            }
        }

        if nya_hyphen && lt.ends_with("nya") && lt.len() > 5 {
            let stem = &lt[..lt.len() - 3];
            if v.is_loan_word(stem) {
                let split_at = t.len() - 3;
                out.push(format!("{}-{}", &t[..split_at], &t[split_at..]));
                i += 1;
                continue;
            }
        }

        out.push(t.clone());
        i += 1;
    }
    out
}

fn pass_spelling(toks: Vec<String>) -> Vec<String> {
    let mut out = Vec::with_capacity(toks.len());
    for t in toks {
        let lt = t.to_lowercase();
        if let Some(fix) = spelling_fix(&lt) {
            if fix != lt {
                let t_upper = t.chars().next().is_some_and(|c| c.is_uppercase());
                let fix_lower = fix.chars().next().is_some_and(|c| c.is_lowercase());
                let adjusted = if t_upper && fix_lower {
                    capitalize_first(fix)
                } else {
                    fix.to_string()
                };
                for part in adjusted.split(' ') {
                    out.push(part.to_string());
                }
                continue;
            }
        }
        out.push(t);
    }
    out
}

fn pass_case_punct(toks: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::with_capacity(toks.len() + 1);
    for t in toks {
        if let Some(prev) = out.last_mut() {
            let t_punct = matches!(t.as_str(), "," | "." | "?" | "!" | ";" | ":");
            let p_punct = matches!(prev.as_str(), "," | "." | "?" | "!" | ";" | ":");
            if t_punct && p_punct {
                if matches!(t.as_str(), "." | "?" | "!") {
                    *prev = t;
                }
                continue;
            }
        }
        out.push(t);
    }

    while out
        .first()
        .is_some_and(|t| matches!(t.as_str(), "," | "." | ";" | ":"))
    {
        out.remove(0);
    }

    let mut cap_next = true;
    for t in &mut out {
        if t == "\n" {
            cap_next = true;
            continue;
        }
        let is_url_or_email = t.contains('@') || t.contains('.');
        if is_word(t) && cap_next {
            if !is_url_or_email && t.chars().next().is_some_and(|c| c.is_alphabetic() && c.is_lowercase()) {
                *t = capitalize_first(t);
            }
            cap_next = false;
        } else if !matches!(
            t.as_str(),
            "," | "." | "?" | "!" | ";" | ":" | "(" | ")" | "\"" | "'"
        ) {
            cap_next = false;
        }
        if matches!(t.as_str(), "." | "?" | "!") {
            cap_next = true;
        }
    }

    if let Some(last) = out.last() {
        if !matches!(last.as_str(), "." | "?" | "!" | "\n") {
            out.push(".".to_string());
        }
    }
    out
}

pub fn normalize(text: &str, v: &Vocab, o: &NormOptions) -> String {
    let mut toks = tokenize(text);
    if o.spoken_punct {
        toks = pass_spoken_punct(toks);
    }
    if o.acronyms {
        toks = pass_spelled(toks);
    }
    if o.numbers {
        toks = pass_numbers(toks, o.dates);
    }
    if o.units == UnitsStyle::Symbols {
        toks = pass_units(toks);
    }
    if o.dates {
        toks = pass_datetime(toks);
    }
    if o.urls {
        toks = pass_urls(toks);
    }
    if o.di_join || o.nya_hyphen {
        toks = pass_affix(toks, v, o.di_join, o.nya_hyphen);
    }
    if o.spelling {
        toks = pass_spelling(toks);
    }
    if o.casing {
        toks = pass_case_punct(toks);
    }
    detokenize(&toks)
}
