use std::{fs, path::Path};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use faultline_replay::{
    canonical, hash, invariant,
    runner::replay_repository_candidate,
    schema::{
        parse_validated, Classification, FixtureManifest, RuntimeErrorCode, RuntimeErrorKind,
        Trace, TransactionStatus,
    },
    trace,
};

fn root() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("replay crate is nested under the repository")
}

fn trace_bytes() -> Vec<u8> {
    fs::read(root().join("fixtures/exploits/auth-001-v2-authority-takeover.json")).unwrap()
}

fn fixture() -> FixtureManifest {
    parse_validated(&fs::read(root().join("manifests/treasury-v1-fixture.json")).unwrap()).unwrap()
}

#[test]
fn assertion_05_canonical_trace_parses() {
    let parsed: Trace = parse_validated(&trace_bytes()).unwrap();
    assert_eq!(parsed.schema, "faultline.trace.v1");
    assert_eq!(parsed.transactions.len(), 2);
}

#[test]
fn assertion_06_invalid_trace_inputs_fail_closed() {
    let original: serde_json::Value = serde_json::from_slice(&trace_bytes()).unwrap();
    let cases: [(&str, fn(serde_json::Value) -> serde_json::Value); 5] = [
        ("duplicate alias", |mut value: serde_json::Value| {
            value["signer_aliases"] = serde_json::json!(["attacker", "attacker"]);
            value
        }),
        ("unknown reference", |mut value: serde_json::Value| {
            value["transactions"][0]["instructions"][0]["accounts"][0]["ref"] =
                serde_json::json!("undeclared");
            value
        }),
        ("disallowed program", |mut value: serde_json::Value| {
            value["transactions"][0]["instructions"][0]["program_id_ref"] =
                serde_json::json!("programs.spl_token");
            value
        }),
        ("invalid base64", |mut value: serde_json::Value| {
            value["transactions"][0]["instructions"][0]["data_base64"] = serde_json::json!("***");
            value
        }),
        ("over-limit trace", |mut value: serde_json::Value| {
            let transaction = value["transactions"][0].clone();
            value["transactions"] = serde_json::Value::Array(vec![transaction; 33]);
            value
        }),
    ];
    for (label, mutate) in cases {
        let bytes = serde_json::to_vec(&mutate(original.clone())).unwrap();
        assert!(parse_validated::<Trace>(&bytes).is_err(), "{label}");
    }

    let duplicate_key = br#"{"schema":"faultline.trace.v1","schema":"faultline.trace.v1"}"#;
    assert!(parse_validated::<Trace>(duplicate_key).is_err());
}

#[test]
fn assertion_07_normalization_is_explicit_stable_and_idempotent() {
    let parsed: Trace = parse_validated(&trace_bytes()).unwrap();
    let first = trace::normalize(&parsed, &fixture()).unwrap();
    let second = trace::normalize(&parsed, &fixture()).unwrap();
    assert_eq!(first, second);
    assert_eq!(first.transactions.len(), 2);
    assert_eq!(first.transactions[0].step, 1);
    assert_eq!(first.transactions[0].instructions[0].accounts.len(), 6);
    assert_eq!(
        first.transactions[0].instructions[0].accounts[0].pubkey,
        "EiRj7VptpwZTy2uRMbHeqCU45fmbPFd4FrGGbQ2MZfi2"
    );
    assert!(first.transactions[0].instructions[0].accounts[0].is_writable);
    let bytes = first.canonical_bytes().unwrap();
    let reparsed: trace::NormalizedTrace = canonical::parse_typed(&bytes).unwrap();
    assert_eq!(first, reparsed);
    assert_eq!(bytes, reparsed.canonical_bytes().unwrap());
}

#[test]
fn assertion_09_original_administrator_is_captured_from_pre_state() {
    let fixture = fixture();
    let treasury = fixture
        .accounts
        .iter()
        .find(|account| account.alias == "treasury_pda")
        .unwrap();
    let vault = fixture
        .accounts
        .iter()
        .find(|account| account.alias == "treasury_vault")
        .unwrap();
    let attacker = fixture
        .accounts
        .iter()
        .find(|account| account.alias == "attacker_token_account")
        .unwrap();
    let captured = invariant::capture_pre_state(
        &BASE64.decode(&treasury.data_base64).unwrap(),
        &BASE64.decode(&vault.data_base64).unwrap(),
        &BASE64.decode(&attacker.data_base64).unwrap(),
    )
    .unwrap();
    assert_eq!(
        captured.original_admin.to_string(),
        fixture.initial_state.original_admin
    );
    assert_eq!(captured.treasury_vault_balance, 1_000_000_000);
    assert_eq!(captured.attacker_balance, 0);
}

#[test]
fn assertion_10_v2_is_deterministically_violated() {
    let first = replay_repository_candidate(root(), "v2").unwrap();
    let second = replay_repository_candidate(root(), "v2").unwrap();
    assert_eq!(first, second);
    assert_eq!(
        first.canonical_bytes().unwrap(),
        second.canonical_bytes().unwrap()
    );
    assert_eq!(first.classification, Classification::Violated);
    assert_eq!(first.result_code, invariant::AUTH_001_VIOLATED);
    assert!(!first.original_admin_authorized);
    assert_eq!(first.pre_treasury_vault_balance, "1000000000");
    assert_eq!(first.post_treasury_vault_balance, "900000000");
    assert_eq!(first.post_attacker_balance, "100000000");
    assert!(first
        .transactions
        .iter()
        .all(|transaction| transaction.status == TransactionStatus::Success));
    println!(
        "v2 normalized={} evaluation={} treasury_post={} attacker_post={}",
        first.normalized_trace_sha256,
        hash::hex(&hash::sha256(&first.canonical_bytes().unwrap())),
        first.post_treasury_vault_sha256,
        first.post_attacker_token_sha256
    );
}

#[test]
fn assertion_11_v3_is_deterministically_preserved() {
    let first = replay_repository_candidate(root(), "v3").unwrap();
    let second = replay_repository_candidate(root(), "v3").unwrap();
    assert_eq!(first, second);
    assert_eq!(
        first.canonical_bytes().unwrap(),
        second.canonical_bytes().unwrap()
    );
    assert_eq!(first.classification, Classification::Preserved);
    assert_eq!(first.result_code, invariant::AUTH_001_PRESERVED);
    assert!(!first.original_admin_authorized);
    assert!(first
        .transactions
        .iter()
        .all(|transaction| transaction.status == TransactionStatus::Error));
    for transaction in &first.transactions {
        let error = transaction.error.as_ref().unwrap();
        assert_eq!(error.instruction_index, 0);
        assert_eq!(error.kind, RuntimeErrorKind::Custom);
        assert_eq!(error.code, RuntimeErrorCode::Custom(6005));
    }
    println!(
        "v3 normalized={} evaluation={} treasury_post={} attacker_post={}",
        first.normalized_trace_sha256,
        hash::hex(&hash::sha256(&first.canonical_bytes().unwrap())),
        first.post_treasury_vault_sha256,
        first.post_attacker_token_sha256
    );
}

#[test]
fn assertion_12_v3_failed_migration_preserves_protected_balances() {
    let evaluation = replay_repository_candidate(root(), "v3").unwrap();
    assert_eq!(
        evaluation.pre_treasury_vault_balance,
        evaluation.post_treasury_vault_balance
    );
    assert_eq!(
        evaluation.pre_attacker_balance,
        evaluation.post_attacker_balance
    );
    assert_eq!(
        evaluation.pre_treasury_vault_sha256,
        evaluation.post_treasury_vault_sha256
    );
    assert_eq!(
        evaluation.pre_attacker_token_sha256,
        evaluation.post_attacker_token_sha256
    );
    assert_eq!(
        evaluation.pre_treasury_state_sha256,
        evaluation.post_treasury_state_sha256
    );
}
