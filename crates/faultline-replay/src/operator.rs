//! Milestone 8 operator identity, one-key custody, and public aggregation boundary.

use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    str::FromStr,
    sync::atomic::{compiler_fence, Ordering},
};

use serde::{Deserialize, Serialize};
use solana_sdk::{
    pubkey::Pubkey,
    signature::{keypair_from_seed, Keypair, Signer},
};

use crate::{
    canonical,
    coordinator::{agree_authenticated, Coordinator, SingleWorkerOutcome},
    hash,
    ipc::{WorkerRequest, INVALID_SIGNATURE_OR_IDENTITY, WORKER_DISAGREEMENT},
    schema::{AttestationIntent, Classification, SignedWorkerOutput, Validate, CANONICALIZATION},
    worker,
};

const MAX_KEYPAIR_FILE_BYTES: u64 = 4_096;
const MAX_PUBLIC_INPUT_BYTES: u64 = 8 * 1024 * 1024;
const GATE_PROGRAM_ID: &str = "9PFPNC6TMNKBCVsm4RoCgVYmqTJJTwnHHuRcysosSCCe";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExitClass {
    Ok = 0,
    UsageOrConfig = 10,
    InvalidInput = 20,
    InvalidSignatureOrIdentity = 21,
    WorkerDisagreement = 22,
    StaleOrSubstitutedState = 23,
    Unauthorized = 24,
    RpcFailure = 30,
    TransactionRejected = 31,
    ConfirmationTimeout = 32,
    ProcessFailure = 40,
    StageTimeout = 41,
    CleanupFailure = 42,
    SecretHandlingFailure = 50,
    InternalError = 70,
}

impl ExitClass {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ok => "OK",
            Self::UsageOrConfig => "USAGE_OR_CONFIG",
            Self::InvalidInput => "INVALID_INPUT",
            Self::InvalidSignatureOrIdentity => "INVALID_SIGNATURE_OR_IDENTITY",
            Self::WorkerDisagreement => "WORKER_DISAGREEMENT",
            Self::StaleOrSubstitutedState => "STALE_OR_SUBSTITUTED_STATE",
            Self::Unauthorized => "UNAUTHORIZED",
            Self::RpcFailure => "RPC_FAILURE",
            Self::TransactionRejected => "TRANSACTION_REJECTED",
            Self::ConfirmationTimeout => "CONFIRMATION_TIMEOUT",
            Self::ProcessFailure => "PROCESS_FAILURE",
            Self::StageTimeout => "STAGE_TIMEOUT",
            Self::CleanupFailure => "CLEANUP_FAILURE",
            Self::SecretHandlingFailure => "SECRET_HANDLING_FAILURE",
            Self::InternalError => "INTERNAL_ERROR",
        }
    }
}

#[derive(Debug)]
pub struct OperatorError {
    class: ExitClass,
    message: &'static str,
}

impl OperatorError {
    pub fn new(class: ExitClass, message: &'static str) -> Self {
        Self { class, message }
    }

    pub fn class(&self) -> ExitClass {
        self.class
    }

    pub fn message(&self) -> &'static str {
        self.message
    }
}

impl std::fmt::Display for OperatorError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.message)
    }
}

impl std::error::Error for OperatorError {}

pub type OperatorResult<T> = std::result::Result<T, OperatorError>;

fn invalid(message: &'static str) -> OperatorError {
    OperatorError::new(ExitClass::InvalidInput, message)
}

fn identity_error(message: &'static str) -> OperatorError {
    OperatorError::new(ExitClass::InvalidSignatureOrIdentity, message)
}

fn secret_error(message: &'static str) -> OperatorError {
    OperatorError::new(ExitClass::SecretHandlingFailure, message)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IdentityBindings {
    pub expected_verifier: String,
    pub epoch_member: String,
    pub stake_identity: String,
    pub worker_signer: String,
    pub attestation_signer: String,
}

impl IdentityBindings {
    pub fn validate(&self) -> OperatorResult<Pubkey> {
        let expected = canonical_pubkey(&self.expected_verifier)?;
        for value in [
            &self.epoch_member,
            &self.stake_identity,
            &self.worker_signer,
            &self.attestation_signer,
        ] {
            if canonical_pubkey(value)? != expected {
                return Err(identity_error("verifier role identity mismatch"));
            }
        }
        Ok(expected)
    }
}

fn canonical_pubkey(value: &str) -> OperatorResult<Pubkey> {
    let key = Pubkey::from_str(value).map_err(|_| invalid("malformed public key"))?;
    if key.to_string() != value {
        return Err(invalid("noncanonical public key"));
    }
    Ok(key)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KeyFileScope<'a> {
    Production { repository: &'a Path },
    Demo { owned_run_directory: &'a Path },
}

pub struct CustodiedSigner {
    public_key: Pubkey,
    seed: [u8; 32],
    input_buffer_cleared: bool,
}

impl CustodiedSigner {
    pub fn public_key(&self) -> Pubkey {
        self.public_key
    }

    fn seed_mut(&mut self) -> &mut [u8; 32] {
        &mut self.seed
    }

    fn clear(&mut self) {
        volatile_clear(&mut self.seed);
    }

    pub fn mutable_input_buffer_was_cleared(&self) -> bool {
        self.input_buffer_cleared
    }

    pub fn seed_is_cleared(&self) -> bool {
        self.seed.iter().all(|value| *value == 0)
    }
}

impl Drop for CustodiedSigner {
    fn drop(&mut self) {
        self.clear();
    }
}

fn volatile_clear(bytes: &mut [u8]) {
    for byte in bytes {
        unsafe { std::ptr::write_volatile(byte, 0) };
    }
    compiler_fence(Ordering::SeqCst);
}

pub fn load_keypair_file(
    keypair_path: &Path,
    expected_verifier: &Pubkey,
    scope: KeyFileScope<'_>,
) -> OperatorResult<CustodiedSigner> {
    reject_reparse_path(keypair_path)?;
    let canonical = fs::canonicalize(keypair_path)
        .map_err(|_| secret_error("keypair file is missing or unreadable"))?;
    let metadata = fs::metadata(&canonical)
        .map_err(|_| secret_error("keypair file is missing or unreadable"))?;
    if !metadata.is_file() || metadata.len() > MAX_KEYPAIR_FILE_BYTES {
        return Err(secret_error("keypair file is unsafe"));
    }
    match scope {
        KeyFileScope::Production { repository } => {
            let repository = fs::canonicalize(repository)
                .map_err(|_| secret_error("repository path is unavailable"))?;
            if path_is_within(&canonical, &repository) {
                return Err(secret_error("repository-contained keypair is forbidden"));
            }
        }
        KeyFileScope::Demo {
            owned_run_directory,
        } => {
            let owned = fs::canonicalize(owned_run_directory)
                .map_err(|_| secret_error("owned demo directory is unavailable"))?;
            if !path_is_within(&canonical, &owned) {
                return Err(secret_error("demo keypair escapes the owned run"));
            }
        }
    }
    let file = File::open(&canonical)
        .map_err(|_| secret_error("keypair file is missing or unreadable"))?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(MAX_KEYPAIR_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| secret_error("keypair file is missing or unreadable"))?;
    if bytes.len() as u64 > MAX_KEYPAIR_FILE_BYTES {
        volatile_clear(&mut bytes);
        return Err(secret_error("keypair file is oversized"));
    }
    let parsed = parse_keypair_bytes(&bytes);
    volatile_clear(&mut bytes);
    let mut secret = parsed?;
    let mut seed = [0_u8; 32];
    seed.copy_from_slice(&secret[..32]);
    let keypair = keypair_from_seed(&seed).map_err(|_| {
        volatile_clear(&mut secret);
        volatile_clear(&mut seed);
        secret_error("keypair material is invalid")
    })?;
    let mut derived = keypair.to_bytes();
    let consistent = derived.as_slice() == secret.as_slice();
    let public_key = keypair.pubkey();
    drop(keypair);
    volatile_clear(&mut derived);
    volatile_clear(&mut secret);
    if !consistent {
        volatile_clear(&mut seed);
        return Err(secret_error("keypair public half is inconsistent"));
    }
    if &public_key != expected_verifier {
        volatile_clear(&mut seed);
        return Err(identity_error("keypair does not match requested verifier"));
    }
    Ok(CustodiedSigner {
        public_key,
        seed,
        input_buffer_cleared: true,
    })
}

fn parse_keypair_bytes(bytes: &[u8]) -> OperatorResult<Vec<u8>> {
    let value: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|_| secret_error("keypair file is malformed"))?;
    let values = value
        .as_array()
        .filter(|values| values.len() == 64)
        .ok_or_else(|| secret_error("keypair file must contain exactly 64 bytes"))?;
    let mut result = Vec::with_capacity(64);
    for value in values {
        let byte = value
            .as_u64()
            .filter(|value| *value <= 255)
            .ok_or_else(|| secret_error("keypair file contains an invalid byte"))?;
        result.push(byte as u8);
    }
    Ok(result)
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct CustodyReport {
    pub keypairs_loaded: u8,
    pub mutable_input_buffer_overwritten_best_effort: bool,
    pub mutable_seed_buffer_overwritten_best_effort: bool,
    pub automatic_retries: u8,
}

#[derive(Debug)]
pub struct VerifierRunResult {
    pub outcome: SingleWorkerOutcome,
    pub custody: CustodyReport,
}

pub fn run_verifier(
    coordinator: &Coordinator,
    request: WorkerRequest,
    bindings: &IdentityBindings,
    keypair_path: &Path,
    scope: KeyFileScope<'_>,
) -> OperatorResult<VerifierRunResult> {
    let expected = bindings.validate()?;
    if request.expected_verifier_pubkey != expected.to_string() {
        return Err(identity_error(
            "request identity does not match configured verifier",
        ));
    }
    let mut signer = load_keypair_file(keypair_path, &expected, scope)?;
    let input_cleared = signer.mutable_input_buffer_was_cleared();
    let outcome = coordinator.run_one(request, signer.seed_mut());
    let seed_cleared = signer.seed_is_cleared();
    signer.clear();
    Ok(VerifierRunResult {
        custody: CustodyReport {
            keypairs_loaded: 1,
            mutable_input_buffer_overwritten_best_effort: input_cleared,
            mutable_seed_buffer_overwritten_best_effort: seed_cleared,
            automatic_retries: 0,
        },
        outcome,
    })
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AttestationPlan {
    pub schema: String,
    pub canonicalization: String,
    pub gate_program_id: String,
    pub expected_genesis_hash: String,
    pub verification_round: String,
    pub verifier_epoch: String,
    pub replay_job_hash: String,
    pub replay_receipt_hash: String,
    pub result_hash: String,
    pub verdict_u8: u8,
    pub signed_worker_outputs: Vec<SignedWorkerOutput>,
    pub attestation_intents: Vec<AttestationIntent>,
}

pub fn verify_quorum(
    requests: &[WorkerRequest],
    outputs: Vec<SignedWorkerOutput>,
    gate_program_id: &str,
    expected_genesis_hash: &str,
    verifier_epoch: &str,
) -> OperatorResult<AttestationPlan> {
    canonical_pubkey(gate_program_id)?;
    if gate_program_id != GATE_PROGRAM_ID {
        return Err(invalid("unexpected Gate program id"));
    }
    canonical_pubkey(verifier_epoch)?;
    canonical_pubkey(expected_genesis_hash)?;
    let outcome = agree_authenticated(requests, outputs).map_err(|(classification, code)| {
        if classification == Classification::WorkerDisagreement || code == WORKER_DISAGREEMENT {
            OperatorError::new(ExitClass::WorkerDisagreement, "worker outputs disagree")
        } else if code == INVALID_SIGNATURE_OR_IDENTITY {
            identity_error("worker authentication or identity failed")
        } else {
            invalid("worker outputs are invalid")
        }
    })?;
    if outcome.signed_outputs.len() != 3 || outcome.attestation_intents.len() != 3 {
        return Err(OperatorError::new(
            ExitClass::WorkerDisagreement,
            "worker outputs are not unanimously eligible",
        ));
    }
    let first = &outcome.signed_outputs[0].output;
    let receipt = first
        .receipt_hash
        .clone()
        .ok_or_else(|| invalid("eligible output lacks receipt hash"))?;
    let result = first
        .replay_result_commitment
        .clone()
        .ok_or_else(|| invalid("eligible output lacks result commitment"))?;
    let verdict = first
        .verdict_u8
        .ok_or_else(|| invalid("eligible output lacks verdict"))?;
    let verification_round = first
        .attestation_intent
        .as_ref()
        .ok_or_else(|| invalid("eligible output lacks attestation intent"))?
        .verification_round
        .clone();
    Ok(AttestationPlan {
        schema: "faultline.attestation-plan.v1".into(),
        canonicalization: CANONICALIZATION.into(),
        gate_program_id: gate_program_id.into(),
        expected_genesis_hash: expected_genesis_hash.into(),
        verification_round,
        verifier_epoch: verifier_epoch.into(),
        replay_job_hash: first.replay_job_hash.clone(),
        replay_receipt_hash: receipt,
        result_hash: result,
        verdict_u8: verdict,
        signed_worker_outputs: outcome.signed_outputs,
        attestation_intents: outcome.attestation_intents,
    })
}

pub fn plan_bytes(plan: &AttestationPlan) -> OperatorResult<Vec<u8>> {
    canonical::serialize_typed(plan).map_err(|_| invalid("attestation plan is not canonical"))
}

pub fn read_request(path: &Path) -> OperatorResult<WorkerRequest> {
    let bytes = read_bounded_public(path)?;
    crate::ipc::parse_canonical(&bytes).map_err(|_| invalid("worker request is invalid"))
}

pub fn read_signed_output(path: &Path) -> OperatorResult<SignedWorkerOutput> {
    let bytes = read_bounded_public(path)?;
    worker::parse_signed(&bytes).map_err(|_| invalid("signed worker output is invalid"))
}

fn read_bounded_public(path: &Path) -> OperatorResult<Vec<u8>> {
    let metadata = fs::metadata(path).map_err(|_| invalid("public input is unavailable"))?;
    if !metadata.is_file() || metadata.len() > MAX_PUBLIC_INPUT_BYTES {
        return Err(invalid("public input exceeds its bound"));
    }
    fs::read(path).map_err(|_| invalid("public input is unavailable"))
}

pub struct DemoKeySet {
    directory: PathBuf,
    files: Vec<PathBuf>,
    public_keys: Vec<Pubkey>,
    cleaned: bool,
}

impl DemoKeySet {
    pub fn create(owned_run_directory: &Path) -> OperatorResult<Self> {
        reject_reparse_path(owned_run_directory)?;
        let owned = fs::canonicalize(owned_run_directory)
            .map_err(|_| secret_error("owned demo directory is unavailable"))?;
        let entropy = Keypair::new().pubkey();
        let directory = owned.join(format!(
            "m8-demo-keys-{}",
            &hash::hex(&hash::sha256(entropy.as_ref()))[..16]
        ));
        fs::create_dir(&directory)
            .map_err(|_| secret_error("demo key directory creation failed"))?;
        let mut set = Self {
            directory,
            files: Vec::with_capacity(3),
            public_keys: Vec::with_capacity(3),
            cleaned: false,
        };
        for ordinal in 0..3_u8 {
            let keypair = Keypair::new();
            let public_key = keypair.pubkey();
            let mut secret = keypair.to_bytes();
            drop(keypair);
            let encoded = match serde_json::to_vec(&secret.as_slice()) {
                Ok(value) => value,
                Err(_) => {
                    volatile_clear(&mut secret);
                    return Err(secret_error("demo key encoding failed"));
                }
            };
            let path = set.directory.join(format!("verifier-{ordinal}.json"));
            let mut file = create_private_demo_file(&path)?;
            set.files.push(path);
            let write_result = file.write_all(&encoded).and_then(|_| file.flush());
            drop(file);
            volatile_clear(&mut secret);
            let mut encoded = encoded;
            volatile_clear(&mut encoded);
            write_result.map_err(|_| secret_error("demo key write failed"))?;
            set.public_keys.push(public_key);
        }
        if set
            .public_keys
            .iter()
            .collect::<std::collections::BTreeSet<_>>()
            .len()
            != 3
        {
            return Err(secret_error("demo identity generation was not distinct"));
        }
        Ok(set)
    }

    pub fn public_keys(&self) -> &[Pubkey] {
        &self.public_keys
    }

    pub fn key_file(&self, ordinal: usize) -> Option<&Path> {
        self.files.get(ordinal).map(PathBuf::as_path)
    }

    pub fn directory(&self) -> &Path {
        &self.directory
    }

    pub fn cleanup(&mut self) -> OperatorResult<()> {
        for path in &self.files {
            if path.exists() {
                fs::remove_file(path).map_err(|_| {
                    OperatorError::new(ExitClass::CleanupFailure, "demo key cleanup failed")
                })?;
            }
        }
        if self.directory.exists() {
            fs::remove_dir(&self.directory).map_err(|_| {
                OperatorError::new(ExitClass::CleanupFailure, "demo key cleanup failed")
            })?;
        }
        self.cleaned = true;
        Ok(())
    }

    pub fn cleanup_verified(&self) -> bool {
        self.cleaned && !self.directory.exists() && self.files.iter().all(|path| !path.exists())
    }
}

#[cfg(windows)]
fn create_private_demo_file(path: &Path) -> OperatorResult<File> {
    use std::os::windows::{ffi::OsStrExt, io::FromRawHandle};
    use windows_sys::Win32::{
        Foundation::{LocalFree, GENERIC_WRITE, INVALID_HANDLE_VALUE},
        Security::{
            Authorization::ConvertStringSecurityDescriptorToSecurityDescriptorW,
            PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES,
        },
        Storage::FileSystem::{CreateFileW, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_NONE},
    };

    let sddl: Vec<u16> = std::ffi::OsStr::new("D:P(A;;FA;;;OW)")
        .encode_wide()
        .chain(Some(0))
        .collect();
    let mut descriptor: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
    if unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.as_ptr(),
            1,
            &mut descriptor,
            std::ptr::null_mut(),
        )
    } == 0
    {
        return Err(secret_error("demo key security descriptor failed"));
    }
    let attributes = SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: descriptor,
        bInheritHandle: 0,
    };
    let path: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let handle = unsafe {
        CreateFileW(
            path.as_ptr(),
            GENERIC_WRITE,
            FILE_SHARE_NONE,
            &attributes,
            CREATE_NEW,
            FILE_ATTRIBUTE_NORMAL,
            std::ptr::null_mut(),
        )
    };
    unsafe { LocalFree(descriptor) };
    if handle == INVALID_HANDLE_VALUE {
        return Err(secret_error("demo key creation failed"));
    }
    Ok(unsafe { File::from_raw_handle(handle) })
}

#[cfg(not(windows))]
fn create_private_demo_file(path: &Path) -> OperatorResult<File> {
    use std::os::unix::fs::OpenOptionsExt;
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .map_err(|_| secret_error("demo key creation failed"))
}

impl Drop for DemoKeySet {
    fn drop(&mut self) {
        if !self.cleaned {
            let _ = self.cleanup();
        }
    }
}

fn path_is_within(path: &Path, parent: &Path) -> bool {
    #[cfg(windows)]
    {
        let path = path.to_string_lossy().to_ascii_lowercase();
        let mut parent = parent.to_string_lossy().to_ascii_lowercase();
        if !parent.ends_with('\\') && !parent.ends_with('/') {
            parent.push('\\');
        }
        path.starts_with(&parent)
    }
    #[cfg(not(windows))]
    {
        path.starts_with(parent)
    }
}

fn reject_reparse_path(path: &Path) -> OperatorResult<()> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|_| secret_error("keypair path cannot be resolved"))?
            .join(path)
    };
    let mut current = PathBuf::new();
    for component in absolute.components() {
        current.push(component);
        let metadata = match fs::symlink_metadata(&current) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if metadata.file_type().is_symlink() || metadata_is_reparse(&metadata) {
            return Err(secret_error("reparse-point keypair path is forbidden"));
        }
    }
    Ok(())
}

#[cfg(windows)]
fn metadata_is_reparse(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & 0x400 != 0
}

#[cfg(not(windows))]
fn metadata_is_reparse(_: &fs::Metadata) -> bool {
    false
}

pub fn classify_worker_outcome(outcome: &SingleWorkerOutcome) -> OperatorResult<()> {
    if !outcome.run_directory_removed
        || !outcome.all_owned_handles_closed
        || outcome
            .telemetry
            .as_ref()
            .is_some_and(|value| !value.cleanup_verified)
    {
        return Err(OperatorError::new(
            ExitClass::CleanupFailure,
            "owned worker cleanup failed",
        ));
    }
    if outcome.signed_output.is_some() {
        return Ok(());
    }
    let class = match outcome.result_code {
        crate::ipc::RUNNER_TIMEOUT => ExitClass::StageTimeout,
        crate::ipc::RUNNER_CLEANUP => ExitClass::CleanupFailure,
        crate::ipc::INVALID_SIGNATURE_OR_IDENTITY => ExitClass::InvalidSignatureOrIdentity,
        _ if outcome.classification == Classification::RunnerFault => ExitClass::ProcessFailure,
        _ => ExitClass::InvalidInput,
    };
    Err(OperatorError::new(class, "worker execution failed"))
}

pub fn validate_signed_output_for_request(
    request: &WorkerRequest,
    output: &SignedWorkerOutput,
) -> OperatorResult<()> {
    request
        .validate()
        .map_err(|_| invalid("worker request is invalid"))?;
    let job_hash =
        hash::replay_job_hash(&request.replay_job).map_err(|_| invalid("replay job is invalid"))?;
    crate::coordinator::authenticate_signed_output(output, request, &job_hash)
        .map_err(|_| identity_error("worker authentication or binding failed"))
}
