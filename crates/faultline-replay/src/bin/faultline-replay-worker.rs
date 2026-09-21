#[cfg(windows)]
fn main() {
    use std::{
        fs::File,
        io,
        os::windows::io::{FromRawHandle, RawHandle},
    };

    let mut arguments = std::env::args_os();
    let _program = arguments.next();
    let flag = arguments.next();
    let value = arguments.next();
    if flag.as_deref() != Some(std::ffi::OsStr::new("--signing-handle"))
        || value.is_none()
        || arguments.next().is_some()
    {
        std::process::exit(64);
    }
    let handle: usize = match value
        .and_then(|value| value.into_string().ok())
        .and_then(|value| value.parse().ok())
    {
        Some(handle) if handle != 0 => handle,
        _ => std::process::exit(64),
    };
    let repository = match std::env::current_dir().and_then(|path| path.canonicalize()) {
        Ok(repository) => repository,
        Err(_) => std::process::exit(65),
    };
    let mut signing = unsafe { File::from_raw_handle(handle as RawHandle) };
    let stdin = io::stdin();
    let stdout = io::stdout();
    let stderr = io::stderr();
    let code = faultline_replay::worker::run_worker_session(
        &repository,
        &mut stdin.lock(),
        &mut signing,
        &mut stdout.lock(),
        &mut stderr.lock(),
    );
    std::process::exit(code);
}

#[cfg(not(windows))]
fn main() {
    eprintln!("faultline replay worker requires Windows isolation");
    std::process::exit(78);
}
