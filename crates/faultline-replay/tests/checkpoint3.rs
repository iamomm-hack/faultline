use std::{env, fs, path::Path};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use faultline_replay::{
    canonical, hash,
    receipt::{
        build_receipt, normalized_log_hash, return_data_hash, state_value_hash,
        transaction_log_hash, validate_bound_receipt, ReceiptBundle,
    },
    runner::{replay_repository_candidate, ReplayEvaluation, ReplayReturnData},
    schema::{
        parse_validated, Classification, ReplayJob, SignedWorkerOutput, Validate, WorkerOutput,
    },
    worker::{
        attestation_intent_hash, build_eligible_output, build_ineligible_output, parse_signed,
        replay_commitment, sign_output, verdict_byte, verify_signed,
    },
};
use serde_json::Value;
use solana_sdk::signature::{keypair_from_seed, Signer};

const NONCE: &str = "1616161616161616161616161616161616161616161616161616161616161616";

fn root() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .unwrap()
}

fn job(candidate: &str) -> ReplayJob {
    let vectors: Value = serde_json::from_slice(
        &fs::read(root().join("manifests/checkpoint-1-vectors.json")).unwrap(),
    )
    .unwrap();
    let index = if candidate == "v2" { 0 } else { 1 };
    parse_validated(&serde_json::to_vec(&vectors["replay_jobs"][index]).unwrap()).unwrap()
}

fn run(candidate: &str) -> (ReplayJob, ReplayEvaluation, ReceiptBundle) {
    let job = job(candidate);
    let evaluation = replay_repository_candidate(root(), candidate).unwrap();
    let receipt = build_receipt(&job, &evaluation).unwrap();
    (job, evaluation, receipt)
}

fn signed(
    candidate: &str,
) -> (
    ReplayJob,
    ReplayEvaluation,
    ReceiptBundle,
    WorkerOutput,
    SignedWorkerOutput,
) {
    let (job, evaluation, receipt) = run(candidate);
    let signer = keypair_from_seed(&[0x15; 32]).unwrap();
    let output = build_eligible_output(&job, &receipt, &signer.pubkey(), NONCE, 0, 1, 1).unwrap();
    let signed = sign_output(output.clone(), &signer).unwrap();
    (job, evaluation, receipt, output, signed)
}

#[test]
fn assertion_17_receipt_binds_runtime_inputs_and_nested_digests() {
    let (job, evaluation, bundle) = run("v2");
    assert_eq!(
        validate_bound_receipt(&bundle.receipt, &job, &evaluation).unwrap(),
        bundle.receipt_hash
    );
    assert_eq!(
        bundle.receipt.transactions.len(),
        evaluation.transactions.len()
    );
    assert_eq!(
        bundle.receipt.transactions[0].return_data_sha256,
        Some(hash::hex(
            &return_data_hash(evaluation.transactions[0].return_data.as_ref()).unwrap()
        ))
    );

    let mut changed = bundle.receipt.clone();
    changed.pre_state_hashes.swap(0, 1);
    assert!(changed.validate().is_err());
    for mutation in 0..3 {
        let mut changed = bundle.receipt.clone();
        match mutation {
            0 => {
                changed.pre_state_hashes.pop();
            }
            1 => {
                changed
                    .pre_state_hashes
                    .push(changed.pre_state_hashes[0].clone());
            }
            _ => {
                changed.pre_state_hashes[1] = changed.pre_state_hashes[0].clone();
            }
        }
        assert!(changed.validate().is_err());
    }
    let mut changed_evaluation = evaluation.clone();
    changed_evaluation.pre_attacker_balance = "1".into();
    assert!(validate_bound_receipt(&bundle.receipt, &job, &changed_evaluation).is_err());
    assert_ne!(
        state_value_hash("attacker_base_units", 2, &0_u64.to_be_bytes()).unwrap(),
        state_value_hash("attacker_base_units", 2, &1_u64.to_be_bytes()).unwrap()
    );

    let present_empty = ReplayReturnData {
        program_id: job.target_program_id.clone(),
        data_base64: String::new(),
    };
    let present_payload = ReplayReturnData {
        program_id: job.target_program_id.clone(),
        data_base64: BASE64.encode([1_u8]),
    };
    assert_ne!(
        return_data_hash(None).unwrap(),
        return_data_hash(Some(&present_empty)).unwrap()
    );
    assert_ne!(
        return_data_hash(Some(&present_empty)).unwrap(),
        return_data_hash(Some(&present_payload)).unwrap()
    );
    let mut bad_return = present_payload.clone();
    bad_return.program_id = "11111111111111111111111111111111".into();
    assert_ne!(
        return_data_hash(Some(&present_payload)).unwrap(),
        return_data_hash(Some(&bad_return)).unwrap()
    );
    bad_return.data_base64 = "***".into();
    assert!(return_data_hash(Some(&bad_return)).is_err());

    let logs = &evaluation.transactions[0].logs;
    let original = transaction_log_hash(logs).unwrap();
    let mut altered = logs.clone();
    altered[0].push('!');
    assert_ne!(original, transaction_log_hash(&altered).unwrap());
    let mut reordered = logs.clone();
    reordered.reverse();
    assert_ne!(original, transaction_log_hash(&reordered).unwrap());
    let mut inserted = logs.clone();
    inserted.push("inserted".into());
    assert_ne!(original, transaction_log_hash(&inserted).unwrap());
    let mut removed = logs.clone();
    removed.pop();
    assert_ne!(original, transaction_log_hash(&removed).unwrap());
    let all: Vec<[u8; 32]> = evaluation
        .transactions
        .iter()
        .map(|tx| transaction_log_hash(&tx.logs).unwrap())
        .collect();
    let mut reversed = all.clone();
    reversed.reverse();
    assert_ne!(
        normalized_log_hash(&all).unwrap(),
        normalized_log_hash(&reversed).unwrap()
    );

    let mut altered_receipt = bundle.receipt.clone();
    altered_receipt.total_compute_units = "0".into();
    assert_ne!(
        hash::receipt_hash(&altered_receipt).unwrap(),
        bundle.receipt_hash
    );
    assert!(validate_bound_receipt(&altered_receipt, &job, &evaluation).is_err());
}

#[test]
fn assertion_18_fresh_runs_are_byte_identical() {
    for candidate in ["v2", "v3"] {
        let first = signed(candidate);
        let second = signed(candidate);
        assert_eq!(first.1, second.1);
        assert_eq!(first.2, second.2);
        assert_eq!(
            canonical::serialize_typed(&first.2.receipt).unwrap(),
            canonical::serialize_typed(&second.2.receipt).unwrap()
        );
        assert_eq!(first.3, second.3);
        assert_eq!(
            hash::worker_message_digest(&first.3).unwrap(),
            hash::worker_message_digest(&second.3).unwrap()
        );
        assert_eq!(first.4, second.4);
        assert_eq!(
            canonical::serialize_typed(&first.4).unwrap(),
            canonical::serialize_typed(&second.4).unwrap()
        );
    }
}

#[test]
fn assertion_19_identity_changes_output_not_receipt_and_signatures_fail_closed() {
    let (job, _evaluation, receipt) = run("v3");
    let signer = keypair_from_seed(&[0x15; 32]).unwrap();
    let other = keypair_from_seed(&[0x16; 32]).unwrap();
    let first = build_eligible_output(&job, &receipt, &signer.pubkey(), NONCE, 0, 1, 1).unwrap();
    let second = build_eligible_output(&job, &receipt, &other.pubkey(), NONCE, 0, 1, 1).unwrap();
    assert_ne!(first, second);
    assert_eq!(first.receipt_hash, second.receipt_hash);
    assert!(sign_output(first.clone(), &other).is_err());
    let signed = sign_output(first.clone(), &signer).unwrap();
    assert_eq!(
        verify_signed(&signed).unwrap(),
        hash::worker_message_digest(&first).unwrap()
    );

    let mut altered = signed.clone();
    altered.output.elapsed_milliseconds = "2".into();
    assert!(verify_signed(&altered).is_err());
    let mut altered = signed.clone();
    altered.output.receipt_hash = Some("00".repeat(32));
    assert!(verify_signed(&altered).is_err());
    let mut altered = signed.clone();
    altered.signer_pubkey = other.pubkey().to_string();
    assert!(verify_signed(&altered).is_err());
    let mut altered = signed.clone();
    altered.signature.replace_range(0..1, "1");
    assert!(verify_signed(&altered).is_err());
    let mut malformed: Value = serde_json::to_value(&signed).unwrap();
    malformed["signature"] = Value::String("bad".into());
    assert!(parse_signed(&serde_json::to_vec(&malformed).unwrap()).is_err());
    let mut replayed = signed.clone();
    replayed.output.coordinator_nonce = "17".repeat(32);
    assert!(verify_signed(&replayed).is_err());
    let mut invalid = signed.clone();
    invalid.output.result_code = 1;
    assert!(verify_signed(&invalid).is_err());
    let mut intent = signed.clone();
    intent
        .output
        .attestation_intent
        .as_mut()
        .unwrap()
        .receipt_hash = "00".repeat(32);
    assert!(verify_signed(&intent).is_err());
}

#[test]
fn assertion_20_preserved_maps_to_hold_zero() {
    let (job, _, receipt) = run("v3");
    assert_eq!(verdict_byte(&Classification::Preserved, 0).unwrap(), 0);
    let commitment =
        replay_commitment(&job, &Classification::Preserved, 0, &receipt.receipt_hash).unwrap();
    assert_ne!(commitment, [0_u8; 32]);
    assert!(verdict_byte(&Classification::Preserved, 1).is_err());
}

#[test]
fn assertion_21_violated_maps_to_violation_one() {
    let (job, _, receipt) = run("v2");
    assert_eq!(verdict_byte(&Classification::Violated, 1).unwrap(), 1);
    let commitment =
        replay_commitment(&job, &Classification::Violated, 1, &receipt.receipt_hash).unwrap();
    assert_ne!(commitment, [0_u8; 32]);
    assert!(verdict_byte(&Classification::Violated, 0).is_err());
}

#[test]
fn assertion_22_milestone5_commitment_vector_is_unchanged() {
    assert_eq!(
        hash::hex(&hash::replay_result_commitment(
            &[1; 32], &[2; 32], &[3; 32], &[4; 32], &[5; 32], 1, &[6; 32]
        )),
        "b7eb266542e099bd41398d8b78d6d571b57844356bfe7c6f5539a73e00046921"
    );
}

#[test]
fn assertion_23_ineligible_results_have_no_commitment_or_intent() {
    let job = job("v2");
    let signer = keypair_from_seed(&[0x15; 32]).unwrap();
    for (classification, code) in [
        (Classification::InvalidEvidence, 0x0001_0001),
        (Classification::UnsupportedEnvironment, 0x0002_0001),
        (Classification::RunnerFault, 0x0003_0001),
    ] {
        assert!(verdict_byte(&classification, code).is_err());
        assert!(replay_commitment(&job, &classification, code, &[0; 32]).is_err());
        let output = build_ineligible_output(
            &hash::hex(&hash::replay_job_hash(&job).unwrap()),
            &signer.pubkey(),
            NONCE,
            0,
            classification,
            code,
        )
        .unwrap();
        assert!(output.receipt_hash.is_none());
        assert!(output.verdict_u8.is_none());
        assert!(output.replay_result_commitment.is_none());
        assert!(output.attestation_intent.is_none());
    }
}

#[test]
fn checkpoint3_runtime_evidence() {
    let mut evidence = Vec::new();
    for candidate in ["v2", "v3"] {
        let (job, evaluation, receipt, output, signed) = signed(candidate);
        let intent = output.attestation_intent.as_ref().unwrap();
        println!("{candidate} receipt={} state_pre={:?} state_post={:?} returns={:?} logs={:?} aggregate={} verdict={} commitment={} worker={} signature={} intent={} canonical_receipt_bytes={} canonical_signed_bytes={}",
            hash::hex(&receipt.receipt_hash), receipt.receipt.pre_state_hashes, receipt.receipt.post_state_hashes,
            receipt.receipt.transactions.iter().map(|tx| tx.return_data_sha256.clone().unwrap()).collect::<Vec<_>>(),
            receipt.receipt.transactions.iter().map(|tx| tx.logs_sha256.clone()).collect::<Vec<_>>(),
            receipt.receipt.normalized_logs_sha256, output.verdict_u8.unwrap(), output.replay_result_commitment.as_ref().unwrap(),
            hash::hex(&hash::worker_message_digest(&output).unwrap()), signed.signature,
            hash::hex(&attestation_intent_hash(intent).unwrap()), canonical::serialize_typed(&receipt.receipt).unwrap().len(), canonical::serialize_typed(&signed).unwrap().len());
        assert_eq!(
            job.candidate_executable_sha256,
            evaluation.candidate_executable_sha256
        );
        let worker_message_digest = hash::hex(&hash::worker_message_digest(&output).unwrap());
        let intent_hash = hash::hex(&attestation_intent_hash(intent).unwrap());
        evidence.push(serde_json::json!({
            "candidate": candidate,
            "job": job,
            "evaluation": evaluation,
            "receipt": receipt.receipt,
            "receipt_hash": hash::hex(&receipt.receipt_hash),
            "output": output,
            "worker_message_digest": worker_message_digest,
            "signed": signed,
            "attestation_intent_hash": intent_hash
        }));
    }
    if let Ok(path) = env::var("FAULTLINE_CP3_EVIDENCE_PATH") {
        fs::write(path, canonical::serialize_typed(&evidence).unwrap()).unwrap();
    }
}
