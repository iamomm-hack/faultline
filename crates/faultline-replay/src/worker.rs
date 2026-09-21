use std::{
    io::{Read, Write},
    path::Path,
    str::FromStr,
    time::Instant,
};

use solana_sdk::{
    pubkey::Pubkey,
    signature::{keypair_from_seed, Keypair, Signature, Signer},
};

use crate::{
    canonical, hash,
    ipc::{
        self, WorkerRequest, WorkerResponse, INVALID_BOUNDS, INVALID_CANONICAL_ENCODING,
        INVALID_DIGEST_BINDING, INVALID_DUPLICATE_KEY, INVALID_JSON, INVALID_SCHEMA_OR_VERSION,
        INVALID_UNKNOWN_FIELD, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, REQUEST_KIND, RESPONSE_KIND,
        RUNNER_INTERNAL, RUNNER_ISOLATION_SETUP, SIGNING_SEED_BYTES, SIGNING_SEED_KIND,
    },
    paths::AllowedRoots,
    receipt::{build_receipt, ReceiptBundle},
    runner,
    schema::{
        parse_validated, AttestationIntent, BuildManifest, Classification, FixtureManifest,
        InvariantManifest, ReplayJob, RunnerManifest, SignedWorkerOutput, Trace, Validate,
        WorkerOutput, CANONICALIZATION,
    },
    trace, Error, Result,
};

const TOKENKEG_SHA256: &str = "18264f491c7e0ad056dd36f42f8de6d1fedf9f044d1f521e714b4dc6b61594b6";

/// Runs one production worker session. The caller supplies the dedicated request,
/// signing-seed, response, and diagnostic streams.
pub fn run_worker_session<R: Read, S: Read, W: Write, E: Write>(
    repository: &Path,
    request_pipe: &mut R,
    signing_pipe: &mut S,
    response_pipe: &mut W,
    diagnostics: &mut E,
) -> i32 {
    let request_bytes = match ipc::read_frame(request_pipe, REQUEST_KIND, MAX_REQUEST_BYTES) {
        Ok(bytes) => bytes,
        Err(error) => {
            let _ = writeln!(diagnostics, "invalid request frame: {error:?}");
            return 20;
        }
    };
    let request: WorkerRequest = match ipc::parse_canonical(&request_bytes) {
        Ok(request) => request,
        Err(error) => {
            let _ = writeln!(diagnostics, "invalid request: {error}");
            return 21;
        }
    };
    let mut seed = match ipc::read_frame(signing_pipe, SIGNING_SEED_KIND, SIGNING_SEED_BYTES) {
        Ok(bytes) if bytes.len() == SIGNING_SEED_BYTES => bytes,
        _ => {
            return emit_failure(
                &request,
                Classification::RunnerFault,
                RUNNER_ISOLATION_SETUP,
                response_pipe,
                diagnostics,
                "invalid signing-seed frame",
            )
        }
    };
    let signer = keypair_from_seed(&seed);
    seed.fill(0);
    let signer = match signer {
        Ok(signer) if signer.pubkey().to_string() == request.expected_verifier_pubkey => signer,
        _ => {
            return emit_failure(
                &request,
                Classification::RunnerFault,
                RUNNER_ISOLATION_SETUP,
                response_pipe,
                diagnostics,
                "signing seed does not match expected verifier",
            )
        }
    };

    let started = Instant::now();
    let signed = match execute_request(repository, &request, &signer, started) {
        Ok(signed) => signed,
        Err(failure) => {
            return emit_failure(
                &request,
                failure.classification,
                failure.code,
                response_pipe,
                diagnostics,
                &failure.diagnostic,
            )
        }
    };
    let response = match WorkerResponse::signed(&request, signed) {
        Ok(response) => response,
        Err(error) => {
            return emit_failure(
                &request,
                Classification::RunnerFault,
                RUNNER_INTERNAL,
                response_pipe,
                diagnostics,
                &format!("response construction failed: {error}"),
            )
        }
    };
    match ipc::canonical_payload(&response)
        .map_err(|_| ipc::FrameError::Io)
        .and_then(|bytes| {
            ipc::write_frame(response_pipe, RESPONSE_KIND, &bytes, MAX_RESPONSE_BYTES)
        }) {
        Ok(()) => 0,
        Err(error) => {
            let _ = writeln!(diagnostics, "response write failed: {error:?}");
            22
        }
    }
}

#[derive(Debug)]
struct WorkerFailure {
    classification: Classification,
    code: u32,
    diagnostic: String,
}

fn execute_request(
    repository: &Path,
    request: &WorkerRequest,
    signer: &Keypair,
    started: Instant,
) -> std::result::Result<SignedWorkerOutput, WorkerFailure> {
    let roots = AllowedRoots::resolve(repository).map_err(map_input_error)?;
    let paths = &request.input_paths;
    let build_bytes = roots
        .read_bounded(&paths.candidate_build_manifest, 1024 * 1024)
        .map_err(map_path_error)?;
    let runner_bytes = roots
        .read_bounded(&paths.runner_manifest, 1024 * 1024)
        .map_err(map_path_error)?;
    let fixture_bytes = roots
        .read_bounded(&paths.fixture_manifest, 10 * 1024 * 1024)
        .map_err(map_path_error)?;
    let invariant_bytes = roots
        .read_bounded(&paths.invariant_manifest, 1024 * 1024)
        .map_err(map_path_error)?;
    let trace_bytes = roots
        .read_bounded(&paths.trace, 2 * 1024 * 1024)
        .map_err(map_path_error)?;
    let executable = roots
        .read_bounded(&paths.candidate_executable, 10 * 1024 * 1024)
        .map_err(map_path_error)?;

    let build: BuildManifest = parse_manifest(&build_bytes)?;
    let runner_manifest: RunnerManifest = parse_manifest(&runner_bytes)?;
    let fixture: FixtureManifest = parse_manifest(&fixture_bytes)?;
    let invariant: InvariantManifest = parse_manifest(&invariant_bytes)?;
    let replay_trace: Trace = parse_manifest(&trace_bytes)?;
    verify_binding(
        hash::manifest_hash("faultline.build.v1", &build),
        &request.replay_job.build_manifest_hash,
        "build manifest",
    )?;
    verify_binding(
        hash::manifest_hash("faultline.runner.v1", &runner_manifest),
        &request.replay_job.runner_manifest_hash,
        "runner manifest",
    )?;
    verify_binding(
        hash::manifest_hash("faultline.fixture.v1", &fixture),
        &request.replay_job.fixture_manifest_hash,
        "fixture manifest",
    )?;
    verify_binding(
        hash::manifest_hash("faultline.invariant.v1", &invariant),
        &request.replay_job.invariant_manifest_hash,
        "invariant manifest",
    )?;
    verify_binding(
        hash::trace_hash(&replay_trace),
        &request.replay_job.trace_hash,
        "trace",
    )?;
    if build.artifact_path != paths.candidate_executable {
        return Err(invalid(
            INVALID_DIGEST_BINDING,
            "build artifact path mismatch",
        ));
    }
    if hash::hex(&hash::sha256(&executable)) != build.executable_sha256
        || build.executable_sha256 != request.replay_job.candidate_executable_sha256
    {
        return Err(invalid(
            INVALID_DIGEST_BINDING,
            "candidate executable digest mismatch",
        ));
    }
    if build.program_id != request.replay_job.target_program_id {
        return Err(invalid(
            INVALID_DIGEST_BINDING,
            "target program binding mismatch",
        ));
    }
    let token = roots
        .read_bounded("manifests/programs/spl-token-3.5.0.so", 10 * 1024 * 1024)
        .map_err(map_path_error)?;
    if hash::hex(&hash::sha256(&token)) != TOKENKEG_SHA256 {
        return Err(invalid(
            INVALID_DIGEST_BINDING,
            "Tokenkeg mirror digest mismatch",
        ));
    }

    let normalized = trace::normalize(&replay_trace, &fixture).map_err(map_input_error)?;
    let evaluation = runner::execute(
        &build.build,
        &executable,
        &build,
        &fixture,
        &invariant,
        &runner_manifest,
        normalized,
    )
    .map_err(|error| WorkerFailure {
        classification: Classification::RunnerFault,
        code: RUNNER_INTERNAL,
        diagnostic: error.to_string(),
    })?;
    let receipt =
        build_receipt(&request.replay_job, &evaluation).map_err(|error| WorkerFailure {
            classification: Classification::RunnerFault,
            code: RUNNER_INTERNAL,
            diagnostic: error.to_string(),
        })?;
    let output = build_eligible_output(
        &request.replay_job,
        &receipt,
        &signer.pubkey(),
        &request.coordinator_nonce,
        request.worker_ordinal,
        0,
        started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
    )
    .map_err(|error| WorkerFailure {
        classification: Classification::RunnerFault,
        code: RUNNER_INTERNAL,
        diagnostic: error.to_string(),
    })?;
    sign_output(output, signer).map_err(|error| WorkerFailure {
        classification: Classification::RunnerFault,
        code: RUNNER_INTERNAL,
        diagnostic: error.to_string(),
    })
}

fn parse_manifest<T: serde::de::DeserializeOwned + serde::Serialize + Validate>(
    bytes: &[u8],
) -> std::result::Result<T, WorkerFailure> {
    parse_validated(bytes).map_err(map_input_error)
}

fn verify_binding(
    actual: Result<[u8; 32]>,
    expected: &str,
    label: &str,
) -> std::result::Result<(), WorkerFailure> {
    let actual = actual.map_err(map_input_error)?;
    if hash::hex(&actual) == expected {
        Ok(())
    } else {
        Err(invalid(
            INVALID_DIGEST_BINDING,
            &format!("{label} digest mismatch"),
        ))
    }
}

fn map_path_error(error: Error) -> WorkerFailure {
    let text = error.to_string();
    let code = if text.contains("size bound") {
        INVALID_BOUNDS
    } else {
        ipc::INVALID_ALIAS_OR_REFERENCE
    };
    invalid(code, &text)
}

fn map_input_error(error: Error) -> WorkerFailure {
    let text = error.to_string();
    let code = match &error {
        Error::DuplicateKey(_) => INVALID_DUPLICATE_KEY,
        Error::Schema(inner) if inner.to_string().contains("unknown field") => {
            INVALID_UNKNOWN_FIELD
        }
        Error::Schema(_) => INVALID_SCHEMA_OR_VERSION,
        Error::Canonical(message) if message.contains("noncanonical") => INVALID_CANONICAL_ENCODING,
        Error::Canonical(message)
            if message.contains("UTF-8")
                || message.contains("expected JSON")
                || message.contains("JSON") =>
        {
            INVALID_JSON
        }
        Error::Canonical(_) => INVALID_CANONICAL_ENCODING,
        Error::Validation(message) if message.contains("bound") || message.contains("limit") => {
            INVALID_BOUNDS
        }
        Error::Validation(_) => INVALID_SCHEMA_OR_VERSION,
        Error::Io(_) => RUNNER_INTERNAL,
    };
    let classification = if code == RUNNER_INTERNAL {
        Classification::RunnerFault
    } else {
        Classification::InvalidEvidence
    };
    WorkerFailure {
        classification,
        code,
        diagnostic: text,
    }
}

fn invalid(code: u32, diagnostic: &str) -> WorkerFailure {
    WorkerFailure {
        classification: Classification::InvalidEvidence,
        code,
        diagnostic: diagnostic.into(),
    }
}

fn emit_failure<W: Write, E: Write>(
    request: &WorkerRequest,
    classification: Classification,
    code: u32,
    response_pipe: &mut W,
    diagnostics: &mut E,
    diagnostic: &str,
) -> i32 {
    let _ = writeln!(diagnostics, "{diagnostic}");
    let response = WorkerResponse::failure(request, classification, code)
        .and_then(|response| ipc::canonical_payload(&response));
    match response {
        Ok(bytes)
            if ipc::write_frame(response_pipe, RESPONSE_KIND, &bytes, MAX_RESPONSE_BYTES)
                .is_ok() =>
        {
            0
        }
        _ => 23,
    }
}

pub fn verdict_byte(classification: &Classification, result_code: u32) -> Result<u8> {
    match (classification, result_code) {
        (Classification::Preserved, 0) => Ok(0),
        (Classification::Violated, 1) => Ok(1),
        _ => Err(Error::Validation(
            "classification is not eligible for a protocol verdict".into(),
        )),
    }
}

pub fn replay_commitment(
    job: &ReplayJob,
    classification: &Classification,
    result_code: u32,
    receipt_hash: &[u8; 32],
) -> Result<[u8; 32]> {
    job.validate()?;
    let verdict = verdict_byte(classification, result_code)?;
    Ok(hash::replay_result_commitment(
        &pubkey_bytes(&job.proposal)?,
        &pubkey_bytes(&job.invariant_account)?,
        &pubkey_bytes(&job.trace_claim)?,
        &digest_bytes(&job.candidate_buffer_hash)?,
        &digest_bytes(&job.invariant_specification_hash)?,
        verdict,
        receipt_hash,
    ))
}

#[allow(clippy::too_many_arguments)]
pub fn build_eligible_output(
    job: &ReplayJob,
    receipt: &ReceiptBundle,
    verifier_pubkey: &Pubkey,
    coordinator_nonce: &str,
    worker_ordinal: u8,
    process_peak_memory_bytes: u64,
    elapsed_milliseconds: u64,
) -> Result<WorkerOutput> {
    receipt.receipt.validate()?;
    if receipt.receipt_hash != hash::receipt_hash(&receipt.receipt)? {
        return Err(Error::Validation("altered receipt hash".into()));
    }
    if receipt.receipt.replay_job_hash != hash::hex(&hash::replay_job_hash(job)?) {
        return Err(Error::Validation("receipt/job binding mismatch".into()));
    }
    let verdict = verdict_byte(&receipt.receipt.classification, receipt.receipt.result_code)?;
    let commitment = replay_commitment(
        job,
        &receipt.receipt.classification,
        receipt.receipt.result_code,
        &receipt.receipt_hash,
    )?;
    let receipt_hash = hash::hex(&receipt.receipt_hash);
    let commitment = hash::hex(&commitment);
    let verifier = verifier_pubkey.to_string();
    let output = WorkerOutput {
        schema: "faultline.worker-output.v1".into(),
        canonicalization: CANONICALIZATION.into(),
        coordinator_nonce: coordinator_nonce.into(),
        worker_ordinal,
        verifier_pubkey: verifier.clone(),
        replay_job_hash: receipt.receipt.replay_job_hash.clone(),
        classification: receipt.receipt.classification.clone(),
        result_code: receipt.receipt.result_code,
        receipt_hash: Some(receipt_hash.clone()),
        verdict_u8: Some(verdict),
        replay_result_commitment: Some(commitment.clone()),
        attestation_intent: Some(AttestationIntent {
            verification_round: job.verification_round.clone(),
            proposal: job.proposal.clone(),
            invariant_account: job.invariant_account.clone(),
            trace_claim: job.trace_claim.clone(),
            verifier_pubkey: verifier,
            verdict_u8: verdict,
            receipt_hash,
            replay_result_commitment: commitment,
        }),
        process_peak_memory_bytes: process_peak_memory_bytes.to_string(),
        elapsed_milliseconds: elapsed_milliseconds.to_string(),
    };
    output.validate()?;
    Ok(output)
}

pub fn build_ineligible_output(
    replay_job_hash: &str,
    verifier_pubkey: &Pubkey,
    coordinator_nonce: &str,
    worker_ordinal: u8,
    classification: Classification,
    result_code: u32,
) -> Result<WorkerOutput> {
    if matches!(
        classification,
        Classification::Preserved | Classification::Violated
    ) {
        return Err(Error::Validation(
            "eligible result requires a receipt".into(),
        ));
    }
    let output = WorkerOutput {
        schema: "faultline.worker-output.v1".into(),
        canonicalization: CANONICALIZATION.into(),
        coordinator_nonce: coordinator_nonce.into(),
        worker_ordinal,
        verifier_pubkey: verifier_pubkey.to_string(),
        replay_job_hash: replay_job_hash.into(),
        classification,
        result_code,
        receipt_hash: None,
        verdict_u8: None,
        replay_result_commitment: None,
        attestation_intent: None,
        process_peak_memory_bytes: "0".into(),
        elapsed_milliseconds: "0".into(),
    };
    output.validate()?;
    Ok(output)
}

pub fn sign_output(output: WorkerOutput, signer: &Keypair) -> Result<SignedWorkerOutput> {
    output.validate()?;
    if signer.pubkey().to_string() != output.verifier_pubkey {
        return Err(Error::Validation("signing key/verifier mismatch".into()));
    }
    let digest = hash::worker_message_digest(&output)?;
    let signature = signer.sign_message(&digest);
    let signed = SignedWorkerOutput {
        schema: "faultline.signed-worker-output.v1".into(),
        canonicalization: CANONICALIZATION.into(),
        output,
        signature_algorithm: "solana-ed25519-sha256-v1".into(),
        signer_pubkey: signer.pubkey().to_string(),
        signature: signature.to_string(),
    };
    signed.validate()?;
    Ok(signed)
}

pub fn parse_signed(bytes: &[u8]) -> Result<SignedWorkerOutput> {
    parse_validated(bytes)
}

pub fn verify_signed(signed: &SignedWorkerOutput) -> Result<[u8; 32]> {
    signed.validate()?;
    let pubkey = Pubkey::from_str(&signed.signer_pubkey)
        .map_err(|_| Error::Validation("invalid signer public key".into()))?;
    let signature = Signature::from_str(&signed.signature)
        .map_err(|_| Error::Validation("invalid signature encoding".into()))?;
    let digest = hash::worker_message_digest(&signed.output)?;
    if !signature.verify(pubkey.as_ref(), &digest) {
        return Err(Error::Validation(
            "worker signature verification failed".into(),
        ));
    }
    Ok(digest)
}

pub fn attestation_intent_hash(intent: &AttestationIntent) -> Result<[u8; 32]> {
    Ok(hash::sha256(&canonical::serialize_typed(intent)?))
}

fn pubkey_bytes(value: &str) -> Result<[u8; 32]> {
    Ok(Pubkey::from_str(value)
        .map_err(|_| Error::Validation("invalid commitment public key".into()))?
        .to_bytes())
}

fn digest_bytes(value: &str) -> Result<[u8; 32]> {
    let bytes = hex_bytes(value)?;
    bytes
        .try_into()
        .map_err(|_| Error::Validation("invalid commitment digest length".into()))
}

fn hex_bytes(value: &str) -> Result<Vec<u8>> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(Error::Validation("invalid lowercase digest".into()));
    }
    (0..64)
        .step_by(2)
        .map(|index| {
            u8::from_str_radix(&value[index..index + 2], 16)
                .map_err(|_| Error::Validation("invalid digest".into()))
        })
        .collect()
}

#[cfg(test)]
mod checkpoint4_tests {
    use super::*;
    use crate::ipc::{InputPaths, WorkerRequest};
    use sha2::{Digest, Sha256};
    use std::{fs, io::Cursor};

    fn root() -> &'static Path {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(Path::parent)
            .unwrap()
    }

    fn request() -> (WorkerRequest, [u8; 32]) {
        let vectors: serde_json::Value = serde_json::from_slice(
            &fs::read(root().join("manifests/checkpoint-1-vectors.json")).unwrap(),
        )
        .unwrap();
        let job: ReplayJob =
            parse_validated(&canonical::serialize_typed(&vectors["replay_jobs"][0]).unwrap())
                .unwrap();
        let seed: [u8; 32] =
            Sha256::digest([b"FAULTLINE_CP4_TEST_SIGNER_V1".as_slice(), &[0_u8]].concat()).into();
        let signer = keypair_from_seed(&seed).unwrap();
        (
            WorkerRequest {
                schema: "faultline.worker-request.v1".into(),
                canonicalization: CANONICALIZATION.into(),
                coordinator_nonce: "00".repeat(32),
                worker_ordinal: 0,
                expected_verifier_pubkey: signer.pubkey().to_string(),
                replay_job: job,
                input_paths: InputPaths {
                    candidate_build_manifest: "manifests/treasury-v2-build.json".into(),
                    runner_manifest: "manifests/treasury-runner.json".into(),
                    fixture_manifest: "manifests/treasury-v1-fixture.json".into(),
                    invariant_manifest: "manifests/auth-001-invariant.json".into(),
                    trace: "fixtures/exploits/auth-001-v2-authority-takeover.json".into(),
                    candidate_executable: "artifacts/treasury/v2/faultline_treasury.so".into(),
                },
            },
            seed,
        )
    }

    #[test]
    fn malformed_missing_trailing_and_wrong_identity_signing_frames_fail_isolation() {
        let (request, seed) = request();
        let request_payload = canonical::serialize_typed(&request).unwrap();
        let request_frame =
            ipc::encode_frame(REQUEST_KIND, &request_payload, MAX_REQUEST_BYTES).unwrap();
        let wrong_seed: [u8; 32] =
            Sha256::digest([b"FAULTLINE_CP4_TEST_SIGNER_V1".as_slice(), &[1_u8]].concat()).into();
        let mut cases = vec![
            Vec::new(),
            ipc::encode_frame(REQUEST_KIND, &seed, SIGNING_SEED_BYTES).unwrap(),
            ipc::encode_frame(SIGNING_SEED_KIND, &seed[..31], SIGNING_SEED_BYTES).unwrap(),
            ipc::encode_frame(SIGNING_SEED_KIND, &wrong_seed, SIGNING_SEED_BYTES).unwrap(),
        ];
        let mut trailing = ipc::encode_frame(SIGNING_SEED_KIND, &seed, SIGNING_SEED_BYTES).unwrap();
        trailing.push(0);
        cases.push(trailing);
        for signing_frame in cases {
            let mut output = Vec::new();
            let mut diagnostics = Vec::new();
            let code = run_worker_session(
                root(),
                &mut Cursor::new(request_frame.clone()),
                &mut Cursor::new(signing_frame),
                &mut output,
                &mut diagnostics,
            );
            assert_eq!(code, 0);
            let payload =
                ipc::read_frame(&mut Cursor::new(output), RESPONSE_KIND, MAX_RESPONSE_BYTES)
                    .unwrap();
            let response: WorkerResponse = ipc::parse_canonical(&payload).unwrap();
            assert_eq!(response.classification, Some(Classification::RunnerFault));
            assert_eq!(response.result_code, Some(RUNNER_ISOLATION_SETUP));
            assert!(response.signed_worker_output.is_none());
        }
    }
}
