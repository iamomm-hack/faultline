#![cfg(windows)]

use std::{fs, path::Path};

use faultline_replay::{
    coordinator::{Coordinator, IdentityMode, ShardOutcome, TerminationCause},
    hash,
    ipc::InputPaths,
    schema::{parse_validated, Classification, ReplayJob},
};

fn assert_success_telemetry(outcome: &ShardOutcome, candidate: &str) {
    let telemetry = &outcome.telemetry;
    assert_eq!(telemetry.launch_attempts, 3);
    assert_eq!(telemetry.retry_attempts, 0);
    assert_eq!(telemetry.workers.len(), 3);
    assert!(telemetry.run_directory_removed);
    assert!(telemetry.all_owned_processes_exited);
    assert!(telemetry.all_owned_handles_closed);
    assert_eq!(
        telemetry
            .workers
            .iter()
            .map(|value| value.worker_ordinal)
            .collect::<Vec<_>>(),
        vec![0, 1, 2]
    );
    for worker in &telemetry.workers {
        assert!(worker.owned_pid.is_some());
        assert_eq!(worker.exit_status_u32, Some(0));
        assert!(worker
            .peak_process_memory_bytes
            .is_some_and(|value| value > 0));
        assert!(worker.peak_job_memory_bytes.is_some_and(|value| value > 0));
        assert!(worker.launch_to_exit_elapsed_milliseconds > 0);
        assert!(worker.cleanup_elapsed_milliseconds > 0);
        assert_eq!(worker.termination_cause, TerminationCause::Completed);
        assert!(worker.cleanup_verified);
        assert_eq!(worker.collection_error, None);
        let limits = worker.applied_limits.as_ref().expect("applied Job limits");
        assert_eq!(limits.active_process_limit, 1);
        assert_eq!(limits.process_memory_limit_bytes, 512 * 1024 * 1024);
        assert_eq!(limits.job_memory_limit_bytes, 512 * 1024 * 1024);
        assert_eq!(limits.user_mode_cpu_limit_100ns, 25 * 10_000_000);
        assert_eq!(limits.wall_timeout_milliseconds, 30_000);
        assert_eq!(limits.cleanup_grace_milliseconds, 5_000);
        assert_eq!(limits.stdout_limit_bytes, 8 * 1024 * 1024);
        assert_eq!(limits.stderr_limit_bytes, 1024 * 1024);
        assert!(limits.queried_back_from_job_object);
        println!(
            "telemetry candidate={candidate} ordinal={} pid={} exit={} peak_process_bytes={} peak_job_bytes={} execution_ms={} cleanup_ms={} cause={} limits_queried_back={} cleanup_verified={}",
            worker.worker_ordinal,
            worker.owned_pid.unwrap(),
            worker.exit_status_u32.unwrap(),
            worker.peak_process_memory_bytes.unwrap(),
            worker.peak_job_memory_bytes.unwrap(),
            worker.launch_to_exit_elapsed_milliseconds,
            worker.cleanup_elapsed_milliseconds,
            worker.termination_cause.as_str(),
            limits.queried_back_from_job_object,
            worker.cleanup_verified
        );
    }
    assert!(
        outcome
            .signed_outputs
            .iter()
            .all(|value| value.output.process_peak_memory_bytes == "0"),
        "signed sentinel must remain outside measured telemetry"
    );
}

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

#[test]
fn assertion_28_real_v2_v3_production_workers_leave_no_owned_residue() {
    let coordinator = Coordinator::new(root()).unwrap();
    let v2 = coordinator.run_repository_candidate("v2", IdentityMode::Production);
    assert_eq!(
        v2.classification,
        Classification::Violated,
        "{:?}",
        v2.diagnostics
    );
    assert_eq!(v2.signed_outputs.len(), 3);
    assert_eq!(v2.attestation_intents.len(), 3);
    assert_success_telemetry(&v2, "v2");

    let v3 = coordinator.run_repository_candidate("v3", IdentityMode::Production);
    assert_eq!(
        v3.classification,
        Classification::Preserved,
        "{:?}",
        v3.diagnostics
    );
    assert_eq!(v3.signed_outputs.len(), 3);
    assert_eq!(v3.attestation_intents.len(), 3);
    assert_success_telemetry(&v3, "v3");

    let baseline = "633a46fb44a034484d14349cd62af4e6a548dcb9";
    let diff = std::process::Command::new("git")
        .current_dir(root())
        .args(["diff", "--quiet", baseline, "--", "programs"])
        .status()
        .unwrap();
    assert!(diff.success(), "production Solana source changed");
    let untracked = std::process::Command::new("git")
        .current_dir(root())
        .args(["status", "--porcelain", "--", "programs"])
        .output()
        .unwrap();
    assert!(untracked.status.success());
    assert!(
        untracked.stdout.is_empty(),
        "untracked production Solana source"
    );
}
