//! Other apps' delivered notifications (stand-in: none read yet; Windows' UserNotificationListener later). Same
//! shapes as macOS's usernoted reader.
use std::path::PathBuf;

#[derive(Debug, PartialEq)]
pub enum Access {
    /// not allowed to read them
    Denied,
    /// nothing to read from
    Missing,
    Failed(String),
}

pub struct Row {
    pub id: i64,
    pub data: Vec<u8>,
    pub app: String,
}

/// Where the notifications are read from: nowhere yet.
pub fn db_path() -> PathBuf {
    PathBuf::new()
}

#[derive(Default)]
pub struct Reader;

impl Reader {
    pub fn new() -> Self {
        Self
    }

    pub fn close(&mut self) {}

    pub fn max_rowid(&mut self) -> Result<i64, Access> {
        Err(Access::Missing)
    }

    pub fn read_after(&mut self, _after: i64) -> Result<Vec<Row>, Access> {
        Err(Access::Missing)
    }
}

pub fn max_rowid() -> Result<i64, Access> {
    Err(Access::Missing)
}

pub fn read_after(_after: i64) -> Result<Vec<Row>, Access> {
    Err(Access::Missing)
}
