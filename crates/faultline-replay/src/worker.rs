use std::str::FromStr;

use solana_sdk::{
    pubkey::Pubkey,
    signature::{Keypair, Signature, Signer},
};

use crate::{
    canonical, hash,
    receipt::ReceiptBundle,
    schema::{
        parse_validated, AttestationIntent, Classification, ReplayJob, SignedWorkerOutput,
        Validate, WorkerOutput, CANONICALIZATION,
    },
    Error, Result,
};

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
