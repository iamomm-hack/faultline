//! Frozen Checkpoint 4 worker IPC framing and closed envelopes.

use std::io::{self, Read, Write};

use serde::{de::DeserializeOwned, Deserialize, Serialize};

use crate::{
    canonical,
    schema::{Classification, ReplayJob, SignedWorkerOutput, Validate, CANONICALIZATION},
    Error, Result,
};

pub const MAGIC: [u8; 8] = *b"FLTWORK1";
pub const PROTOCOL_VERSION: u16 = 1;
pub const REQUEST_KIND: u16 = 0x0001;
pub const SIGNING_SEED_KIND: u16 = 0x0002;
pub const RESPONSE_KIND: u16 = 0x0003;
pub const HEADER_LEN: usize = 16;
pub const MAX_REQUEST_BYTES: usize = 1024 * 1024;
pub const SIGNING_SEED_BYTES: usize = 32;
pub const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_STDERR_BYTES: usize = 1024 * 1024;

pub const INVALID_JSON: u32 = 0x0001_0001;
pub const INVALID_DUPLICATE_KEY: u32 = 0x0001_0002;
pub const INVALID_UNKNOWN_FIELD: u32 = 0x0001_0003;
pub const INVALID_CANONICAL_ENCODING: u32 = 0x0001_0004;
pub const INVALID_SCHEMA_OR_VERSION: u32 = 0x0001_0005;
pub const INVALID_DIGEST_BINDING: u32 = 0x0001_0006;
pub const INVALID_ALIAS_OR_REFERENCE: u32 = 0x0001_0007;
pub const INVALID_BOUNDS: u32 = 0x0001_0008;
pub const INVALID_SIGNATURE_OR_IDENTITY: u32 = 0x0001_0009;
pub const UNSUPPORTED_ENGINE_OR_RUNTIME: u32 = 0x0002_0001;
pub const UNSUPPORTED_PROGRAM: u32 = 0x0002_0002;
pub const UNSUPPORTED_CPI: u32 = 0x0002_0003;
pub const UNSUPPORTED_SYSVAR_OR_EXTERNAL_DATA: u32 = 0x0002_0004;
pub const UNSUPPORTED_TRACE_FEATURE: u32 = 0x0002_0005;
pub const RUNNER_INTERNAL: u32 = 0x0003_0001;
pub const RUNNER_CRASH: u32 = 0x0003_0002;
pub const RUNNER_TIMEOUT: u32 = 0x0003_0003;
pub const RUNNER_MEMORY_LIMIT: u32 = 0x0003_0004;
pub const RUNNER_OUTPUT_LIMIT_OR_MALFORMED_OUTPUT: u32 = 0x0003_0005;
pub const RUNNER_ISOLATION_SETUP: u32 = 0x0003_0006;
pub const RUNNER_CLEANUP: u32 = 0x0003_0007;
pub const WORKER_DISAGREEMENT: u32 = 0x0004_0001;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FrameError {
    EarlyEof,
    WrongMagic,
    WrongVersion,
    WrongKind,
    Oversized,
    TrailingBytes,
    Io,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InputPaths {
    pub candidate_build_manifest: String,
    pub runner_manifest: String,
    pub fixture_manifest: String,
    pub invariant_manifest: String,
    pub trace: String,
    pub candidate_executable: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkerRequest {
    pub schema: String,
    pub canonicalization: String,
    pub coordinator_nonce: String,
    pub worker_ordinal: u8,
    pub expected_verifier_pubkey: String,
    pub replay_job: ReplayJob,
    pub input_paths: InputPaths,
}

impl Validate for WorkerRequest {
    fn validate(&self) -> Result<()> {
        if self.schema != "faultline.worker-request.v1" || self.canonicalization != CANONICALIZATION
        {
            return Err(Error::Validation("worker request schema/version".into()));
        }
        validate_lower_hex_32(&self.coordinator_nonce)?;
        if self.worker_ordinal > 2 {
            return Err(Error::Validation("worker request ordinal".into()));
        }
        let decoded = bs58::decode(&self.expected_verifier_pubkey)
            .into_vec()
            .map_err(|_| Error::Validation("worker request verifier identity".into()))?;
        if decoded.len() != 32
            || bs58::encode(&decoded).into_string() != self.expected_verifier_pubkey
        {
            return Err(Error::Validation("worker request verifier identity".into()));
        }
        self.replay_job.validate()?;
        for path in self.input_paths.values() {
            validate_repository_path(path)?;
        }
        Ok(())
    }
}

impl InputPaths {
    pub fn values(&self) -> [&str; 6] {
        [
            &self.candidate_build_manifest,
            &self.runner_manifest,
            &self.fixture_manifest,
            &self.invariant_manifest,
            &self.trace,
            &self.candidate_executable,
        ]
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkerResponse {
    pub schema: String,
    pub canonicalization: String,
    pub coordinator_nonce: String,
    pub worker_ordinal: u8,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signed_worker_output: Option<SignedWorkerOutput>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub classification: Option<Classification>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_code: Option<u32>,
}

impl WorkerResponse {
    pub fn signed(request: &WorkerRequest, output: SignedWorkerOutput) -> Result<Self> {
        let value = Self {
            schema: "faultline.worker-response.v1".into(),
            canonicalization: CANONICALIZATION.into(),
            coordinator_nonce: request.coordinator_nonce.clone(),
            worker_ordinal: request.worker_ordinal,
            status: "signed_output".into(),
            signed_worker_output: Some(output),
            classification: None,
            result_code: None,
        };
        value.validate()?;
        Ok(value)
    }

    pub fn failure(
        request: &WorkerRequest,
        classification: Classification,
        result_code: u32,
    ) -> Result<Self> {
        let value = Self {
            schema: "faultline.worker-response.v1".into(),
            canonicalization: CANONICALIZATION.into(),
            coordinator_nonce: request.coordinator_nonce.clone(),
            worker_ordinal: request.worker_ordinal,
            status: "failure".into(),
            signed_worker_output: None,
            classification: Some(classification),
            result_code: Some(result_code),
        };
        value.validate()?;
        Ok(value)
    }
}

impl Validate for WorkerResponse {
    fn validate(&self) -> Result<()> {
        if self.schema != "faultline.worker-response.v1"
            || self.canonicalization != CANONICALIZATION
        {
            return Err(Error::Validation("worker response schema/version".into()));
        }
        validate_lower_hex_32(&self.coordinator_nonce)?;
        if self.worker_ordinal > 2 {
            return Err(Error::Validation("worker response ordinal".into()));
        }
        match self.status.as_str() {
            "signed_output" => {
                if self.classification.is_some() || self.result_code.is_some() {
                    return Err(Error::Validation(
                        "signed response has failure fields".into(),
                    ));
                }
                self.signed_worker_output
                    .as_ref()
                    .ok_or_else(|| Error::Validation("missing signed worker output".into()))?
                    .validate()?;
            }
            "failure" => {
                if self.signed_worker_output.is_some() {
                    return Err(Error::Validation(
                        "failure response contains signed output".into(),
                    ));
                }
                let class = self
                    .classification
                    .as_ref()
                    .ok_or_else(|| Error::Validation("missing failure classification".into()))?;
                let code = self
                    .result_code
                    .ok_or_else(|| Error::Validation("missing failure code".into()))?;
                if !valid_failure_pair(class, code) {
                    return Err(Error::Validation(
                        "invalid failure classification/code".into(),
                    ));
                }
            }
            _ => return Err(Error::Validation("invalid worker response status".into())),
        }
        Ok(())
    }
}

pub fn valid_failure_pair(classification: &Classification, code: u32) -> bool {
    matches!(
        (classification, code),
        (Classification::InvalidEvidence, 0x0001_0001..=0x0001_0009)
            | (
                Classification::UnsupportedEnvironment,
                0x0002_0001..=0x0002_0005
            )
            | (Classification::RunnerFault, 0x0003_0001..=0x0003_0007)
    )
}

pub fn encode_frame(
    kind: u16,
    payload: &[u8],
    maximum: usize,
) -> std::result::Result<Vec<u8>, FrameError> {
    if payload.len() > maximum || payload.len() > u32::MAX as usize {
        return Err(FrameError::Oversized);
    }
    let mut frame = Vec::with_capacity(HEADER_LEN + payload.len());
    frame.extend_from_slice(&MAGIC);
    frame.extend_from_slice(&PROTOCOL_VERSION.to_be_bytes());
    frame.extend_from_slice(&kind.to_be_bytes());
    frame.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    frame.extend_from_slice(payload);
    Ok(frame)
}

pub fn write_frame<W: Write>(
    writer: &mut W,
    kind: u16,
    payload: &[u8],
    maximum: usize,
) -> std::result::Result<(), FrameError> {
    let frame = encode_frame(kind, payload, maximum)?;
    writer.write_all(&frame).map_err(|_| FrameError::Io)?;
    writer.flush().map_err(|_| FrameError::Io)
}

pub fn read_frame<R: Read>(
    reader: &mut R,
    expected_kind: u16,
    maximum: usize,
) -> std::result::Result<Vec<u8>, FrameError> {
    let mut header = [0_u8; HEADER_LEN];
    read_exact_mapped(reader, &mut header)?;
    if header[..8] != MAGIC {
        return Err(FrameError::WrongMagic);
    }
    if u16::from_be_bytes([header[8], header[9]]) != PROTOCOL_VERSION {
        return Err(FrameError::WrongVersion);
    }
    if u16::from_be_bytes([header[10], header[11]]) != expected_kind {
        return Err(FrameError::WrongKind);
    }
    let length = u32::from_be_bytes(header[12..16].try_into().expect("four bytes")) as usize;
    if length > maximum {
        return Err(FrameError::Oversized);
    }
    let mut payload = vec![0_u8; length];
    read_exact_mapped(reader, &mut payload)?;
    let mut trailing = [0_u8; 1];
    match reader.read(&mut trailing) {
        Ok(0) => Ok(payload),
        Ok(_) => Err(FrameError::TrailingBytes),
        Err(error) if error.kind() == io::ErrorKind::Interrupted => {
            read_eof_after_interrupt(reader, &mut trailing).map(|()| payload)
        }
        Err(_) => Err(FrameError::Io),
    }
}

pub fn canonical_payload<T: Serialize>(value: &T) -> Result<Vec<u8>> {
    canonical::serialize_typed(value)
}

pub fn parse_canonical<T: DeserializeOwned + Serialize + Validate>(bytes: &[u8]) -> Result<T> {
    let value: T = canonical::parse_typed(bytes)?;
    value.validate()?;
    if canonical::serialize_typed(&value)? != bytes {
        return Err(Error::Canonical("noncanonical JSON encoding".into()));
    }
    Ok(value)
}

fn read_exact_mapped<R: Read>(
    reader: &mut R,
    bytes: &mut [u8],
) -> std::result::Result<(), FrameError> {
    match reader.read_exact(bytes) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => Err(FrameError::EarlyEof),
        Err(_) => Err(FrameError::Io),
    }
}

fn read_eof_after_interrupt<R: Read>(
    reader: &mut R,
    byte: &mut [u8; 1],
) -> std::result::Result<(), FrameError> {
    loop {
        match reader.read(byte) {
            Ok(0) => return Ok(()),
            Ok(_) => return Err(FrameError::TrailingBytes),
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(_) => return Err(FrameError::Io),
        }
    }
}

fn validate_lower_hex_32(value: &str) -> Result<()> {
    if value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        Ok(())
    } else {
        Err(Error::Validation("expected lowercase 32-byte hex".into()))
    }
}

pub fn validate_repository_path(value: &str) -> Result<()> {
    if value.is_empty()
        || value.contains('\\')
        || value.starts_with('/')
        || value.starts_with("//")
        || value.starts_with("\\\\")
        || value.starts_with("\\\\?\\")
        || value.as_bytes().get(1) == Some(&b':')
        || value.contains(':')
        || value
            .split('/')
            .any(|part| part.is_empty() || matches!(part, "." | ".."))
    {
        return Err(Error::Validation(
            "forbidden repository-relative path".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::{Deserialize, Serialize};
    use std::io::Cursor;

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Closed {
        value: String,
    }

    impl Validate for Closed {
        fn validate(&self) -> Result<()> {
            if self.value == "ok" {
                Ok(())
            } else {
                Err(Error::Validation("closed value".into()))
            }
        }
    }

    #[test]
    fn exact_sixteen_byte_header_round_trip() {
        let encoded = encode_frame(REQUEST_KIND, b"{}", MAX_REQUEST_BYTES).unwrap();
        assert_eq!(&encoded[..8], b"FLTWORK1");
        assert_eq!(encoded.len(), 18);
        assert_eq!(
            read_frame(&mut Cursor::new(encoded), REQUEST_KIND, MAX_REQUEST_BYTES).unwrap(),
            b"{}"
        );
    }

    #[test]
    fn every_header_and_stream_failure_is_closed() {
        let base = encode_frame(REQUEST_KIND, b"x", MAX_REQUEST_BYTES).unwrap();
        for length in 0..HEADER_LEN + 1 {
            assert_eq!(
                read_frame(
                    &mut Cursor::new(&base[..length]),
                    REQUEST_KIND,
                    MAX_REQUEST_BYTES
                ),
                Err(FrameError::EarlyEof)
            );
        }
        let mut value = base.clone();
        value[0] ^= 1;
        assert_eq!(
            read_frame(&mut Cursor::new(value), REQUEST_KIND, 1),
            Err(FrameError::WrongMagic)
        );
        let mut value = base.clone();
        value[9] = 2;
        assert_eq!(
            read_frame(&mut Cursor::new(value), REQUEST_KIND, 1),
            Err(FrameError::WrongVersion)
        );
        assert_eq!(
            read_frame(&mut Cursor::new(base.clone()), RESPONSE_KIND, 1),
            Err(FrameError::WrongKind)
        );
        let mut value = base.clone();
        value[12..16].copy_from_slice(&2_u32.to_be_bytes());
        assert_eq!(
            read_frame(&mut Cursor::new(value), REQUEST_KIND, 1),
            Err(FrameError::Oversized)
        );
        let mut value = base;
        value.push(0);
        assert_eq!(
            read_frame(&mut Cursor::new(value), REQUEST_KIND, 1),
            Err(FrameError::TrailingBytes)
        );
    }

    #[test]
    fn closed_canonical_json_rejects_duplicate_unknown_and_noncanonical_fields() {
        assert!(matches!(
            parse_canonical::<Closed>(br#"{"value":"ok","value":"ok"}"#),
            Err(Error::DuplicateKey(_))
        ));
        assert!(matches!(
            parse_canonical::<Closed>(br#"{"unknown":1,"value":"ok"}"#),
            Err(Error::Schema(_))
        ));
        assert!(matches!(
            parse_canonical::<Closed>(b"{ \"value\": \"ok\" }"),
            Err(Error::Canonical(_))
        ));
        let parsed = parse_canonical::<Closed>(br#"{"value":"ok"}"#).unwrap();
        assert_eq!(parsed.value, "ok");
    }

    #[test]
    fn forbidden_path_forms_and_root_escape_are_rejected() {
        for value in [
            "",
            "/absolute",
            "C:/drive",
            "C:relative",
            "//server/share",
            r"\\?\C:\device",
            "manifests\\file.json",
            "manifests//file.json",
            "manifests/./file.json",
            "manifests/../file.json",
            "manifests/file.json:stream",
        ] {
            assert!(validate_repository_path(value).is_err(), "{value}");
        }
        assert!(validate_repository_path("manifests/file.json").is_ok());
    }

    #[test]
    fn assertion_15_internal_worker_failure_is_runner_fault_without_evidence() {
        let response = WorkerResponse {
            schema: "faultline.worker-response.v1".into(),
            canonicalization: CANONICALIZATION.into(),
            coordinator_nonce: "00".repeat(32),
            worker_ordinal: 0,
            status: "failure".into(),
            signed_worker_output: None,
            classification: Some(Classification::RunnerFault),
            result_code: Some(RUNNER_INTERNAL),
        };
        response.validate().unwrap();
        assert!(response.signed_worker_output.is_none());
    }

    #[test]
    fn every_worker_failure_code_has_exactly_one_valid_classification() {
        for code in INVALID_JSON..=INVALID_SIGNATURE_OR_IDENTITY {
            assert!(valid_failure_pair(&Classification::InvalidEvidence, code));
            assert!(!valid_failure_pair(&Classification::RunnerFault, code));
        }
        for code in UNSUPPORTED_ENGINE_OR_RUNTIME..=UNSUPPORTED_TRACE_FEATURE {
            assert!(valid_failure_pair(
                &Classification::UnsupportedEnvironment,
                code
            ));
            assert!(!valid_failure_pair(&Classification::InvalidEvidence, code));
        }
        for code in RUNNER_INTERNAL..=RUNNER_CLEANUP {
            assert!(valid_failure_pair(&Classification::RunnerFault, code));
            assert!(!valid_failure_pair(
                &Classification::UnsupportedEnvironment,
                code
            ));
        }
        assert!(!valid_failure_pair(
            &Classification::WorkerDisagreement,
            WORKER_DISAGREEMENT
        ));
    }
}
