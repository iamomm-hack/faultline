//! Repository-root confinement and post-open final-path checks.

use std::{
    fs::{self, File},
    io::Read,
    path::{Component, Path, PathBuf},
};

use crate::{ipc::validate_repository_path, Error, Result};

#[derive(Clone, Debug)]
pub struct AllowedRoots {
    repository: PathBuf,
    roots: Vec<PathBuf>,
}

impl AllowedRoots {
    pub fn resolve(repository: &Path) -> Result<Self> {
        let repository = fs::canonicalize(repository)?;
        let mut roots = Vec::new();
        for relative in ["artifacts/treasury", "fixtures", "policies", "manifests"] {
            let root = fs::canonicalize(repository.join(relative))?;
            if !is_beneath(&root, &repository) {
                return Err(Error::Validation("allowed root escapes repository".into()));
            }
            reject_reparse_chain(&repository, &root)?;
            roots.push(root);
        }
        Ok(Self { repository, roots })
    }

    pub fn repository(&self) -> &Path {
        &self.repository
    }

    pub fn resolve_file(&self, relative: &str) -> Result<PathBuf> {
        validate_repository_path(relative)?;
        let lexical = self.repository.join(relative);
        reject_reparse_chain(&self.repository, &lexical)?;
        let canonical = fs::canonicalize(&lexical)?;
        if !self.roots.iter().any(|root| is_beneath(&canonical, root)) {
            return Err(Error::Validation(
                "input is outside frozen allowed roots".into(),
            ));
        }
        let metadata = fs::metadata(&canonical)?;
        if !metadata.is_file() {
            return Err(Error::Validation(
                "declared input is not a regular file".into(),
            ));
        }
        Ok(canonical)
    }

    pub fn read_bounded(&self, relative: &str, maximum: usize) -> Result<Vec<u8>> {
        let canonical = self.resolve_file(relative)?;
        let file = File::open(&canonical)?;
        let final_path = final_path(&file)?;
        if !same_path(&canonical, &final_path)
            || !self.roots.iter().any(|root| is_beneath(&final_path, root))
        {
            return Err(Error::Validation(
                "opened final path changed or escaped".into(),
            ));
        }
        let length = file.metadata()?.len();
        if length > maximum as u64 {
            return Err(Error::Validation(
                "declared input exceeds size bound".into(),
            ));
        }
        let mut bytes = Vec::with_capacity(length as usize);
        file.take(maximum as u64 + 1).read_to_end(&mut bytes)?;
        if bytes.len() > maximum {
            return Err(Error::Validation(
                "declared input exceeds size bound".into(),
            ));
        }
        Ok(bytes)
    }
}

fn is_beneath(path: &Path, root: &Path) -> bool {
    path == root || path.starts_with(root)
}

fn same_path(left: &Path, right: &Path) -> bool {
    #[cfg(windows)]
    {
        left.to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy())
    }
    #[cfg(not(windows))]
    {
        left == right
    }
}

fn reject_reparse_chain(repository: &Path, target: &Path) -> Result<()> {
    let relative = target
        .strip_prefix(repository)
        .map_err(|_| Error::Validation("path lexically escapes repository".into()))?;
    let mut current = repository.to_path_buf();
    for component in relative.components() {
        if !matches!(component, Component::Normal(_)) {
            return Err(Error::Validation("forbidden path component".into()));
        }
        current.push(component);
        let metadata = fs::symlink_metadata(&current)?;
        if metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
            return Err(Error::Validation(
                "symlink, junction, or reparse point rejected".into(),
            ));
        }
    }
    Ok(())
}

#[cfg(windows)]
fn is_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_reparse_point(_: &fs::Metadata) -> bool {
    false
}

#[cfg(windows)]
fn final_path(file: &File) -> Result<PathBuf> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        GetFinalPathNameByHandleW, FILE_NAME_NORMALIZED, VOLUME_NAME_DOS,
    };

    let handle = file.as_raw_handle() as *mut core::ffi::c_void;
    let required = unsafe {
        GetFinalPathNameByHandleW(
            handle,
            std::ptr::null_mut(),
            0,
            FILE_NAME_NORMALIZED | VOLUME_NAME_DOS,
        )
    };
    if required == 0 {
        return Err(Error::Io(std::io::Error::last_os_error()));
    }
    let mut buffer = vec![0_u16; required as usize + 1];
    let written = unsafe {
        GetFinalPathNameByHandleW(
            handle,
            buffer.as_mut_ptr(),
            buffer.len() as u32,
            FILE_NAME_NORMALIZED | VOLUME_NAME_DOS,
        )
    };
    if written == 0 || written as usize >= buffer.len() {
        return Err(Error::Io(std::io::Error::last_os_error()));
    }
    let text = String::from_utf16(&buffer[..written as usize])
        .map_err(|_| Error::Validation("final path is not UTF-16".into()))?;
    Ok(PathBuf::from(text))
}

#[cfg(not(windows))]
fn final_path(file: &File) -> Result<PathBuf> {
    #[cfg(unix)]
    {
        use std::os::fd::AsRawFd;
        return Ok(fs::canonicalize(format!(
            "/proc/self/fd/{}",
            file.as_raw_fd()
        ))?);
    }
    #[allow(unreachable_code)]
    Err(Error::Validation(
        "final-path checking is unsupported".into(),
    ))
}
