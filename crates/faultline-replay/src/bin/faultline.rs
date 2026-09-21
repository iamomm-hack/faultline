use std::{
    collections::{BTreeMap, BTreeSet},
    ffi::OsString,
    io::Write,
    path::{Path, PathBuf},
};

use faultline_replay::{
    canonical,
    coordinator::Coordinator,
    operator::{
        self, classify_worker_outcome, plan_bytes, read_request, read_signed_output, run_verifier,
        verify_quorum, ExitClass, IdentityBindings, KeyFileScope, OperatorError,
    },
};
use serde::Serialize;

fn main() {
    std::panic::set_hook(Box::new(|_| {
        let _ = writeln!(
            std::io::stderr(),
            "INTERNAL_ERROR: operator terminated unexpectedly"
        );
    }));
    let code = match execute(std::env::args_os().skip(1).collect()) {
        Ok(()) => ExitClass::Ok,
        Err(error) => {
            let _ = writeln!(
                std::io::stderr(),
                "{}: {}",
                error.class().as_str(),
                error.message()
            );
            error.class()
        }
    };
    std::process::exit(code as i32);
}

fn execute(arguments: Vec<OsString>) -> Result<(), OperatorError> {
    reject_secret_environment()?;
    if arguments.iter().any(|value| {
        matches!(
            value.to_str(),
            Some("--seed" | "--secret-key" | "--private-key" | "--keypair-bytes")
        )
    }) {
        return Err(OperatorError::new(
            ExitClass::SecretHandlingFailure,
            "raw key arguments are forbidden",
        ));
    }
    if arguments.len() < 2 {
        return Err(usage());
    }
    let group = arguments[0].to_str().ok_or_else(usage)?;
    let command = arguments[1].to_str().ok_or_else(usage)?;
    let options = Options::parse(&arguments[2..])?;
    match (group, command) {
        ("verifier", "run") => verifier_run(options),
        ("quorum", "verify") => quorum_verify(options),
        _ => Err(usage()),
    }
}

fn reject_secret_environment() -> Result<(), OperatorError> {
    for name in [
        "FAULTLINE_PRIVATE_KEY",
        "FAULTLINE_SIGNING_SEED",
        "FAULTLINE_KEYPAIR_BYTES",
        "SOLANA_PRIVATE_KEY",
    ] {
        if std::env::var_os(name).is_some() {
            return Err(OperatorError::new(
                ExitClass::SecretHandlingFailure,
                "raw key environment input is forbidden",
            ));
        }
    }
    Ok(())
}

fn verifier_run(options: Options) -> Result<(), OperatorError> {
    options.require_only(&[
        "repository",
        "request",
        "keypair",
        "epoch-member",
        "stake-identity",
        "worker-signer",
        "attestation-signer",
        "output",
        "demo-owned-run",
    ])?;
    let repository = options.path("repository")?;
    let request_path = options.path("request")?;
    let keypair_path = options.path("keypair")?;
    let output_path = options.path("output")?;
    if paths_equivalent(&keypair_path, &output_path) {
        return Err(OperatorError::new(
            ExitClass::SecretHandlingFailure,
            "keypair and public output paths must differ",
        ));
    }
    let request = read_request(&request_path)?;
    let bindings = IdentityBindings {
        expected_verifier: request.expected_verifier_pubkey.clone(),
        epoch_member: options.string("epoch-member")?,
        stake_identity: options.string("stake-identity")?,
        worker_signer: options.string("worker-signer")?,
        attestation_signer: options.string("attestation-signer")?,
    };
    let coordinator = Coordinator::new(&repository).map_err(|_| {
        OperatorError::new(
            ExitClass::UsageOrConfig,
            "operator repository is unavailable",
        )
    })?;
    let demo_root = options.optional_path("demo-owned-run")?;
    let scope = match demo_root.as_deref() {
        Some(path) => KeyFileScope::Demo {
            owned_run_directory: path,
        },
        None => KeyFileScope::Production {
            repository: &repository,
        },
    };
    let result = run_verifier(&coordinator, request, &bindings, &keypair_path, scope)?;
    classify_worker_outcome(&result.outcome)?;
    let signed = result.outcome.signed_output.as_ref().ok_or_else(|| {
        OperatorError::new(ExitClass::ProcessFailure, "worker emitted no signed output")
    })?;
    let bytes = canonical::serialize_typed(signed).map_err(|_| {
        OperatorError::new(
            ExitClass::InternalError,
            "signed output serialization failed",
        )
    })?;
    write_public(&output_path, &bytes)?;
    #[derive(Serialize)]
    struct Summary<'a> {
        status: &'static str,
        command: &'static str,
        result: PublicRunResult<'a>,
    }
    #[derive(Serialize)]
    struct PublicRunResult<'a> {
        verifier_pubkey: &'a str,
        worker_ordinal: u8,
        coordinator_nonce: &'a str,
        replay_job_hash: &'a str,
        classification: &'a ClassificationName,
        receipt_hash: Option<&'a str>,
        replay_result_commitment: Option<&'a str>,
        launch_attempts: u8,
        retry_attempts: u8,
        cleanup_verified: bool,
        custody: &'a operator::CustodyReport,
    }
    #[derive(Serialize)]
    #[serde(transparent)]
    struct ClassificationName(String);
    let classification = ClassificationName(format!("{:?}", signed.output.classification));
    write_stdout(&Summary {
        status: "ok",
        command: "verifier run",
        result: PublicRunResult {
            verifier_pubkey: &signed.output.verifier_pubkey,
            worker_ordinal: signed.output.worker_ordinal,
            coordinator_nonce: &signed.output.coordinator_nonce,
            replay_job_hash: &signed.output.replay_job_hash,
            classification: &classification,
            receipt_hash: signed.output.receipt_hash.as_deref(),
            replay_result_commitment: signed.output.replay_result_commitment.as_deref(),
            launch_attempts: result.outcome.launch_attempts,
            retry_attempts: result.outcome.retry_attempts,
            cleanup_verified: result.outcome.run_directory_removed
                && result.outcome.all_owned_handles_closed
                && result
                    .outcome
                    .telemetry
                    .as_ref()
                    .is_some_and(|value| value.cleanup_verified),
            custody: &result.custody,
        },
    })
}

fn quorum_verify(options: Options) -> Result<(), OperatorError> {
    options.require_only(&[
        "request",
        "signed-output",
        "gate-program-id",
        "expected-genesis-hash",
        "verifier-epoch",
        "plan-output",
    ])?;
    let request_paths = options.paths_exactly("request", 3)?;
    let output_paths = options.paths_exactly("signed-output", 3)?;
    let requests = request_paths
        .iter()
        .map(|path| read_request(path))
        .collect::<Result<Vec<_>, _>>()?;
    let outputs = output_paths
        .iter()
        .map(|path| read_signed_output(path))
        .collect::<Result<Vec<_>, _>>()?;
    let plan = verify_quorum(
        &requests,
        outputs,
        &options.string("gate-program-id")?,
        &options.string("expected-genesis-hash")?,
        &options.string("verifier-epoch")?,
    )?;
    let plan_path = options.path("plan-output")?;
    let bytes = plan_bytes(&plan)?;
    write_public(&plan_path, &bytes)?;
    #[derive(Serialize)]
    struct Summary<'a> {
        status: &'static str,
        command: &'static str,
        result: PlanSummary<'a>,
    }
    #[derive(Serialize)]
    struct PlanSummary<'a> {
        verification_round: &'a str,
        replay_job_hash: &'a str,
        replay_receipt_hash: &'a str,
        result_hash: &'a str,
        verdict_u8: u8,
        verifier_identities: Vec<&'a str>,
        authenticated_outputs: usize,
        retry_attempts: u8,
    }
    write_stdout(&Summary {
        status: "ok",
        command: "quorum verify",
        result: PlanSummary {
            verification_round: &plan.verification_round,
            replay_job_hash: &plan.replay_job_hash,
            replay_receipt_hash: &plan.replay_receipt_hash,
            result_hash: &plan.result_hash,
            verdict_u8: plan.verdict_u8,
            verifier_identities: plan
                .signed_worker_outputs
                .iter()
                .map(|value| value.signer_pubkey.as_str())
                .collect(),
            authenticated_outputs: plan.signed_worker_outputs.len(),
            retry_attempts: 0,
        },
    })
}

fn write_stdout<T: Serialize>(value: &T) -> Result<(), OperatorError> {
    let bytes = canonical::serialize_typed(value)
        .map_err(|_| OperatorError::new(ExitClass::InternalError, "result serialization failed"))?;
    if bytes.len() > 1024 * 1024 {
        return Err(OperatorError::new(
            ExitClass::InternalError,
            "structured output exceeds its bound",
        ));
    }
    let mut stdout = std::io::stdout().lock();
    stdout
        .write_all(&bytes)
        .and_then(|_| stdout.write_all(b"\n"))
        .map_err(|_| OperatorError::new(ExitClass::InternalError, "structured output failed"))
}

fn write_public(path: &Path, bytes: &[u8]) -> Result<(), OperatorError> {
    if bytes.len() > 8 * 1024 * 1024 {
        return Err(OperatorError::new(
            ExitClass::InvalidInput,
            "public output exceeds its bound",
        ));
    }
    std::fs::write(path, bytes).map_err(|_| {
        OperatorError::new(
            ExitClass::InvalidInput,
            "public output could not be written",
        )
    })
}

fn paths_equivalent(left: &Path, right: &Path) -> bool {
    fn normalized(path: &Path) -> Option<String> {
        if path.exists() {
            std::fs::canonicalize(path).ok()
        } else {
            let parent = path.parent()?;
            let name = path.file_name()?;
            std::fs::canonicalize(parent)
                .ok()
                .map(|value| value.join(name))
        }
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
    }
    normalized(left).is_some_and(|left| normalized(right).is_some_and(|right| left == right))
}

fn usage() -> OperatorError {
    OperatorError::new(
        ExitClass::UsageOrConfig,
        "unsupported or incomplete command",
    )
}

struct Options(BTreeMap<String, Vec<OsString>>);

impl Options {
    fn parse(values: &[OsString]) -> Result<Self, OperatorError> {
        if values.len() % 2 != 0 {
            return Err(usage());
        }
        let mut options = BTreeMap::<String, Vec<OsString>>::new();
        for pair in values.chunks_exact(2) {
            let name = pair[0].to_str().ok_or_else(usage)?;
            if !name.starts_with("--") || name.len() < 3 {
                return Err(usage());
            }
            options
                .entry(name[2..].to_owned())
                .or_default()
                .push(pair[1].clone());
        }
        Ok(Self(options))
    }

    fn require_only(&self, allowed: &[&str]) -> Result<(), OperatorError> {
        let allowed: BTreeSet<_> = allowed.iter().copied().collect();
        if self.0.keys().any(|name| !allowed.contains(name.as_str())) {
            return Err(usage());
        }
        for (name, values) in &self.0 {
            if name != "request" && name != "signed-output" && values.len() != 1 {
                return Err(usage());
            }
        }
        Ok(())
    }

    fn value(&self, name: &str) -> Result<&OsString, OperatorError> {
        self.0
            .get(name)
            .filter(|values| values.len() == 1)
            .map(|values| &values[0])
            .ok_or_else(usage)
    }

    fn string(&self, name: &str) -> Result<String, OperatorError> {
        self.value(name)?
            .to_str()
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .ok_or_else(usage)
    }

    fn path(&self, name: &str) -> Result<PathBuf, OperatorError> {
        Ok(PathBuf::from(self.value(name)?))
    }

    fn optional_path(&self, name: &str) -> Result<Option<PathBuf>, OperatorError> {
        match self.0.get(name) {
            None => Ok(None),
            Some(values) if values.len() == 1 => Ok(Some(PathBuf::from(&values[0]))),
            _ => Err(usage()),
        }
    }

    fn paths_exactly(&self, name: &str, count: usize) -> Result<Vec<PathBuf>, OperatorError> {
        self.0
            .get(name)
            .filter(|values| values.len() == count)
            .map(|values| values.iter().map(PathBuf::from).collect())
            .ok_or_else(usage)
    }
}
