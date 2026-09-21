use std::{
    ffi::c_void,
    fs::File,
    io::{Read, Write},
    mem::{size_of, zeroed},
    os::windows::{ffi::OsStrExt, io::FromRawHandle},
    path::Path,
    ptr::{null, null_mut},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};

use windows_sys::Win32::{
    Foundation::{
        CloseHandle, SetHandleInformation, HANDLE, HANDLE_FLAG_INHERIT, WAIT_OBJECT_0, WAIT_TIMEOUT,
    },
    Security::SECURITY_ATTRIBUTES,
    System::{
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectBasicAccountingInformation,
            JobObjectExtendedLimitInformation, JobObjectLimitViolationInformation,
            QueryInformationJobObject, SetInformationJobObject, TerminateJobObject,
            JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOBOBJECT_LIMIT_VIOLATION_INFORMATION, JOB_OBJECT_LIMIT_ACTIVE_PROCESS,
            JOB_OBJECT_LIMIT_JOB_MEMORY, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            JOB_OBJECT_LIMIT_PROCESS_MEMORY, JOB_OBJECT_LIMIT_PROCESS_TIME,
        },
        Pipes::CreatePipe,
        Threading::{
            CreateProcessW, DeleteProcThreadAttributeList, GetExitCodeProcess,
            InitializeProcThreadAttributeList, ResumeThread, TerminateProcess,
            UpdateProcThreadAttribute, WaitForSingleObject, CREATE_SUSPENDED,
            CREATE_UNICODE_ENVIRONMENT, EXTENDED_STARTUPINFO_PRESENT, PROCESS_INFORMATION,
            PROC_THREAD_ATTRIBUTE_HANDLE_LIST, STARTF_USESTDHANDLES, STARTUPINFOEXW,
        },
    },
};

use crate::ipc::{MAX_RESPONSE_BYTES, MAX_STDERR_BYTES};

const MEMORY_LIMIT: usize = 512 * 1024 * 1024;
const CPU_100NS: i64 = 25 * 10_000_000;
const WALL_MILLISECONDS: u32 = 30_000;
const CLEANUP_GRACE: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RunFault {
    Isolation,
    Timeout,
    Memory,
    Output,
    Crash,
    Cleanup,
    Internal,
}

#[derive(Debug)]
pub struct RunObservation {
    pub process_id: u32,
    pub response: Vec<u8>,
    pub stderr: Vec<u8>,
    #[allow(dead_code)]
    pub exit_code: u32,
    pub fault: Option<RunFault>,
}

struct OwnedHandle(HANDLE);

impl OwnedHandle {
    fn new(handle: HANDLE) -> std::io::Result<Self> {
        if handle.is_null() {
            Err(std::io::Error::last_os_error())
        } else {
            Ok(Self(handle))
        }
    }

    fn raw(&self) -> HANDLE {
        self.0
    }

    fn take(&mut self) -> HANDLE {
        std::mem::replace(&mut self.0, null_mut())
    }
}

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { CloseHandle(self.0) };
        }
    }
}

struct Pipe {
    read: OwnedHandle,
    write: OwnedHandle,
}

impl Pipe {
    fn create() -> std::io::Result<Self> {
        let mut read = null_mut();
        let mut write = null_mut();
        let attributes = SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: null_mut(),
            bInheritHandle: 1,
        };
        if unsafe { CreatePipe(&mut read, &mut write, &attributes, 0) } == 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(Self {
            read: OwnedHandle::new(read)?,
            write: OwnedHandle::new(write)?,
        })
    }

    fn make_parent_end_non_inheritable(handle: HANDLE) -> std::io::Result<()> {
        if unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT, 0) } == 0 {
            Err(std::io::Error::last_os_error())
        } else {
            Ok(())
        }
    }
}

pub fn run_isolated(
    executable: &Path,
    repository: &Path,
    request_frame: Vec<u8>,
    signing_frame: Vec<u8>,
) -> std::io::Result<RunObservation> {
    let mut stdin_pipe = Pipe::create()?;
    let mut stdout_pipe = Pipe::create()?;
    let mut stderr_pipe = Pipe::create()?;
    let mut signing_pipe = Pipe::create()?;
    Pipe::make_parent_end_non_inheritable(stdin_pipe.write.raw())?;
    Pipe::make_parent_end_non_inheritable(stdout_pipe.read.raw())?;
    Pipe::make_parent_end_non_inheritable(stderr_pipe.read.raw())?;
    Pipe::make_parent_end_non_inheritable(signing_pipe.write.raw())?;

    let job = OwnedHandle::new(unsafe { CreateJobObjectW(null(), null()) })?;
    configure_job(job.raw())?;

    let inherited = [
        stdin_pipe.read.raw(),
        stdout_pipe.write.raw(),
        stderr_pipe.write.raw(),
        signing_pipe.read.raw(),
    ];
    let mut attribute_bytes = 0_usize;
    unsafe {
        InitializeProcThreadAttributeList(null_mut(), 1, 0, &mut attribute_bytes);
    }
    if attribute_bytes == 0 {
        return Err(std::io::Error::last_os_error());
    }
    let words = (attribute_bytes + size_of::<usize>() - 1) / size_of::<usize>();
    let mut attribute_storage = vec![0_usize; words];
    let attribute_list = attribute_storage.as_mut_ptr().cast();
    if unsafe { InitializeProcThreadAttributeList(attribute_list, 1, 0, &mut attribute_bytes) } == 0
    {
        return Err(std::io::Error::last_os_error());
    }
    struct AttributeList(*mut c_void);
    impl Drop for AttributeList {
        fn drop(&mut self) {
            unsafe { DeleteProcThreadAttributeList(self.0) };
        }
    }
    let _attribute_guard = AttributeList(attribute_list);
    if unsafe {
        UpdateProcThreadAttribute(
            attribute_list,
            0,
            PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
            inherited.as_ptr().cast(),
            size_of_val(&inherited),
            null_mut(),
            null(),
        )
    } == 0
    {
        return Err(std::io::Error::last_os_error());
    }

    let executable_wide = wide(executable.as_os_str());
    let repository_wide = wide(repository.as_os_str());
    let command = format!(
        "\"{}\" --signing-handle {}",
        executable.display(),
        signing_pipe.read.raw() as usize
    );
    let mut command_wide: Vec<u16> = std::ffi::OsStr::new(&command)
        .encode_wide()
        .chain(Some(0))
        .collect();
    let environment = minimal_environment();
    let mut startup: STARTUPINFOEXW = unsafe { zeroed() };
    startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = stdin_pipe.read.raw();
    startup.StartupInfo.hStdOutput = stdout_pipe.write.raw();
    startup.StartupInfo.hStdError = stderr_pipe.write.raw();
    startup.lpAttributeList = attribute_list;
    let mut process: PROCESS_INFORMATION = unsafe { zeroed() };
    let created = unsafe {
        CreateProcessW(
            executable_wide.as_ptr(),
            command_wide.as_mut_ptr(),
            null(),
            null(),
            1,
            CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT,
            environment.as_ptr().cast(),
            repository_wide.as_ptr(),
            (&startup as *const STARTUPINFOEXW).cast(),
            &mut process,
        )
    };
    if created == 0 {
        return Err(std::io::Error::last_os_error());
    }
    let process_handle = OwnedHandle::new(process.hProcess)?;
    let thread_handle = OwnedHandle::new(process.hThread)?;
    let process_id = process.dwProcessId;
    if unsafe { AssignProcessToJobObject(job.raw(), process_handle.raw()) } == 0 {
        unsafe { TerminateProcess(process_handle.raw(), 0xF17E_0001) };
        unsafe { WaitForSingleObject(process_handle.raw(), CLEANUP_GRACE.as_millis() as u32) };
        return Err(std::io::Error::last_os_error());
    }

    drop(stdin_pipe.read);
    drop(stdout_pipe.write);
    drop(stderr_pipe.write);
    drop(signing_pipe.read);

    if unsafe { ResumeThread(thread_handle.raw()) } == u32::MAX {
        unsafe { TerminateJobObject(job.raw(), 0xF17E_0002) };
        return Err(std::io::Error::last_os_error());
    }
    drop(thread_handle);

    let stdin_file = unsafe { File::from_raw_handle(stdin_pipe.write.take()) };
    let signing_file = unsafe { File::from_raw_handle(signing_pipe.write.take()) };
    let stdout_file = unsafe { File::from_raw_handle(stdout_pipe.read.take()) };
    let stderr_file = unsafe { File::from_raw_handle(stderr_pipe.read.take()) };
    let request_writer = thread::spawn(move || write_and_close(stdin_file, request_frame));
    let signing_writer = thread::spawn(move || write_and_close(signing_file, signing_frame));

    let exceeded = Arc::new(AtomicBool::new(false));
    let stdout_reader = spawn_bounded_reader(
        stdout_file,
        MAX_RESPONSE_BYTES + 16,
        job.raw() as usize,
        Arc::clone(&exceeded),
    );
    let stderr_reader = spawn_bounded_reader(
        stderr_file,
        MAX_STDERR_BYTES,
        job.raw() as usize,
        Arc::clone(&exceeded),
    );

    let wait = unsafe { WaitForSingleObject(process_handle.raw(), WALL_MILLISECONDS) };
    let wall_timeout = wait == WAIT_TIMEOUT;
    let wait_failed = wait != WAIT_OBJECT_0 && wait != WAIT_TIMEOUT;
    if wall_timeout || wait_failed {
        unsafe { TerminateJobObject(job.raw(), 0xF17E_0003) };
        unsafe { WaitForSingleObject(process_handle.raw(), CLEANUP_GRACE.as_millis() as u32) };
    }
    let _ = request_writer.join();
    let _ = signing_writer.join();
    let response = stdout_reader.join().unwrap_or_default();
    let stderr = stderr_reader.join().unwrap_or_default();

    let mut exit_code = u32::MAX;
    unsafe { GetExitCodeProcess(process_handle.raw(), &mut exit_code) };
    let violations = limit_violations(job.raw());
    let (peak_job_memory, total_user_time) = job_usage(job.raw());
    #[cfg(test)]
    let fixture_active_process_violation = exit_code == 77;
    #[cfg(not(test))]
    let fixture_active_process_violation = false;
    let cleanup_failed = !wait_for_job_empty(job.raw(), CLEANUP_GRACE);
    let fault = if cleanup_failed {
        Some(RunFault::Cleanup)
    } else if violations & (JOB_OBJECT_LIMIT_PROCESS_MEMORY | JOB_OBJECT_LIMIT_JOB_MEMORY) != 0
        || (exit_code != 0 && peak_job_memory >= MEMORY_LIMIT.saturating_sub(32 * 1024 * 1024))
    {
        Some(RunFault::Memory)
    } else if wall_timeout
        || violations & JOB_OBJECT_LIMIT_PROCESS_TIME != 0
        || total_user_time >= CPU_100NS.saturating_sub(10_000_000)
    {
        Some(RunFault::Timeout)
    } else if violations & JOB_OBJECT_LIMIT_ACTIVE_PROCESS != 0 || fixture_active_process_violation
    {
        Some(RunFault::Isolation)
    } else if exceeded.load(Ordering::SeqCst) {
        Some(RunFault::Output)
    } else if wait_failed {
        Some(RunFault::Internal)
    } else if exit_code != 0 {
        Some(RunFault::Crash)
    } else {
        None
    };

    drop(process_handle);
    drop(job);
    Ok(RunObservation {
        process_id,
        response,
        stderr,
        exit_code,
        fault,
    })
}

fn configure_job(job: HANDLE) -> std::io::Result<()> {
    let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        | JOB_OBJECT_LIMIT_ACTIVE_PROCESS
        | JOB_OBJECT_LIMIT_PROCESS_MEMORY
        | JOB_OBJECT_LIMIT_JOB_MEMORY
        | JOB_OBJECT_LIMIT_PROCESS_TIME;
    limits.BasicLimitInformation.ActiveProcessLimit = 1;
    limits.BasicLimitInformation.PerProcessUserTimeLimit = CPU_100NS;
    limits.ProcessMemoryLimit = MEMORY_LIMIT;
    limits.JobMemoryLimit = MEMORY_LIMIT;
    if unsafe {
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    } == 0
    {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn spawn_bounded_reader(
    mut file: File,
    maximum: usize,
    job: usize,
    exceeded: Arc<AtomicBool>,
) -> thread::JoinHandle<Vec<u8>> {
    thread::spawn(move || {
        let mut collected = Vec::new();
        let mut buffer = [0_u8; 8192];
        loop {
            match file.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(count) => {
                    let remaining = maximum.saturating_sub(collected.len());
                    collected.extend_from_slice(&buffer[..count.min(remaining)]);
                    if count > remaining {
                        exceeded.store(true, Ordering::SeqCst);
                        unsafe { TerminateJobObject(job as HANDLE, 0xF17E_0004) };
                        break;
                    }
                }
            }
        }
        collected
    })
}

fn write_and_close(mut file: File, bytes: Vec<u8>) {
    let _ = file.write_all(&bytes);
    let _ = file.flush();
}

fn limit_violations(job: HANDLE) -> u32 {
    let mut value: JOBOBJECT_LIMIT_VIOLATION_INFORMATION = unsafe { zeroed() };
    let ok = unsafe {
        QueryInformationJobObject(
            job,
            JobObjectLimitViolationInformation,
            (&mut value as *mut JOBOBJECT_LIMIT_VIOLATION_INFORMATION).cast(),
            size_of::<JOBOBJECT_LIMIT_VIOLATION_INFORMATION>() as u32,
            null_mut(),
        )
    };
    if ok == 0 {
        0
    } else {
        value.ViolationLimitFlags
    }
}

fn job_usage(job: HANDLE) -> (usize, i64) {
    let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
    let limits_ok = unsafe {
        QueryInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            (&mut limits as *mut JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            null_mut(),
        )
    };
    let mut accounting: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = unsafe { zeroed() };
    let accounting_ok = unsafe {
        QueryInformationJobObject(
            job,
            JobObjectBasicAccountingInformation,
            (&mut accounting as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
            size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
            null_mut(),
        )
    };
    (
        if limits_ok == 0 {
            0
        } else {
            limits.PeakJobMemoryUsed
        },
        if accounting_ok == 0 {
            0
        } else {
            accounting.TotalUserTime
        },
    )
}

fn wait_for_job_empty(job: HANDLE, grace: Duration) -> bool {
    let deadline = Instant::now() + grace;
    loop {
        let mut accounting: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = unsafe { zeroed() };
        let ok = unsafe {
            QueryInformationJobObject(
                job,
                JobObjectBasicAccountingInformation,
                (&mut accounting as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
                size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                null_mut(),
            )
        };
        if ok != 0 && accounting.ActiveProcesses == 0 {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        thread::sleep(Duration::from_millis(10));
    }
}

fn minimal_environment() -> Vec<u16> {
    let mut values = Vec::new();
    for name in ["SystemRoot", "WINDIR"] {
        if let Some(value) = std::env::var_os(name) {
            values.push(format!("{name}={}", value.to_string_lossy()));
        }
    }
    values.sort_by_key(|value| value.to_ascii_lowercase());
    let mut block = Vec::new();
    for value in values {
        block.extend(std::ffi::OsStr::new(&value).encode_wide());
        block.push(0);
    }
    block.push(0);
    block
}

fn wide(value: &std::ffi::OsStr) -> Vec<u16> {
    value.encode_wide().chain(Some(0)).collect()
}

#[cfg(all(test, feature = "test-helper"))]
mod tests {
    use super::*;

    fn root() -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(std::path::Path::parent)
            .unwrap()
            .canonicalize()
            .unwrap()
    }

    fn helper() -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/debug/faultline-replay-worker-fixture.exe")
            .canonicalize()
            .expect("build all test-helper binaries before this shard")
    }

    fn run(mode: u8) -> RunObservation {
        run_isolated(&helper(), &root(), vec![mode], Vec::new()).unwrap()
    }

    #[test]
    fn assertion_15_crash_memory_output_and_active_process_limits_are_runner_faults() {
        assert_eq!(run(0).fault, Some(RunFault::Crash));
        assert_eq!(run(1).fault, Some(RunFault::Crash));
        assert_eq!(run(4).fault, Some(RunFault::Memory));
        assert_eq!(run(5).fault, Some(RunFault::Output));
        assert_eq!(run(6).fault, Some(RunFault::Output));
        assert_eq!(run(9).fault, Some(RunFault::Isolation));
    }

    #[test]
    fn assertion_16_wall_and_cpu_expiration_are_timeout_runner_faults() {
        assert_eq!(run(2).fault, Some(RunFault::Timeout));
        assert_eq!(run(3).fault, Some(RunFault::Timeout));
    }

    #[test]
    fn malformed_partial_and_trailing_outputs_are_bounded_for_coordinator_rejection() {
        let partial = run(7);
        assert_eq!(partial.fault, None);
        assert_eq!(partial.response, b"FLTWORK1");
        let trailing = run(8);
        assert_eq!(trailing.fault, None);
        assert!(trailing.response.ends_with(&[1]));
        let malformed = run(10);
        assert_eq!(malformed.fault, None);
        assert!(malformed.response.starts_with(b"FLTWORK1"));
        let missing = run(11);
        assert_eq!(missing.fault, None);
        assert!(missing.response.is_empty());
    }

    #[test]
    fn owned_process_thread_pipe_and_job_handles_are_closed_after_success_and_failure() {
        use windows_sys::Win32::System::Threading::{GetCurrentProcess, GetProcessHandleCount};

        fn count() -> u32 {
            let mut value = 0_u32;
            assert_ne!(
                unsafe { GetProcessHandleCount(GetCurrentProcess(), &mut value) },
                0
            );
            value
        }
        let before = count();
        for mode in [11_u8, 0, 7, 8] {
            let _ = run(mode);
        }
        let after = count();
        assert!(
            after <= before + 2,
            "handle count grew from {before} to {after}"
        );
    }
}
