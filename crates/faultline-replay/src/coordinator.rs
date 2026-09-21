//! Trusted three-worker coordinator and identity-independent agreement logic.

use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
    sync::Arc,
    time::Instant,
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use solana_sdk::signature::{keypair_from_seed, Keypair, Signer};

use crate::{
    canonical, hash,
    ipc::{
        self, InputPaths, WorkerRequest, WorkerResponse, INVALID_SIGNATURE_OR_IDENTITY,
        MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, REQUEST_KIND, RESPONSE_KIND, RUNNER_CLEANUP,
        RUNNER_CRASH, RUNNER_INTERNAL, RUNNER_ISOLATION_SETUP, RUNNER_MEMORY_LIMIT,
        RUNNER_OUTPUT_LIMIT_OR_MALFORMED_OUTPUT, RUNNER_TIMEOUT, SIGNING_SEED_BYTES,
        SIGNING_SEED_KIND, WORKER_DISAGREEMENT,
    },
    schema::{AttestationIntent, Classification, ReplayJob, SignedWorkerOutput, Validate},
    worker::verify_signed,
    Error, Result,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IdentityMode {
    Production,
    ExplicitCheckpoint4TestVectors,
}

#[derive(Clone, Debug)]
pub struct Coordinator {
    repository: PathBuf,
    worker_executable: PathBuf,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AppliedJobLimits {
    pub active_process_limit: u32,
    pub process_memory_limit_bytes: u64,
    pub job_memory_limit_bytes: u64,
    pub user_mode_cpu_limit_100ns: u64,
    pub wall_timeout_milliseconds: u64,
    pub cleanup_grace_milliseconds: u64,
    pub stdout_limit_bytes: u64,
    pub stderr_limit_bytes: u64,
    pub queried_back_from_job_object: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TerminationCause {
    Completed,
    SetupFailure,
    AbnormalExit,
    WallTimeout,
    CpuLimit,
    ProcessMemoryLimit,
    JobMemoryLimit,
    ActiveProcessLimit,
    OutputLimit,
    Cancelled,
    CleanupFailure,
}

impl TerminationCause {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Completed => "completed",
            Self::SetupFailure => "setup_failure",
            Self::AbnormalExit => "abnormal_exit",
            Self::WallTimeout => "wall_timeout",
            Self::CpuLimit => "cpu_limit",
            Self::ProcessMemoryLimit => "process_memory_limit",
            Self::JobMemoryLimit => "job_memory_limit",
            Self::ActiveProcessLimit => "active_process_limit",
            Self::OutputLimit => "output_limit",
            Self::Cancelled => "cancelled",
            Self::CleanupFailure => "cleanup_failure",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorkerRunTelemetry {
    pub worker_ordinal: u8,
    pub owned_pid: Option<u32>,
    pub exit_status_u32: Option<u32>,
    pub peak_process_memory_bytes: Option<u64>,
    pub peak_job_memory_bytes: Option<u64>,
    pub launch_to_exit_elapsed_milliseconds: u64,
    pub cleanup_elapsed_milliseconds: u64,
    pub applied_limits: Option<AppliedJobLimits>,
    pub termination_cause: TerminationCause,
    pub cleanup_verified: bool,
    pub collection_error: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShardTelemetry {
    pub launch_attempts: u8,
    pub retry_attempts: u8,
    pub workers: Vec<WorkerRunTelemetry>,
    pub run_directory_removed: bool,
    pub all_owned_processes_exited: bool,
    pub all_owned_handles_closed: bool,
}

impl ShardTelemetry {
    fn no_launches() -> Self {
        Self {
            launch_attempts: 0,
            retry_attempts: 0,
            workers: Vec::new(),
            run_directory_removed: true,
            all_owned_processes_exited: true,
            all_owned_handles_closed: true,
        }
    }
}

#[derive(Clone, Debug)]
pub struct ShardOutcome {
    pub classification: Classification,
    pub result_code: u32,
    pub signed_outputs: Vec<SignedWorkerOutput>,
    pub attestation_intents: Vec<AttestationIntent>,
    pub process_ids: Vec<u32>,
    pub diagnostics: Vec<String>,
    pub launch_attempts: usize,
    pub telemetry: ShardTelemetry,
}

#[derive(Clone, Debug)]
pub struct SingleWorkerOutcome {
    pub classification: Classification,
    pub result_code: u32,
    pub signed_output: Option<SignedWorkerOutput>,
    pub attestation_intent: Option<AttestationIntent>,
    pub process_id: Option<u32>,
    pub diagnostics: Vec<String>,
    pub launch_attempts: u8,
    pub retry_attempts: u8,
    pub telemetry: Option<WorkerRunTelemetry>,
    pub run_directory_removed: bool,
    pub all_owned_handles_closed: bool,
}

impl ShardOutcome {
    fn failure(classification: Classification, result_code: u32, diagnostics: Vec<String>) -> Self {
        Self {
            classification,
            result_code,
            signed_outputs: Vec::new(),
            attestation_intents: Vec::new(),
            process_ids: Vec::new(),
            diagnostics,
            launch_attempts: 0,
            telemetry: ShardTelemetry::no_launches(),
        }
    }
}

impl Coordinator {
    pub fn new(repository: &Path) -> Result<Self> {
        let repository = fs::canonicalize(repository)?;
        #[cfg(windows)]
        let worker_executable = {
            let expected = repository
                .join("crates/faultline-replay/target/debug")
                .join("faultline-replay-worker.exe");
            let worker_executable = fs::canonicalize(&expected).map_err(|error| {
                Error::Validation(format!("worker executable validation failed: {error}"))
            })?;
            if worker_executable != expected || !worker_executable.is_file() {
                return Err(Error::Validation(
                    "worker executable is not the canonical production target".into(),
                ));
            }
            reject_reparse(&repository, &worker_executable)?;
            worker_executable
        };
        #[cfg(not(windows))]
        let worker_executable = PathBuf::new();
        Ok(Self {
            repository,
            worker_executable,
        })
    }

    pub fn run_repository_candidate(&self, candidate: &str, mode: IdentityMode) -> ShardOutcome {
        if !matches!(candidate, "v2" | "v3") {
            return ShardOutcome::failure(
                Classification::UnsupportedEnvironment,
                ipc::UNSUPPORTED_PROGRAM,
                vec!["unsupported candidate".into()],
            );
        }
        let job = match load_job(&self.repository, candidate) {
            Ok(job) => job,
            Err(error) => {
                return ShardOutcome::failure(
                    Classification::InvalidEvidence,
                    ipc::INVALID_SCHEMA_OR_VERSION,
                    vec![error.to_string()],
                )
            }
        };
        let paths = match candidate {
            "v2" | "v3" => InputPaths {
                candidate_build_manifest: format!("manifests/treasury-{candidate}-build.json"),
                runner_manifest: "manifests/treasury-runner.json".into(),
                fixture_manifest: "manifests/treasury-v1-fixture.json".into(),
                invariant_manifest: "manifests/auth-001-invariant.json".into(),
                trace: "fixtures/exploits/auth-001-v2-authority-takeover.json".into(),
                candidate_executable: format!(
                    "artifacts/treasury/{candidate}/faultline_treasury.so"
                ),
            },
            _ => unreachable!("candidate checked above"),
        };
        self.run(job, paths, mode)
    }

    pub fn run(&self, job: ReplayJob, paths: InputPaths, mode: IdentityMode) -> ShardOutcome {
        #[cfg(not(windows))]
        {
            let _ = (job, paths, mode);
            return ShardOutcome::failure(
                Classification::UnsupportedEnvironment,
                ipc::UNSUPPORTED_ENGINE_OR_RUNTIME,
                vec!["Windows Job Object isolation is required".into()],
            );
        }
        #[cfg(windows)]
        {
            self.run_windows(job, paths, mode)
        }
    }

    /// Launches exactly one production worker for a caller-supplied verifier seed.
    /// This is the Milestone 8 single-operator integration boundary; it does not
    /// change the frozen request, response, signature, or consensus schemas.
    pub fn run_one(&self, request: WorkerRequest, seed: &mut [u8; 32]) -> SingleWorkerOutcome {
        #[cfg(not(windows))]
        {
            let _ = (request, seed);
            return SingleWorkerOutcome {
                classification: Classification::UnsupportedEnvironment,
                result_code: ipc::UNSUPPORTED_ENGINE_OR_RUNTIME,
                signed_output: None,
                attestation_intent: None,
                process_id: None,
                diagnostics: vec!["Windows Job Object isolation is required".into()],
                launch_attempts: 0,
                retry_attempts: 0,
                telemetry: None,
                run_directory_removed: true,
                all_owned_handles_closed: true,
            };
        }
        #[cfg(windows)]
        {
            self.run_one_windows(request, seed)
        }
    }

    #[cfg(windows)]
    fn run_one_windows(&self, request: WorkerRequest, seed: &mut [u8; 32]) -> SingleWorkerOutcome {
        use crate::windows_job::{run_isolated, RunFault};

        let failure = |classification, result_code, diagnostics| SingleWorkerOutcome {
            classification,
            result_code,
            signed_output: None,
            attestation_intent: None,
            process_id: None,
            diagnostics,
            launch_attempts: 0,
            retry_attempts: 0,
            telemetry: None,
            run_directory_removed: true,
            all_owned_handles_closed: true,
        };
        if let Err(error) = request.validate() {
            return failure(
                Classification::InvalidEvidence,
                ipc::INVALID_SCHEMA_OR_VERSION,
                vec![error.to_string()],
            );
        }
        let signer = match keypair_from_seed(seed) {
            Ok(value) if value.pubkey().to_string() == request.expected_verifier_pubkey => value,
            _ => {
                return failure(
                    Classification::InvalidEvidence,
                    INVALID_SIGNATURE_OR_IDENTITY,
                    vec!["configured verifier identity mismatch".into()],
                )
            }
        };
        drop(signer);
        let job_hash = match hash::replay_job_hash(&request.replay_job) {
            Ok(value) => value,
            Err(error) => {
                return failure(
                    Classification::InvalidEvidence,
                    ipc::INVALID_SCHEMA_OR_VERSION,
                    vec![error.to_string()],
                )
            }
        };
        let request_payload = match canonical::serialize_typed(&request) {
            Ok(value) => value,
            Err(error) => {
                return failure(
                    Classification::InvalidEvidence,
                    ipc::INVALID_SCHEMA_OR_VERSION,
                    vec![error.to_string()],
                )
            }
        };
        let request_frame =
            match ipc::encode_frame(REQUEST_KIND, &request_payload, MAX_REQUEST_BYTES) {
                Ok(value) => value,
                Err(error) => {
                    return failure(
                        Classification::InvalidEvidence,
                        ipc::INVALID_BOUNDS,
                        vec![format!("request frame rejected: {error:?}")],
                    )
                }
            };
        let signing_frame = ipc::encode_frame(SIGNING_SEED_KIND, seed, SIGNING_SEED_BYTES)
            .expect("fixed-size seed frame");
        for byte in seed.iter_mut() {
            unsafe { std::ptr::write_volatile(byte, 0) };
        }
        std::sync::atomic::compiler_fence(std::sync::atomic::Ordering::SeqCst);
        let mut entropy = Keypair::new().to_bytes();
        let run_name = format!(
            "faultline-operator-run-{}",
            hash::hex(&hash::sha256(&entropy))
        );
        entropy.fill(0);
        let run_root = self.repository.join("tmp").join(run_name);
        if let Err(error) = fs::create_dir(&run_root) {
            return failure(
                Classification::RunnerFault,
                RUNNER_ISOLATION_SETUP,
                vec![format!("run directory creation: {error}")],
            );
        }
        let observation = run_isolated(
            request.worker_ordinal,
            &self.worker_executable,
            &self.repository,
            request_frame,
            signing_frame,
        );
        let directory_removed = cleanup_run_directory(&run_root);
        let observation = match observation {
            Ok(value) => value,
            Err(error) => {
                return SingleWorkerOutcome {
                    classification: Classification::RunnerFault,
                    result_code: if directory_removed {
                        RUNNER_ISOLATION_SETUP
                    } else {
                        RUNNER_CLEANUP
                    },
                    signed_output: None,
                    attestation_intent: None,
                    process_id: None,
                    diagnostics: vec![error.to_string()],
                    launch_attempts: 1,
                    retry_attempts: 0,
                    telemetry: None,
                    run_directory_removed: directory_removed,
                    all_owned_handles_closed: true,
                };
            }
        };
        let mut diagnostics = Vec::new();
        if !observation.stderr.is_empty() {
            diagnostics.push(String::from_utf8_lossy(&observation.stderr).into_owned());
        }
        let process_id = Some(observation.process_id);
        let telemetry = Some(observation.telemetry);
        let handles_closed = observation.all_owned_handles_closed;
        let result = if !directory_removed {
            (Classification::RunnerFault, RUNNER_CLEANUP, None)
        } else if let Some(fault) = observation.fault {
            let code = match fault {
                RunFault::Cleanup => RUNNER_CLEANUP,
                RunFault::Memory => RUNNER_MEMORY_LIMIT,
                RunFault::Timeout => RUNNER_TIMEOUT,
                RunFault::Isolation => RUNNER_ISOLATION_SETUP,
                RunFault::Output => RUNNER_OUTPUT_LIMIT_OR_MALFORMED_OUTPUT,
                RunFault::Crash => RUNNER_CRASH,
                RunFault::Internal => RUNNER_INTERNAL,
            };
            (Classification::RunnerFault, code, None)
        } else {
            match parse_response_or_failure(&observation.response) {
                Err((classification, code, diagnostic)) => {
                    diagnostics.push(diagnostic);
                    (classification, code, None)
                }
                Ok(response)
                    if response.coordinator_nonce != request.coordinator_nonce
                        || response.worker_ordinal != request.worker_ordinal =>
                {
                    (
                        Classification::InvalidEvidence,
                        INVALID_SIGNATURE_OR_IDENTITY,
                        None,
                    )
                }
                Ok(response) if response.status == "failure" => (
                    response.classification.expect("validated failure"),
                    response.result_code.expect("validated failure"),
                    None,
                ),
                Ok(response) => {
                    let signed = response.signed_worker_output.expect("validated success");
                    match authenticate_signed_output(&signed, &request, &job_hash) {
                        Ok(()) => (
                            signed.output.classification.clone(),
                            signed.output.result_code,
                            Some(signed),
                        ),
                        Err(_) => (
                            Classification::InvalidEvidence,
                            INVALID_SIGNATURE_OR_IDENTITY,
                            None,
                        ),
                    }
                }
            }
        };
        let intent = result
            .2
            .as_ref()
            .and_then(|value| value.output.attestation_intent.clone());
        SingleWorkerOutcome {
            classification: result.0,
            result_code: result.1,
            signed_output: result.2,
            attestation_intent: intent,
            process_id,
            diagnostics,
            launch_attempts: 1,
            retry_attempts: 0,
            telemetry,
            run_directory_removed: directory_removed,
            all_owned_handles_closed: handles_closed,
        }
    }

    #[cfg(windows)]
    fn run_windows(&self, job: ReplayJob, paths: InputPaths, mode: IdentityMode) -> ShardOutcome {
        use crate::windows_job::{run_isolated, RunFault};

        let job_hash = match hash::replay_job_hash(&job) {
            Ok(value) => value,
            Err(error) => {
                return ShardOutcome::failure(
                    Classification::InvalidEvidence,
                    ipc::INVALID_SCHEMA_OR_VERSION,
                    vec![error.to_string()],
                )
            }
        };
        let identities = identities(mode, &job_hash);
        let run_entropy = Keypair::new().to_bytes();
        let run_name = format!(
            "faultline-worker-run-{}",
            hash::hex(&hash::sha256(&run_entropy))
        );
        let run_root = self.repository.join("tmp").join(run_name);
        if let Err(error) = fs::create_dir(&run_root) {
            return ShardOutcome::failure(
                Classification::RunnerFault,
                RUNNER_ISOLATION_SETUP,
                vec![format!("run directory creation: {error}")],
            );
        }
        let mut prepared = Vec::new();
        for identity in identities {
            let keypair = match keypair_from_seed(&identity.seed) {
                Ok(value) => value,
                Err(error) => {
                    let _ = fs::remove_dir(&run_root);
                    return ShardOutcome::failure(
                        Classification::RunnerFault,
                        RUNNER_INTERNAL,
                        vec![format!("keypair creation: {error}")],
                    );
                }
            };
            let request = WorkerRequest {
                schema: "faultline.worker-request.v1".into(),
                canonicalization: crate::schema::CANONICALIZATION.into(),
                coordinator_nonce: hash::hex(&identity.nonce),
                worker_ordinal: identity.ordinal,
                expected_verifier_pubkey: keypair.pubkey().to_string(),
                replay_job: job.clone(),
                input_paths: paths.clone(),
            };
            if let Err(error) = request.validate() {
                let _ = fs::remove_dir(&run_root);
                return ShardOutcome::failure(
                    Classification::RunnerFault,
                    RUNNER_INTERNAL,
                    vec![error.to_string()],
                );
            }
            let request_payload =
                canonical::serialize_typed(&request).expect("validated request serializes");
            let request_frame =
                ipc::encode_frame(REQUEST_KIND, &request_payload, MAX_REQUEST_BYTES)
                    .expect("bounded request");
            let signing_frame =
                ipc::encode_frame(SIGNING_SEED_KIND, &identity.seed, SIGNING_SEED_BYTES)
                    .expect("fixed signing frame");
            prepared.push((request, request_frame, signing_frame));
        }
        let repository = Arc::new(self.repository.clone());
        let executable = Arc::new(self.worker_executable.clone());
        let mut joins = Vec::new();
        for (request, request_frame, signing_frame) in prepared {
            let repository = Arc::clone(&repository);
            let executable = Arc::clone(&executable);
            let thread_request = request.clone();
            joins.push((
                request,
                std::thread::spawn(move || {
                    run_isolated(
                        thread_request.worker_ordinal,
                        executable.as_path(),
                        repository.as_path(),
                        request_frame,
                        signing_frame,
                    )
                }),
            ));
        }
        let mut observations = Vec::new();
        for (request, join) in joins {
            match join.join() {
                Ok(value) => observations.push((request, value)),
                Err(_) => observations.push((
                    request,
                    Err(std::io::Error::new(
                        std::io::ErrorKind::Other,
                        "coordinator runner thread panicked",
                    )),
                )),
            }
        }

        let mut diagnostics = Vec::new();
        let mut process_ids = Vec::new();
        let mut failures = Vec::new();
        let mut signed = Vec::new();
        let mut telemetry = Vec::new();
        let mut handle_status = Vec::new();
        for (request, observation) in observations {
            let observation = match observation {
                Ok(value) => value,
                Err(error) => {
                    diagnostics.push(error.to_string());
                    failures.push((Classification::RunnerFault, RUNNER_ISOLATION_SETUP));
                    telemetry.push((
                        WorkerRunTelemetry {
                            worker_ordinal: request.worker_ordinal,
                            owned_pid: None,
                            exit_status_u32: None,
                            peak_process_memory_bytes: None,
                            peak_job_memory_bytes: None,
                            launch_to_exit_elapsed_milliseconds: 0,
                            cleanup_elapsed_milliseconds: 0,
                            applied_limits: None,
                            termination_cause: TerminationCause::SetupFailure,
                            cleanup_verified: false,
                            collection_error: Some(error.to_string()),
                        },
                        None,
                    ));
                    handle_status.push(true);
                    continue;
                }
            };
            process_ids.push(observation.process_id);
            telemetry.push((observation.telemetry, Some(observation.cleanup_started)));
            handle_status.push(observation.all_owned_handles_closed);
            if !observation.stderr.is_empty() {
                diagnostics.push(String::from_utf8_lossy(&observation.stderr).into_owned());
            }
            if let Some(fault) = observation.fault {
                failures.push((
                    Classification::RunnerFault,
                    match fault {
                        RunFault::Cleanup => RUNNER_CLEANUP,
                        RunFault::Memory => RUNNER_MEMORY_LIMIT,
                        RunFault::Timeout => RUNNER_TIMEOUT,
                        RunFault::Isolation => RUNNER_ISOLATION_SETUP,
                        RunFault::Output => RUNNER_OUTPUT_LIMIT_OR_MALFORMED_OUTPUT,
                        RunFault::Crash => RUNNER_CRASH,
                        RunFault::Internal => RUNNER_INTERNAL,
                    },
                ));
                continue;
            }
            let response = match parse_response_or_failure(&observation.response) {
                Ok(value) => value,
                Err((classification, result_code, diagnostic)) => {
                    diagnostics.push(diagnostic);
                    failures.push((classification, result_code));
                    continue;
                }
            };
            if response.coordinator_nonce != request.coordinator_nonce
                || response.worker_ordinal != request.worker_ordinal
            {
                failures.push((
                    Classification::InvalidEvidence,
                    INVALID_SIGNATURE_OR_IDENTITY,
                ));
                continue;
            }
            if response.status == "failure" {
                failures.push((
                    response.classification.expect("validated failure"),
                    response.result_code.expect("validated failure"),
                ));
                continue;
            }
            let value = response
                .signed_worker_output
                .expect("validated signed response");
            if authenticate_signed_output(&value, &request, &job_hash).is_err() {
                failures.push((
                    Classification::InvalidEvidence,
                    INVALID_SIGNATURE_OR_IDENTITY,
                ));
                continue;
            }
            signed.push(value);
        }

        let directory_cleanup_started = Instant::now();
        let run_directory_removed = cleanup_run_directory(&run_root);
        let directory_cleanup_elapsed = milliseconds(directory_cleanup_started.elapsed());
        for (value, started) in &mut telemetry {
            value.cleanup_elapsed_milliseconds = started
                .map(|instant| milliseconds(instant.elapsed()))
                .unwrap_or(directory_cleanup_elapsed);
        }
        telemetry.sort_by_key(|(value, _)| value.worker_ordinal);
        let workers: Vec<_> = telemetry.into_iter().map(|(value, _)| value).collect();
        let shard_telemetry = ShardTelemetry {
            launch_attempts: 3,
            retry_attempts: 0,
            all_owned_processes_exited: workers.iter().all(|value| value.cleanup_verified),
            all_owned_handles_closed: handle_status.into_iter().all(|value| value),
            workers,
            run_directory_removed,
        };
        if !run_directory_removed {
            failures.push((Classification::RunnerFault, RUNNER_CLEANUP));
        }
        if !failures.is_empty() {
            let (classification, code) = highest_precedence(&failures);
            return ShardOutcome {
                classification,
                result_code: code,
                signed_outputs: Vec::new(),
                attestation_intents: Vec::new(),
                process_ids,
                diagnostics,
                launch_attempts: 3,
                telemetry: shard_telemetry,
            };
        }
        match agree(signed) {
            Ok(mut outcome) => {
                outcome.process_ids = process_ids;
                outcome.diagnostics = diagnostics;
                outcome.launch_attempts = 3;
                outcome.telemetry = shard_telemetry;
                outcome
            }
            Err((classification, code)) => ShardOutcome {
                classification,
                result_code: code,
                signed_outputs: Vec::new(),
                attestation_intents: Vec::new(),
                process_ids,
                diagnostics,
                launch_attempts: 3,
                telemetry: shard_telemetry,
            },
        }
    }
}

#[derive(Clone, Copy)]
struct Identity {
    ordinal: u8,
    seed: [u8; 32],
    nonce: [u8; 32],
}

fn identities(mode: IdentityMode, job_hash: &[u8; 32]) -> [Identity; 3] {
    std::array::from_fn(|index| {
        let ordinal = index as u8;
        match mode {
            IdentityMode::ExplicitCheckpoint4TestVectors => {
                let seed: [u8; 32] = Sha256::digest(
                    [b"FAULTLINE_CP4_TEST_SIGNER_V1".as_slice(), &[ordinal]].concat(),
                )
                .into();
                let nonce: [u8; 32] = Sha256::digest(
                    [
                        b"FAULTLINE_CP4_TEST_NONCE_V1".as_slice(),
                        job_hash.as_slice(),
                        &[ordinal],
                    ]
                    .concat(),
                )
                .into();
                Identity {
                    ordinal,
                    seed,
                    nonce,
                }
            }
            IdentityMode::Production => {
                let signing = Keypair::new().to_bytes();
                let random_nonce = Keypair::new().to_bytes();
                let mut seed = [0_u8; 32];
                seed.copy_from_slice(&signing[..32]);
                let mut nonce = [0_u8; 32];
                nonce.copy_from_slice(&random_nonce[..32]);
                Identity {
                    ordinal,
                    seed,
                    nonce,
                }
            }
        }
    })
}

fn load_job(repository: &Path, candidate: &str) -> Result<ReplayJob> {
    let bytes = fs::read(repository.join("manifests/checkpoint-1-vectors.json"))?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(Error::Schema)?;
    let index = match candidate {
        "v2" => 0,
        "v3" => 1,
        _ => return Err(Error::Validation("unsupported replay candidate".into())),
    };
    let selected = value
        .get("replay_jobs")
        .and_then(|value| value.get(index))
        .ok_or_else(|| Error::Validation("missing replay job vector".into()))?;
    let encoded = canonical::serialize_typed(selected)?;
    crate::schema::parse_validated(&encoded)
}

fn parse_response(frame: &[u8]) -> Result<WorkerResponse> {
    let payload = ipc::read_frame(
        &mut std::io::Cursor::new(frame),
        RESPONSE_KIND,
        MAX_RESPONSE_BYTES,
    )
    .map_err(|error| Error::Validation(format!("invalid response frame: {error:?}")))?;
    ipc::parse_canonical(&payload)
}

#[cfg(windows)]
pub(crate) fn parse_response_or_failure(
    frame: &[u8],
) -> std::result::Result<WorkerResponse, (Classification, u32, String)> {
    parse_response(frame).map_err(|error| {
        (
            Classification::RunnerFault,
            RUNNER_OUTPUT_LIMIT_OR_MALFORMED_OUTPUT,
            error.to_string(),
        )
    })
}

pub fn authenticate_signed_output(
    signed: &SignedWorkerOutput,
    request: &WorkerRequest,
    job_hash: &[u8; 32],
) -> Result<()> {
    verify_signed(signed)?;
    let output = &signed.output;
    if output.coordinator_nonce != request.coordinator_nonce
        || output.worker_ordinal != request.worker_ordinal
        || output.verifier_pubkey != request.expected_verifier_pubkey
        || signed.signer_pubkey != request.expected_verifier_pubkey
        || output.replay_job_hash != hash::hex(job_hash)
    {
        return Err(Error::Validation(
            "authenticated worker binding mismatch".into(),
        ));
    }
    Ok(())
}

/// Authenticates exactly three request/output pairs in ordinal order and then
/// applies the frozen identity-independent Milestone 7 consensus projection.
pub fn agree_authenticated(
    requests: &[WorkerRequest],
    values: Vec<SignedWorkerOutput>,
) -> std::result::Result<ShardOutcome, (Classification, u32)> {
    if requests.len() != 3 || values.len() != 3 {
        return Err((
            Classification::InvalidEvidence,
            INVALID_SIGNATURE_OR_IDENTITY,
        ));
    }
    let mut job_hash: Option<[u8; 32]> = None;
    for (index, (request, value)) in requests.iter().zip(&values).enumerate() {
        if request.worker_ordinal != index as u8 || value.output.worker_ordinal != index as u8 {
            return Err((
                Classification::InvalidEvidence,
                INVALID_SIGNATURE_OR_IDENTITY,
            ));
        }
        let current = hash::replay_job_hash(&request.replay_job).map_err(|_| {
            (
                Classification::InvalidEvidence,
                ipc::INVALID_SCHEMA_OR_VERSION,
            )
        })?;
        if job_hash.is_some_and(|expected| expected != current) {
            return Err((Classification::WorkerDisagreement, WORKER_DISAGREEMENT));
        }
        job_hash = Some(current);
        authenticate_signed_output(value, request, &current).map_err(|_| {
            (
                Classification::InvalidEvidence,
                INVALID_SIGNATURE_OR_IDENTITY,
            )
        })?;
    }
    agree(values)
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ConsensusProjection {
    replay_job_hash: String,
    classification: Classification,
    result_code: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    receipt_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    verdict_u8: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    replay_result_commitment: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    attestation_intent: Option<ConsensusIntent>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ConsensusIntent {
    verification_round: String,
    proposal: String,
    invariant_account: String,
    trace_claim: String,
    verdict_u8: u8,
    receipt_hash: String,
    replay_result_commitment: String,
}

fn projection(value: &SignedWorkerOutput) -> ConsensusProjection {
    let output = &value.output;
    ConsensusProjection {
        replay_job_hash: output.replay_job_hash.clone(),
        classification: output.classification.clone(),
        result_code: output.result_code,
        receipt_hash: output.receipt_hash.clone(),
        verdict_u8: output.verdict_u8,
        replay_result_commitment: output.replay_result_commitment.clone(),
        attestation_intent: output
            .attestation_intent
            .as_ref()
            .map(|intent| ConsensusIntent {
                verification_round: intent.verification_round.clone(),
                proposal: intent.proposal.clone(),
                invariant_account: intent.invariant_account.clone(),
                trace_claim: intent.trace_claim.clone(),
                verdict_u8: intent.verdict_u8,
                receipt_hash: intent.receipt_hash.clone(),
                replay_result_commitment: intent.replay_result_commitment.clone(),
            }),
    }
}

fn agree(
    values: Vec<SignedWorkerOutput>,
) -> std::result::Result<ShardOutcome, (Classification, u32)> {
    if values.len() != 3 {
        return Err((Classification::RunnerFault, RUNNER_CRASH));
    }
    let ordinals: BTreeSet<_> = values
        .iter()
        .map(|value| value.output.worker_ordinal)
        .collect();
    let nonces: BTreeSet<_> = values
        .iter()
        .map(|value| &value.output.coordinator_nonce)
        .collect();
    let identities: BTreeSet<_> = values
        .iter()
        .map(|value| &value.output.verifier_pubkey)
        .collect();
    let signatures: BTreeSet<_> = values.iter().map(|value| &value.signature).collect();
    let canonical_responses: BTreeSet<_> = values
        .iter()
        .map(|value| canonical::serialize_typed(value).expect("validated output serializes"))
        .collect();
    if ordinals != BTreeSet::from([0, 1, 2])
        || nonces.len() != 3
        || identities.len() != 3
        || signatures.len() != 3
        || canonical_responses.len() != 3
    {
        return Err((
            Classification::InvalidEvidence,
            INVALID_SIGNATURE_OR_IDENTITY,
        ));
    }
    let first = projection(&values[0]);
    if values[1..].iter().any(|value| projection(value) != first) {
        return Err((Classification::WorkerDisagreement, WORKER_DISAGREEMENT));
    }
    let eligible = matches!(
        first.classification,
        Classification::Preserved | Classification::Violated
    );
    let intents = if eligible {
        values
            .iter()
            .map(|value| {
                value
                    .output
                    .attestation_intent
                    .clone()
                    .expect("eligible output")
            })
            .collect()
    } else {
        Vec::new()
    };
    Ok(ShardOutcome {
        classification: first.classification,
        result_code: first.result_code,
        signed_outputs: if eligible { values } else { Vec::new() },
        attestation_intents: intents,
        process_ids: Vec::new(),
        diagnostics: Vec::new(),
        launch_attempts: 3,
        telemetry: ShardTelemetry::no_launches(),
    })
}

fn milliseconds(duration: std::time::Duration) -> u64 {
    duration.as_millis().try_into().unwrap_or(u64::MAX)
}

fn highest_precedence(failures: &[(Classification, u32)]) -> (Classification, u32) {
    failures
        .iter()
        .min_by_key(|(_, code)| precedence(*code))
        .cloned()
        .unwrap_or((Classification::RunnerFault, RUNNER_INTERNAL))
}

fn precedence(code: u32) -> u8 {
    match code {
        RUNNER_CLEANUP => 1,
        RUNNER_MEMORY_LIMIT => 2,
        RUNNER_TIMEOUT => 3,
        RUNNER_ISOLATION_SETUP => 4,
        RUNNER_OUTPUT_LIMIT_OR_MALFORMED_OUTPUT => 5,
        RUNNER_CRASH => 6,
        WORKER_DISAGREEMENT => 7,
        0x0001_0001..=0x0002_0005 => 8,
        _ => 9,
    }
}

fn cleanup_run_directory(path: &Path) -> bool {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let _ = fs::remove_dir_all(path);
        if !path.exists() {
            return true;
        }
        if std::time::Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}

fn reject_reparse(repository: &Path, executable: &Path) -> Result<()> {
    let relative = executable
        .strip_prefix(repository)
        .map_err(|_| Error::Validation("worker executable escapes repository".into()))?;
    let mut current = repository.to_path_buf();
    for component in relative.components() {
        current.push(component);
        let metadata = fs::symlink_metadata(&current)?;
        if metadata.file_type().is_symlink() || reparse(&metadata) {
            return Err(Error::Validation(
                "worker executable uses a reparse point".into(),
            ));
        }
    }
    Ok(())
}

#[cfg(windows)]
fn reparse(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & 0x400 != 0
}

#[cfg(not(windows))]
fn reparse(_: &fs::Metadata) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        receipt::build_receipt,
        runner::replay_repository_candidate,
        worker::{build_eligible_output, build_ineligible_output, sign_output},
    };

    #[test]
    fn checkpoint4_vectors_match_frozen_table() {
        let v2 = hex_to_array("76cd28ba983a92475d4c52defdb1225d3fbcd5c5489202d5d2c13a068b41f43b");
        let values = identities(IdentityMode::ExplicitCheckpoint4TestVectors, &v2);
        assert_eq!(
            hash::hex(&values[0].seed),
            "a131302e0473e6c89129e7901057b2082e56c0b49b45c829db8aabf200b3dd3d"
        );
        assert_eq!(
            hash::hex(&values[0].nonce),
            "ee37af3a42128ec081f4c16fb77c6ba73ca77ac2b877594bf9aea6a6c7587d07"
        );
        let keys: BTreeSet<_> = values
            .iter()
            .map(|value| keypair_from_seed(&value.seed).unwrap().pubkey().to_string())
            .collect();
        assert_eq!(keys.len(), 3);
    }

    #[test]
    fn assertion_16_and_27_substitution_replay_and_wrong_signature_are_rejected() {
        let repository = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(std::path::Path::parent)
            .unwrap();
        let job = load_job(repository, "v2").unwrap();
        let job_hash = hash::replay_job_hash(&job).unwrap();
        let identities = identities(IdentityMode::ExplicitCheckpoint4TestVectors, &job_hash);
        let signer = keypair_from_seed(&identities[0].seed).unwrap();
        let request = test_request(&job, &identities[0], signer.pubkey().to_string());
        let output = build_ineligible_output(
            &hash::hex(&job_hash),
            &signer.pubkey(),
            &request.coordinator_nonce,
            0,
            Classification::UnsupportedEnvironment,
            ipc::UNSUPPORTED_PROGRAM,
        )
        .unwrap();
        let signed = sign_output(output, &signer).unwrap();
        assert!(authenticate_signed_output(&signed, &request, &job_hash).is_ok());

        let mut wrong_nonce = request.clone();
        wrong_nonce.coordinator_nonce = "00".repeat(32);
        assert!(authenticate_signed_output(&signed, &wrong_nonce, &job_hash).is_err());
        let mut wrong_ordinal = request.clone();
        wrong_ordinal.worker_ordinal = 1;
        assert!(authenticate_signed_output(&signed, &wrong_ordinal, &job_hash).is_err());
        let other = keypair_from_seed(&identities[1].seed).unwrap();
        let mut wrong_identity = request.clone();
        wrong_identity.expected_verifier_pubkey = other.pubkey().to_string();
        assert!(authenticate_signed_output(&signed, &wrong_identity, &job_hash).is_err());
        let mut altered_signature = signed.clone();
        altered_signature.signature = solana_sdk::signature::Signature::default().to_string();
        assert!(authenticate_signed_output(&altered_signature, &request, &job_hash).is_err());
        let wrong_job = [0_u8; 32];
        assert!(authenticate_signed_output(&signed, &request, &wrong_job).is_err());
    }

    #[test]
    fn assertion_26_disagreement_and_duplicates_emit_no_attestations() {
        let repository = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(std::path::Path::parent)
            .unwrap();
        let job = load_job(repository, "v2").unwrap();
        let job_hash = hash::replay_job_hash(&job).unwrap();
        let identities = identities(IdentityMode::ExplicitCheckpoint4TestVectors, &job_hash);
        let mut values = Vec::new();
        for identity in identities {
            let signer = keypair_from_seed(&identity.seed).unwrap();
            let output = build_ineligible_output(
                &hash::hex(&job_hash),
                &signer.pubkey(),
                &hash::hex(&identity.nonce),
                identity.ordinal,
                Classification::UnsupportedEnvironment,
                ipc::UNSUPPORTED_PROGRAM,
            )
            .unwrap();
            values.push(sign_output(output, &signer).unwrap());
        }
        let unanimous = agree(values.clone()).unwrap();
        assert_eq!(
            unanimous.classification,
            Classification::UnsupportedEnvironment
        );
        assert!(unanimous.attestation_intents.is_empty());
        assert!(unanimous.signed_outputs.is_empty());

        let signer = keypair_from_seed(&identities[2].seed).unwrap();
        let different = build_ineligible_output(
            &hash::hex(&job_hash),
            &signer.pubkey(),
            &hash::hex(&identities[2].nonce),
            2,
            Classification::UnsupportedEnvironment,
            ipc::UNSUPPORTED_CPI,
        )
        .unwrap();
        values[2] = sign_output(different, &signer).unwrap();
        assert_eq!(
            agree(values).unwrap_err(),
            (Classification::WorkerDisagreement, WORKER_DISAGREEMENT)
        );

        let evaluation = replay_repository_candidate(repository, "v2").unwrap();
        let receipt = build_receipt(&job, &evaluation).unwrap();
        let mut eligible = Vec::new();
        for identity in identities {
            let signer = keypair_from_seed(&identity.seed).unwrap();
            let output = build_eligible_output(
                &job,
                &receipt,
                &signer.pubkey(),
                &hash::hex(&identity.nonce),
                identity.ordinal,
                0,
                0,
            )
            .unwrap();
            eligible.push(sign_output(output, &signer).unwrap());
        }
        assert_eq!(
            agree(eligible.clone()).unwrap().attestation_intents.len(),
            3
        );
        let signer = keypair_from_seed(&identities[2].seed).unwrap();
        let ineligible = build_ineligible_output(
            &hash::hex(&job_hash),
            &signer.pubkey(),
            &hash::hex(&identities[2].nonce),
            2,
            Classification::UnsupportedEnvironment,
            ipc::UNSUPPORTED_PROGRAM,
        )
        .unwrap();
        eligible[2] = sign_output(ineligible, &signer).unwrap();
        assert_eq!(
            agree(eligible).unwrap_err(),
            (Classification::WorkerDisagreement, WORKER_DISAGREEMENT)
        );
    }

    #[test]
    fn frozen_failure_precedence_is_exhaustive_and_stable() {
        let failures = vec![
            (Classification::RunnerFault, RUNNER_INTERNAL),
            (Classification::RunnerFault, RUNNER_CRASH),
            (
                Classification::RunnerFault,
                RUNNER_OUTPUT_LIMIT_OR_MALFORMED_OUTPUT,
            ),
            (Classification::RunnerFault, RUNNER_ISOLATION_SETUP),
            (Classification::RunnerFault, RUNNER_TIMEOUT),
            (Classification::RunnerFault, RUNNER_MEMORY_LIMIT),
            (Classification::RunnerFault, RUNNER_CLEANUP),
        ];
        assert_eq!(
            highest_precedence(&failures),
            (Classification::RunnerFault, RUNNER_CLEANUP)
        );
        for window in failures.windows(2) {
            assert!(precedence(window[1].1) < precedence(window[0].1));
        }
    }

    #[cfg(windows)]
    #[test]
    fn cleanup_obstruction_exhausts_grace_and_maps_to_runner_cleanup() {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::{
            Foundation::{CloseHandle, GENERIC_READ, INVALID_HANDLE_VALUE},
            Storage::FileSystem::{
                CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_NONE, OPEN_EXISTING,
            },
        };

        let repository = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(std::path::Path::parent)
            .unwrap();
        let directory = repository.join("tmp").join(format!(
            "faultline-cleanup-obstruction-test-{}",
            std::process::id()
        ));
        fs::create_dir(&directory).unwrap();
        let file = directory.join("locked");
        fs::write(&file, b"locked").unwrap();
        let wide: Vec<u16> = file.as_os_str().encode_wide().chain(Some(0)).collect();
        let handle = unsafe {
            CreateFileW(
                wide.as_ptr(),
                GENERIC_READ,
                FILE_SHARE_NONE,
                std::ptr::null(),
                OPEN_EXISTING,
                FILE_ATTRIBUTE_NORMAL,
                std::ptr::null_mut(),
            )
        };
        assert_ne!(handle, INVALID_HANDLE_VALUE);
        assert!(!cleanup_run_directory(&directory));
        assert_eq!(
            highest_precedence(&[(Classification::RunnerFault, RUNNER_CLEANUP)]),
            (Classification::RunnerFault, RUNNER_CLEANUP)
        );
        unsafe { CloseHandle(handle) };
        assert!(cleanup_run_directory(&directory));
    }

    fn test_request(job: &ReplayJob, identity: &Identity, pubkey: String) -> WorkerRequest {
        WorkerRequest {
            schema: "faultline.worker-request.v1".into(),
            canonicalization: crate::schema::CANONICALIZATION.into(),
            coordinator_nonce: hash::hex(&identity.nonce),
            worker_ordinal: identity.ordinal,
            expected_verifier_pubkey: pubkey,
            replay_job: job.clone(),
            input_paths: InputPaths {
                candidate_build_manifest: "manifests/treasury-v2-build.json".into(),
                runner_manifest: "manifests/treasury-runner.json".into(),
                fixture_manifest: "manifests/treasury-v1-fixture.json".into(),
                invariant_manifest: "manifests/auth-001-invariant.json".into(),
                trace: "fixtures/exploits/auth-001-v2-authority-takeover.json".into(),
                candidate_executable: "artifacts/treasury/v2/faultline_treasury.so".into(),
            },
        }
    }

    fn hex_to_array(value: &str) -> [u8; 32] {
        let bytes: Vec<_> = (0..64)
            .step_by(2)
            .map(|index| u8::from_str_radix(&value[index..index + 2], 16).unwrap())
            .collect();
        bytes.try_into().unwrap()
    }
}
