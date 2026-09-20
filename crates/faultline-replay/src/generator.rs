use std::{
    env, fs,
    path::{Path, PathBuf},
};

use serde::Serialize;
use serde_json::{Map, Value};
use solana_sdk::signature::{keypair_from_seed, Signer};

use crate::{
    canonical,
    hash::{self, hex},
    schema::*,
    Error, Result,
};

const V2_HASH: &str = "82bf0adc96092daeae5758715ba1e05d7c9b272b03b8588e62ec3858ef4b4f6a";
const V3_HASH: &str = "8ef2ad4bd0b7bf799ebe82ce17984b8ec80d55b47bd5ea5b9ec6aa304010fffa";
const POLICY_HASH: &str = "b63f9fccb4731d21ea15c254634ba9f569ed3ff305e6e5c16bfab3dfc53dec7c";
const TOKEN_HASH: &str = "18264f491c7e0ad056dd36f42f8de6d1fedf9f044d1f521e714b4dc6b61594b6";
const LITESVM_CRATE_HASH: &str = "0963e4df461a414763f0348b73eb284a734534a53558fcae35f984a0c16a6e6c";
const WORKER_VECTOR_SEED: [u8; 32] = [0x15; 32];

#[derive(Debug, Serialize)]
pub struct GenerationReport {
    pub build_v2_manifest_hash: String,
    pub build_v3_manifest_hash: String,
    pub runner_manifest_hash: String,
    pub fixture_manifest_hash: String,
    pub invariant_manifest_hash: String,
    pub trace_hash: String,
    pub replay_job_v2_hash: String,
    pub replay_job_v3_hash: String,
    pub receipt_v2_hash: String,
    pub receipt_v3_hash: String,
    pub worker_v2_message_digest: String,
    pub worker_v3_message_digest: String,
    pub milestone5_violation_result_hash: String,
    pub tokenkeg_sha256: String,
}

#[derive(Debug, Serialize)]
struct VectorFile<'a> {
    kind: &'static str,
    canonicalization: &'static str,
    note: &'static str,
    hashes: &'a GenerationReport,
    replay_jobs: [&'a ReplayJob; 2],
    receipts: [&'a ReplayReceipt; 2],
    unsigned_worker_outputs: [&'a WorkerOutput; 2],
    negative_vectors: Vec<NegativeVector>,
}

#[derive(Debug, Serialize)]
struct NegativeVector {
    id: &'static str,
    mutation: &'static str,
    expected: &'static str,
}

pub fn repository_root() -> Result<PathBuf> {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .map(Path::to_path_buf)
        .ok_or_else(|| Error::Validation("cannot locate repository root".into()))
}

pub fn generate() -> Result<GenerationReport> {
    let root = repository_root()?;
    verify_artifact(
        &root,
        "artifacts/treasury/v2/faultline_treasury.so",
        V2_HASH,
    )?;
    verify_artifact(
        &root,
        "artifacts/treasury/v3/faultline_treasury.so",
        V3_HASH,
    )?;

    let policy_path = root.join("policies/invariants/AUTH-001.json");
    let policy_bytes = fs::read(&policy_path)?;
    canonical::parse(&policy_bytes)?;
    if hex(&hash::sha256(&policy_bytes)) != POLICY_HASH {
        return Err(Error::Validation(
            "tracked AUTH-001 byte hash mismatch".into(),
        ));
    }
    let invariant = invariant_from_policy(&policy_bytes)?;
    invariant.validate()?;

    let trace_bytes = fs::read(root.join("fixtures/exploits/auth-001-v2-authority-takeover.json"))?;
    let trace: Trace = parse_validated(&trace_bytes)?;

    let v2 = build_manifest("v2", V2_HASH);
    let v3 = build_manifest("v3", V3_HASH);
    let runner = runner_manifest();
    let fixture = fixture_manifest()?;
    v2.validate()?;
    v3.validate()?;
    runner.validate()?;
    fixture.validate()?;

    let manifests = root.join("manifests");
    fs::create_dir_all(manifests.join("programs"))?;
    write_pretty(&manifests.join("treasury-v2-build.json"), &v2)?;
    write_pretty(&manifests.join("treasury-v3-build.json"), &v3)?;
    write_pretty(&manifests.join("treasury-runner.json"), &runner)?;
    write_pretty(&manifests.join("treasury-v1-fixture.json"), &fixture)?;
    write_pretty(&manifests.join("auth-001-invariant.json"), &invariant)?;
    extract_tokenkeg(&manifests.join("programs/spl-token-3.5.0.so"))?;

    let v2_manifest_hash = manifest_hex("faultline.build.v1", &v2)?;
    let v3_manifest_hash = manifest_hex("faultline.build.v1", &v3)?;
    let runner_hash = manifest_hex("faultline.runner.v1", &runner)?;
    let fixture_hash = manifest_hex("faultline.fixture.v1", &fixture)?;
    let invariant_hash = manifest_hex("faultline.invariant.v1", &invariant)?;
    let trace_hash = hex(&hash::trace_hash(&trace)?);
    let job_v2 = replay_job(
        V2_HASH,
        &v2_manifest_hash,
        &runner_hash,
        &fixture_hash,
        &invariant_hash,
        &trace_hash,
    );
    let job_v3 = replay_job(
        V3_HASH,
        &v3_manifest_hash,
        &runner_hash,
        &fixture_hash,
        &invariant_hash,
        &trace_hash,
    );
    job_v2.validate()?;
    job_v3.validate()?;
    let job_v2_hash = hex(&hash::replay_job_hash(&job_v2)?);
    let job_v3_hash = hex(&hash::replay_job_hash(&job_v3)?);
    let receipt_v2 = receipt(&job_v2, &job_v2_hash)?;
    let receipt_v3 = receipt(&job_v3, &job_v3_hash)?;
    receipt_v2.validate()?;
    receipt_v3.validate()?;
    let receipt_v2_hash = hex(&hash::receipt_hash(&receipt_v2)?);
    let receipt_v3_hash = hex(&hash::receipt_hash(&receipt_v3)?);
    let worker_v2 = worker(&job_v2, &job_v2_hash, &receipt_v2_hash)?;
    let worker_v3 = worker(&job_v3, &job_v3_hash, &receipt_v3_hash)?;
    worker_v2.validate()?;
    worker_v3.validate()?;
    let milestone5 = milestone5_vector();

    let report = GenerationReport {
        build_v2_manifest_hash: v2_manifest_hash,
        build_v3_manifest_hash: v3_manifest_hash,
        runner_manifest_hash: runner_hash,
        fixture_manifest_hash: fixture_hash,
        invariant_manifest_hash: invariant_hash,
        trace_hash,
        replay_job_v2_hash: job_v2_hash,
        replay_job_v3_hash: job_v3_hash,
        receipt_v2_hash,
        receipt_v3_hash,
        worker_v2_message_digest: hex(&hash::worker_message_digest(&worker_v2)?),
        worker_v3_message_digest: hex(&hash::worker_message_digest(&worker_v3)?),
        milestone5_violation_result_hash: hex(&milestone5),
        tokenkeg_sha256: TOKEN_HASH.into(),
    };
    if report.milestone5_violation_result_hash
        != "b7eb266542e099bd41398d8b78d6d571b57844356bfe7c6f5539a73e00046921"
    {
        return Err(Error::Validation("Milestone 5 vector changed".into()));
    }
    let vectors = VectorFile {
        kind: "faultline-checkpoint-1-test-vectors",
        canonicalization: CANONICALIZATION,
        note: "Format-only receipt and worker vectors; not VM execution evidence.",
        hashes: &report,
        replay_jobs: [&job_v2, &job_v3],
        receipts: [&receipt_v2, &receipt_v3],
        unsigned_worker_outputs: [&worker_v2, &worker_v3],
        negative_vectors: negative_vectors(),
    };
    write_pretty(&manifests.join("checkpoint-1-vectors.json"), &vectors)?;
    Ok(report)
}

fn negative_vectors() -> Vec<NegativeVector> {
    [
        (
            "duplicate-key",
            "repeat an existing object key",
            "INVALID_DUPLICATE_KEY",
        ),
        (
            "unknown-nested-field",
            "add limits.unknown",
            "INVALID_UNKNOWN_FIELD",
        ),
        (
            "missing-required-field",
            "remove build.program",
            "INVALID_SCHEMA_OR_VERSION",
        ),
        (
            "wrong-schema",
            "change invariant schema discriminator",
            "INVALID_SCHEMA_OR_VERSION",
        ),
        (
            "non-nfc",
            "replace NFC string with decomposed Unicode",
            "INVALID_CANONICAL_ENCODING",
        ),
        (
            "float",
            "replace an integer token with 1.0",
            "INVALID_CANONICAL_ENCODING",
        ),
        (
            "unsorted-aliases",
            "swap adjacent fixture accounts",
            "INVALID_ALIAS_OR_REFERENCE",
        ),
        (
            "signer-key",
            "replace derived signer public key",
            "INVALID_DIGEST_BINDING",
        ),
        (
            "pda-bump",
            "change TreasuryState bump byte",
            "INVALID_DIGEST_BINDING",
        ),
        (
            "rent",
            "change synthetic account lamports",
            "INVALID_DIGEST_BINDING",
        ),
        (
            "candidate-in-fixture",
            "add candidate hash to target program entry",
            "INVALID_UNKNOWN_FIELD",
        ),
        (
            "selector-set",
            "duplicate a receipt selector",
            "INVALID_ALIAS_OR_REFERENCE",
        ),
        (
            "runtime-error",
            "use an unsupported builtin symbol",
            "INVALID_SCHEMA_OR_VERSION",
        ),
        (
            "worker-conditional",
            "omit receipt hash from an eligible output",
            "INVALID_SCHEMA_OR_VERSION",
        ),
        (
            "dependency-drift",
            "change replay runtime from 1.18.22",
            "UNSUPPORTED_ENGINE_OR_RUNTIME",
        ),
    ]
    .into_iter()
    .map(|(id, mutation, expected)| NegativeVector {
        id,
        mutation,
        expected,
    })
    .collect()
}

fn build_manifest(build: &str, digest: &str) -> BuildManifest {
    BuildManifest {
        schema: "faultline.build.v1".into(),
        canonicalization: CANONICALIZATION.into(),
        program: "faultline_treasury".into(),
        program_id: TREASURY_PROGRAM_ID.into(),
        build: build.into(),
        cargo_features: vec![build.into()],
        artifact_path: format!("artifacts/treasury/{build}/faultline_treasury.so"),
        executable_sha256: digest.into(),
        toolchain: Toolchain {
            solana_cli: "solana-cli 1.18.10 (src:a093e239; feat:3469865029, client:Agave)".into(),
            cargo_build_sbf: "solana-cargo-build-sbf 1.18.10".into(),
            platform_tools: "v1.41".into(),
            anchor_crates: "0.30.1".into(),
        },
    }
}

fn runner_manifest() -> RunnerManifest {
    RunnerManifest {
        schema: "faultline.runner.v1".into(),
        canonicalization: CANONICALIZATION.into(),
        engine: "litesvm".into(),
        engine_version: "0.1.0".into(),
        engine_source_commit: "5cda1d2dcfae16714a6ff808b58f0c087b21bd42".into(),
        solana_runtime: "1.18.22".into(),
        feature_set: "litesvm-0.1.0-all-enabled".into(),
        sigverify: true,
        clock_mode: "fixture".into(),
        recent_blockhash_mode: "runner-deterministic".into(),
        token_program: TOKEN_PROGRAM_ID.into(),
        token_program_bundle: "spl-token-3.5.0".into(),
        allowed_external_programs: vec![TOKEN_PROGRAM_ID.into()],
        limits: RunnerLimits {
            max_transactions: 32,
            max_instructions_per_transaction: 16,
            max_accounts_per_instruction: 64,
            max_instruction_data_bytes: 10_240,
            max_compute_units_per_transaction: 1_400_000,
            max_manifest_bytes: 1_048_576,
            max_trace_bytes: 2_097_152,
            max_fixture_bytes: 10_485_760,
            max_output_bytes: 8_388_608,
        },
    }
}

fn fixture_manifest() -> Result<FixtureManifest> {
    let programs = vec![
        FixtureProgram {
            kind: "target".into(),
            alias: "faultline_treasury".into(),
            program_id: TREASURY_PROGRAM_ID.into(),
            bundle_name: None,
            artifact_path: None,
            executable_sha256: None,
            source_crate: None,
            source_crate_version: None,
            source_crate_sha256: None,
            source_member_path: None,
        },
        FixtureProgram {
            kind: "bundled".into(),
            alias: "spl_token".into(),
            program_id: TOKEN_PROGRAM_ID.into(),
            bundle_name: Some("spl-token-3.5.0".into()),
            artifact_path: Some("manifests/programs/spl-token-3.5.0.so".into()),
            executable_sha256: Some(TOKEN_HASH.into()),
            source_crate: Some("litesvm".into()),
            source_crate_version: Some("0.1.0".into()),
            source_crate_sha256: Some(LITESVM_CRATE_HASH.into()),
            source_member_path: Some("src/spl/programs/spl_token-3.5.0.so".into()),
        },
    ];
    let signers = [
        ("attacker", "Dvci5BTD5CkwYCQh6pC6UumLWF9LHSinJ5doS8PS9hV6"),
        (
            "treasury-admin",
            "564Gpg3mVA7LwcW7hVQkeATttbaRRMTntp9eV2AGNpbd",
        ),
        ("user", "58aVWrJhcixCdUrm8wVdfUVZiC5Y7QzpFQuoQbJHMV4i"),
    ]
    .into_iter()
    .map(|(alias, pubkey)| FixtureSigner {
        alias: alias.into(),
        pubkey: pubkey.into(),
        lamports: "10000000000".into(),
    })
    .collect();
    Ok(FixtureManifest {
        schema: "faultline.fixture.v1".into(),
        canonicalization: CANONICALIZATION.into(),
        fixture_id: "treasury-v1".into(),
        base_slot: "1".into(),
        clock: Clock {
            slot: "1".into(),
            unix_timestamp: "0".into(),
        },
        programs,
        accounts: synthetic_accounts()?,
        signers,
        setup_transactions: vec![],
        initial_state: InitialState {
            original_admin: "564Gpg3mVA7LwcW7hVQkeATttbaRRMTntp9eV2AGNpbd".into(),
            treasury_state: "EiRj7VptpwZTy2uRMbHeqCU45fmbPFd4FrGGbQ2MZfi2".into(),
            treasury_vault: "E1wvHDQMjFVw8hZgdsLzo5tXqSttrvHB56Du1oD1roDY".into(),
            attacker_token_account: "3DUXuoksqpratbjmysGEKQQUUb1mZRR4y3GWNjSiNTPP".into(),
            payment_mint: "2cmmKxvd7YMFYhfqSFb45Q7zVYyhqsgoswxbvVeThgkG".into(),
            mint_decimals: 6,
            treasury_vault_base_units: "1000000000".into(),
            attacker_base_units: "0".into(),
        },
    })
}

fn invariant_from_policy(bytes: &[u8]) -> Result<InvariantManifest> {
    let mut value: Map<String, Value> = serde_json::from_slice(bytes).map_err(Error::Schema)?;
    value.insert(
        "canonicalization".into(),
        Value::String(CANONICALIZATION.into()),
    );
    let encoded = serde_json::to_vec(&Value::Object(value)).map_err(Error::Schema)?;
    parse_validated(&encoded)
}

fn replay_job(
    candidate: &str,
    build: &str,
    runner: &str,
    fixture: &str,
    invariant: &str,
    trace: &str,
) -> ReplayJob {
    ReplayJob {
        schema: "faultline.replay-job.v1".into(),
        canonicalization: CANONICALIZATION.into(),
        verification_round: "29d2S7vB453rNYFdR5Ycwt7y9haRT5fwVwL9zTmBhfV2".into(),
        proposal: "2DYKaRPBeNM5WdW8rNsYEktjPrnd89Mm4Lzp3qonSzoj".into(),
        invariant_account: "2HTciirCEfeJeikeHgCTXdfVe1zpoD3ackfU7DrPCL8S".into(),
        trace_claim: "2MNus2KCpxwXnp19iyXNpWSFtBD2UGjQBAL8AbtywfT9".into(),
        candidate_buffer_hash: candidate.into(),
        invariant_specification_hash: POLICY_HASH.into(),
        build_manifest_hash: build.into(),
        runner_manifest_hash: runner.into(),
        fixture_manifest_hash: fixture.into(),
        invariant_manifest_hash: invariant.into(),
        trace_hash: trace.into(),
        target_program_id: TREASURY_PROGRAM_ID.into(),
        candidate_executable_sha256: candidate.into(),
        expected_invariant_id: "AUTH-001".into(),
    }
}

fn receipt(job: &ReplayJob, job_hash: &str) -> Result<ReplayReceipt> {
    let state = |prefix: &str| {
        [
            "attacker_balance",
            "original_admin",
            "treasury_vault_balance",
        ]
        .into_iter()
        .map(|selector| StateHash {
            selector_id: selector.into(),
            sha256: hex(&hash::vector_digest(&format!("{prefix}.{selector}.sha256"))),
        })
        .collect()
    };
    Ok(ReplayReceipt {
        schema: "faultline.replay-receipt.v1".into(),
        canonicalization: CANONICALIZATION.into(),
        replay_job_hash: job_hash.into(),
        build_manifest_hash: job.build_manifest_hash.clone(),
        runner_manifest_hash: job.runner_manifest_hash.clone(),
        fixture_manifest_hash: job.fixture_manifest_hash.clone(),
        invariant_manifest_hash: job.invariant_manifest_hash.clone(),
        trace_hash: job.trace_hash.clone(),
        candidate_executable_sha256: job.candidate_executable_sha256.clone(),
        engine: "litesvm".into(),
        engine_version: "0.1.0".into(),
        engine_source_commit: "5cda1d2dcfae16714a6ff808b58f0c087b21bd42".into(),
        solana_runtime: "1.18.22".into(),
        feature_set: "litesvm-0.1.0-all-enabled".into(),
        transactions: vec![TransactionResult {
            index: 0,
            status: TransactionStatus::Success,
            error: None,
            compute_units: 1,
            return_data_sha256: None,
            logs_sha256: hex(&hash::vector_digest("transactions.0.logs_sha256")),
        }],
        pre_state_hashes: state("pre_state_hashes"),
        post_state_hashes: state("post_state_hashes"),
        normalized_logs_sha256: hex(&hash::vector_digest("normalized_logs_sha256")),
        classification: Classification::Preserved,
        result_code: 0,
        total_compute_units: "1".into(),
    })
}

fn worker(job: &ReplayJob, job_hash: &str, receipt_hash: &str) -> Result<WorkerOutput> {
    let commitment = hash::replay_result_commitment(
        &public_key_bytes(&job.proposal)?,
        &public_key_bytes(&job.invariant_account)?,
        &public_key_bytes(&job.trace_claim)?,
        &hex_bytes(&job.candidate_buffer_hash)?,
        &hex_bytes(&job.invariant_specification_hash)?,
        0,
        &hex_bytes(receipt_hash)?,
    );
    let commitment = hex(&commitment);
    let verifier = keypair_from_seed(&WORKER_VECTOR_SEED)
        .map_err(|error| Error::Validation(format!("worker vector key derivation: {error}")))?
        .pubkey()
        .to_string();
    if verifier != "FMUEmtxhU46GzhKF4FW9MLJdQWiLgjiXP9TYRWSrqTpV" {
        return Err(Error::Validation(
            "worker vector public-key derivation mismatch".into(),
        ));
    }
    Ok(WorkerOutput {
        schema: "faultline.worker-output.v1".into(),
        canonicalization: CANONICALIZATION.into(),
        coordinator_nonce: "16".repeat(32),
        worker_ordinal: 0,
        verifier_pubkey: verifier.clone(),
        replay_job_hash: job_hash.into(),
        classification: Classification::Preserved,
        result_code: 0,
        receipt_hash: Some(receipt_hash.into()),
        verdict_u8: Some(0),
        replay_result_commitment: Some(commitment.clone()),
        attestation_intent: Some(AttestationIntent {
            verification_round: job.verification_round.clone(),
            proposal: job.proposal.clone(),
            invariant_account: job.invariant_account.clone(),
            trace_claim: job.trace_claim.clone(),
            verifier_pubkey: verifier,
            verdict_u8: 0,
            receipt_hash: receipt_hash.into(),
            replay_result_commitment: commitment,
        }),
        process_peak_memory_bytes: "1".into(),
        elapsed_milliseconds: "1".into(),
    })
}

fn milestone5_vector() -> [u8; 32] {
    hash::replay_result_commitment(
        &[1; 32], &[2; 32], &[3; 32], &[4; 32], &[5; 32], 1, &[6; 32],
    )
}
fn manifest_hex<T: Serialize>(schema: &str, value: &T) -> Result<String> {
    Ok(hex(&hash::manifest_hash(schema, value)?))
}

fn verify_artifact(root: &Path, path: &str, expected: &str) -> Result<()> {
    let bytes = fs::read(root.join(path))?;
    if hex(&hash::sha256(&bytes)) != expected {
        return Err(Error::Validation(format!("artifact hash mismatch: {path}")));
    }
    Ok(())
}

fn write_pretty<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let mut bytes = serde_json::to_vec_pretty(value).map_err(Error::Schema)?;
    bytes.push(b'\n');
    if fs::read(path).ok().as_deref() != Some(bytes.as_slice()) {
        fs::write(path, bytes)?;
    }
    Ok(())
}

fn extract_tokenkeg(destination: &Path) -> Result<()> {
    let cargo_home = env::var_os("CARGO_HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("USERPROFILE").map(|home| PathBuf::from(home).join(".cargo")))
        .ok_or_else(|| Error::Validation("CARGO_HOME is unavailable".into()))?;
    let crate_file = find_named(&cargo_home.join("registry/cache"), "litesvm-0.1.0.crate")?
        .ok_or_else(|| Error::Validation("pinned LiteSVM crate archive is unavailable".into()))?;
    let crate_bytes = fs::read(crate_file)?;
    if hex(&hash::sha256(&crate_bytes)) != LITESVM_CRATE_HASH {
        return Err(Error::Validation("LiteSVM crate checksum mismatch".into()));
    }
    let member = find_member(&cargo_home.join("registry/src"))?
        .ok_or_else(|| Error::Validation("LiteSVM Tokenkeg member is unavailable".into()))?;
    let bytes = fs::read(member)?;
    if bytes.len() != 133_352 || hex(&hash::sha256(&bytes)) != TOKEN_HASH {
        return Err(Error::Validation("LiteSVM Tokenkeg member mismatch".into()));
    }
    if fs::read(destination).ok().as_deref() != Some(bytes.as_slice()) {
        fs::write(destination, bytes)?;
    }
    Ok(())
}

fn find_named(root: &Path, name: &str) -> Result<Option<PathBuf>> {
    if !root.exists() {
        return Ok(None);
    }
    for entry in fs::read_dir(root)? {
        let path = entry?.path();
        if path.is_dir() {
            if let Some(found) = find_named(&path, name)? {
                return Ok(Some(found));
            }
        } else if path.file_name().and_then(|v| v.to_str()) == Some(name) {
            return Ok(Some(path));
        }
    }
    Ok(None)
}

fn find_member(root: &Path) -> Result<Option<PathBuf>> {
    if !root.exists() {
        return Ok(None);
    }
    for entry in fs::read_dir(root)? {
        let path = entry?.path();
        if path.is_dir() {
            if path.file_name().and_then(|v| v.to_str()) == Some("litesvm-0.1.0") {
                let member = path.join("src/spl/programs/spl_token-3.5.0.so");
                if member.is_file() {
                    return Ok(Some(member));
                }
            }
            if let Some(found) = find_member(&path)? {
                return Ok(Some(found));
            }
        }
    }
    Ok(None)
}

fn hex_bytes(value: &str) -> Result<[u8; 32]> {
    if value.len() != 64 {
        return Err(Error::Validation("hex length".into()));
    }
    let mut bytes = [0_u8; 32];
    for (index, pair) in value.as_bytes().chunks_exact(2).enumerate() {
        bytes[index] = u8::from_str_radix(
            std::str::from_utf8(pair).map_err(|_| Error::Validation("hex".into()))?,
            16,
        )
        .map_err(|_| Error::Validation("hex".into()))?;
    }
    Ok(bytes)
}

fn public_key_bytes(value: &str) -> Result<[u8; 32]> {
    let bytes = bs58::decode(value)
        .into_vec()
        .map_err(|_| Error::Validation("public key".into()))?;
    bytes
        .try_into()
        .map_err(|_| Error::Validation("public key length".into()))
}
