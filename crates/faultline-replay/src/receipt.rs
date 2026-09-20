use std::str::FromStr;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use solana_sdk::pubkey::Pubkey;

use crate::{
    hash,
    runner::{ReplayEvaluation, ReplayReturnData},
    schema::{ReplayJob, ReplayReceipt, StateHash, TransactionResult, Validate, CANONICALIZATION},
    Error, Result,
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReceiptBundle {
    pub receipt: ReplayReceipt,
    pub receipt_hash: [u8; 32],
}

pub fn build_receipt(job: &ReplayJob, evaluation: &ReplayEvaluation) -> Result<ReceiptBundle> {
    job.validate()?;
    if job.candidate_executable_sha256 != evaluation.candidate_executable_sha256
        || job.candidate_buffer_hash != evaluation.candidate_executable_sha256
    {
        return Err(Error::Validation(
            "receipt candidate binding mismatch".into(),
        ));
    }

    let mut transactions = Vec::with_capacity(evaluation.transactions.len());
    let mut log_hashes = Vec::with_capacity(evaluation.transactions.len());
    let mut total_compute_units = 0_u64;
    for transaction in &evaluation.transactions {
        let compute_units = u32::try_from(transaction.compute_units)
            .map_err(|_| Error::Validation("transaction compute units exceed u32".into()))?;
        total_compute_units = total_compute_units
            .checked_add(transaction.compute_units)
            .ok_or_else(|| Error::Validation("total compute units overflow".into()))?;
        let logs = transaction_log_hash(&transaction.logs)?;
        log_hashes.push(logs);
        transactions.push(TransactionResult {
            index: transaction.index,
            status: transaction.status.clone(),
            error: transaction.error.clone(),
            compute_units,
            return_data_sha256: Some(hash::hex(&return_data_hash(
                transaction.return_data.as_ref(),
            )?)),
            logs_sha256: hash::hex(&logs),
        });
    }

    let original_admin = Pubkey::from_str(&evaluation.original_admin)
        .map_err(|_| Error::Validation("invalid original administrator".into()))?;
    let pre_attacker = decimal(&evaluation.pre_attacker_balance)?;
    let post_attacker = decimal(&evaluation.post_attacker_balance)?;
    let pre_vault = decimal(&evaluation.pre_treasury_vault_balance)?;
    let post_vault = decimal(&evaluation.post_treasury_vault_balance)?;

    let receipt = ReplayReceipt {
        schema: "faultline.replay-receipt.v1".into(),
        canonicalization: CANONICALIZATION.into(),
        replay_job_hash: hash::hex(&hash::replay_job_hash(job)?),
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
        transactions,
        pre_state_hashes: state_hashes(pre_attacker, &original_admin, pre_vault)?,
        post_state_hashes: state_hashes(post_attacker, &original_admin, post_vault)?,
        normalized_logs_sha256: hash::hex(&normalized_log_hash(&log_hashes)?),
        classification: evaluation.classification.clone(),
        result_code: evaluation.result_code,
        total_compute_units: total_compute_units.to_string(),
    };
    receipt.validate()?;
    let receipt_hash = hash::receipt_hash(&receipt)?;
    Ok(ReceiptBundle {
        receipt,
        receipt_hash,
    })
}

pub fn validate_bound_receipt(
    receipt: &ReplayReceipt,
    job: &ReplayJob,
    evaluation: &ReplayEvaluation,
) -> Result<[u8; 32]> {
    receipt.validate()?;
    let expected = build_receipt(job, evaluation)?;
    if receipt != &expected.receipt {
        return Err(Error::Validation("runtime receipt binding mismatch".into()));
    }
    Ok(expected.receipt_hash)
}

pub fn state_value_hash(selector_name: &str, type_tag: u8, value: &[u8]) -> Result<[u8; 32]> {
    if !matches!(
        selector_name,
        "original_admin" | "treasury_vault_base_units" | "attacker_base_units"
    ) || !matches!(
        (selector_name, type_tag),
        ("original_admin", 1) | ("treasury_vault_base_units", 2) | ("attacker_base_units", 2)
    ) {
        return Err(Error::Validation("unsupported state selector/type".into()));
    }
    let name = selector_name.as_bytes();
    let name_len = u32::try_from(name.len())
        .map_err(|_| Error::Validation("selector name exceeds u32".into()))?;
    let value_len = u32::try_from(value.len())
        .map_err(|_| Error::Validation("selector value exceeds u32".into()))?;
    if (type_tag == 1 && value.len() != 32) || (type_tag == 2 && value.len() != 8) {
        return Err(Error::Validation("invalid selector value length".into()));
    }
    let mut preimage = Vec::new();
    preimage.extend_from_slice(b"FAULTLINE_STATE_VALUE_V1");
    preimage.extend_from_slice(&name_len.to_be_bytes());
    preimage.extend_from_slice(name);
    preimage.push(type_tag);
    preimage.extend_from_slice(&value_len.to_be_bytes());
    preimage.extend_from_slice(value);
    Ok(hash::sha256(&preimage))
}

pub fn return_data_hash(value: Option<&ReplayReturnData>) -> Result<[u8; 32]> {
    let mut preimage = b"FAULTLINE_RETURN_DATA_V1".to_vec();
    match value {
        None => preimage.push(0),
        Some(value) => {
            preimage.push(1);
            let program = Pubkey::from_str(&value.program_id)
                .map_err(|_| Error::Validation("invalid return-data program ID".into()))?;
            let data = BASE64
                .decode(&value.data_base64)
                .map_err(|_| Error::Validation("invalid return-data Base64".into()))?;
            let len = u32::try_from(data.len())
                .map_err(|_| Error::Validation("return data exceeds u32".into()))?;
            preimage.extend_from_slice(program.as_ref());
            preimage.extend_from_slice(&len.to_be_bytes());
            preimage.extend_from_slice(&data);
        }
    }
    Ok(hash::sha256(&preimage))
}

pub fn transaction_log_hash(logs: &[String]) -> Result<[u8; 32]> {
    let count =
        u32::try_from(logs.len()).map_err(|_| Error::Validation("log count exceeds u32".into()))?;
    let mut preimage = b"FAULTLINE_TX_LOGS_V1".to_vec();
    preimage.extend_from_slice(&count.to_be_bytes());
    for log in logs {
        let bytes = log.as_bytes();
        let len = u32::try_from(bytes.len())
            .map_err(|_| Error::Validation("log length exceeds u32".into()))?;
        preimage.extend_from_slice(&len.to_be_bytes());
        preimage.extend_from_slice(bytes);
    }
    Ok(hash::sha256(&preimage))
}

pub fn normalized_log_hash(log_hashes: &[[u8; 32]]) -> Result<[u8; 32]> {
    let count = u32::try_from(log_hashes.len())
        .map_err(|_| Error::Validation("transaction log count exceeds u32".into()))?;
    let mut preimage = b"FAULTLINE_NORMALIZED_LOGS_V1".to_vec();
    preimage.extend_from_slice(&count.to_be_bytes());
    for digest in log_hashes {
        preimage.extend_from_slice(digest);
    }
    Ok(hash::sha256(&preimage))
}

fn state_hashes(attacker: u64, admin: &Pubkey, vault: u64) -> Result<Vec<StateHash>> {
    Ok(vec![
        StateHash {
            selector_id: "attacker_balance".into(),
            sha256: hash::hex(&state_value_hash(
                "attacker_base_units",
                2,
                &attacker.to_be_bytes(),
            )?),
        },
        StateHash {
            selector_id: "original_admin".into(),
            sha256: hash::hex(&state_value_hash("original_admin", 1, admin.as_ref())?),
        },
        StateHash {
            selector_id: "treasury_vault_balance".into(),
            sha256: hash::hex(&state_value_hash(
                "treasury_vault_base_units",
                2,
                &vault.to_be_bytes(),
            )?),
        },
    ])
}

fn decimal(value: &str) -> Result<u64> {
    value
        .parse()
        .map_err(|_| Error::Validation("invalid runtime balance".into()))
}
