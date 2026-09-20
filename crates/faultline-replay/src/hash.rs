use sha2::{Digest, Sha256};

use crate::{canonical, Error};

pub fn sha256(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn canonical_hash<T: serde::Serialize>(domain: &[u8], value: &T) -> Result<[u8; 32], Error> {
    let canonical = canonical::serialize_typed(value)?;
    let mut preimage = Vec::with_capacity(domain.len() + 9 + canonical.len());
    preimage.extend_from_slice(domain);
    preimage.push(0);
    preimage.extend_from_slice(&(canonical.len() as u64).to_be_bytes());
    preimage.extend_from_slice(&canonical);
    Ok(sha256(&preimage))
}

pub fn manifest_hash<T: serde::Serialize>(schema: &str, value: &T) -> Result<[u8; 32], Error> {
    let canonical = canonical::serialize_typed(value)?;
    let schema = schema.as_bytes();
    let mut preimage = Vec::new();
    preimage.extend_from_slice(b"FAULTLINE_MANIFEST_V1");
    preimage.push(0);
    preimage.extend_from_slice(&(schema.len() as u16).to_be_bytes());
    preimage.extend_from_slice(schema);
    preimage.extend_from_slice(&(canonical.len() as u64).to_be_bytes());
    preimage.extend_from_slice(&canonical);
    Ok(sha256(&preimage))
}

pub fn trace_hash<T: serde::Serialize>(value: &T) -> Result<[u8; 32], Error> {
    canonical_hash(b"FAULTLINE_TRACE_V1", value)
}

pub fn replay_job_hash<T: serde::Serialize>(value: &T) -> Result<[u8; 32], Error> {
    canonical_hash(b"FAULTLINE_REPLAY_JOB_V1", value)
}

pub fn receipt_hash<T: serde::Serialize>(value: &T) -> Result<[u8; 32], Error> {
    canonical_hash(b"FAULTLINE_REPLAY_RECEIPT_V1", value)
}

pub fn worker_message_digest<T: serde::Serialize>(value: &T) -> Result<[u8; 32], Error> {
    canonical_hash(b"FAULTLINE_WORKER_OUTPUT_V1", value)
}

pub fn replay_result_commitment(
    proposal: &[u8; 32],
    invariant: &[u8; 32],
    trace_claim: &[u8; 32],
    candidate_buffer_hash: &[u8; 32],
    invariant_specification_hash: &[u8; 32],
    verdict: u8,
    receipt_hash: &[u8; 32],
) -> [u8; 32] {
    let mut preimage = Vec::with_capacity(212);
    preimage.extend_from_slice(b"FAULTLINE_REPLAY_V1");
    preimage.extend_from_slice(proposal);
    preimage.extend_from_slice(invariant);
    preimage.extend_from_slice(trace_claim);
    preimage.extend_from_slice(candidate_buffer_hash);
    preimage.extend_from_slice(invariant_specification_hash);
    preimage.push(verdict);
    preimage.extend_from_slice(receipt_hash);
    debug_assert_eq!(preimage.len(), 212);
    sha256(&preimage)
}

pub fn vector_digest(field_path: &str) -> [u8; 32] {
    let path = field_path.as_bytes();
    let mut preimage = Vec::new();
    preimage.extend_from_slice(b"FAULTLINE_CP1_VECTOR_V1");
    preimage.push(0);
    preimage.extend_from_slice(&(path.len() as u16).to_be_bytes());
    preimage.extend_from_slice(path);
    sha256(&preimage)
}
