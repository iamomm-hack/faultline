use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    str::FromStr,
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use litesvm::{types::TransactionMetadata, LiteSVM};
use serde::{Deserialize, Serialize};
use solana_program_runtime::compute_budget::ComputeBudget;
use solana_sdk::{
    account::Account,
    clock::Clock,
    instruction::{AccountMeta, Instruction, InstructionError},
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    transaction::{Transaction, TransactionError},
};

use crate::{
    canonical, hash,
    invariant::{self, Auth001PostState},
    schema::{
        derived_keypair, parse_validated, BuildManifest, BuiltinInstructionError, Classification,
        FixtureManifest, InvariantManifest, RunnerManifest, RuntimeErrorCode, RuntimeErrorKind,
        StableRuntimeError, Trace, TransactionStatus, Validate,
    },
    trace::{self, NormalizedTrace},
    Error, Result,
};

const TOKENKEG_SHA256: &str = "18264f491c7e0ad056dd36f42f8de6d1fedf9f044d1f521e714b4dc6b61594b6";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayTransactionEvidence {
    pub index: u16,
    pub status: TransactionStatus,
    pub error: Option<StableRuntimeError>,
    pub compute_units: u64,
    pub logs: Vec<String>,
    pub logs_sha256: String,
    pub return_data: Option<ReplayReturnData>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayReturnData {
    pub program_id: String,
    pub data_base64: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayEvaluation {
    pub candidate: String,
    pub candidate_executable_sha256: String,
    pub normalized_trace: NormalizedTrace,
    pub normalized_trace_sha256: String,
    pub original_admin: String,
    pub pre_treasury_vault_balance: String,
    pub post_treasury_vault_balance: String,
    pub pre_attacker_balance: String,
    pub post_attacker_balance: String,
    pub pre_treasury_state_sha256: String,
    pub post_treasury_state_sha256: String,
    pub pre_treasury_vault_sha256: String,
    pub post_treasury_vault_sha256: String,
    pub pre_attacker_token_sha256: String,
    pub post_attacker_token_sha256: String,
    pub transactions: Vec<ReplayTransactionEvidence>,
    pub classification: Classification,
    pub result_code: u32,
    pub original_admin_authorized: bool,
}

impl ReplayEvaluation {
    pub fn canonical_bytes(&self) -> Result<Vec<u8>> {
        canonical::serialize_typed(self)
    }
}

pub fn replay_repository_candidate(root: &Path, candidate: &str) -> Result<ReplayEvaluation> {
    if !matches!(candidate, "v2" | "v3") {
        return Err(Error::Validation(format!(
            "unsupported replay candidate {candidate}"
        )));
    }
    let fixture: FixtureManifest = read_validated(root.join("manifests/treasury-v1-fixture.json"))?;
    let policy: InvariantManifest = read_validated(root.join("manifests/auth-001-invariant.json"))?;
    let runner: RunnerManifest = read_validated(root.join("manifests/treasury-runner.json"))?;
    let trace: Trace =
        read_validated(root.join("fixtures/exploits/auth-001-v2-authority-takeover.json"))?;
    let build: BuildManifest =
        read_validated(root.join(format!("manifests/treasury-{candidate}-build.json")))?;
    if build.build != candidate {
        return Err(Error::Validation(
            "candidate/build manifest mismatch".into(),
        ));
    }

    verify_file_hash(
        &root.join("manifests/programs/spl-token-3.5.0.so"),
        TOKENKEG_SHA256,
        "Tokenkeg mirror",
    )?;
    let candidate_bytes = fs::read(root.join(&build.artifact_path))?;
    verify_bytes_hash(
        &candidate_bytes,
        &build.executable_sha256,
        "candidate executable",
    )?;

    let normalized_trace = trace::normalize(&trace, &fixture)?;
    execute(
        candidate,
        &candidate_bytes,
        &build,
        &fixture,
        &policy,
        &runner,
        normalized_trace,
    )
}

fn execute(
    candidate: &str,
    candidate_bytes: &[u8],
    build: &BuildManifest,
    fixture: &FixtureManifest,
    policy: &InvariantManifest,
    runner: &RunnerManifest,
    normalized_trace: NormalizedTrace,
) -> Result<ReplayEvaluation> {
    build.validate()?;
    fixture.validate()?;
    policy.validate()?;
    runner.validate()?;

    let mut compute_budget = ComputeBudget::default();
    compute_budget.compute_unit_limit = u64::from(runner.limits.max_compute_units_per_transaction);
    let mut vm = LiteSVM::new()
        .with_sigverify(runner.sigverify)
        .with_compute_budget(compute_budget);
    vm.set_sysvar(&Clock {
        slot: 1,
        epoch_start_timestamp: 0,
        epoch: 0,
        leader_schedule_epoch: 0,
        unix_timestamp: 0,
    });
    let treasury_program = pubkey(&build.program_id)?;
    vm.add_program(treasury_program, candidate_bytes);

    for value in &fixture.accounts {
        vm.set_account(
            pubkey(&value.pubkey)?,
            Account {
                lamports: decimal_u64(&value.lamports, "account lamports")?,
                data: BASE64
                    .decode(&value.data_base64)
                    .map_err(|_| Error::Validation("invalid fixture account Base64".into()))?,
                owner: pubkey(&value.owner)?,
                executable: value.executable,
                rent_epoch: decimal_u64(&value.rent_epoch, "rent_epoch")?,
            },
        )
        .map_err(|error| Error::Validation(format!("fixture account install: {error}")))?;
    }

    let mut keypairs = BTreeMap::<String, Keypair>::new();
    for signer in &fixture.signers {
        let keypair = derived_keypair("FAULTLINE_TEST_SIGNER_V1", &signer.alias)?;
        if keypair.pubkey().to_string() != signer.pubkey {
            return Err(Error::Validation("deterministic signer mismatch".into()));
        }
        vm.set_account(
            keypair.pubkey(),
            Account {
                lamports: decimal_u64(&signer.lamports, "signer lamports")?,
                data: Vec::new(),
                owner: solana_sdk::system_program::id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .map_err(|error| Error::Validation(format!("signer account install: {error}")))?;
        keypairs.insert(signer.pubkey.clone(), keypair);
    }

    let treasury_state_key = pubkey(&fixture.initial_state.treasury_state)?;
    let treasury_vault_key = pubkey(&fixture.initial_state.treasury_vault)?;
    let attacker_token_key = pubkey(&fixture.initial_state.attacker_token_account)?;
    let pre_treasury_state = account_data(&vm, &treasury_state_key, "treasury state")?;
    let pre_treasury_vault = account_data(&vm, &treasury_vault_key, "treasury vault")?;
    let pre_attacker_token = account_data(&vm, &attacker_token_key, "attacker token")?;
    let pre = invariant::capture_pre_state(
        &pre_treasury_state,
        &pre_treasury_vault,
        &pre_attacker_token,
    )?;
    if pre.original_admin.to_string() != fixture.initial_state.original_admin
        || pre.treasury_vault_balance.to_string() != fixture.initial_state.treasury_vault_base_units
        || pre.attacker_balance.to_string() != fixture.initial_state.attacker_base_units
    {
        return Err(Error::Validation(
            "captured AUTH-001 pre-state does not match fixture binding".into(),
        ));
    }

    let mut transaction_evidence = Vec::with_capacity(normalized_trace.transactions.len());
    for (index, transaction) in normalized_trace.transactions.iter().enumerate() {
        let payer = pubkey(
            transaction
                .signer_pubkeys
                .first()
                .ok_or_else(|| Error::Validation("missing deterministic fee payer".into()))?,
        )?;
        let instructions = transaction
            .instructions
            .iter()
            .map(|instruction| {
                Ok(Instruction {
                    program_id: pubkey(&instruction.program_id)?,
                    accounts: instruction
                        .accounts
                        .iter()
                        .map(|account| {
                            Ok(AccountMeta {
                                pubkey: pubkey(&account.pubkey)?,
                                is_signer: account.is_signer,
                                is_writable: account.is_writable,
                            })
                        })
                        .collect::<Result<Vec<_>>>()?,
                    data: BASE64.decode(&instruction.data_base64).map_err(|_| {
                        Error::Validation("invalid normalized instruction Base64".into())
                    })?,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        let transaction_keypairs = transaction
            .signer_pubkeys
            .iter()
            .map(|key| {
                keypairs
                    .get(key)
                    .ok_or_else(|| Error::Validation(format!("unknown signer public key {key}")))
            })
            .collect::<Result<Vec<_>>>()?;
        let signed = Transaction::new_signed_with_payer(
            &instructions,
            Some(&payer),
            &transaction_keypairs,
            vm.latest_blockhash(),
        );
        let evidence = match vm.send_transaction(signed) {
            Ok(metadata) => transaction_result(index, TransactionStatus::Success, None, metadata)?,
            Err(failed) => transaction_result(
                index,
                TransactionStatus::Error,
                Some(stable_transaction_error(failed.err)?),
                failed.meta,
            )?,
        };
        transaction_evidence.push(evidence);
    }

    let post_treasury_state = account_data(&vm, &treasury_state_key, "treasury state")?;
    let post_treasury_vault = account_data(&vm, &treasury_vault_key, "treasury vault")?;
    let post_attacker_token = account_data(&vm, &attacker_token_key, "attacker token")?;
    let post: Auth001PostState =
        invariant::capture_post_state(&post_treasury_vault, &post_attacker_token)?;
    let verdict = invariant::evaluate_auth_001(policy, &normalized_trace, &pre, &post)?;
    let normalized_trace_bytes = normalized_trace.canonical_bytes()?;

    Ok(ReplayEvaluation {
        candidate: candidate.into(),
        candidate_executable_sha256: build.executable_sha256.clone(),
        normalized_trace,
        normalized_trace_sha256: digest(&normalized_trace_bytes),
        original_admin: pre.original_admin.to_string(),
        pre_treasury_vault_balance: pre.treasury_vault_balance.to_string(),
        post_treasury_vault_balance: post.treasury_vault_balance.to_string(),
        pre_attacker_balance: pre.attacker_balance.to_string(),
        post_attacker_balance: post.attacker_balance.to_string(),
        pre_treasury_state_sha256: digest(&pre_treasury_state),
        post_treasury_state_sha256: digest(&post_treasury_state),
        pre_treasury_vault_sha256: digest(&pre_treasury_vault),
        post_treasury_vault_sha256: digest(&post_treasury_vault),
        pre_attacker_token_sha256: digest(&pre_attacker_token),
        post_attacker_token_sha256: digest(&post_attacker_token),
        transactions: transaction_evidence,
        classification: verdict.classification,
        result_code: verdict.result_code,
        original_admin_authorized: verdict.original_admin_authorized,
    })
}

fn transaction_result(
    index: usize,
    status: TransactionStatus,
    error: Option<StableRuntimeError>,
    metadata: TransactionMetadata,
) -> Result<ReplayTransactionEvidence> {
    let index = u16::try_from(index)
        .map_err(|_| Error::Validation("transaction index exceeds u16".into()))?;
    let logs_bytes = canonical::serialize_typed(&metadata.logs)?;
    let return_data = if metadata.return_data.program_id == Pubkey::default()
        && metadata.return_data.data.is_empty()
    {
        None
    } else {
        Some(ReplayReturnData {
            program_id: metadata.return_data.program_id.to_string(),
            data_base64: BASE64.encode(metadata.return_data.data),
        })
    };
    Ok(ReplayTransactionEvidence {
        index,
        status,
        error,
        compute_units: metadata.compute_units_consumed,
        logs: metadata.logs,
        logs_sha256: digest(&logs_bytes),
        return_data,
    })
}

fn stable_transaction_error(error: TransactionError) -> Result<StableRuntimeError> {
    let TransactionError::InstructionError(instruction_index, instruction_error) = error else {
        return Err(Error::Validation(
            "unsupported non-instruction transaction failure".into(),
        ));
    };
    let (kind, code) = match instruction_error {
        InstructionError::Custom(code) => {
            (RuntimeErrorKind::Custom, RuntimeErrorCode::Custom(code))
        }
        builtin => (
            RuntimeErrorKind::Builtin,
            RuntimeErrorCode::Builtin(stable_builtin_error(builtin)?),
        ),
    };
    Ok(StableRuntimeError {
        instruction_index: instruction_index as u16,
        kind,
        code,
    })
}

fn stable_builtin_error(error: InstructionError) -> Result<BuiltinInstructionError> {
    use BuiltinInstructionError as B;
    use InstructionError as I;
    Ok(match error {
        I::GenericError => B::GenericError,
        I::InvalidArgument => B::InvalidArgument,
        I::InvalidInstructionData => B::InvalidInstructionData,
        I::InvalidAccountData => B::InvalidAccountData,
        I::AccountDataTooSmall => B::AccountDataTooSmall,
        I::InsufficientFunds => B::InsufficientFunds,
        I::IncorrectProgramId => B::IncorrectProgramId,
        I::MissingRequiredSignature => B::MissingRequiredSignature,
        I::AccountAlreadyInitialized => B::AccountAlreadyInitialized,
        I::UninitializedAccount => B::UninitializedAccount,
        I::UnbalancedInstruction => B::UnbalancedInstruction,
        I::ModifiedProgramId => B::ModifiedProgramId,
        I::ExternalAccountLamportSpend => B::ExternalAccountLamportSpend,
        I::ExternalAccountDataModified => B::ExternalAccountDataModified,
        I::ReadonlyLamportChange => B::ReadonlyLamportChange,
        I::ReadonlyDataModified => B::ReadonlyDataModified,
        I::DuplicateAccountIndex => B::DuplicateAccountIndex,
        I::ExecutableModified => B::ExecutableModified,
        I::RentEpochModified => B::RentEpochModified,
        I::NotEnoughAccountKeys => B::NotEnoughAccountKeys,
        I::AccountDataSizeChanged => B::AccountDataSizeChanged,
        I::AccountNotExecutable => B::AccountNotExecutable,
        I::AccountBorrowFailed => B::AccountBorrowFailed,
        I::AccountBorrowOutstanding => B::AccountBorrowOutstanding,
        I::DuplicateAccountOutOfSync => B::DuplicateAccountOutOfSync,
        I::InvalidError => B::InvalidError,
        I::ExecutableDataModified => B::ExecutableDataModified,
        I::ExecutableLamportChange => B::ExecutableLamportChange,
        I::ExecutableAccountNotRentExempt => B::ExecutableAccountNotRentExempt,
        I::UnsupportedProgramId => B::UnsupportedProgramId,
        I::CallDepth => B::CallDepth,
        I::MissingAccount => B::MissingAccount,
        I::ReentrancyNotAllowed => B::ReentrancyNotAllowed,
        I::MaxSeedLengthExceeded => B::MaxSeedLengthExceeded,
        I::InvalidSeeds => B::InvalidSeeds,
        I::InvalidRealloc => B::InvalidRealloc,
        I::ComputationalBudgetExceeded => B::ComputationalBudgetExceeded,
        I::PrivilegeEscalation => B::PrivilegeEscalation,
        I::ProgramEnvironmentSetupFailure => B::ProgramEnvironmentSetupFailure,
        I::ProgramFailedToComplete => B::ProgramFailedToComplete,
        I::ProgramFailedToCompile => B::ProgramFailedToCompile,
        I::Immutable => B::Immutable,
        I::IncorrectAuthority => B::IncorrectAuthority,
        I::BorshIoError(_) => B::BorshIoError,
        I::AccountNotRentExempt => B::AccountNotRentExempt,
        I::InvalidAccountOwner => B::InvalidAccountOwner,
        I::ArithmeticOverflow => B::ArithmeticOverflow,
        I::UnsupportedSysvar => B::UnsupportedSysvar,
        I::IllegalOwner => B::IllegalOwner,
        I::MaxAccountsDataAllocationsExceeded => B::MaxAccountsDataAllocationsExceeded,
        I::MaxAccountsExceeded => B::MaxAccountsExceeded,
        I::MaxInstructionTraceLengthExceeded => B::MaxInstructionTraceLengthExceeded,
        I::BuiltinProgramsMustConsumeComputeUnits => B::BuiltinProgramsMustConsumeComputeUnits,
        I::Custom(_) => return Err(Error::Validation("custom error mapping mismatch".into())),
    })
}

fn read_validated<T: serde::de::DeserializeOwned + Validate>(path: PathBuf) -> Result<T> {
    parse_validated(&fs::read(path)?)
}

fn verify_file_hash(path: &Path, expected: &str, label: &str) -> Result<()> {
    verify_bytes_hash(&fs::read(path)?, expected, label)
}

fn verify_bytes_hash(bytes: &[u8], expected: &str, label: &str) -> Result<()> {
    if digest(bytes) != expected {
        return Err(Error::Validation(format!("{label} SHA-256 mismatch")));
    }
    Ok(())
}

fn account_data(vm: &LiteSVM, key: &Pubkey, label: &str) -> Result<Vec<u8>> {
    vm.get_account(key)
        .map(|account| account.data)
        .ok_or_else(|| Error::Validation(format!("missing {label} account")))
}

fn pubkey(value: &str) -> Result<Pubkey> {
    Pubkey::from_str(value).map_err(|_| Error::Validation("invalid public key".into()))
}

fn decimal_u64(value: &str, label: &str) -> Result<u64> {
    value
        .parse()
        .map_err(|_| Error::Validation(format!("invalid {label}")))
}

fn digest(bytes: &[u8]) -> String {
    hash::hex(&hash::sha256(bytes))
}
