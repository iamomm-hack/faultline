use std::collections::{BTreeMap, BTreeSet};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};

use crate::{
    canonical,
    schema::{FixtureManifest, Trace, Validate},
    Error, Result,
};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NormalizedTrace {
    pub transactions: Vec<NormalizedTransaction>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NormalizedTransaction {
    pub step: u32,
    pub recent_blockhash_mode: String,
    pub signer_pubkeys: Vec<String>,
    pub instructions: Vec<NormalizedInstruction>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NormalizedInstruction {
    pub program_id: String,
    pub operation: String,
    pub data_base64: String,
    pub accounts: Vec<NormalizedAccountMeta>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NormalizedAccountMeta {
    pub pubkey: String,
    pub is_signer: bool,
    pub is_writable: bool,
}

impl NormalizedTrace {
    pub fn canonical_bytes(&self) -> Result<Vec<u8>> {
        canonical::serialize_typed(self)
    }
}

pub fn normalize(trace: &Trace, fixture: &FixtureManifest) -> Result<NormalizedTrace> {
    trace.validate()?;
    fixture.validate()?;
    normalize_execution_fields(trace, fixture)
}

fn normalize_execution_fields(trace: &Trace, fixture: &FixtureManifest) -> Result<NormalizedTrace> {
    let signer_by_alias: BTreeMap<&str, &str> = fixture
        .signers
        .iter()
        .map(|signer| (signer.alias.as_str(), signer.pubkey.as_str()))
        .collect();
    let account_by_alias: BTreeMap<&str, &str> = fixture
        .accounts
        .iter()
        .map(|account| (account.alias.as_str(), account.pubkey.as_str()))
        .collect();
    let program_by_alias: BTreeMap<&str, &str> = fixture
        .programs
        .iter()
        .map(|program| (program.alias.as_str(), program.program_id.as_str()))
        .collect();
    let declared_trace_signers: BTreeSet<&str> =
        trace.signer_aliases.iter().map(String::as_str).collect();

    let mut transactions = Vec::with_capacity(trace.transactions.len());
    for transaction in &trace.transactions {
        if transaction.signer_aliases.is_empty() {
            return Err(Error::Validation(
                "replay transaction requires a deterministic fee payer".into(),
            ));
        }
        let transaction_signers: BTreeSet<&str> = transaction
            .signer_aliases
            .iter()
            .map(String::as_str)
            .collect();
        let mut signer_pubkeys = Vec::with_capacity(transaction.signer_aliases.len());
        for alias in &transaction.signer_aliases {
            if !declared_trace_signers.contains(alias.as_str()) {
                return Err(Error::Validation(format!(
                    "transaction signer {alias} is not declared by the trace"
                )));
            }
            signer_pubkeys.push(
                signer_by_alias
                    .get(alias.as_str())
                    .ok_or_else(|| {
                        Error::Validation(format!("unknown fixture signer alias {alias}"))
                    })?
                    .to_string(),
            );
        }

        let mut instructions = Vec::with_capacity(transaction.instructions.len());
        for instruction in &transaction.instructions {
            let alias = instruction
                .program_id_ref
                .strip_prefix("programs.")
                .ok_or_else(|| Error::Validation("invalid program reference prefix".into()))?;
            let program_id = program_by_alias
                .get(alias)
                .ok_or_else(|| Error::Validation(format!("unknown program alias {alias}")))?;
            if alias != "faultline_treasury" {
                return Err(Error::Validation(format!(
                    "unsupported top-level program alias {alias}"
                )));
            }

            let data = BASE64
                .decode(&instruction.data_base64)
                .map_err(|_| Error::Validation("invalid instruction Base64".into()))?;
            validate_operation_bytes(
                &instruction.instruction,
                &data,
                instruction.amount_base_units.as_deref(),
            )?;

            let mut accounts = Vec::with_capacity(instruction.accounts.len());
            for account in &instruction.accounts {
                let (pubkey, signer_alias) = if let Some(pubkey) =
                    account_by_alias.get(account.reference.as_str())
                {
                    (*pubkey, None)
                } else if let Some(pubkey) = signer_by_alias.get(account.reference.as_str()) {
                    (*pubkey, Some(account.reference.as_str()))
                } else if let Some(pubkey) = program_by_alias.get(account.reference.as_str()) {
                    (*pubkey, None)
                } else if let Some(program_alias) = account.reference.strip_prefix("programs.") {
                    (
                        *program_by_alias.get(program_alias).ok_or_else(|| {
                            Error::Validation(format!(
                                "unknown instruction account program {program_alias}"
                            ))
                        })?,
                        None,
                    )
                } else {
                    return Err(Error::Validation(format!(
                        "unknown instruction account reference {}",
                        account.reference
                    )));
                };

                if account.is_signer {
                    let signer_alias = signer_alias.ok_or_else(|| {
                        Error::Validation(format!(
                            "non-signer account {} requests signer privilege",
                            account.reference
                        ))
                    })?;
                    if !transaction_signers.contains(signer_alias) {
                        return Err(Error::Validation(format!(
                            "undeclared signer privilege for {signer_alias}"
                        )));
                    }
                }
                accounts.push(NormalizedAccountMeta {
                    pubkey: pubkey.to_string(),
                    is_signer: account.is_signer,
                    is_writable: account.is_writable,
                });
            }
            instructions.push(NormalizedInstruction {
                program_id: program_id.to_string(),
                operation: instruction.instruction.clone(),
                data_base64: BASE64.encode(data),
                accounts,
            });
        }
        transactions.push(NormalizedTransaction {
            step: transaction.step,
            recent_blockhash_mode: transaction.recent_blockhash_mode.clone(),
            signer_pubkeys,
            instructions,
        });
    }
    Ok(NormalizedTrace { transactions })
}

fn validate_operation_bytes(
    operation: &str,
    data: &[u8],
    declared_amount: Option<&str>,
) -> Result<()> {
    match operation {
        "migrate_authority" => {
            let expected = anchor_discriminator("migrate_authority");
            if data != expected.as_slice() || declared_amount.is_some() {
                return Err(Error::Validation(
                    "migrate_authority instruction bytes do not match the operation".into(),
                ));
            }
        }
        "admin_withdraw" => {
            if data.len() != 16 || data[..8] != anchor_discriminator("admin_withdraw") {
                return Err(Error::Validation(
                    "admin_withdraw instruction bytes do not match the operation".into(),
                ));
            }
            let amount = u64::from_le_bytes(
                data[8..16]
                    .try_into()
                    .expect("length checked immediately above"),
            );
            let amount = amount.to_string();
            if declared_amount != Some(amount.as_str()) {
                return Err(Error::Validation(
                    "admin_withdraw amount binding mismatch".into(),
                ));
            }
        }
        other => {
            return Err(Error::Validation(format!(
                "unsupported treasury operation {other}"
            )))
        }
    }
    Ok(())
}

fn anchor_discriminator(operation: &str) -> [u8; 8] {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(format!("global:{operation}").as_bytes());
    digest[..8]
        .try_into()
        .expect("SHA-256 always contains eight bytes")
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path};

    use base64::{engine::general_purpose::STANDARD as BASE64, Engine};

    use crate::{
        hash,
        invariant::{capture_post_state, capture_pre_state, evaluate_auth_001},
        schema::{parse_validated, FixtureManifest, InvariantManifest, Trace},
    };

    use super::normalize;

    fn root() -> &'static Path {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(Path::parent)
            .expect("replay crate is nested under the repository")
    }

    #[test]
    fn assertion_08_expected_metadata_is_not_execution_input() {
        let fixture: FixtureManifest =
            parse_validated(&fs::read(root().join("manifests/treasury-v1-fixture.json")).unwrap())
                .unwrap();
        let policy: InvariantManifest =
            parse_validated(&fs::read(root().join("manifests/auth-001-invariant.json")).unwrap())
                .unwrap();
        let trace: Trace = parse_validated(
            &fs::read(root().join("fixtures/exploits/auth-001-v2-authority-takeover.json"))
                .unwrap(),
        )
        .unwrap();
        let baseline = normalize(&trace, &fixture).unwrap();
        let mut descriptive = trace.clone();
        descriptive
            .expected_violation
            .post_balance_after_v2_base_units = "1".into();
        descriptive.safety_notes = vec!["different hash-bound review metadata".into()];
        for transaction in &mut descriptive.transactions {
            transaction.label = "different descriptive label".into();
            for instruction in &mut transaction.instructions {
                for account in &mut instruction.accounts {
                    account.role = Some("different descriptive role".into());
                }
            }
        }
        let descriptive_normalized = normalize(&descriptive, &fixture).unwrap();
        assert_eq!(baseline, descriptive_normalized);
        assert_ne!(
            hash::trace_hash(&trace).unwrap(),
            hash::trace_hash(&descriptive).unwrap()
        );

        let account = |alias: &str| {
            BASE64
                .decode(
                    &fixture
                        .accounts
                        .iter()
                        .find(|account| account.alias == alias)
                        .unwrap()
                        .data_base64,
                )
                .unwrap()
        };
        let treasury = account("treasury_pda");
        let vault = account("treasury_vault");
        let attacker = account("attacker_token_account");
        let pre = capture_pre_state(&treasury, &vault, &attacker).unwrap();
        let post = capture_post_state(&vault, &attacker).unwrap();
        assert_eq!(
            evaluate_auth_001(&policy, &baseline, &pre, &post).unwrap(),
            evaluate_auth_001(&policy, &descriptive_normalized, &pre, &post).unwrap()
        );
    }
}
