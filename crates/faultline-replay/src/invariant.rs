use solana_sdk::pubkey::Pubkey;

use crate::{
    schema::{Classification, InvariantManifest, Validate},
    trace::NormalizedTrace,
    Error, Result,
};

pub const AUTH_001_PRESERVED: u32 = 0;
pub const AUTH_001_VIOLATED: u32 = 1;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Auth001PreState {
    pub original_admin: Pubkey,
    pub treasury_vault_balance: u64,
    pub attacker_balance: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Auth001PostState {
    pub treasury_vault_balance: u64,
    pub attacker_balance: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Auth001Verdict {
    pub classification: Classification,
    pub result_code: u32,
    pub original_admin_authorized: bool,
}

pub fn capture_pre_state(
    treasury_state_data: &[u8],
    treasury_vault_data: &[u8],
    attacker_token_data: &[u8],
) -> Result<Auth001PreState> {
    Ok(Auth001PreState {
        original_admin: treasury_admin(treasury_state_data)?,
        treasury_vault_balance: token_balance(treasury_vault_data)?,
        attacker_balance: token_balance(attacker_token_data)?,
    })
}

pub fn capture_post_state(
    treasury_vault_data: &[u8],
    attacker_token_data: &[u8],
) -> Result<Auth001PostState> {
    Ok(Auth001PostState {
        treasury_vault_balance: token_balance(treasury_vault_data)?,
        attacker_balance: token_balance(attacker_token_data)?,
    })
}

pub fn evaluate_auth_001(
    policy: &InvariantManifest,
    normalized_trace: &NormalizedTrace,
    pre: &Auth001PreState,
    post: &Auth001PostState,
) -> Result<Auth001Verdict> {
    policy.validate()?;
    let original_admin = pre.original_admin.to_string();
    let original_admin_authorized = normalized_trace.transactions.iter().any(|transaction| {
        transaction.instructions.iter().any(|instruction| {
            matches!(
                instruction.operation.as_str(),
                "migrate_authority" | "admin_withdraw"
            ) && instruction
                .accounts
                .iter()
                .any(|account| account.pubkey == original_admin && account.is_signer)
        })
    });

    if !original_admin_authorized && post.treasury_vault_balance < pre.treasury_vault_balance {
        Ok(Auth001Verdict {
            classification: Classification::Violated,
            result_code: AUTH_001_VIOLATED,
            original_admin_authorized,
        })
    } else {
        Ok(Auth001Verdict {
            classification: Classification::Preserved,
            result_code: AUTH_001_PRESERVED,
            original_admin_authorized,
        })
    }
}

fn treasury_admin(data: &[u8]) -> Result<Pubkey> {
    if data.len() != 210 || data[..8] != [0xf0, 0x38, 0xe2, 0x9e, 0x8a, 0xf4, 0x4f, 0x9a] {
        return Err(Error::Validation(
            "invalid TreasuryState account encoding".into(),
        ));
    }
    Ok(Pubkey::new_from_array(
        data[9..41]
            .try_into()
            .expect("TreasuryState length was checked"),
    ))
}

fn token_balance(data: &[u8]) -> Result<u64> {
    if data.len() != 165 || data[108] != 1 {
        return Err(Error::Validation(
            "invalid initialized SPL Token account encoding".into(),
        ));
    }
    Ok(u64::from_le_bytes(
        data[64..72]
            .try_into()
            .expect("token account length was checked"),
    ))
}
