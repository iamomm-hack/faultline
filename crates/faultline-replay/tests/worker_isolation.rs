#![cfg(windows)]

use std::{fs, path::Path};

use faultline_replay::{
    coordinator::{Coordinator, IdentityMode},
    hash,
    ipc::InputPaths,
    schema::{parse_validated, Classification, ReplayJob},
};

fn root() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .unwrap()
}

fn job(candidate: &str) -> ReplayJob {
    let vectors: serde_json::Value = serde_json::from_slice(
        &fs::read(root().join("manifests/checkpoint-1-vectors.json")).unwrap(),
    )
    .unwrap();
    let index = usize::from(candidate == "v3");
    parse_validated(
        &faultline_replay::canonical::serialize_typed(&vectors["replay_jobs"][index]).unwrap(),
    )
    .unwrap()
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

#[test]
fn assertion_13_digest_mismatched_evidence_is_invalid() {
    let coordinator = Coordinator::new(root()).unwrap();
    let mut altered = job("v2");
    altered.build_manifest_hash = "00".repeat(32);
    let outcome = coordinator.run(
        altered,
        paths("v2"),
        IdentityMode::ExplicitCheckpoint4TestVectors,
    );
    assert_eq!(outcome.classification, Classification::InvalidEvidence);
    assert_eq!(outcome.result_code, 0x0001_0006);
    assert!(outcome.attestation_intents.is_empty());
    assert_eq!(outcome.launch_attempts, 3);
}

#[test]
fn assertion_14_unsupported_program_requirement_is_unsupported_environment() {
    let coordinator = Coordinator::new(root()).unwrap();
    let outcome = coordinator.run_repository_candidate(
        "not-supported",
        IdentityMode::ExplicitCheckpoint4TestVectors,
    );
    assert_eq!(
        outcome.classification,
        Classification::UnsupportedEnvironment
    );
    assert_eq!(outcome.result_code, 0x0002_0002);
    assert!(outcome.attestation_intents.is_empty());
}

#[test]
fn assertion_24_real_three_worker_v2_consensus() {
    let outcome = Coordinator::new(root())
        .unwrap()
        .run_repository_candidate("v2", IdentityMode::ExplicitCheckpoint4TestVectors);
    assert_eq!(
        outcome.classification,
        Classification::Violated,
        "{:?}",
        outcome.diagnostics
    );
    assert_eq!(outcome.result_code, 1);
    assert_eq!(outcome.process_ids.len(), 3);
    assert_eq!(
        outcome
            .process_ids
            .iter()
            .collect::<std::collections::BTreeSet<_>>()
            .len(),
        3
    );
    assert_eq!(outcome.signed_outputs.len(), 3);
    assert_eq!(outcome.attestation_intents.len(), 3);
    assert_eq!(outcome.launch_attempts, 3);
    let receipts: std::collections::BTreeSet<_> = outcome
        .signed_outputs
        .iter()
        .map(|value| value.output.receipt_hash.as_ref().unwrap())
        .collect();
    let commitments: std::collections::BTreeSet<_> = outcome
        .signed_outputs
        .iter()
        .map(|value| value.output.replay_result_commitment.as_ref().unwrap())
        .collect();
    assert_eq!(receipts.len(), 1);
    assert_eq!(commitments.len(), 1);
    assert_eq!(
        outcome.signed_outputs[0].output.replay_job_hash,
        hash::hex(&hash::replay_job_hash(&job("v2")).unwrap())
    );
    for value in &outcome.signed_outputs {
        println!(
            "v2 ordinal={} pid={} identity={} nonce={} signature={} receipt={} commitment={}",
            value.output.worker_ordinal,
            outcome.process_ids[value.output.worker_ordinal as usize],
            value.output.verifier_pubkey,
            value.output.coordinator_nonce,
            value.signature,
            value.output.receipt_hash.as_deref().unwrap(),
            value.output.replay_result_commitment.as_deref().unwrap()
        );
    }
}

#[test]
fn assertion_25_real_three_worker_v3_consensus() {
    let outcome = Coordinator::new(root())
        .unwrap()
        .run_repository_candidate("v3", IdentityMode::ExplicitCheckpoint4TestVectors);
    assert_eq!(
        outcome.classification,
        Classification::Preserved,
        "{:?}",
        outcome.diagnostics
    );
    assert_eq!(outcome.result_code, 0);
    assert_eq!(outcome.process_ids.len(), 3);
    assert_eq!(outcome.signed_outputs.len(), 3);
    assert_eq!(outcome.attestation_intents.len(), 3);
    assert_eq!(outcome.launch_attempts, 3);
    for value in &outcome.signed_outputs {
        println!(
            "v3 ordinal={} pid={} identity={} nonce={} signature={} receipt={} commitment={}",
            value.output.worker_ordinal,
            outcome.process_ids[value.output.worker_ordinal as usize],
            value.output.verifier_pubkey,
            value.output.coordinator_nonce,
            value.signature,
            value.output.receipt_hash.as_deref().unwrap(),
            value.output.replay_result_commitment.as_deref().unwrap()
        );
    }
}
