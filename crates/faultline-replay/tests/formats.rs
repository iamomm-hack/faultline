use std::{
    fs,
    path::{Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use faultline_replay::{canonical, generator, hash, schema::*};
use serde_json::{json, Value};

const V2_MANIFEST: &str = "a213c958500d3a70c2728c0e338c8d107e1fd60ce6f710a8e239ed758de20446";
const V3_MANIFEST: &str = "2aee101be039a43d5e627ced1bac08c6d198d44d4bc79aab79382b94e131d002";
const RUNNER_MANIFEST: &str = "dc34400dbb847be66b0caad52cf084e9f219a5b6ba21dc5e2f1173e27f1603e1";
const FIXTURE_MANIFEST: &str = "4ab226d73a278dcd31fb5302af75a24028f5e8d1c476688a2c3c044ae71be7ec";
const INVARIANT_MANIFEST: &str = "0a07189bace342fe73b8f9bc16aa208b5a56b6709da1b722f567b5debab035f2";
const TRACE_HASH: &str = "4cf5fd3cf106700d5c9bd7bd49a32b28e6e7625e994943a578cb8d6b9aeb45b1";
const JOB_HASHES: [&str; 2] = [
    "76cd28ba983a92475d4c52defdb1225d3fbcd5c5489202d5d2c13a068b41f43b",
    "5b0c7a9c945b0fdaef42204bf0c11d1f0141fdbfe4d3db7db867a08d23d12e2a",
];
const RECEIPT_HASHES: [&str; 2] = [
    "34fbbeec13719f3f3d655a841a7e6a4f30469f1208c7cd345b10d938833b763f",
    "f0325d9d847009900492f89831efc80fdad67fb189b6da1bba4b7984c8613eff",
];
const WORKER_DIGESTS: [&str; 2] = [
    "3d6a55952102f1323e5cb8aa1442bb057150dad44e8d02f9bdaa7d2352dcfa2a",
    "3e873f206c9ed9db04da8551cb981ce1c27998b927f4ea842ce61bcd7907cd9e",
];

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .unwrap()
        .to_path_buf()
}
fn bytes(path: &str) -> Vec<u8> {
    fs::read(root().join(path)).unwrap()
}
fn value(path: &str) -> Value {
    serde_json::from_slice(&bytes(path)).unwrap()
}
fn encoded(value: &Value) -> Vec<u8> {
    serde_json::to_vec(value).unwrap()
}

#[test]
fn assertion_1_canonical_serialization_is_stable() {
    let a = canonical::parse(r#"{"z":0,"a":{"é":"x","b":"/\n"}}"#.as_bytes()).unwrap();
    let b = canonical::parse("{\"a\":{\"b\":\"/\\n\",\"é\":\"x\"},\"z\":0}".as_bytes()).unwrap();
    let expected = "{\"a\":{\"b\":\"/\\n\",\"é\":\"x\"},\"z\":0}".as_bytes();
    assert_eq!(canonical::serialize(&a), expected);
    assert_eq!(canonical::serialize(&a), canonical::serialize(&b));
    assert_eq!(
        canonical::serialize(&canonical::parse(expected).unwrap()),
        expected
    );
}

#[test]
fn assertion_2_rejects_invalid_canonical_json() {
    for invalid in [
        br#"{"x":1,"x":1}"#.as_slice(),
        br#"{"x":1.0}"#,
        br#"{"x":-0}"#,
        br#"{"x":01}"#,
        br#"{"x":9007199254740992}"#,
        b"\xef\xbb\xbf{}",
        b"{\"x\":\"a\0b\"}",
    ] {
        assert!(
            canonical::parse(invalid).is_err(),
            "accepted {}",
            String::from_utf8_lossy(invalid)
        );
    }
    assert!(canonical::parse(&[0xff]).is_err());
    assert!(canonical::parse("{\"x\":\"e\u{301}\"}".as_bytes()).is_err());
    assert!(canonical::parse(br#"{"x":"\ud800"}"#).is_err());
}

#[test]
fn assertion_2_rejects_unknown_missing_and_wrong_schema_fields() {
    let mut runner = value("manifests/treasury-runner.json");
    runner["limits"]["unknown"] = json!(1);
    assert!(parse_validated::<RunnerManifest>(&encoded(&runner)).is_err());
    let mut build = value("manifests/treasury-v2-build.json");
    build.as_object_mut().unwrap().remove("program");
    assert!(parse_validated::<BuildManifest>(&encoded(&build)).is_err());
    let mut invariant = value("manifests/auth-001-invariant.json");
    invariant["schema"] = json!("faultline.invariant.v2");
    assert!(parse_validated::<InvariantManifest>(&encoded(&invariant)).is_err());
}

#[test]
fn assertion_2_rejects_encoding_bounds_and_decimal_errors() {
    let mut fixture = value("manifests/treasury-v1-fixture.json");
    fixture["signers"][0]["pubkey"] = json!("not-base58!");
    assert!(parse_validated::<FixtureManifest>(&encoded(&fixture)).is_err());
    let mut fixture = value("manifests/treasury-v1-fixture.json");
    fixture["accounts"][0]["data_base64"] = json!("***");
    assert!(parse_validated::<FixtureManifest>(&encoded(&fixture)).is_err());
    let mut fixture = value("manifests/treasury-v1-fixture.json");
    fixture["signers"][0]["lamports"] = json!("01");
    assert!(parse_validated::<FixtureManifest>(&encoded(&fixture)).is_err());
    let mut build = value("manifests/treasury-v2-build.json");
    build["executable_sha256"] = json!("A".repeat(64));
    assert!(parse_validated::<BuildManifest>(&encoded(&build)).is_err());
    let mut trace = value("fixtures/exploits/auth-001-v2-authority-takeover.json");
    trace["transactions"][0]["step"] = json!(4_294_967_296_u64);
    assert!(parse_validated::<Trace>(&encoded(&trace)).is_err());
}

#[test]
fn assertion_2_rejects_order_duplicates_and_reference_errors() {
    let mut fixture = value("manifests/treasury-v1-fixture.json");
    fixture["accounts"].as_array_mut().unwrap().swap(0, 1);
    assert!(parse_validated::<FixtureManifest>(&encoded(&fixture)).is_err());
    let mut fixture = value("manifests/treasury-v1-fixture.json");
    fixture["signers"][1] = fixture["signers"][0].clone();
    assert!(parse_validated::<FixtureManifest>(&encoded(&fixture)).is_err());
    let mut trace = value("fixtures/exploits/auth-001-v2-authority-takeover.json");
    trace["transactions"][0]["instructions"][0]["program_id_ref"] = json!("programs.unknown");
    assert!(parse_validated::<Trace>(&encoded(&trace)).is_err());
    let mut trace = value("fixtures/exploits/auth-001-v2-authority-takeover.json");
    trace["transactions"][0]["instructions"][0]["accounts"][0]["ref"] = json!("unknown");
    assert!(parse_validated::<Trace>(&encoded(&trace)).is_err());
}

#[test]
fn assertion_2_rejects_fixture_derivation_and_payload_drift() {
    for (path, replacement) in [
        (
            "/signers/0/pubkey",
            json!("564Gpg3mVA7LwcW7hVQkeATttbaRRMTntp9eV2AGNpbd"),
        ),
        ("/accounts/0/lamports", json!("1")),
        ("/accounts/1/data_base64", json!("AA==")),
        (
            "/initial_state/treasury_state",
            json!("11111111111111111111111111111111"),
        ),
    ] {
        let mut fixture = value("manifests/treasury-v1-fixture.json");
        *fixture.pointer_mut(path).unwrap() = replacement;
        assert!(
            parse_validated::<FixtureManifest>(&encoded(&fixture)).is_err(),
            "accepted {path}"
        );
    }

    let mut fixture = value("manifests/treasury-v1-fixture.json");
    let encoded_state = fixture["accounts"][2]["data_base64"].as_str().unwrap();
    let mut state = BASE64.decode(encoded_state).unwrap();
    state[81] = 254;
    fixture["accounts"][2]["data_base64"] = json!(BASE64.encode(state));
    assert!(parse_validated::<FixtureManifest>(&encoded(&fixture)).is_err());
}

#[test]
fn assertion_2_rejects_candidate_binding_in_fixture_target() {
    let mut fixture = value("manifests/treasury-v1-fixture.json");
    fixture["programs"][0]["candidate_executable_sha256"] = json!("00".repeat(32));
    assert!(parse_validated::<FixtureManifest>(&encoded(&fixture)).is_err());
}

#[test]
fn assertion_2_runtime_error_mapping_is_closed() {
    assert_eq!(BUILTIN_ERROR_SYMBOLS.len(), 53);
    for symbol in BUILTIN_ERROR_SYMBOLS {
        let json = format!(r#"{{"instruction_index":0,"kind":"builtin","code":"{symbol}"}}"#);
        parse_validated::<StableRuntimeError>(json.as_bytes()).unwrap();
    }
    assert!(parse_validated::<StableRuntimeError>(
        br#"{"instruction_index":0,"kind":"builtin","code":"FutureError"}"#
    )
    .is_err());
    assert!(parse_validated::<StableRuntimeError>(
        br#"{"instruction_index":0,"kind":"custom","code":"GenericError"}"#
    )
    .is_err());
    parse_validated::<StableRuntimeError>(
        br#"{"instruction_index":65535,"kind":"custom","code":4294967295}"#,
    )
    .unwrap();
}

#[test]
fn assertion_2_receipt_and_worker_cross_fields_fail_closed() {
    let vectors = value("manifests/checkpoint-1-vectors.json");
    let mut receipt = vectors["receipts"][0].clone();
    receipt["pre_state_hashes"]
        .as_array_mut()
        .unwrap()
        .swap(0, 1);
    assert!(parse_validated::<ReplayReceipt>(&encoded(&receipt)).is_err());
    let mut receipt = vectors["receipts"][0].clone();
    receipt["transactions"][0]["status"] = json!("error");
    assert!(parse_validated::<ReplayReceipt>(&encoded(&receipt)).is_err());
    let mut receipt = vectors["receipts"][0].clone();
    receipt["pre_state_hashes"][1] = receipt["pre_state_hashes"][0].clone();
    assert!(parse_validated::<ReplayReceipt>(&encoded(&receipt)).is_err());
    let mut worker = vectors["unsigned_worker_outputs"][0].clone();
    worker.as_object_mut().unwrap().remove("receipt_hash");
    assert!(parse_validated::<WorkerOutput>(&encoded(&worker)).is_err());
    let mut worker = vectors["unsigned_worker_outputs"][0].clone();
    worker["classification"] = json!("InvalidEvidence");
    worker["result_code"] = json!(65537);
    assert!(parse_validated::<WorkerOutput>(&encoded(&worker)).is_err());
}

#[test]
fn assertion_2_dependency_and_token_provenance_are_frozen() {
    let cargo = fs::read_to_string(root().join("crates/faultline-replay/Cargo.toml")).unwrap();
    for pin in [
        "litesvm = \"=0.1.0\"",
        "solana-program = \"=1.18.22\"",
        "solana_rbpf = \"=0.8.3\"",
    ] {
        assert!(cargo.contains(pin));
    }
    assert!(!cargo.contains("faultline_gate"));
    assert!(!cargo.contains("faultline_treasury"));
    let token = bytes("manifests/programs/spl-token-3.5.0.so");
    assert_eq!(token.len(), 133_352);
    assert_eq!(
        hash::hex(&hash::sha256(&token)),
        "18264f491c7e0ad056dd36f42f8de6d1fedf9f044d1f521e714b4dc6b61594b6"
    );
    let mut runner = value("manifests/treasury-runner.json");
    runner["solana_runtime"] = json!("1.18.10");
    assert!(parse_validated::<RunnerManifest>(&encoded(&runner)).is_err());
    let mut fixture = value("manifests/treasury-v1-fixture.json");
    fixture["programs"][1]["source_crate_sha256"] = json!("00".repeat(32));
    assert!(parse_validated::<FixtureManifest>(&encoded(&fixture)).is_err());
}

#[test]
fn assertion_3_bound_changes_change_hashes() {
    let build: BuildManifest = parse_validated(&bytes("manifests/treasury-v2-build.json")).unwrap();
    let original = hash::manifest_hash(&build.schema, &build).unwrap();
    let mut changed = build.clone();
    changed.executable_sha256.replace_range(63..64, "0");
    assert_ne!(
        original,
        hash::manifest_hash(&changed.schema, &changed).unwrap()
    );
    let vectors = value("manifests/checkpoint-1-vectors.json");
    let job: ReplayJob = parse_validated(&encoded(&vectors["replay_jobs"][0])).unwrap();
    let original = hash::replay_job_hash(&job).unwrap();
    let mut changed = job.clone();
    changed.trace_hash.replace_range(63..64, "0");
    assert_ne!(original, hash::replay_job_hash(&changed).unwrap());
}

#[test]
fn assertion_4_all_manifest_schemas_validate() {
    let v2: BuildManifest = parse_validated(&bytes("manifests/treasury-v2-build.json")).unwrap();
    let v3: BuildManifest = parse_validated(&bytes("manifests/treasury-v3-build.json")).unwrap();
    let runner: RunnerManifest = parse_validated(&bytes("manifests/treasury-runner.json")).unwrap();
    let fixture: FixtureManifest =
        parse_validated(&bytes("manifests/treasury-v1-fixture.json")).unwrap();
    let invariant: InvariantManifest =
        parse_validated(&bytes("manifests/auth-001-invariant.json")).unwrap();
    assert_eq!(
        hash::hex(&hash::manifest_hash(&v2.schema, &v2).unwrap()),
        V2_MANIFEST
    );
    assert_eq!(
        hash::hex(&hash::manifest_hash(&v3.schema, &v3).unwrap()),
        V3_MANIFEST
    );
    assert_eq!(
        hash::hex(&hash::manifest_hash(&runner.schema, &runner).unwrap()),
        RUNNER_MANIFEST
    );
    assert_eq!(
        hash::hex(&hash::manifest_hash(&fixture.schema, &fixture).unwrap()),
        FIXTURE_MANIFEST
    );
    assert_eq!(
        hash::hex(&hash::manifest_hash(&invariant.schema, &invariant).unwrap()),
        INVARIANT_MANIFEST
    );
}

#[test]
fn checkpoint_1_trace_job_receipt_and_worker_vectors_validate() {
    let trace: Trace = parse_validated(&bytes(
        "fixtures/exploits/auth-001-v2-authority-takeover.json",
    ))
    .unwrap();
    assert_eq!(hash::hex(&hash::trace_hash(&trace).unwrap()), TRACE_HASH);
    let vectors = value("manifests/checkpoint-1-vectors.json");
    for index in 0..2 {
        let job: ReplayJob = parse_validated(&encoded(&vectors["replay_jobs"][index])).unwrap();
        let receipt: ReplayReceipt =
            parse_validated(&encoded(&vectors["receipts"][index])).unwrap();
        let worker: WorkerOutput =
            parse_validated(&encoded(&vectors["unsigned_worker_outputs"][index])).unwrap();
        assert_eq!(
            hash::hex(&hash::replay_job_hash(&job).unwrap()),
            JOB_HASHES[index]
        );
        assert_eq!(
            hash::hex(&hash::receipt_hash(&receipt).unwrap()),
            RECEIPT_HASHES[index]
        );
        assert_eq!(
            hash::hex(&hash::worker_message_digest(&worker).unwrap()),
            WORKER_DIGESTS[index]
        );
    }
}

#[test]
fn checkpoint_1_milestone_5_vector_is_unchanged() {
    let result = hash::replay_result_commitment(
        &[1; 32], &[2; 32], &[3; 32], &[4; 32], &[5; 32], 1, &[6; 32],
    );
    assert_eq!(
        hash::hex(&result),
        "b7eb266542e099bd41398d8b78d6d571b57844356bfe7c6f5539a73e00046921"
    );
}

#[test]
fn checkpoint_1_generator_matches_golden_report() {
    let report = generator::generate().unwrap();
    assert_eq!(report.build_v2_manifest_hash, V2_MANIFEST);
    assert_eq!(report.build_v3_manifest_hash, V3_MANIFEST);
    assert_eq!(report.runner_manifest_hash, RUNNER_MANIFEST);
    assert_eq!(report.fixture_manifest_hash, FIXTURE_MANIFEST);
    assert_eq!(report.invariant_manifest_hash, INVARIANT_MANIFEST);
    assert_eq!(report.trace_hash, TRACE_HASH);
    assert_eq!(
        [
            report.replay_job_v2_hash.as_str(),
            report.replay_job_v3_hash.as_str()
        ],
        JOB_HASHES
    );
    assert_eq!(
        [
            report.receipt_v2_hash.as_str(),
            report.receipt_v3_hash.as_str()
        ],
        RECEIPT_HASHES
    );
    assert_eq!(
        [
            report.worker_v2_message_digest.as_str(),
            report.worker_v3_message_digest.as_str()
        ],
        WORKER_DIGESTS
    );
}
