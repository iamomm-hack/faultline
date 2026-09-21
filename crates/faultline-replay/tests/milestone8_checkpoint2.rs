#![cfg(windows)]

use std::{
    collections::BTreeSet,
    ffi::OsStr,
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::OnceLock,
};

use faultline_replay::{
    canonical,
    coordinator::{authenticate_signed_output, Coordinator},
    hash,
    ipc::{self, InputPaths, WorkerRequest},
    operator::{
        self, load_keypair_file, run_verifier, validate_signed_output_for_request, verify_quorum,
        DemoKeySet, ExitClass, IdentityBindings, KeyFileScope,
    },
    schema::{parse_validated, Classification, ReplayJob, SignedWorkerOutput, CANONICALIZATION},
    worker,
};
use solana_sdk::signature::{Keypair, Signer};
use std::os::windows::ffi::OsStrExt;
use windows_sys::Win32::{
    Foundation::{CloseHandle, GENERIC_READ, INVALID_HANDLE_VALUE},
    Storage::FileSystem::{CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_NONE, OPEN_EXISTING},
};

const GATE_PROGRAM_ID: &str = "9PFPNC6TMNKBCVsm4RoCgVYmqTJJTwnHHuRcysosSCCe";

fn root() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .unwrap()
}

fn owned_test_root(label: &str) -> PathBuf {
    let entropy = Keypair::new().pubkey();
    let path = root().join("tmp").join(format!(
        "m8-c2-{label}-{}-{}",
        std::process::id(),
        &hash::hex(&hash::sha256(entropy.as_ref()))[..12]
    ));
    fs::create_dir_all(&path).unwrap();
    path.canonicalize().unwrap()
}

fn job(candidate: &str) -> ReplayJob {
    let vectors: serde_json::Value = serde_json::from_slice(
        &fs::read(root().join("manifests/checkpoint-1-vectors.json")).unwrap(),
    )
    .unwrap();
    let index = usize::from(candidate == "v3");
    parse_validated(&canonical::serialize_typed(&vectors["replay_jobs"][index]).unwrap()).unwrap()
}

fn paths(candidate: &str) -> InputPaths {
    InputPaths {
        candidate_build_manifest: format!("manifests/treasury-{candidate}-build.json"),
        runner_manifest: "manifests/treasury-runner.json".into(),
        fixture_manifest: "manifests/treasury-v1-fixture.json".into(),
        invariant_manifest: "manifests/auth-001-invariant.json".into(),
        trace: "fixtures/exploits/auth-001-v2-authority-takeover.json".into(),
        candidate_executable: format!("artifacts/treasury/{candidate}/faultline_treasury.so"),
    }
}

fn request(candidate: &str, identity: &str, ordinal: u8, nonce_label: &str) -> WorkerRequest {
    WorkerRequest {
        schema: "faultline.worker-request.v1".into(),
        canonicalization: CANONICALIZATION.into(),
        coordinator_nonce: hash::hex(&hash::sha256(nonce_label.as_bytes())),
        worker_ordinal: ordinal,
        expected_verifier_pubkey: identity.into(),
        replay_job: job(candidate),
        input_paths: paths(candidate),
    }
}

fn bindings(identity: &str) -> IdentityBindings {
    IdentityBindings {
        expected_verifier: identity.into(),
        epoch_member: identity.into(),
        stake_identity: identity.into(),
        worker_signer: identity.into(),
        attestation_signer: identity.into(),
    }
}

struct RealFixture {
    requests: Vec<WorkerRequest>,
    outputs: Vec<SignedWorkerOutput>,
    fresh_request: WorkerRequest,
    fresh_output: SignedWorkerOutput,
    v3_request: WorkerRequest,
    v3_output: SignedWorkerOutput,
    ineligible_request: WorkerRequest,
    ineligible_output: SignedWorkerOutput,
    identities: Vec<String>,
    custody_reports: Vec<operator::CustodyReport>,
    cli_redaction_clean: bool,
    demo_directory_removed: bool,
    run_directory_removed: bool,
}

fn fixture() -> &'static RealFixture {
    static VALUE: OnceLock<RealFixture> = OnceLock::new();
    VALUE.get_or_init(build_fixture)
}

fn build_fixture() -> RealFixture {
    let owned = owned_test_root("real-workers");
    let mut demo = DemoKeySet::create(&owned).unwrap();
    let identities: Vec<_> = demo.public_keys().iter().map(ToString::to_string).collect();
    let requests: Vec<_> = (0..3)
        .map(|ordinal| {
            request(
                "v2",
                &identities[ordinal],
                ordinal as u8,
                &format!("m8-c2-v2-{ordinal}"),
            )
        })
        .collect();
    let coordinator = Coordinator::new(root()).unwrap();
    let request_path = owned.join("request-0.json");
    let output_path = owned.join("output-0.json");
    fs::write(
        &request_path,
        canonical::serialize_typed(&requests[0]).unwrap(),
    )
    .unwrap();
    let key_path = demo.key_file(0).unwrap().to_path_buf();
    let mut secret_text = fs::read_to_string(&key_path).unwrap();
    let key_basename = key_path.file_name().unwrap().to_string_lossy().into_owned();
    let cli = Command::new(env!("CARGO_BIN_EXE_faultline"))
        .args([
            OsStr::new("verifier"),
            OsStr::new("run"),
            OsStr::new("--repository"),
            root().as_os_str(),
            OsStr::new("--request"),
            request_path.as_os_str(),
            OsStr::new("--keypair"),
            key_path.as_os_str(),
            OsStr::new("--epoch-member"),
            OsStr::new(&identities[0]),
            OsStr::new("--stake-identity"),
            OsStr::new(&identities[0]),
            OsStr::new("--worker-signer"),
            OsStr::new(&identities[0]),
            OsStr::new("--attestation-signer"),
            OsStr::new(&identities[0]),
            OsStr::new("--output"),
            output_path.as_os_str(),
            OsStr::new("--demo-owned-run"),
            owned.as_os_str(),
        ])
        .output()
        .unwrap();
    assert_eq!(
        cli.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&cli.stderr)
    );
    let mut outputs = vec![operator::read_signed_output(&output_path).unwrap()];
    let mut custody_reports = Vec::new();
    for ordinal in 1..3 {
        let result = run_verifier(
            &coordinator,
            requests[ordinal].clone(),
            &bindings(&identities[ordinal]),
            demo.key_file(ordinal).unwrap(),
            KeyFileScope::Demo {
                owned_run_directory: &owned,
            },
        )
        .unwrap();
        operator::classify_worker_outcome(&result.outcome).unwrap();
        custody_reports.push(result.custody);
        outputs.push(result.outcome.signed_output.unwrap());
    }

    let fresh_request = request("v2", &identities[0], 0, "m8-c2-v2-fresh-launch");
    let fresh = run_verifier(
        &coordinator,
        fresh_request.clone(),
        &bindings(&identities[0]),
        demo.key_file(0).unwrap(),
        KeyFileScope::Demo {
            owned_run_directory: &owned,
        },
    )
    .unwrap();
    operator::classify_worker_outcome(&fresh.outcome).unwrap();

    let v3_request = request("v3", &identities[2], 2, "m8-c2-v3-mixed");
    let v3 = run_verifier(
        &coordinator,
        v3_request.clone(),
        &bindings(&identities[2]),
        demo.key_file(2).unwrap(),
        KeyFileScope::Demo {
            owned_run_directory: &owned,
        },
    )
    .unwrap();
    operator::classify_worker_outcome(&v3.outcome).unwrap();

    let ineligible_request = request("v2", &identities[2], 2, "m8-c2-ineligible");
    let mut bytes: Vec<u8> =
        serde_json::from_slice(&fs::read(demo.key_file(2).unwrap()).unwrap()).unwrap();
    let signer = Keypair::from_bytes(&bytes).unwrap();
    bytes.fill(0);
    let ineligible = worker::build_ineligible_output(
        &hash::hex(&hash::replay_job_hash(&ineligible_request.replay_job).unwrap()),
        &signer.pubkey(),
        &ineligible_request.coordinator_nonce,
        2,
        Classification::UnsupportedEnvironment,
        ipc::UNSUPPORTED_PROGRAM,
    )
    .unwrap();
    let ineligible_output = worker::sign_output(ineligible, &signer).unwrap();
    drop(signer);

    demo.cleanup().unwrap();
    let demo_directory_removed = demo.cleanup_verified();
    let demo_directory = demo.directory().to_path_buf();
    drop(demo);
    fs::remove_file(request_path).unwrap();
    fs::remove_file(output_path).unwrap();
    fs::remove_dir(&owned).unwrap();
    let run_directory_removed = !owned.exists() && !demo_directory.exists();
    let cli_redaction_clean = !String::from_utf8_lossy(&cli.stdout).contains(&secret_text)
        && !String::from_utf8_lossy(&cli.stderr).contains(&secret_text)
        && !String::from_utf8_lossy(&cli.stdout).contains(&key_basename)
        && !String::from_utf8_lossy(&cli.stderr).contains(&key_basename);
    secret_text.clear();

    RealFixture {
        requests,
        outputs,
        fresh_request,
        fresh_output: fresh.outcome.signed_output.unwrap(),
        v3_request,
        v3_output: v3.outcome.signed_output.unwrap(),
        ineligible_request,
        ineligible_output,
        identities,
        custody_reports,
        cli_redaction_clean,
        demo_directory_removed,
        run_directory_removed,
    }
}

#[test]
fn m8_c2_identity_is_consistent_across_layers() {
    let value = fixture();
    for (index, output) in value.outputs.iter().enumerate() {
        assert_eq!(
            bindings(&value.identities[index])
                .validate()
                .unwrap()
                .to_string(),
            value.identities[index]
        );
        assert_eq!(
            value.requests[index].expected_verifier_pubkey,
            value.identities[index]
        );
        assert_eq!(output.signer_pubkey, value.identities[index]);
        assert_eq!(output.output.verifier_pubkey, value.identities[index]);
        assert_eq!(
            output
                .output
                .attestation_intent
                .as_ref()
                .unwrap()
                .verifier_pubkey,
            value.identities[index]
        );
    }
}

#[test]
fn m8_c2_wrong_keypair_is_rejected() {
    let owned = owned_test_root("wrong-key");
    let mut demo = DemoKeySet::create(&owned).unwrap();
    let expected = demo.public_keys()[0].to_string();
    let before: BTreeSet<_> = fs::read_dir(root().join("tmp"))
        .unwrap()
        .flatten()
        .map(|value| value.path())
        .collect();
    let error = run_verifier(
        &Coordinator::new(root()).unwrap(),
        request("v2", &expected, 0, "wrong-key"),
        &bindings(&expected),
        demo.key_file(1).unwrap(),
        KeyFileScope::Demo {
            owned_run_directory: &owned,
        },
    )
    .unwrap_err();
    assert_eq!(error.class(), ExitClass::InvalidSignatureOrIdentity);
    let after: BTreeSet<_> = fs::read_dir(root().join("tmp"))
        .unwrap()
        .flatten()
        .map(|value| value.path())
        .collect();
    assert_eq!(
        before, after,
        "wrong key must fail before worker run-directory creation"
    );
    demo.cleanup().unwrap();
    fs::remove_dir(owned).unwrap();
}

#[test]
fn m8_c2_mismatched_operator_identity_is_rejected() {
    let value = fixture();
    assert_eq!(
        validate_signed_output_for_request(&value.requests[1], &value.outputs[0])
            .unwrap_err()
            .class(),
        ExitClass::InvalidSignatureOrIdentity
    );
    let mut swapped = value.outputs.clone();
    swapped.swap(0, 1);
    assert_eq!(
        verify_quorum(
            &value.requests,
            swapped,
            GATE_PROGRAM_ID,
            &Keypair::new().pubkey().to_string(),
            &Keypair::new().pubkey().to_string()
        )
        .unwrap_err()
        .class(),
        ExitClass::InvalidSignatureOrIdentity
    );
}

#[test]
fn m8_c2_production_never_custodies_three_keys() {
    let value = fixture();
    assert!(value
        .custody_reports
        .iter()
        .all(|report| report.keypairs_loaded == 1 && report.automatic_retries == 0));
    let cli = Command::new(env!("CARGO_BIN_EXE_faultline"))
        .args(["quorum", "verify", "--keypair", "forbidden"])
        .output()
        .unwrap();
    assert_eq!(cli.status.code(), Some(10));
    assert!(cli.stdout.is_empty());
}

#[test]
fn m8_c2_key_secret_is_not_disclosed() {
    let value = fixture();
    assert!(value.cli_redaction_clean);
    let marker = "M8_RAW_SECRET_MARKER";
    let argv = Command::new(env!("CARGO_BIN_EXE_faultline"))
        .args(["verifier", "run", "--seed", marker])
        .output()
        .unwrap();
    assert_eq!(argv.status.code(), Some(50));
    assert!(!String::from_utf8_lossy(&argv.stderr).contains(marker));
    let environment = Command::new(env!("CARGO_BIN_EXE_faultline"))
        .args(["verifier", "run"])
        .env("FAULTLINE_SIGNING_SEED", marker)
        .output()
        .unwrap();
    assert_eq!(environment.status.code(), Some(50));
    assert!(!String::from_utf8_lossy(&environment.stderr).contains(marker));
}

#[test]
fn m8_c2_unsafe_key_files_are_rejected() {
    let owned = owned_test_root("unsafe-keys");
    let expected = Keypair::new().pubkey();
    let cases: Vec<(&str, &[u8])> = vec![
        ("malformed.json", b"not-json"),
        ("short.json", b"[1,2,3]"),
        ("negative.json", b"[-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1]"),
        ("float.json", b"[1.5,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]"),
        ("range.json", b"[256,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]"),
        ("string.json", b"[\"1\",1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]"),
    ];
    for (name, bytes) in cases {
        let path = owned.join(name);
        fs::write(&path, bytes).unwrap();
        assert_eq!(
            expect_error(load_keypair_file(
                &path,
                &expected,
                KeyFileScope::Demo {
                    owned_run_directory: &owned
                }
            ))
            .class(),
            ExitClass::SecretHandlingFailure
        );
    }
    let inconsistent = owned.join("inconsistent.json");
    fs::write(&inconsistent, serde_json::to_vec(&vec![7_u8; 64]).unwrap()).unwrap();
    assert_eq!(
        expect_error(load_keypair_file(
            &inconsistent,
            &expected,
            KeyFileScope::Demo {
                owned_run_directory: &owned
            }
        ))
        .class(),
        ExitClass::SecretHandlingFailure
    );
    let extended = owned.join("extended.json");
    fs::write(&extended, serde_json::to_vec(&vec![1_u8; 65]).unwrap()).unwrap();
    assert_eq!(
        expect_error(load_keypair_file(
            &extended,
            &expected,
            KeyFileScope::Demo {
                owned_run_directory: &owned
            }
        ))
        .class(),
        ExitClass::SecretHandlingFailure
    );
    assert_eq!(
        expect_error(load_keypair_file(
            &owned.join("missing.json"),
            &expected,
            KeyFileScope::Demo {
                owned_run_directory: &owned
            }
        ))
        .class(),
        ExitClass::SecretHandlingFailure
    );

    let unreadable = owned.join("unreadable.json");
    let unreadable_key = Keypair::new();
    let mut unreadable_bytes = unreadable_key.to_bytes();
    fs::write(
        &unreadable,
        serde_json::to_vec(&unreadable_bytes.as_slice()).unwrap(),
    )
    .unwrap();
    unreadable_bytes.fill(0);
    let unreadable_wide: Vec<u16> = unreadable
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let locked = unsafe {
        CreateFileW(
            unreadable_wide.as_ptr(),
            GENERIC_READ,
            FILE_SHARE_NONE,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            std::ptr::null_mut(),
        )
    };
    assert_ne!(locked, INVALID_HANDLE_VALUE);
    assert_eq!(
        expect_error(load_keypair_file(
            &unreadable,
            &unreadable_key.pubkey(),
            KeyFileScope::Demo {
                owned_run_directory: &owned
            }
        ))
        .class(),
        ExitClass::SecretHandlingFailure
    );
    unsafe { CloseHandle(locked) };
    assert_eq!(
        expect_error(load_keypair_file(
            &owned,
            &expected,
            KeyFileScope::Demo {
                owned_run_directory: &owned
            }
        ))
        .class(),
        ExitClass::SecretHandlingFailure
    );

    let target_directory = owned.join("target-directory");
    fs::create_dir(&target_directory).unwrap();
    fs::write(target_directory.join("target.json"), b"[]").unwrap();
    let junction = owned.join("junction");
    let created = Command::new("cmd.exe")
        .args([
            OsStr::new("/d"),
            OsStr::new("/c"),
            OsStr::new("mklink"),
            OsStr::new("/J"),
        ])
        .arg(&junction)
        .arg(&target_directory)
        .output()
        .unwrap();
    assert!(created.status.success(), "junction fixture creation failed");
    let link = junction.join("target.json");
    assert_eq!(
        expect_error(load_keypair_file(
            &link,
            &expected,
            KeyFileScope::Demo {
                owned_run_directory: &owned
            }
        ))
        .class(),
        ExitClass::SecretHandlingFailure
    );

    let repository_key = root().join("m8-c2-forbidden-key.json");
    fs::write(&repository_key, b"[]").unwrap();
    assert_eq!(
        expect_error(load_keypair_file(
            &repository_key,
            &expected,
            KeyFileScope::Production { repository: root() }
        ))
        .class(),
        ExitClass::SecretHandlingFailure
    );
    fs::remove_file(repository_key).unwrap();
    fs::remove_dir(&junction).unwrap();
    fs::remove_dir_all(owned).unwrap();
}

#[test]
fn m8_c2_key_lifetime_is_bounded() {
    let value = fixture();
    assert!(value
        .custody_reports
        .iter()
        .all(|report| report.mutable_input_buffer_overwritten_best_effort
            && report.mutable_seed_buffer_overwritten_best_effort));
}

#[test]
fn m8_c2_worker_signature_is_authenticated() {
    let value = fixture();
    for (request, output) in value.requests.iter().zip(&value.outputs) {
        let digest = hash::replay_job_hash(&request.replay_job).unwrap();
        authenticate_signed_output(output, request, &digest).unwrap();
        validate_signed_output_for_request(request, output).unwrap();
    }
}

#[test]
fn m8_c2_altered_worker_output_is_rejected() {
    let value = fixture();
    let request = &value.requests[0];
    let mut cases = Vec::new();
    let mut payload = value.outputs[0].clone();
    payload.output.replay_job_hash = "00".repeat(32);
    cases.push(payload);
    let mut signature = value.outputs[0].clone();
    signature.signature = solana_sdk::signature::Signature::default().to_string();
    cases.push(signature);
    let mut identity = value.outputs[0].clone();
    identity.signer_pubkey = value.identities[1].clone();
    cases.push(identity);
    let mut ordinal = value.outputs[0].clone();
    ordinal.output.worker_ordinal = 1;
    cases.push(ordinal);
    let mut algorithm = value.outputs[0].clone();
    algorithm.signature_algorithm = "ed25519".into();
    cases.push(algorithm);
    for case in cases {
        assert!(validate_signed_output_for_request(request, &case).is_err());
    }
}

#[test]
fn m8_c2_nonce_and_launch_replay_is_rejected() {
    let value = fixture();
    validate_signed_output_for_request(&value.fresh_request, &value.fresh_output).unwrap();
    assert_eq!(
        validate_signed_output_for_request(&value.fresh_request, &value.outputs[0])
            .unwrap_err()
            .class(),
        ExitClass::InvalidSignatureOrIdentity
    );
    let mut wrong_ordinal = value.fresh_request.clone();
    wrong_ordinal.worker_ordinal = 1;
    assert!(validate_signed_output_for_request(&wrong_ordinal, &value.fresh_output).is_err());
    let mut wrong_job = value.fresh_request.clone();
    wrong_job.replay_job = job("v3");
    assert!(validate_signed_output_for_request(&wrong_job, &value.fresh_output).is_err());
}

#[test]
fn m8_c2_consensus_requires_exact_unanimous_three() {
    let value = fixture();
    let plan = verify_quorum(
        &value.requests,
        value.outputs.clone(),
        GATE_PROGRAM_ID,
        &Keypair::new().pubkey().to_string(),
        &Keypair::new().pubkey().to_string(),
    )
    .unwrap();
    assert_eq!(plan.signed_worker_outputs.len(), 3);
    assert_eq!(plan.attestation_intents.len(), 3);
    assert!(verify_quorum(
        &value.requests[..2],
        value.outputs[..2].to_vec(),
        GATE_PROGRAM_ID,
        &Keypair::new().pubkey().to_string(),
        &Keypair::new().pubkey().to_string()
    )
    .is_err());
    let mut four_requests = value.requests.clone();
    four_requests.push(value.requests[2].clone());
    let mut four_outputs = value.outputs.clone();
    four_outputs.push(value.outputs[2].clone());
    assert!(verify_quorum(
        &four_requests,
        four_outputs,
        GATE_PROGRAM_ID,
        &Keypair::new().pubkey().to_string(),
        &Keypair::new().pubkey().to_string()
    )
    .is_err());
    let duplicate_outputs = vec![
        value.outputs[0].clone(),
        value.outputs[1].clone(),
        value.outputs[1].clone(),
    ];
    assert!(verify_quorum(
        &value.requests,
        duplicate_outputs,
        GATE_PROGRAM_ID,
        &Keypair::new().pubkey().to_string(),
        &Keypair::new().pubkey().to_string()
    )
    .is_err());
}

#[test]
fn m8_c2_disagreement_emits_no_plan() {
    let value = fixture();
    let mixed_requests = vec![
        value.requests[0].clone(),
        value.requests[1].clone(),
        value.v3_request.clone(),
    ];
    let mixed_outputs = vec![
        value.outputs[0].clone(),
        value.outputs[1].clone(),
        value.v3_output.clone(),
    ];
    assert_eq!(
        verify_quorum(
            &mixed_requests,
            mixed_outputs,
            GATE_PROGRAM_ID,
            &Keypair::new().pubkey().to_string(),
            &Keypair::new().pubkey().to_string()
        )
        .unwrap_err()
        .class(),
        ExitClass::WorkerDisagreement
    );
    let ineligible_requests = vec![
        value.requests[0].clone(),
        value.requests[1].clone(),
        value.ineligible_request.clone(),
    ];
    let ineligible_outputs = vec![
        value.outputs[0].clone(),
        value.outputs[1].clone(),
        value.ineligible_output.clone(),
    ];
    assert_eq!(
        verify_quorum(
            &ineligible_requests,
            ineligible_outputs,
            GATE_PROGRAM_ID,
            &Keypair::new().pubkey().to_string(),
            &Keypair::new().pubkey().to_string()
        )
        .unwrap_err()
        .class(),
        ExitClass::WorkerDisagreement
    );
}

#[test]
fn m8_c2_demo_keys_are_ephemeral() {
    let value = fixture();
    assert_eq!(value.identities.iter().collect::<BTreeSet<_>>().len(), 3);
    assert!(value.demo_directory_removed);
    assert!(value.run_directory_removed);
    assert!(value.cli_redaction_clean);
}

fn expect_error<T>(result: Result<T, operator::OperatorError>) -> operator::OperatorError {
    match result {
        Ok(_) => panic!("expected operator failure"),
        Err(error) => error,
    }
}

#[test]
fn checkpoint2_exit_classes_are_closed_and_stable() {
    let expected = [
        (ExitClass::Ok, 0, "OK"),
        (ExitClass::UsageOrConfig, 10, "USAGE_OR_CONFIG"),
        (ExitClass::InvalidInput, 20, "INVALID_INPUT"),
        (
            ExitClass::InvalidSignatureOrIdentity,
            21,
            "INVALID_SIGNATURE_OR_IDENTITY",
        ),
        (ExitClass::WorkerDisagreement, 22, "WORKER_DISAGREEMENT"),
        (
            ExitClass::StaleOrSubstitutedState,
            23,
            "STALE_OR_SUBSTITUTED_STATE",
        ),
        (ExitClass::Unauthorized, 24, "UNAUTHORIZED"),
        (ExitClass::RpcFailure, 30, "RPC_FAILURE"),
        (ExitClass::TransactionRejected, 31, "TRANSACTION_REJECTED"),
        (ExitClass::ConfirmationTimeout, 32, "CONFIRMATION_TIMEOUT"),
        (ExitClass::ProcessFailure, 40, "PROCESS_FAILURE"),
        (ExitClass::StageTimeout, 41, "STAGE_TIMEOUT"),
        (ExitClass::CleanupFailure, 42, "CLEANUP_FAILURE"),
        (
            ExitClass::SecretHandlingFailure,
            50,
            "SECRET_HANDLING_FAILURE",
        ),
        (ExitClass::InternalError, 70, "INTERNAL_ERROR"),
    ];
    for (value, code, name) in expected {
        assert_eq!(value as i32, code);
        assert_eq!(value.as_str(), name);
    }
}

#[test]
fn checkpoint2_valid_production_keypair_file_loads() {
    let entropy = Keypair::new().pubkey();
    let directory = std::env::temp_dir().join(format!(
        "faultline-m8-c2-production-key-{}-{}",
        std::process::id(),
        &hash::hex(&hash::sha256(entropy.as_ref()))[..12]
    ));
    fs::create_dir(&directory).unwrap();
    let path = directory.join("operator.json");
    let keypair = Keypair::new();
    let expected = keypair.pubkey();
    let mut secret = keypair.to_bytes();
    drop(keypair);
    let mut encoded = serde_json::to_vec(&secret.as_slice()).unwrap();
    fs::write(&path, &encoded).unwrap();
    secret.fill(0);
    encoded.fill(0);
    let loaded = load_keypair_file(
        &path,
        &expected,
        KeyFileScope::Production { repository: root() },
    )
    .unwrap();
    assert_eq!(loaded.public_key(), expected);
    assert!(loaded.mutable_input_buffer_was_cleared());
    drop(loaded);
    fs::remove_file(path).unwrap();
    fs::remove_dir(directory).unwrap();
}

#[test]
fn checkpoint2_production_source_boundary_audit() {
    let operator =
        fs::read_to_string(root().join("crates/faultline-replay/src/operator.rs")).unwrap();
    let cli =
        fs::read_to_string(root().join("crates/faultline-replay/src/bin/faultline.rs")).unwrap();
    let combined = format!("{operator}\n{cli}");
    for forbidden in [
        "TcpStream",
        "TcpListener",
        "UdpSocket",
        "reqwest",
        "std::process::Command",
        "cmd.exe",
        "powershell",
        "default_keypair",
        ".config/solana",
        "Keypair::from_seed",
        "console.log",
    ] {
        assert!(
            !combined.contains(forbidden),
            "forbidden production call site: {forbidden}"
        );
    }
    assert_eq!(
        operator.matches("load_keypair_file(keypair_path").count(),
        1
    );
    assert!(!operator.contains("Vec<CustodiedSigner>"));
    assert!(!cli.contains("signed_worker_outputs: Vec<Keypair>"));
}
