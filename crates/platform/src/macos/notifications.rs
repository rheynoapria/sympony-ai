//! macOS's delivered notifications, read from usernoted's database (read-only; it needs Full Disk Access).
use rusqlite::{Connection, OpenFlags};
use std::os::unix::fs::MetadataExt;
use std::path::PathBuf;

#[derive(Debug, PartialEq)]
pub enum Access {
    /// Full Disk Access not given
    Denied,
    /// no database where macOS keeps it
    Missing,
    Failed(String),
}

pub struct Row {
    pub id: i64,
    pub data: Vec<u8>,
    pub app: String,
}

pub fn db_path() -> PathBuf {
    dirs_home().join("Library/Group Containers/group.com.apple.usernoted/db2/db")
}

fn dirs_home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default()
}

fn open_with_id() -> Result<(Connection, (u64, u64)), Access> {
    let path = db_path();
    let meta = match std::fs::metadata(&path) {
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => return Err(Access::Denied),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // macOS hides the folder itself without access: say Denied unless its parent is readable
            let parent_ok = path.parent().is_some_and(|p| std::fs::read_dir(p).is_ok());
            return Err(if parent_ok { Access::Missing } else { Access::Denied });
        }
        Err(e) => return Err(Access::Failed(e.to_string())),
        Ok(m) => m,
    };
    let file_id = (meta.dev(), meta.ino());
    // (the file is there but can't be opened: macOS lets stat through without Full Disk Access, not the open)
    let db = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX).map_err(|_| Access::Denied)?;
    db.query_row("SELECT 1 FROM record LIMIT 1", [], |_| Ok(())).or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(()),
        e if e.to_string().contains("authorization denied") || e.to_string().contains("unable to open") => Err(Access::Denied),
        e => Err(Access::Failed(e.to_string())),
    })?;
    Ok((db, file_id))
}

fn open() -> Result<Connection, Access> {
    open_with_id().map(|(db, _)| db)
}

/// Persistent read-only handle to usernoted's SQLite database for the 1s poll loop.
/// Reopens automatically if usernoted replaces the file (inode change) or a query errors.
#[derive(Default)]
pub struct Reader {
    db: Option<Connection>,
    file_id: Option<(u64, u64)>,
}

impl Reader {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn close(&mut self) {
        self.db = None;
        self.file_id = None;
    }

    fn ensure_open(&mut self) -> Result<&Connection, Access> {
        let path = db_path();
        if self.db.is_some() {
            let same = std::fs::metadata(&path)
                .ok()
                .is_some_and(|m| self.file_id == Some((m.dev(), m.ino())));
            if !same {
                self.close();
            }
        }
        if self.db.is_none() {
            let (db, id) = open_with_id()?;
            self.db = Some(db);
            self.file_id = Some(id);
        }
        Ok(self.db.as_ref().unwrap())
    }

    pub fn max_rowid(&mut self) -> Result<i64, Access> {
        let db = self.ensure_open()?;
        match db
            .prepare_cached("SELECT IFNULL(MAX(rec_id), 0) FROM record")
            .and_then(|mut st| st.query_row([], |r| r.get(0)))
        {
            Ok(id) => Ok(id),
            Err(e) => {
                self.close();
                Err(Access::Failed(e.to_string()))
            }
        }
    }

    pub fn read_after(&mut self, after: i64) -> Result<Vec<Row>, Access> {
        let db = self.ensure_open()?;
        let res = (|| -> rusqlite::Result<Vec<Row>> {
            let mut st = db.prepare_cached(
                "SELECT r.rec_id, r.data, IFNULL(a.identifier, '') FROM record r LEFT JOIN app a ON a.app_id = r.app_id WHERE r.rec_id > ?1 ORDER BY r.rec_id",
            )?;
            let rows = st.query_map([after], |r| Ok(Row { id: r.get(0)?, data: r.get(1)?, app: r.get(2)? }))?;
            Ok(rows.filter_map(Result::ok).collect())
        })();
        match res {
            Ok(rows) => Ok(rows),
            Err(e) => {
                self.close();
                Err(Access::Failed(e.to_string()))
            }
        }
    }
}

/// The newest record's id (0 for none): where to start, so what's already there isn't shown.
pub fn max_rowid() -> Result<i64, Access> {
    open()?.query_row("SELECT IFNULL(MAX(rec_id), 0) FROM record", [], |r| r.get(0)).map_err(|e| Access::Failed(e.to_string()))
}

/// Records newer than `after`, oldest first, with their app's bundle id.
pub fn read_after(after: i64) -> Result<Vec<Row>, Access> {
    let db = open()?;
    let mut st = db
        .prepare("SELECT r.rec_id, r.data, IFNULL(a.identifier, '') FROM record r LEFT JOIN app a ON a.app_id = r.app_id WHERE r.rec_id > ?1 ORDER BY r.rec_id")
        .map_err(|e| Access::Failed(e.to_string()))?;
    let rows = st
        .query_map([after], |r| Ok(Row { id: r.get(0)?, data: r.get(1)?, app: r.get(2)? }))
        .map_err(|e| Access::Failed(e.to_string()))?;
    Ok(rows.filter_map(Result::ok).collect())
}

/// The bundle ids of the apps usernoted knows (each has asked to post notifications).
pub fn apps() -> Result<Vec<String>, Access> {
    let db = open()?;
    let mut st = db.prepare("SELECT IFNULL(identifier, '') FROM app").map_err(|e| Access::Failed(e.to_string()))?;
    let rows = st.query_map([], |r| r.get::<_, String>(0)).map_err(|e| Access::Failed(e.to_string()))?;
    Ok(rows.filter_map(Result::ok).filter(|id| !id.is_empty()).collect())
}
