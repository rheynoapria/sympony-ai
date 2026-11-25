//! Drop Actions' file work in Rust, for where the Mac's own tools (`ditto`, `zip`, `cp`, `mv`) don't exist:
//! zipping files and folders, extracting a zip safely, copying a folder whole, moving across drives.
use std::io::Write;
use std::path::{Path, PathBuf};

/// Zips `items` (files and folders) into `out`, each under its own name: a folder with everything in it, its empty
/// folders too, the way Finder's Compress keeps it. Two items with the same name (from different folders) get
/// "name 2" for the second. Symbolic links are left out. A file already at `out` is never touched; when it fails,
/// nothing it began is left behind.
pub fn zip_items(out: &Path, items: &[PathBuf]) -> Result<(), String> {
    let file = std::fs::File::create_new(out).map_err(|e| format!("{}: {e}", out.display()))?;
    let r = (|| -> Result<(), String> {
        let mut zip = zip::ZipWriter::new(std::io::BufWriter::new(file));
        let mut top: Vec<String> = Vec::new();
        for item in items {
            let name = item.file_name().map(|n| n.to_string_lossy().into_owned()).filter(|n| !n.is_empty()).unwrap_or_else(|| "item".into());
            let name = crate::shelf::unique_name(&name, &|n| top.iter().any(|t| t.eq_ignore_ascii_case(n)));
            top.push(name.clone());
            add(&mut zip, item, &name)?;
        }
        zip.finish().map_err(|e| e.to_string())?.flush().map_err(|e| e.to_string())?;
        Ok(())
    })();
    if r.is_err() {
        let _ = std::fs::remove_file(out);
    }
    r
}

fn options(meta: &std::fs::Metadata) -> zip::write::SimpleFileOptions {
    let o = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    match meta.modified().ok().and_then(zip_time) {
        Some(t) => o.last_modified_time(t),
        None => o,
    }
}

fn add<W: Write + std::io::Seek>(zip: &mut zip::ZipWriter<W>, path: &Path, name: &str) -> Result<(), String> {
    let meta = std::fs::symlink_metadata(path).map_err(|e| format!("{}: {e}", path.display()))?;
    if meta.file_type().is_symlink() {
        return Ok(());
    }
    if meta.is_dir() {
        zip.add_directory(format!("{name}/"), options(&meta)).map_err(|e| e.to_string())?;
        let mut children: Vec<PathBuf> = std::fs::read_dir(path).map_err(|e| format!("{}: {e}", path.display()))?
            .filter_map(|e| e.ok().map(|e| e.path())).collect();
        children.sort();
        for c in children {
            let child = c.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            add(zip, &c, &format!("{name}/{child}"))?;
        }
        return Ok(());
    }
    zip.start_file(name, options(&meta)).map_err(|e| e.to_string())?;
    let mut f = std::fs::File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    std::io::copy(&mut f, zip).map_err(|e| e.to_string())?;
    Ok(())
}

/// The zip format's local time for a file's time (zip keeps 1980 to 2107, even seconds).
fn zip_time(t: std::time::SystemTime) -> Option<zip::DateTime> {
    use chrono::{Datelike, Timelike};
    let l: chrono::DateTime<chrono::Local> = t.into();
    zip::DateTime::from_date_and_time(u16::try_from(l.year()).ok()?, l.month() as u8, l.day() as u8, l.hour() as u8, l.minute() as u8, l.second() as u8).ok()
}

fn system_time(t: zip::DateTime) -> Option<std::time::SystemTime> {
    use chrono::TimeZone;
    let naive = chrono::NaiveDate::from_ymd_opt(t.year().into(), t.month().into(), t.day().into())?
        .and_hms_opt(t.hour().into(), t.minute().into(), t.second().into())?;
    chrono::Local.from_local_datetime(&naive).earliest().map(Into::into)
}

/// Extracts the zip `archive` into the folder `out` (made here), streaming each file, its times kept. An entry that
/// would land outside `out` (`..`, an absolute path) stops it with nothing more written; symbolic links are left out.
/// The number of files written.
pub fn extract(archive: &Path, out: &Path) -> Result<usize, String> {
    let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(std::io::BufReader::new(file)).map_err(|_| "it isn’t a zip archive, or it’s damaged".to_string())?;
    // (every name checked before anything is written)
    for i in 0..zip.len() {
        let entry = zip.by_index(i).map_err(|_| "the archive is damaged".to_string())?;
        if entry.enclosed_name().is_none() {
            return Err("the archive holds a path outside its folder".into());
        }
    }
    std::fs::create_dir_all(out).map_err(|e| e.to_string())?;
    let mut n = 0;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|_| "the archive is damaged".to_string())?;
        if entry.is_symlink() || entry.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000) {
            continue;
        }
        let Some(rel) = entry.enclosed_name() else { continue };
        let dst = out.join(rel);
        if entry.is_dir() {
            std::fs::create_dir_all(&dst).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(p) = dst.parent() {
            std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
        }
        let mut f = std::fs::File::create(&dst).map_err(|e| format!("{}: {e}", dst.display()))?;
        std::io::copy(&mut entry, &mut f).map_err(|_| "the archive is damaged".to_string())?;
        if let Some(t) = entry.last_modified().and_then(system_time) {
            let _ = f.set_modified(t);
        }
        n += 1;
    }
    Ok(n)
}

/// Copies a file, or a folder with everything in it, to `dst`, which mustn't be there yet (nothing is ever copied
/// over), nor inside the folder copied. Files keep their times; symbolic links are left out.
pub fn copy_tree(src: &Path, dst: &Path) -> Result<(), String> {
    fit(src, dst)?;
    copy_all(src, dst)
}

/// Whether `src` can go to `dst`: nothing there yet, and not into itself (a folder copied or moved into one of its
/// own folders would never end).
fn fit(src: &Path, dst: &Path) -> Result<(), String> {
    if std::fs::symlink_metadata(dst).is_ok() {
        return Err(format!("{} is already there", dst.display()));
    }
    let (Ok(from), Some(Ok(into))) = (src.canonicalize(), dst.parent().map(Path::canonicalize)) else { return Ok(()) };
    if src.is_dir() && into.starts_with(&from) {
        return Err("a folder can’t go into itself".into());
    }
    Ok(())
}

fn copy_all(src: &Path, dst: &Path) -> Result<(), String> {
    let meta = std::fs::symlink_metadata(src).map_err(|e| format!("{}: {e}", src.display()))?;
    if meta.file_type().is_symlink() {
        return Ok(());
    }
    if !meta.is_dir() {
        std::fs::copy(src, dst).map_err(|e| format!("{}: {e}", src.display()))?;
        if let Ok(t) = meta.modified() {
            let _ = std::fs::File::options().write(true).open(dst).and_then(|f| f.set_modified(t));
        }
        return Ok(());
    }
    std::fs::create_dir(dst).map_err(|e| format!("{}: {e}", dst.display()))?;
    for e in std::fs::read_dir(src).map_err(|e| format!("{}: {e}", src.display()))? {
        let e = e.map_err(|e| e.to_string())?;
        copy_all(&e.path(), &dst.join(e.file_name()))?;
    }
    Ok(())
}

/// Moves a file or folder to `dst`, which mustn't be there yet (Windows' rename would replace a file): renamed in
/// place on the same drive, else copied whole and the original removed once the copy is complete.
pub fn move_path(src: &Path, dst: &Path) -> Result<(), String> {
    fit(src, dst)?;
    match std::fs::rename(src, dst) {
        Ok(()) => Ok(()),
        Err(e) if other_drive(&e) => move_by_copy(src, dst),
        Err(e) => Err(format!("{}: {e}", src.display())),
    }
}

/// Whether a rename failed because the two places are on different drives (Windows' ERROR_NOT_SAME_DEVICE, EXDEV).
fn other_drive(e: &std::io::Error) -> bool {
    matches!(e.raw_os_error(), Some(17) if cfg!(windows)) || matches!(e.raw_os_error(), Some(18) if !cfg!(windows))
}

fn move_by_copy(src: &Path, dst: &Path) -> Result<(), String> {
    if let Err(e) = copy_all(src, dst) {
        // (half a copy isn't left beside a whole original)
        let _ = if dst.is_dir() { std::fs::remove_dir_all(dst) } else { std::fs::remove_file(dst) };
        return Err(e);
    }
    let r = if src.is_dir() { std::fs::remove_dir_all(src) } else { std::fs::remove_file(src) };
    r.map_err(|e| format!("copied, but the original couldn’t be removed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh folder under the temp folder, removed when dropped.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new(tag: &str) -> Scratch {
            let d = std::env::temp_dir().join(format!("sy-archive-{tag}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&d);
            std::fs::create_dir_all(&d).unwrap();
            Scratch(d)
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn names_in(zip: &Path) -> Vec<String> {
        let mut a = zip::ZipArchive::new(std::fs::File::open(zip).unwrap()).unwrap();
        let mut v: Vec<String> = (0..a.len()).map(|i| a.by_index(i).unwrap().name().unwrap().into_owned()).collect();
        v.sort();
        v
    }

    /// A folder like a user's: a file, a sub-folder with a non-ASCII name, an empty folder.
    fn project(root: &Path) -> PathBuf {
        let p = root.join("Laporan Q4");
        std::fs::create_dir_all(p.join("gambar ü")).unwrap();
        std::fs::create_dir_all(p.join("kosong")).unwrap();
        std::fs::write(p.join("catatan.txt"), "halo").unwrap();
        std::fs::write(p.join("gambar ü").join("a.png"), [1u8, 2, 3]).unwrap();
        p
    }

    #[test]
    fn a_folder_zips_whole_under_its_name_and_extracts_back_the_same() {
        let s = Scratch::new("zip");
        let folder = project(&s.0);
        let note = s.0.join("one.txt");
        std::fs::write(&note, "one").unwrap();
        let out = s.0.join("Archive.zip");
        zip_items(&out, &[folder.clone(), note]).unwrap();
        assert_eq!(names_in(&out), vec!["Laporan Q4/", "Laporan Q4/catatan.txt", "Laporan Q4/gambar ü/", "Laporan Q4/gambar ü/a.png", "Laporan Q4/kosong/", "one.txt"]);
        let back = s.0.join("back");
        assert_eq!(extract(&out, &back).unwrap(), 3);
        assert_eq!(std::fs::read_to_string(back.join("Laporan Q4").join("catatan.txt")).unwrap(), "halo");
        assert_eq!(std::fs::read(back.join("Laporan Q4").join("gambar ü").join("a.png")).unwrap(), vec![1, 2, 3]);
        assert!(back.join("Laporan Q4").join("kosong").is_dir());
        assert_eq!(std::fs::read_to_string(back.join("one.txt")).unwrap(), "one");
        // a file's time comes back (zip keeps even seconds)
        let was = std::fs::metadata(folder.join("catatan.txt")).unwrap().modified().unwrap();
        let now = std::fs::metadata(back.join("Laporan Q4").join("catatan.txt")).unwrap().modified().unwrap();
        let gap = if was > now { was.duration_since(now) } else { now.duration_since(was) }.unwrap();
        assert!(gap.as_secs() <= 2, "{gap:?}");
    }

    #[test]
    fn two_items_with_one_name_both_go_in() {
        let s = Scratch::new("same");
        for d in ["a", "b"] {
            std::fs::create_dir_all(s.0.join(d)).unwrap();
            std::fs::write(s.0.join(d).join("notes.txt"), d).unwrap();
        }
        let out = s.0.join("Archive.zip");
        zip_items(&out, &[s.0.join("a").join("notes.txt"), s.0.join("b").join("notes.txt")]).unwrap();
        assert_eq!(names_in(&out), vec!["notes 2.txt", "notes.txt"]);
    }

    #[test]
    fn a_zip_that_fails_leaves_nothing_behind() {
        let s = Scratch::new("fail");
        let out = s.0.join("x.zip");
        assert!(zip_items(&out, &[s.0.join("gone.txt")]).is_err());
        assert!(!out.exists());
    }

    #[test]
    fn an_archive_reaching_outside_its_folder_writes_nothing() {
        let s = Scratch::new("slip");
        let bad = s.0.join("bad.zip");
        let mut z = zip::ZipWriter::new(std::fs::File::create(&bad).unwrap());
        z.start_file("fine.txt", zip::write::SimpleFileOptions::default()).unwrap();
        z.write_all(b"ok").unwrap();
        z.start_file("../escaped.txt", zip::write::SimpleFileOptions::default()).unwrap();
        z.write_all(b"no").unwrap();
        z.finish().unwrap();
        let out = s.0.join("out");
        assert!(extract(&bad, &out).is_err());
        assert!(!s.0.join("escaped.txt").exists());
        assert!(!out.join("fine.txt").exists());
        // and something that isn't a zip says so
        std::fs::write(s.0.join("not.zip"), "text").unwrap();
        assert!(extract(&s.0.join("not.zip"), &s.0.join("out2")).is_err());
    }

    #[test]
    fn a_folder_copies_whole_and_a_move_by_copy_leaves_only_the_copy() {
        let s = Scratch::new("copy");
        let folder = project(&s.0);
        let copy = s.0.join("copy");
        copy_tree(&folder, &copy).unwrap();
        assert_eq!(std::fs::read_to_string(copy.join("catatan.txt")).unwrap(), "halo");
        assert!(copy.join("kosong").is_dir() && copy.join("gambar ü").join("a.png").is_file());
        assert!(folder.exists());
        // (the way a move across drives goes)
        let moved = s.0.join("moved");
        move_by_copy(&folder, &moved).unwrap();
        assert!(!folder.exists());
        assert_eq!(std::fs::read(moved.join("gambar ü").join("a.png")).unwrap(), vec![1, 2, 3]);
        // on the same drive a move is a rename
        let file = s.0.join("f.txt");
        std::fs::write(&file, "x").unwrap();
        move_path(&file, &s.0.join("g.txt")).unwrap();
        assert!(!file.exists() && s.0.join("g.txt").exists());
    }

    #[test]
    fn nothing_is_ever_written_over_what_is_there() {
        let s = Scratch::new("over");
        let a = s.0.join("a.txt");
        let b = s.0.join("b.txt");
        std::fs::write(&a, "a").unwrap();
        std::fs::write(&b, "b").unwrap();
        assert!(copy_tree(&a, &b).is_err());
        assert!(move_path(&a, &b).is_err());
        assert!(zip_items(&b, std::slice::from_ref(&a)).is_err());
        assert_eq!(std::fs::read_to_string(&b).unwrap(), "b");
        assert_eq!(std::fs::read_to_string(&a).unwrap(), "a");
        // a folder into one of its own folders: refused, nothing made
        let folder = project(&s.0);
        let inner = folder.join("gambar ü").join("Laporan Q4");
        assert!(copy_tree(&folder, &inner).is_err());
        assert!(move_path(&folder, &inner).is_err());
        assert!(!inner.exists() && folder.join("catatan.txt").exists());
    }
}
