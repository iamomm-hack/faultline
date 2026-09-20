use std::{collections::BTreeSet, str::FromStr};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256};
use solana_sdk::{
    pubkey::Pubkey,
    signature::{keypair_from_seed, Signer},
};

use crate::{canonical, hash, Error, Result};

pub const CANONICALIZATION: &str = "faultline.canonical-json.v1";
pub const TREASURY_PROGRAM_ID: &str = "46zDmEZAYrpwi3k6FsKFf1rPWZDbZEKM21SFzMKzb1a4";
pub const TOKEN_PROGRAM_ID: &str = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
pub const SYSTEM_PROGRAM_ID: &str = "11111111111111111111111111111111";

pub trait Validate {
    fn validate(&self) -> Result<()>;
}

pub fn parse_validated<T: DeserializeOwned + Validate>(bytes: &[u8]) -> Result<T> {
    let value: T = canonical::parse_typed(bytes)?;
    value.validate()?;
    Ok(value)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Toolchain {
    pub solana_cli: String,
    pub cargo_build_sbf: String,
    pub platform_tools: String,
    pub anchor_crates: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BuildManifest {
    pub schema: String,
    pub canonicalization: String,
    pub program: String,
    pub program_id: String,
    pub build: String,
    pub cargo_features: Vec<String>,
    pub artifact_path: String,
    pub executable_sha256: String,
    pub toolchain: Toolchain,
}

impl Validate for BuildManifest {
    fn validate(&self) -> Result<()> {
        exact(&self.schema, "faultline.build.v1", "build.schema")?;
        common(&self.canonicalization)?;
        exact(&self.program, "faultline_treasury", "build.program")?;
        exact(&self.program_id, TREASURY_PROGRAM_ID, "build.program_id")?;
        public_key(&self.program_id)?;
        if !matches!(self.build.as_str(), "v2" | "v3") {
            return invalid("build.build");
        }
        if self.cargo_features != [self.build.clone()] {
            return invalid("build.cargo_features");
        }
        repository_path(&self.artifact_path)?;
        sha256_hex(&self.executable_sha256)?;
        exact(
            &self.toolchain.solana_cli,
            "solana-cli 1.18.10 (src:a093e239; feat:3469865029, client:Agave)",
            "toolchain.solana_cli",
        )?;
        exact(
            &self.toolchain.cargo_build_sbf,
            "solana-cargo-build-sbf 1.18.10",
            "toolchain.cargo_build_sbf",
        )?;
        exact(
            &self.toolchain.platform_tools,
            "v1.41",
            "toolchain.platform_tools",
        )?;
        exact(
            &self.toolchain.anchor_crates,
            "0.30.1",
            "toolchain.anchor_crates",
        )
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunnerLimits {
    pub max_transactions: u32,
    pub max_instructions_per_transaction: u32,
    pub max_accounts_per_instruction: u32,
    pub max_instruction_data_bytes: u32,
    pub max_compute_units_per_transaction: u32,
    pub max_manifest_bytes: u32,
    pub max_trace_bytes: u32,
    pub max_fixture_bytes: u32,
    pub max_output_bytes: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunnerManifest {
    pub schema: String,
    pub canonicalization: String,
    pub engine: String,
    pub engine_version: String,
    pub engine_source_commit: String,
    pub solana_runtime: String,
    pub feature_set: String,
    pub sigverify: bool,
    pub clock_mode: String,
    pub recent_blockhash_mode: String,
    pub token_program: String,
    pub token_program_bundle: String,
    pub allowed_external_programs: Vec<String>,
    pub limits: RunnerLimits,
}

impl Validate for RunnerManifest {
    fn validate(&self) -> Result<()> {
        exact(&self.schema, "faultline.runner.v1", "runner.schema")?;
        common(&self.canonicalization)?;
        exact(&self.engine, "litesvm", "runner.engine")?;
        exact(&self.engine_version, "0.1.0", "runner.engine_version")?;
        exact(
            &self.engine_source_commit,
            "5cda1d2dcfae16714a6ff808b58f0c087b21bd42",
            "runner.engine_source_commit",
        )?;
        exact(&self.solana_runtime, "1.18.22", "runner.solana_runtime")?;
        exact(
            &self.feature_set,
            "litesvm-0.1.0-all-enabled",
            "runner.feature_set",
        )?;
        if !self.sigverify {
            return invalid("runner.sigverify");
        }
        exact(&self.clock_mode, "fixture", "runner.clock_mode")?;
        exact(
            &self.recent_blockhash_mode,
            "runner-deterministic",
            "runner.recent_blockhash_mode",
        )?;
        exact(
            &self.token_program,
            TOKEN_PROGRAM_ID,
            "runner.token_program",
        )?;
        public_key(&self.token_program)?;
        exact(
            &self.token_program_bundle,
            "spl-token-3.5.0",
            "runner.token_program_bundle",
        )?;
        if self.allowed_external_programs != [TOKEN_PROGRAM_ID] {
            return invalid("runner.allowed_external_programs");
        }
        let l = &self.limits;
        if (
            l.max_transactions,
            l.max_instructions_per_transaction,
            l.max_accounts_per_instruction,
            l.max_instruction_data_bytes,
            l.max_compute_units_per_transaction,
            l.max_manifest_bytes,
            l.max_trace_bytes,
            l.max_fixture_bytes,
            l.max_output_bytes,
        ) != (
            32, 16, 64, 10_240, 1_400_000, 1_048_576, 2_097_152, 10_485_760, 8_388_608,
        ) {
            return invalid("runner.limits");
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Clock {
    pub slot: String,
    pub unix_timestamp: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FixtureProgram {
    pub kind: String,
    pub alias: String,
    pub program_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bundle_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artifact_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executable_sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_crate: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_crate_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_crate_sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_member_path: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SyntheticAccount {
    pub alias: String,
    pub pubkey: String,
    pub owner: String,
    pub lamports: String,
    pub executable: bool,
    pub rent_epoch: String,
    pub data_base64: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FixtureSigner {
    pub alias: String,
    pub pubkey: String,
    pub lamports: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InitialState {
    pub original_admin: String,
    pub treasury_state: String,
    pub treasury_vault: String,
    pub attacker_token_account: String,
    pub payment_mint: String,
    pub mint_decimals: u8,
    pub treasury_vault_base_units: String,
    pub attacker_base_units: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RawTransaction {
    pub step: u32,
    pub label: String,
    pub recent_blockhash_mode: String,
    pub signer_aliases: Vec<String>,
    pub instructions: Vec<RawInstruction>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RawInstruction {
    pub program_id_ref: String,
    pub instruction: String,
    pub data_base64: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub amount_base_units: Option<String>,
    pub accounts: Vec<RawInstructionAccount>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RawInstructionAccount {
    #[serde(rename = "ref")]
    pub reference: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    pub is_signer: bool,
    pub is_writable: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FixtureManifest {
    pub schema: String,
    pub canonicalization: String,
    pub fixture_id: String,
    pub base_slot: String,
    pub clock: Clock,
    pub programs: Vec<FixtureProgram>,
    pub accounts: Vec<SyntheticAccount>,
    pub signers: Vec<FixtureSigner>,
    pub setup_transactions: Vec<RawTransaction>,
    pub initial_state: InitialState,
}

impl Validate for FixtureManifest {
    fn validate(&self) -> Result<()> {
        exact(&self.schema, "faultline.fixture.v1", "fixture.schema")?;
        common(&self.canonicalization)?;
        exact(&self.fixture_id, "treasury-v1", "fixture.fixture_id")?;
        exact(&self.base_slot, "1", "fixture.base_slot")?;
        exact(&self.clock.slot, "1", "fixture.clock.slot")?;
        exact(
            &self.clock.unix_timestamp,
            "0",
            "fixture.clock.unix_timestamp",
        )?;
        if !self.setup_transactions.is_empty() {
            return invalid("fixture.setup_transactions");
        }
        if self.programs.len() != 2 || !is_sorted_unique(&self.programs, |p| &p.alias) {
            return invalid("fixture.programs ordering");
        }
        validate_programs(&self.programs)?;
        if self.accounts.len() != 4 || !is_sorted_unique(&self.accounts, |a| &a.alias) {
            return invalid("fixture.accounts ordering");
        }
        if self.signers.len() != 3 || !is_sorted_unique(&self.signers, |s| &s.alias) {
            return invalid("fixture.signers ordering");
        }
        for signer in &self.signers {
            nonempty(&signer.alias, "signer.alias")?;
            public_key(&signer.pubkey)?;
            exact(&signer.lamports, "10000000000", "signer.lamports")?;
            let expected = derived_key("FAULTLINE_TEST_SIGNER_V1", &signer.alias)?;
            exact(&signer.pubkey, &expected, "signer.pubkey derivation")?;
        }
        let expected_signers = [
            ("attacker", "Dvci5BTD5CkwYCQh6pC6UumLWF9LHSinJ5doS8PS9hV6"),
            (
                "treasury-admin",
                "564Gpg3mVA7LwcW7hVQkeATttbaRRMTntp9eV2AGNpbd",
            ),
            ("user", "58aVWrJhcixCdUrm8wVdfUVZiC5Y7QzpFQuoQbJHMV4i"),
        ];
        for (signer, expected) in self.signers.iter().zip(expected_signers) {
            exact(&signer.alias, expected.0, "fixture.signer alias")?;
            exact(&signer.pubkey, expected.1, "fixture.signer pubkey")?;
        }
        validate_initial_state(&self.initial_state)?;
        let expected_accounts = synthetic_accounts()?;
        for (actual, expected) in self.accounts.iter().zip(expected_accounts.iter()) {
            if canonical::serialize_typed(actual)? != canonical::serialize_typed(expected)? {
                return invalid(&format!("fixture account {} mismatch", expected.alias));
            }
        }
        let mut public_keys = BTreeSet::new();
        for account in &self.accounts {
            if !public_keys.insert(&account.pubkey) {
                return invalid("duplicate fixture account public key");
            }
            canonical_base64(&account.data_base64)?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MachineEvaluator {
    #[serde(rename = "type")]
    pub evaluator_type: String,
    pub version: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrackedTreasuryAccount {
    pub fixture_account_ref: String,
    pub state_account_type: String,
    pub vault_field: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AdminAuthoritySource {
    pub kind: String,
    pub field: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AllowedOutflowCondition {
    pub operation: String,
    pub required_authority: String,
    pub required_signature: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InvariantLimits {
    pub max_transactions: u32,
    pub token_program: String,
    pub amount_encoding: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InvariantManifest {
    pub schema: String,
    pub canonicalization: String,
    pub invariant_id: String,
    pub version: u32,
    pub name: String,
    pub statement: String,
    pub machine_evaluator: MachineEvaluator,
    pub tracked_treasury_account: TrackedTreasuryAccount,
    pub admin_authority_source: AdminAuthoritySource,
    pub allowed_outflow_conditions: Vec<AllowedOutflowCondition>,
    pub pre_state_selector: String,
    pub post_state_selector: String,
    pub violation_relation: String,
    pub semantic_rule: String,
    pub supported_trace_schema: String,
    pub limits: InvariantLimits,
    pub limitations: Vec<String>,
}

impl Validate for InvariantManifest {
    fn validate(&self) -> Result<()> {
        exact(&self.schema, "faultline.invariant.v1", "invariant.schema")?;
        common(&self.canonicalization)?;
        exact(&self.invariant_id, "AUTH-001", "invariant.id")?;
        if self.version != 1 {
            return invalid("invariant.version");
        }
        exact(
            &self.name,
            "Unauthorized treasury token outflow is forbidden",
            "invariant.name",
        )?;
        exact(
            &self.statement,
            "A non-admin signer must never cause the tracked treasury token balance to decrease.",
            "invariant.statement",
        )?;
        exact(
            &self.machine_evaluator.evaluator_type,
            "unauthorized_token_outflow_v1",
            "invariant.machine_evaluator.type",
        )?;
        if self.machine_evaluator.version != 1 {
            return invalid("invariant.machine_evaluator.version");
        }
        exact(
            &self.tracked_treasury_account.fixture_account_ref,
            "treasury_pda",
            "tracked_treasury_account.fixture_account_ref",
        )?;
        exact(
            &self.tracked_treasury_account.state_account_type,
            "TreasuryState",
            "tracked_treasury_account.state_account_type",
        )?;
        exact(
            &self.tracked_treasury_account.vault_field,
            "vault_token_account",
            "tracked_treasury_account.vault_field",
        )?;
        exact(
            &self.admin_authority_source.kind,
            "pre_state_treasury_admin",
            "admin_authority_source.kind",
        )?;
        exact(
            &self.admin_authority_source.field,
            "TreasuryState.admin",
            "admin_authority_source.field",
        )?;
        if self.allowed_outflow_conditions.len() != 2 {
            return invalid("allowed_outflow_conditions");
        }
        for (condition, operation) in self
            .allowed_outflow_conditions
            .iter()
            .zip(["admin_withdraw", "migrate_authority"])
        {
            exact(
                &condition.operation,
                operation,
                "allowed_outflow_conditions.operation",
            )?;
            exact(
                &condition.required_authority,
                "original_admin",
                "allowed_outflow_conditions.required_authority",
            )?;
            if !condition.required_signature {
                return invalid("allowed_outflow_conditions.required_signature");
            }
        }
        exact(
            &self.pre_state_selector,
            "treasury_vault.token_balance",
            "pre_state_selector",
        )?;
        exact(
            &self.post_state_selector,
            "treasury_vault.token_balance",
            "post_state_selector",
        )?;
        exact(&self.violation_relation, "if_no_valid_original_admin_authorization_then_post_balance_must_be_greater_than_or_equal_to_pre_balance", "violation_relation")?;
        exact(&self.semantic_rule, "Let original_admin be TreasuryState.admin in the captured pre-state. If no transaction in the trace contains a valid authorization from original_admin for the relevant migration or withdrawal operation, then post_treasury_vault_balance >= pre_treasury_vault_balance. A trace cannot satisfy authorization by first corrupting TreasuryState.admin.", "semantic_rule")?;
        exact(
            &self.supported_trace_schema,
            "faultline.trace.v1",
            "supported_trace_schema",
        )?;
        if self.limits.max_transactions != 32 {
            return invalid("invariant.limits.max_transactions");
        }
        exact(
            &self.limits.token_program,
            "spl-token-v3-tokenkeg",
            "invariant.limits.token_program",
        )?;
        exact(
            &self.limits.amount_encoding,
            "u64_base_units",
            "invariant.limits.amount_encoding",
        )?;
        let limitations = [
            "Milestone 2 defines the evaluator contract and canonical policy but does not implement the verifier quorum or generic replay daemon.",
            "Only the configured fixture treasury and Tokenkeg mint are in scope.",
            "Token-2022 extensions, transfer fees, confidential balances, rebasing assets, and oracle-dependent policies are out of scope.",
        ];
        if self.limitations.iter().map(String::as_str).ne(limitations) {
            return invalid("invariant.limitations");
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TraceCanonicalization {
    pub encoding: String,
    pub json: String,
    pub instruction_data: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreStateSelectors {
    pub original_admin: String,
    pub treasury_vault_balance: String,
    pub attacker_balance: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExpectedViolation {
    pub selector: String,
    pub relation: String,
    pub pre_balance_base_units: String,
    pub post_balance_after_v2_base_units: String,
    pub attacker_post_balance_after_v2_base_units: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Trace {
    pub schema: String,
    pub trace_id: String,
    pub invariant_id: String,
    pub target_version: String,
    pub fixture: String,
    pub canonicalization: TraceCanonicalization,
    pub signer_aliases: Vec<String>,
    pub pre_state_selectors: PreStateSelectors,
    pub transactions: Vec<RawTransaction>,
    pub expected_violation: ExpectedViolation,
    pub safety_notes: Vec<String>,
}

impl Validate for Trace {
    fn validate(&self) -> Result<()> {
        exact(&self.schema, "faultline.trace.v1", "trace.schema")?;
        exact(
            &self.trace_id,
            "auth-001-v2-authority-takeover",
            "trace.trace_id",
        )?;
        exact(&self.invariant_id, "AUTH-001", "trace.invariant_id")?;
        exact(&self.target_version, "v2", "trace.target_version")?;
        exact(&self.fixture, "treasury-v1", "trace.fixture")?;
        exact(
            &self.canonicalization.encoding,
            "utf8",
            "trace.canonicalization.encoding",
        )?;
        exact(
            &self.canonicalization.json,
            "sorted_keys_no_insignificant_whitespace_for_hashing",
            "trace.canonicalization.json",
        )?;
        exact(
            &self.canonicalization.instruction_data,
            "anchor_discriminator_plus_borsh_args_base64",
            "trace.canonicalization.instruction_data",
        )?;
        if self.signer_aliases.is_empty()
            || self.signer_aliases.len() > 64
            || !strictly_sorted(&self.signer_aliases)
            || self
                .signer_aliases
                .iter()
                .any(|alias| !matches!(alias.as_str(), "attacker" | "treasury-admin" | "user"))
        {
            return invalid("trace.signer_aliases");
        }
        exact(
            &self.pre_state_selectors.original_admin,
            "treasury_state.admin",
            "pre_state_selectors.original_admin",
        )?;
        exact(
            &self.pre_state_selectors.treasury_vault_balance,
            "treasury_vault.token_balance",
            "pre_state_selectors.treasury_vault_balance",
        )?;
        exact(
            &self.pre_state_selectors.attacker_balance,
            "attacker_token_account.token_balance",
            "pre_state_selectors.attacker_balance",
        )?;
        if self.transactions.is_empty() || self.transactions.len() > 32 {
            return invalid("trace.transactions");
        }
        for (index, transaction) in self.transactions.iter().enumerate() {
            transaction.validate(index as u32 + 1)?;
        }
        let e = &self.expected_violation;
        exact(
            &e.selector,
            "treasury_vault.token_balance",
            "expected_violation.selector",
        )?;
        exact(
            &e.relation,
            "post_gte_pre_for_non_admin",
            "expected_violation.relation",
        )?;
        for value in [
            &e.pre_balance_base_units,
            &e.post_balance_after_v2_base_units,
            &e.attacker_post_balance_after_v2_base_units,
        ] {
            unsigned_decimal(value, u64::MAX)?;
        }
        if self.safety_notes.is_empty()
            || self.safety_notes.len() > 32
            || self.safety_notes.iter().any(String::is_empty)
        {
            return invalid("trace.safety_notes");
        }
        Ok(())
    }
}

impl RawTransaction {
    fn validate(&self, expected_step: u32) -> Result<()> {
        if self.step != expected_step || !(1..=32).contains(&self.step) {
            return invalid("transaction.step");
        }
        nonempty(&self.label, "transaction.label")?;
        exact(
            &self.recent_blockhash_mode,
            "runner",
            "transaction.recent_blockhash_mode",
        )?;
        if self.signer_aliases.len() > 64 || !strictly_sorted(&self.signer_aliases) {
            return invalid("transaction.signer_aliases");
        }
        if self
            .signer_aliases
            .iter()
            .any(|alias| !matches!(alias.as_str(), "attacker" | "treasury-admin" | "user"))
        {
            return invalid("transaction signer alias reference");
        }
        if self.instructions.is_empty() || self.instructions.len() > 16 {
            return invalid("transaction.instructions");
        }
        for instruction in &self.instructions {
            exact(
                &instruction.program_id_ref,
                "programs.faultline_treasury",
                "instruction.program_id_ref",
            )?;
            nonempty(&instruction.instruction, "instruction.instruction")?;
            if canonical_base64(&instruction.data_base64)?.len() > 10_240 {
                return invalid("instruction.data_base64 size");
            }
            if let Some(amount) = &instruction.amount_base_units {
                unsigned_decimal(amount, u64::MAX)?;
            }
            if instruction.accounts.is_empty() || instruction.accounts.len() > 64 {
                return invalid("instruction.accounts");
            }
            for account in &instruction.accounts {
                nonempty(&account.reference, "instruction.account.ref")?;
                if let Some(role) = &account.role {
                    nonempty(role, "instruction.account.role")?;
                }
                if !matches!(
                    account.reference.as_str(),
                    "treasury_pda"
                        | "attacker"
                        | "user"
                        | "treasury-admin"
                        | "treasury_vault"
                        | "attacker_token_account"
                        | "payment_mint"
                        | "spl_token"
                        | "programs.faultline_treasury"
                ) {
                    return invalid("instruction account reference");
                }
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayJob {
    pub schema: String,
    pub canonicalization: String,
    pub verification_round: String,
    pub proposal: String,
    pub invariant_account: String,
    pub trace_claim: String,
    pub candidate_buffer_hash: String,
    pub invariant_specification_hash: String,
    pub build_manifest_hash: String,
    pub runner_manifest_hash: String,
    pub fixture_manifest_hash: String,
    pub invariant_manifest_hash: String,
    pub trace_hash: String,
    pub target_program_id: String,
    pub candidate_executable_sha256: String,
    pub expected_invariant_id: String,
}

impl Validate for ReplayJob {
    fn validate(&self) -> Result<()> {
        exact(&self.schema, "faultline.replay-job.v1", "job.schema")?;
        common(&self.canonicalization)?;
        for key in [
            &self.verification_round,
            &self.proposal,
            &self.invariant_account,
            &self.trace_claim,
            &self.target_program_id,
        ] {
            public_key(key)?;
        }
        exact(
            &self.target_program_id,
            TREASURY_PROGRAM_ID,
            "job.target_program_id",
        )?;
        for digest in [
            &self.candidate_buffer_hash,
            &self.invariant_specification_hash,
            &self.build_manifest_hash,
            &self.runner_manifest_hash,
            &self.fixture_manifest_hash,
            &self.invariant_manifest_hash,
            &self.trace_hash,
            &self.candidate_executable_sha256,
        ] {
            sha256_hex(digest)?;
        }
        if self.candidate_buffer_hash != self.candidate_executable_sha256 {
            return invalid("job candidate hash binding");
        }
        exact(
            &self.expected_invariant_id,
            "AUTH-001",
            "job.expected_invariant_id",
        )
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum Classification {
    Preserved,
    Violated,
    InvalidEvidence,
    UnsupportedEnvironment,
    RunnerFault,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransactionStatus {
    Success,
    Error,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeErrorKind {
    Custom,
    Builtin,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RuntimeErrorCode {
    Custom(u32),
    Builtin(BuiltinInstructionError),
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum BuiltinInstructionError {
    GenericError,
    InvalidArgument,
    InvalidInstructionData,
    InvalidAccountData,
    AccountDataTooSmall,
    InsufficientFunds,
    IncorrectProgramId,
    MissingRequiredSignature,
    AccountAlreadyInitialized,
    UninitializedAccount,
    UnbalancedInstruction,
    ModifiedProgramId,
    ExternalAccountLamportSpend,
    ExternalAccountDataModified,
    ReadonlyLamportChange,
    ReadonlyDataModified,
    DuplicateAccountIndex,
    ExecutableModified,
    RentEpochModified,
    NotEnoughAccountKeys,
    AccountDataSizeChanged,
    AccountNotExecutable,
    AccountBorrowFailed,
    AccountBorrowOutstanding,
    DuplicateAccountOutOfSync,
    InvalidError,
    ExecutableDataModified,
    ExecutableLamportChange,
    ExecutableAccountNotRentExempt,
    UnsupportedProgramId,
    CallDepth,
    MissingAccount,
    ReentrancyNotAllowed,
    MaxSeedLengthExceeded,
    InvalidSeeds,
    InvalidRealloc,
    ComputationalBudgetExceeded,
    PrivilegeEscalation,
    ProgramEnvironmentSetupFailure,
    ProgramFailedToComplete,
    ProgramFailedToCompile,
    Immutable,
    IncorrectAuthority,
    BorshIoError,
    AccountNotRentExempt,
    InvalidAccountOwner,
    ArithmeticOverflow,
    UnsupportedSysvar,
    IllegalOwner,
    MaxAccountsDataAllocationsExceeded,
    MaxAccountsExceeded,
    MaxInstructionTraceLengthExceeded,
    BuiltinProgramsMustConsumeComputeUnits,
}

pub const BUILTIN_ERROR_SYMBOLS: [&str; 53] = [
    "GenericError",
    "InvalidArgument",
    "InvalidInstructionData",
    "InvalidAccountData",
    "AccountDataTooSmall",
    "InsufficientFunds",
    "IncorrectProgramId",
    "MissingRequiredSignature",
    "AccountAlreadyInitialized",
    "UninitializedAccount",
    "UnbalancedInstruction",
    "ModifiedProgramId",
    "ExternalAccountLamportSpend",
    "ExternalAccountDataModified",
    "ReadonlyLamportChange",
    "ReadonlyDataModified",
    "DuplicateAccountIndex",
    "ExecutableModified",
    "RentEpochModified",
    "NotEnoughAccountKeys",
    "AccountDataSizeChanged",
    "AccountNotExecutable",
    "AccountBorrowFailed",
    "AccountBorrowOutstanding",
    "DuplicateAccountOutOfSync",
    "InvalidError",
    "ExecutableDataModified",
    "ExecutableLamportChange",
    "ExecutableAccountNotRentExempt",
    "UnsupportedProgramId",
    "CallDepth",
    "MissingAccount",
    "ReentrancyNotAllowed",
    "MaxSeedLengthExceeded",
    "InvalidSeeds",
    "InvalidRealloc",
    "ComputationalBudgetExceeded",
    "PrivilegeEscalation",
    "ProgramEnvironmentSetupFailure",
    "ProgramFailedToComplete",
    "ProgramFailedToCompile",
    "Immutable",
    "IncorrectAuthority",
    "BorshIoError",
    "AccountNotRentExempt",
    "InvalidAccountOwner",
    "ArithmeticOverflow",
    "UnsupportedSysvar",
    "IllegalOwner",
    "MaxAccountsDataAllocationsExceeded",
    "MaxAccountsExceeded",
    "MaxInstructionTraceLengthExceeded",
    "BuiltinProgramsMustConsumeComputeUnits",
];

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StableRuntimeError {
    pub instruction_index: u16,
    pub kind: RuntimeErrorKind,
    pub code: RuntimeErrorCode,
}

impl StableRuntimeError {
    fn validate(&self) -> Result<()> {
        match (&self.kind, &self.code) {
            (RuntimeErrorKind::Custom, RuntimeErrorCode::Custom(_))
            | (RuntimeErrorKind::Builtin, RuntimeErrorCode::Builtin(_)) => Ok(()),
            _ => invalid("runtime error kind/code mismatch"),
        }
    }
}

impl Validate for StableRuntimeError {
    fn validate(&self) -> Result<()> {
        StableRuntimeError::validate(self)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransactionResult {
    pub index: u16,
    pub status: TransactionStatus,
    pub error: Option<StableRuntimeError>,
    pub compute_units: u32,
    pub return_data_sha256: Option<String>,
    pub logs_sha256: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StateHash {
    pub selector_id: String,
    pub sha256: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayReceipt {
    pub schema: String,
    pub canonicalization: String,
    pub replay_job_hash: String,
    pub build_manifest_hash: String,
    pub runner_manifest_hash: String,
    pub fixture_manifest_hash: String,
    pub invariant_manifest_hash: String,
    pub trace_hash: String,
    pub candidate_executable_sha256: String,
    pub engine: String,
    pub engine_version: String,
    pub engine_source_commit: String,
    pub solana_runtime: String,
    pub feature_set: String,
    pub transactions: Vec<TransactionResult>,
    pub pre_state_hashes: Vec<StateHash>,
    pub post_state_hashes: Vec<StateHash>,
    pub normalized_logs_sha256: String,
    pub classification: Classification,
    pub result_code: u32,
    pub total_compute_units: String,
}

impl Validate for ReplayReceipt {
    fn validate(&self) -> Result<()> {
        exact(
            &self.schema,
            "faultline.replay-receipt.v1",
            "receipt.schema",
        )?;
        common(&self.canonicalization)?;
        for digest in [
            &self.replay_job_hash,
            &self.build_manifest_hash,
            &self.runner_manifest_hash,
            &self.fixture_manifest_hash,
            &self.invariant_manifest_hash,
            &self.trace_hash,
            &self.candidate_executable_sha256,
            &self.normalized_logs_sha256,
        ] {
            sha256_hex(digest)?;
        }
        exact(&self.engine, "litesvm", "receipt.engine")?;
        exact(&self.engine_version, "0.1.0", "receipt.engine_version")?;
        exact(
            &self.engine_source_commit,
            "5cda1d2dcfae16714a6ff808b58f0c087b21bd42",
            "receipt.engine_source_commit",
        )?;
        exact(&self.solana_runtime, "1.18.22", "receipt.solana_runtime")?;
        exact(
            &self.feature_set,
            "litesvm-0.1.0-all-enabled",
            "receipt.feature_set",
        )?;
        if self.transactions.is_empty() || self.transactions.len() > 32 {
            return invalid("receipt.transactions");
        }
        for (index, tx) in self.transactions.iter().enumerate() {
            if tx.index as usize != index || tx.compute_units > 1_400_000 {
                return invalid("receipt transaction bounds");
            }
            match (&tx.status, &tx.error) {
                (TransactionStatus::Success, None) => {}
                (TransactionStatus::Error, Some(error)) => error.validate()?,
                _ => return invalid("receipt transaction status/error"),
            }
            if let Some(digest) = &tx.return_data_sha256 {
                sha256_hex(digest)?;
            }
            sha256_hex(&tx.logs_sha256)?;
        }
        validate_state_hashes(&self.pre_state_hashes)?;
        validate_state_hashes(&self.post_state_hashes)?;
        match (&self.classification, self.result_code) {
            (Classification::Preserved, 0) | (Classification::Violated, 1) => {}
            _ => return invalid("receipt classification/result_code"),
        }
        unsigned_decimal(&self.total_compute_units, u64::MAX)?;
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AttestationIntent {
    pub verification_round: String,
    pub proposal: String,
    pub invariant_account: String,
    pub trace_claim: String,
    pub verifier_pubkey: String,
    pub verdict_u8: u8,
    pub receipt_hash: String,
    pub replay_result_commitment: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkerOutput {
    pub schema: String,
    pub canonicalization: String,
    pub coordinator_nonce: String,
    pub worker_ordinal: u8,
    pub verifier_pubkey: String,
    pub replay_job_hash: String,
    pub classification: Classification,
    pub result_code: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub receipt_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verdict_u8: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replay_result_commitment: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attestation_intent: Option<AttestationIntent>,
    pub process_peak_memory_bytes: String,
    pub elapsed_milliseconds: String,
}

impl Validate for WorkerOutput {
    fn validate(&self) -> Result<()> {
        exact(&self.schema, "faultline.worker-output.v1", "worker.schema")?;
        common(&self.canonicalization)?;
        sha256_hex(&self.coordinator_nonce)?;
        if self.worker_ordinal > 2 {
            return invalid("worker.worker_ordinal");
        }
        public_key(&self.verifier_pubkey)?;
        sha256_hex(&self.replay_job_hash)?;
        unsigned_decimal(&self.process_peak_memory_bytes, u64::MAX)?;
        unsigned_decimal(&self.elapsed_milliseconds, u64::MAX)?;
        let eligible = match (&self.classification, self.result_code) {
            (Classification::Preserved, 0) => Some(0),
            (Classification::Violated, 1) => Some(1),
            (Classification::InvalidEvidence, 0x0001_0001..=0x0001_0009)
            | (Classification::UnsupportedEnvironment, 0x0002_0001..=0x0002_0005)
            | (Classification::RunnerFault, 0x0003_0001..=0x0003_0007) => None,
            _ => return invalid("worker classification/result_code"),
        };
        match eligible {
            Some(verdict) => {
                let receipt = self
                    .receipt_hash
                    .as_ref()
                    .ok_or_else(|| Error::Validation("missing eligible receipt_hash".into()))?;
                let commitment = self
                    .replay_result_commitment
                    .as_ref()
                    .ok_or_else(|| Error::Validation("missing eligible commitment".into()))?;
                sha256_hex(receipt)?;
                sha256_hex(commitment)?;
                if self.verdict_u8 != Some(verdict) {
                    return invalid("worker.verdict_u8");
                }
                let intent = self
                    .attestation_intent
                    .as_ref()
                    .ok_or_else(|| Error::Validation("missing attestation intent".into()))?;
                for key in [
                    &intent.verification_round,
                    &intent.proposal,
                    &intent.invariant_account,
                    &intent.trace_claim,
                    &intent.verifier_pubkey,
                ] {
                    public_key(key)?;
                }
                if intent.verifier_pubkey != self.verifier_pubkey
                    || intent.verdict_u8 != verdict
                    || intent.receipt_hash != *receipt
                    || intent.replay_result_commitment != *commitment
                {
                    return invalid("worker attestation binding");
                }
            }
            None => {
                if self.receipt_hash.is_some()
                    || self.verdict_u8.is_some()
                    || self.replay_result_commitment.is_some()
                    || self.attestation_intent.is_some()
                {
                    return invalid("ineligible worker fields");
                }
            }
        }
        Ok(())
    }
}

fn validate_programs(programs: &[FixtureProgram]) -> Result<()> {
    let target = &programs[0];
    exact(&target.kind, "target", "fixture.program.kind")?;
    exact(&target.alias, "faultline_treasury", "fixture.program.alias")?;
    exact(
        &target.program_id,
        TREASURY_PROGRAM_ID,
        "fixture.program.program_id",
    )?;
    if target.bundle_name.is_some()
        || target.artifact_path.is_some()
        || target.executable_sha256.is_some()
        || target.source_crate.is_some()
        || target.source_crate_version.is_some()
        || target.source_crate_sha256.is_some()
        || target.source_member_path.is_some()
    {
        return invalid("fixture target candidate/provenance fields");
    }
    let bundled = &programs[1];
    exact(&bundled.kind, "bundled", "fixture.program.kind")?;
    exact(&bundled.alias, "spl_token", "fixture.program.alias")?;
    exact(
        &bundled.program_id,
        TOKEN_PROGRAM_ID,
        "fixture.program.program_id",
    )?;
    exact_option(&bundled.bundle_name, "spl-token-3.5.0", "bundle_name")?;
    exact_option(
        &bundled.artifact_path,
        "manifests/programs/spl-token-3.5.0.so",
        "artifact_path",
    )?;
    exact_option(
        &bundled.executable_sha256,
        "18264f491c7e0ad056dd36f42f8de6d1fedf9f044d1f521e714b4dc6b61594b6",
        "executable_sha256",
    )?;
    exact_option(&bundled.source_crate, "litesvm", "source_crate")?;
    exact_option(
        &bundled.source_crate_version,
        "0.1.0",
        "source_crate_version",
    )?;
    exact_option(
        &bundled.source_crate_sha256,
        "0963e4df461a414763f0348b73eb284a734534a53558fcae35f984a0c16a6e6c",
        "source_crate_sha256",
    )?;
    exact_option(
        &bundled.source_member_path,
        "src/spl/programs/spl_token-3.5.0.so",
        "source_member_path",
    )?;
    Ok(())
}

fn validate_initial_state(state: &InitialState) -> Result<()> {
    let expected = [
        (
            &state.original_admin,
            "564Gpg3mVA7LwcW7hVQkeATttbaRRMTntp9eV2AGNpbd",
        ),
        (
            &state.treasury_state,
            "EiRj7VptpwZTy2uRMbHeqCU45fmbPFd4FrGGbQ2MZfi2",
        ),
        (
            &state.treasury_vault,
            "E1wvHDQMjFVw8hZgdsLzo5tXqSttrvHB56Du1oD1roDY",
        ),
        (
            &state.attacker_token_account,
            "3DUXuoksqpratbjmysGEKQQUUb1mZRR4y3GWNjSiNTPP",
        ),
        (
            &state.payment_mint,
            "2cmmKxvd7YMFYhfqSFb45Q7zVYyhqsgoswxbvVeThgkG",
        ),
    ];
    for (value, expected) in expected {
        public_key(value)?;
        exact(value, expected, "initial_state pubkey")?;
    }
    if state.mint_decimals != 6 {
        return invalid("initial_state.mint_decimals");
    }
    exact(
        &state.treasury_vault_base_units,
        "1000000000",
        "initial_state.treasury_vault_base_units",
    )?;
    exact(
        &state.attacker_base_units,
        "0",
        "initial_state.attacker_base_units",
    )
}

pub fn synthetic_accounts() -> Result<Vec<SyntheticAccount>> {
    let mint = derived_key("FAULTLINE_TEST_ACCOUNT_V1", "payment-mint")?;
    let vault = derived_key("FAULTLINE_TEST_ACCOUNT_V1", "treasury-vault-token")?;
    let attacker_token = derived_key("FAULTLINE_TEST_ACCOUNT_V1", "attacker-token")?;
    exact(
        &mint,
        "2cmmKxvd7YMFYhfqSFb45Q7zVYyhqsgoswxbvVeThgkG",
        "payment mint derivation",
    )?;
    exact(
        &vault,
        "E1wvHDQMjFVw8hZgdsLzo5tXqSttrvHB56Du1oD1roDY",
        "vault derivation",
    )?;
    exact(
        &attacker_token,
        "3DUXuoksqpratbjmysGEKQQUUb1mZRR4y3GWNjSiNTPP",
        "attacker token derivation",
    )?;
    let treasury_program = Pubkey::from_str(TREASURY_PROGRAM_ID)
        .map_err(|_| Error::Validation("treasury program id".into()))?;
    let (pda, bump) = Pubkey::find_program_address(&[b"treasury"], &treasury_program);
    if bump != 255 {
        return invalid("treasury PDA bump");
    }
    exact(
        &pda.to_string(),
        "EiRj7VptpwZTy2uRMbHeqCU45fmbPFd4FrGGbQ2MZfi2",
        "treasury PDA",
    )?;
    let mint_bytes = mint_data();
    let vault_bytes = token_account_data(&mint, &pda.to_string(), 1_000_000_000)?;
    let attacker_bytes =
        token_account_data(&mint, "Dvci5BTD5CkwYCQh6pC6UumLWF9LHSinJ5doS8PS9hV6", 0)?;
    let treasury_bytes = treasury_state_data(&pda.to_string(), &vault, &mint)?;
    let mut accounts = vec![
        account(
            "attacker_token_account",
            &attacker_token,
            TOKEN_PROGRAM_ID,
            "2039280",
            &attacker_bytes,
        ),
        account(
            "payment_mint",
            &mint,
            TOKEN_PROGRAM_ID,
            "1461600",
            &mint_bytes,
        ),
        account(
            "treasury_pda",
            &pda.to_string(),
            TREASURY_PROGRAM_ID,
            "2352480",
            &treasury_bytes,
        ),
        account(
            "treasury_vault",
            &vault,
            TOKEN_PROGRAM_ID,
            "2039280",
            &vault_bytes,
        ),
    ];
    accounts.sort_by(|a, b| a.alias.as_bytes().cmp(b.alias.as_bytes()));
    let expected = [
        (
            "attacker_token_account",
            165,
            "e094f0d1d58669afcf6f576d05c1acda6ffec11ca45d5feee8b0b1f68a4e737f",
        ),
        (
            "payment_mint",
            82,
            "e5871cb75e1a408fe8a3830c2b0c84abe831f86909d8d8c3cff2b4d0cd001846",
        ),
        (
            "treasury_pda",
            210,
            "c58208ee116dbc2140d342fb876f04a9aef1683c1de165c2b3a9aba41fd4b155",
        ),
        (
            "treasury_vault",
            165,
            "d1801a802d583187730d51ea26a1aac2a1388de3d2ec24869b712a8c0643167f",
        ),
    ];
    for (account, (alias, length, digest)) in accounts.iter().zip(expected) {
        exact(&account.alias, alias, "synthetic account alias")?;
        let bytes = canonical_base64(&account.data_base64)?;
        if bytes.len() != length || hash::hex(&hash::sha256(&bytes)) != digest {
            return invalid(&format!("synthetic account payload {alias}"));
        }
    }
    Ok(accounts)
}

fn account(
    alias: &str,
    pubkey: &str,
    owner: &str,
    lamports: &str,
    data: &[u8],
) -> SyntheticAccount {
    SyntheticAccount {
        alias: alias.into(),
        pubkey: pubkey.into(),
        owner: owner.into(),
        lamports: lamports.into(),
        executable: false,
        rent_epoch: "0".into(),
        data_base64: BASE64.encode(data),
    }
}

fn mint_data() -> Vec<u8> {
    let mut data = vec![0_u8; 82];
    data[36..44].copy_from_slice(&1_000_000_000_u64.to_le_bytes());
    data[44] = 6;
    data[45] = 1;
    data
}

fn token_account_data(mint: &str, authority: &str, amount: u64) -> Result<Vec<u8>> {
    let mut data = vec![0_u8; 165];
    data[0..32].copy_from_slice(&pubkey_bytes(mint)?);
    data[32..64].copy_from_slice(&pubkey_bytes(authority)?);
    data[64..72].copy_from_slice(&amount.to_le_bytes());
    data[108] = 1;
    Ok(data)
}

fn treasury_state_data(_pda: &str, vault: &str, mint: &str) -> Result<Vec<u8>> {
    let mut data = vec![0_u8; 210];
    data[0..8].copy_from_slice(&[0xf0, 0x38, 0xe2, 0x9e, 0x8a, 0xf4, 0x4f, 0x9a]);
    data[8] = 1;
    data[9..41].copy_from_slice(&pubkey_bytes(
        "564Gpg3mVA7LwcW7hVQkeATttbaRRMTntp9eV2AGNpbd",
    )?);
    data[41..73].copy_from_slice(&pubkey_bytes(vault)?);
    data[73..81].copy_from_slice(&1_000_000_000_u64.to_le_bytes());
    data[81] = 255;
    data[82..114].copy_from_slice(&pubkey_bytes(mint)?);
    Ok(data)
}

pub fn derived_key(domain: &str, alias: &str) -> Result<String> {
    let mut hasher = Sha256::new();
    hasher.update(domain.as_bytes());
    hasher.update([0]);
    hasher.update(alias.as_bytes());
    let seed: [u8; 32] = hasher.finalize().into();
    let keypair = keypair_from_seed(&seed)
        .map_err(|error| Error::Validation(format!("key derivation: {error}")))?;
    Ok(keypair.pubkey().to_string())
}

fn validate_state_hashes(values: &[StateHash]) -> Result<()> {
    let selectors = [
        "attacker_balance",
        "original_admin",
        "treasury_vault_balance",
    ];
    if values.len() != selectors.len() {
        return invalid("state hash selector count");
    }
    for (value, selector) in values.iter().zip(selectors) {
        exact(&value.selector_id, selector, "state hash selector order")?;
        sha256_hex(&value.sha256)?;
    }
    Ok(())
}

fn public_key(value: &str) -> Result<()> {
    let decoded = bs58::decode(value)
        .into_vec()
        .map_err(|_| Error::Validation("invalid Base58 public key".into()))?;
    if decoded.len() != 32 || bs58::encode(&decoded).into_string() != value {
        return invalid("noncanonical public key");
    }
    Ok(())
}

fn pubkey_bytes(value: &str) -> Result<[u8; 32]> {
    public_key(value)?;
    let decoded = bs58::decode(value)
        .into_vec()
        .map_err(|_| Error::Validation("invalid public key".into()))?;
    decoded
        .try_into()
        .map_err(|_| Error::Validation("public key length".into()))
}

fn sha256_hex(value: &str) -> Result<()> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return invalid("invalid lowercase SHA-256");
    }
    Ok(())
}

fn canonical_base64(value: &str) -> Result<Vec<u8>> {
    let decoded = BASE64
        .decode(value)
        .map_err(|_| Error::Validation("invalid Base64".into()))?;
    if BASE64.encode(&decoded) != value {
        return invalid("noncanonical Base64");
    }
    Ok(decoded)
}

fn unsigned_decimal(value: &str, max: u64) -> Result<u64> {
    if value.is_empty()
        || (value.len() > 1 && value.starts_with('0'))
        || !value.bytes().all(|b| b.is_ascii_digit())
    {
        return invalid("noncanonical unsigned decimal string");
    }
    let parsed = value
        .parse::<u64>()
        .map_err(|_| Error::Validation("decimal out of range".into()))?;
    if parsed > max {
        return invalid("decimal out of range");
    }
    Ok(parsed)
}

fn repository_path(value: &str) -> Result<()> {
    if value.is_empty()
        || value.contains('\\')
        || value.contains(':')
        || value.starts_with('/')
        || value
            .split('/')
            .any(|part| part.is_empty() || matches!(part, "." | ".."))
    {
        return invalid("invalid repository-relative path");
    }
    Ok(())
}

fn is_sorted_unique<T, F>(values: &[T], key: F) -> bool
where
    F: Fn(&T) -> &String,
{
    values
        .windows(2)
        .all(|pair| key(&pair[0]).as_bytes() < key(&pair[1]).as_bytes())
}

fn strictly_sorted(values: &[String]) -> bool {
    values
        .windows(2)
        .all(|pair| pair[0].as_bytes() < pair[1].as_bytes())
}

fn common(value: &str) -> Result<()> {
    exact(value, CANONICALIZATION, "canonicalization")
}
fn nonempty(value: &str, field: &str) -> Result<()> {
    if value.is_empty() {
        invalid(field)
    } else {
        Ok(())
    }
}
fn exact(value: &str, expected: &str, field: &str) -> Result<()> {
    if value == expected {
        Ok(())
    } else {
        invalid(field)
    }
}
fn exact_option(value: &Option<String>, expected: &str, field: &str) -> Result<()> {
    match value {
        Some(value) => exact(value, expected, field),
        None => invalid(field),
    }
}
fn invalid<T>(message: &str) -> Result<T> {
    Err(Error::Validation(message.into()))
}
