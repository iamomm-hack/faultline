use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};

#[cfg(not(any(feature = "v1", feature = "v2", feature = "v3")))]
compile_error!("faultline_treasury requires exactly one explicit build feature: v1, v2, or v3");
#[cfg(any(
    all(feature = "v1", feature = "v2"),
    all(feature = "v1", feature = "v3"),
    all(feature = "v2", feature = "v3")
))]
compile_error!(
    "faultline_treasury build features are mutually exclusive; choose only one of v1, v2, or v3"
);

#[cfg(feature = "v1")]
mod version_impl {
    include!("versions/v1.rs");
}
#[cfg(feature = "v2")]
mod version_impl {
    include!("versions/v2.rs");
}
#[cfg(feature = "v3")]
mod version_impl {
    include!("versions/v3.rs");
}

declare_id!("46zDmEZAYrpwi3k6FsKFf1rPWZDbZEKM21SFzMKzb1a4");

const TREASURY_SEED: &[u8] = b"treasury";
const TOKEN_PROGRAM_ID: Pubkey =
    anchor_lang::solana_program::pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_ACCOUNT_LEN: usize = 165;
const TOKEN_ACCOUNT_MINT_OFFSET: usize = 0;
const TOKEN_ACCOUNT_OWNER_OFFSET: usize = 32;
const TOKEN_ACCOUNT_AMOUNT_OFFSET: usize = 64;
const TOKEN_ACCOUNT_STATE_OFFSET: usize = 108;
const TOKEN_ACCOUNT_INITIALIZED: u8 = 1;
const SPL_TOKEN_TRANSFER_TAG: u8 = 3;
const MINT_RESERVED_OFFSET: usize = 0;

#[program]
pub mod faultline_treasury {
    use super::*;

    pub fn initialize_version(ctx: Context<InitializeVersion>) -> Result<()> {
        write_compiled_version(&mut ctx.accounts.version_state, ctx.bumps.version_state);
        Ok(())
    }

    pub fn refresh_version(ctx: Context<RefreshVersion>) -> Result<()> {
        let bump = ctx.accounts.version_state.bump;
        write_compiled_version(&mut ctx.accounts.version_state, bump);
        Ok(())
    }

    pub fn initialize_treasury(ctx: Context<InitializeTreasury>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.token_program.key(),
            TOKEN_PROGRAM_ID,
            TreasuryError::WrongTokenProgram
        );
        require_keys_eq!(
            *ctx.accounts.vault_token_account.owner,
            TOKEN_PROGRAM_ID,
            TreasuryError::WrongAccountOwner
        );

        let vault = parse_token_account(&ctx.accounts.vault_token_account.to_account_info())?;
        require_keys_eq!(
            vault.mint,
            ctx.accounts.payment_mint.key(),
            TreasuryError::WrongTokenMint
        );
        require_keys_eq!(
            vault.owner,
            ctx.accounts.treasury_state.key(),
            TreasuryError::WrongVaultAuthority
        );
        require!(vault.amount == 0, TreasuryError::VaultMustStartEmpty);

        let treasury = &mut ctx.accounts.treasury_state;
        treasury.schema_version = 1;
        treasury.admin = ctx.accounts.admin.key();
        treasury.vault_token_account = ctx.accounts.vault_token_account.key();
        treasury.total_deposited = 0;
        treasury.bump = ctx.bumps.treasury_state;
        treasury.reserved = [0; TreasuryState::RESERVED_SIZE];
        treasury.set_payment_mint(ctx.accounts.payment_mint.key());
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, TreasuryError::InvalidAmount);
        validate_payment_mint(&ctx.accounts.treasury_state, &ctx.accounts.payment_mint)?;
        validate_vault(
            &ctx.accounts.treasury_state,
            &ctx.accounts.vault_token_account.to_account_info(),
            &ctx.accounts.payment_mint.key(),
        )?;
        let source = parse_token_account(&ctx.accounts.depositor_token_account.to_account_info())?;
        require_keys_eq!(
            source.mint,
            ctx.accounts.payment_mint.key(),
            TreasuryError::WrongTokenMint
        );
        require_keys_eq!(
            source.owner,
            ctx.accounts.depositor.key(),
            TreasuryError::UnauthorizedTokenOwner
        );

        spl_token_transfer(
            &ctx.accounts.token_program.to_account_info(),
            &ctx.accounts.depositor_token_account.to_account_info(),
            &ctx.accounts.vault_token_account.to_account_info(),
            &ctx.accounts.depositor.to_account_info(),
            amount,
            None,
        )?;

        let treasury = &mut ctx.accounts.treasury_state;
        treasury.total_deposited = treasury
            .total_deposited
            .checked_add(amount)
            .ok_or(TreasuryError::ArithmeticOverflow)?;
        Ok(())
    }

    pub fn admin_withdraw(ctx: Context<AdminWithdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, TreasuryError::InvalidAmount);
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.treasury_state.admin,
            TreasuryError::UnauthorizedAdmin
        );
        validate_payment_mint(&ctx.accounts.treasury_state, &ctx.accounts.payment_mint)?;
        validate_vault(
            &ctx.accounts.treasury_state,
            &ctx.accounts.vault_token_account.to_account_info(),
            &ctx.accounts.payment_mint.key(),
        )?;
        let destination =
            parse_token_account(&ctx.accounts.destination_token_account.to_account_info())?;
        require_keys_eq!(
            destination.mint,
            ctx.accounts.payment_mint.key(),
            TreasuryError::WrongTokenMint
        );

        let bump = ctx.accounts.treasury_state.bump;
        let signer_seeds: &[&[u8]] = &[TREASURY_SEED, &[bump]];
        spl_token_transfer(
            &ctx.accounts.token_program.to_account_info(),
            &ctx.accounts.vault_token_account.to_account_info(),
            &ctx.accounts.destination_token_account.to_account_info(),
            &ctx.accounts.treasury_state.to_account_info(),
            amount,
            Some(signer_seeds),
        )?;

        let treasury = &mut ctx.accounts.treasury_state;
        treasury.total_deposited = treasury
            .total_deposited
            .checked_sub(amount)
            .ok_or(TreasuryError::ArithmeticOverflow)?;
        Ok(())
    }

    pub fn migrate_authority(ctx: Context<MigrateAuthority>) -> Result<()> {
        migrate_authority_impl(ctx)
    }
}

fn migrate_authority_impl(ctx: Context<MigrateAuthority>) -> Result<()> {
    validate_payment_mint(&ctx.accounts.treasury_state, &ctx.accounts.payment_mint)?;
    validate_vault(
        &ctx.accounts.treasury_state,
        &ctx.accounts.vault_token_account.to_account_info(),
        &ctx.accounts.payment_mint.key(),
    )?;
    require!(
        ctx.accounts.treasury_state.schema_version == 1,
        TreasuryError::UnexpectedSchemaVersion
    );
    require!(
        ctx.accounts.new_admin.key() != Pubkey::default(),
        TreasuryError::InvalidNewAdmin
    );

    #[cfg(feature = "v1")]
    {
        let _ = ctx;
        err!(TreasuryError::MigrationUnavailable)
    }

    #[cfg(feature = "v2")]
    {
        // INTENTIONALLY VULNERABLE DEMO IMPLEMENTATION.
        // DO NOT DEPLOY TO A PUBLIC CLUSTER OR REUSE IN PRODUCTION.
        // Regression: v2 checks only that the replacement authority signed.
        // It fails to require the currently configured admin signer.
        let treasury = &mut ctx.accounts.treasury_state;
        treasury.admin = ctx.accounts.new_admin.key();
        treasury.schema_version = 2;
        Ok(())
    }

    #[cfg(feature = "v3")]
    {
        require!(
            ctx.accounts.current_admin.is_signer,
            TreasuryError::CurrentAdminMustSign
        );
        require_keys_eq!(
            ctx.accounts.current_admin.key(),
            ctx.accounts.treasury_state.admin,
            TreasuryError::UnauthorizedAdmin
        );
        let treasury = &mut ctx.accounts.treasury_state;
        treasury.admin = ctx.accounts.new_admin.key();
        treasury.schema_version = 2;
        Ok(())
    }
}

fn write_compiled_version(state: &mut Account<VersionState>, bump: u8) {
    state.version = version_impl::VERSION;
    state.marker = version_impl::MARKER;
    state.bump = bump;
}

#[derive(Accounts)]
pub struct InitializeVersion<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + VersionState::INIT_SPACE,
        seeds = [b"version"],
        bump
    )]
    pub version_state: Account<'info, VersionState>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RefreshVersion<'info> {
    #[account(mut, seeds = [b"version"], bump = version_state.bump)]
    pub version_state: Account<'info, VersionState>,
}

#[derive(Accounts)]
pub struct InitializeTreasury<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + TreasuryState::LEN,
        seeds = [TREASURY_SEED],
        bump
    )]
    pub treasury_state: Account<'info, TreasuryState>,
    /// CHECK: SPL Token account layout, mint, owner, and amount are validated manually.
    pub vault_token_account: UncheckedAccount<'info>,
    /// CHECK: Mint address is stored and then used as the strict treasury asset binding.
    pub payment_mint: UncheckedAccount<'info>,
    /// CHECK: Exact Tokenkeg program ID is validated manually.
    pub token_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    pub depositor: Signer<'info>,
    #[account(mut, seeds = [TREASURY_SEED], bump = treasury_state.bump)]
    pub treasury_state: Account<'info, TreasuryState>,
    /// CHECK: SPL Token account parsed and checked manually.
    #[account(mut)]
    pub depositor_token_account: UncheckedAccount<'info>,
    /// CHECK: Exact bound vault checked manually.
    #[account(mut, address = treasury_state.vault_token_account)]
    pub vault_token_account: UncheckedAccount<'info>,
    /// CHECK: Exact payment mint checked against reserved layout.
    pub payment_mint: UncheckedAccount<'info>,
    /// CHECK: Exact Tokenkeg program ID is validated manually.
    #[account(address = TOKEN_PROGRAM_ID)]
    pub token_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct AdminWithdraw<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [TREASURY_SEED], bump = treasury_state.bump)]
    pub treasury_state: Account<'info, TreasuryState>,
    /// CHECK: Exact bound vault checked manually.
    #[account(mut, address = treasury_state.vault_token_account)]
    pub vault_token_account: UncheckedAccount<'info>,
    /// CHECK: SPL Token destination account parsed and checked manually.
    #[account(mut)]
    pub destination_token_account: UncheckedAccount<'info>,
    /// CHECK: Exact payment mint checked against reserved layout.
    pub payment_mint: UncheckedAccount<'info>,
    /// CHECK: Exact Tokenkeg program ID is validated manually.
    #[account(address = TOKEN_PROGRAM_ID)]
    pub token_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct MigrateAuthority<'info> {
    #[account(mut, seeds = [TREASURY_SEED], bump = treasury_state.bump)]
    pub treasury_state: Account<'info, TreasuryState>,
    /// CHECK: v3 requires this to be the configured admin signer. v2 intentionally omits that check.
    pub current_admin: UncheckedAccount<'info>,
    pub new_admin: Signer<'info>,
    /// CHECK: Exact bound vault checked manually.
    #[account(address = treasury_state.vault_token_account)]
    pub vault_token_account: UncheckedAccount<'info>,
    /// CHECK: Exact payment mint checked against reserved layout.
    pub payment_mint: UncheckedAccount<'info>,
    /// CHECK: Exact Tokenkeg program ID is validated manually.
    #[account(address = TOKEN_PROGRAM_ID)]
    pub token_program: UncheckedAccount<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct VersionState {
    pub version: u16,
    pub marker: [u8; 16],
    pub bump: u8,
}

#[account]
pub struct TreasuryState {
    pub schema_version: u8,
    pub admin: Pubkey,
    pub vault_token_account: Pubkey,
    pub total_deposited: u64,
    pub bump: u8,
    pub reserved: [u8; TreasuryState::RESERVED_SIZE],
}

impl TreasuryState {
    pub const RESERVED_SIZE: usize = 128;
    pub const LEN: usize = 1 + 32 + 32 + 8 + 1 + Self::RESERVED_SIZE;

    pub fn payment_mint(&self) -> Pubkey {
        Pubkey::new_from_array(
            self.reserved[MINT_RESERVED_OFFSET..MINT_RESERVED_OFFSET + 32]
                .try_into()
                .unwrap(),
        )
    }

    pub fn set_payment_mint(&mut self, mint: Pubkey) {
        self.reserved[MINT_RESERVED_OFFSET..MINT_RESERVED_OFFSET + 32]
            .copy_from_slice(mint.as_ref());
    }
}

struct TokenAccountView {
    mint: Pubkey,
    owner: Pubkey,
    amount: u64,
}

fn parse_token_account(account: &AccountInfo) -> Result<TokenAccountView> {
    require_keys_eq!(
        *account.owner,
        TOKEN_PROGRAM_ID,
        TreasuryError::WrongAccountOwner
    );
    let data = account.try_borrow_data()?;
    require!(
        data.len() == TOKEN_ACCOUNT_LEN,
        TreasuryError::InvalidTokenAccount
    );
    require!(
        data[TOKEN_ACCOUNT_STATE_OFFSET] == TOKEN_ACCOUNT_INITIALIZED,
        TreasuryError::InvalidTokenAccount
    );
    Ok(TokenAccountView {
        mint: Pubkey::new_from_array(
            data[TOKEN_ACCOUNT_MINT_OFFSET..TOKEN_ACCOUNT_MINT_OFFSET + 32]
                .try_into()
                .unwrap(),
        ),
        owner: Pubkey::new_from_array(
            data[TOKEN_ACCOUNT_OWNER_OFFSET..TOKEN_ACCOUNT_OWNER_OFFSET + 32]
                .try_into()
                .unwrap(),
        ),
        amount: u64::from_le_bytes(
            data[TOKEN_ACCOUNT_AMOUNT_OFFSET..TOKEN_ACCOUNT_AMOUNT_OFFSET + 8]
                .try_into()
                .unwrap(),
        ),
    })
}

fn validate_payment_mint(treasury: &TreasuryState, mint: &UncheckedAccount) -> Result<()> {
    require_keys_eq!(
        treasury.payment_mint(),
        mint.key(),
        TreasuryError::WrongTokenMint
    );
    Ok(())
}

fn validate_vault(
    treasury: &TreasuryState,
    vault_info: &AccountInfo,
    mint: &Pubkey,
) -> Result<TokenAccountView> {
    require_keys_eq!(
        vault_info.key(),
        treasury.vault_token_account,
        TreasuryError::WrongVault
    );
    let vault = parse_token_account(vault_info)?;
    require_keys_eq!(vault.mint, *mint, TreasuryError::WrongTokenMint);
    Ok(vault)
}

fn spl_token_transfer<'info>(
    token_program: &AccountInfo<'info>,
    source: &AccountInfo<'info>,
    destination: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    amount: u64,
    signer_seeds: Option<&[&[u8]]>,
) -> Result<()> {
    require_keys_eq!(
        token_program.key(),
        TOKEN_PROGRAM_ID,
        TreasuryError::WrongTokenProgram
    );
    let mut data = [0u8; 9];
    data[0] = SPL_TOKEN_TRANSFER_TAG;
    data[1..9].copy_from_slice(&amount.to_le_bytes());
    let ix = Instruction {
        program_id: TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*source.key, false),
            AccountMeta::new(*destination.key, false),
            AccountMeta::new_readonly(*authority.key, true),
        ],
        data: data.to_vec(),
    };
    let account_infos = [
        source.clone(),
        destination.clone(),
        authority.clone(),
        token_program.clone(),
    ];
    if let Some(seeds) = signer_seeds {
        invoke_signed(&ix, &account_infos, &[seeds])?;
    } else {
        invoke_signed(&ix, &account_infos, &[])?;
    }
    Ok(())
}

#[error_code]
pub enum TreasuryError {
    #[msg("Arithmetic overflow or underflow")]
    ArithmeticOverflow,
    #[msg("Amount must be non-zero")]
    InvalidAmount,
    #[msg("SPL Token account layout or initialized state is invalid")]
    InvalidTokenAccount,
    #[msg("Migration is unavailable in v1")]
    MigrationUnavailable,
    #[msg("The current admin signer is required")]
    CurrentAdminMustSign,
    #[msg("Unauthorized treasury admin")]
    UnauthorizedAdmin,
    #[msg("Token account owner is not the transaction signer")]
    UnauthorizedTokenOwner,
    #[msg("Unexpected treasury schema version")]
    UnexpectedSchemaVersion,
    #[msg("New admin cannot be the default pubkey")]
    InvalidNewAdmin,
    #[msg("Token account is owned by the wrong program")]
    WrongAccountOwner,
    #[msg("Wrong Tokenkeg program")]
    WrongTokenProgram,
    #[msg("Wrong token mint")]
    WrongTokenMint,
    #[msg("Wrong treasury vault account")]
    WrongVault,
    #[msg("Treasury vault token authority is wrong")]
    WrongVaultAuthority,
    #[msg("Treasury vault must start empty")]
    VaultMustStartEmpty,
}
