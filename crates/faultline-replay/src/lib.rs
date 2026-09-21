pub mod canonical;
pub mod coordinator;
pub mod generator;
pub mod hash;
pub mod invariant;
pub mod ipc;
pub mod paths;
pub mod receipt;
pub mod runner;
pub mod schema;
pub mod trace;
pub mod worker;

#[cfg(windows)]
mod windows_job;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("canonical JSON error: {0}")]
    Canonical(String),
    #[error("duplicate JSON object key: {0}")]
    DuplicateKey(String),
    #[error("schema error: {0}")]
    Schema(#[from] serde_json::Error),
    #[error("validation error: {0}")]
    Validation(String),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, Error>;
