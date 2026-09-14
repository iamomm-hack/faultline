use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    bpf_loader_upgradeable::{self, UpgradeableLoaderState},
    program::invoke_signed,
};

declare_id!("9PFPNC6TMNKBCVsm4RoCgVYmqTJJTwnHHuRcysosSCCe");

const GUARD_VERSION: u16 = 1;
const GUARD_SEED: &[u8] = b"guard";
const PROPOSAL_SEED: &[u8] = b"proposal";
const DOMAIN_SEED: &[u8] = b"faultline";

#[program]
pub mod faultline_gate {
    use super::*;

    pub fn initialize_guard(ctx: Context<InitializeGuard>) -> Result<()> {
        validate_program_and_programdata(
            &ctx.accounts.target_program.to_account_info(),
            &ctx.accounts.program_data.to_account_info(),
        )?;

        let guard = &mut ctx.accounts.guard_config;
        guard.version = GUARD_VERSION;
        guard.target_program = ctx.accounts.target_program.key();
        guard.governance_authority = ctx.accounts.governance.key();
        guard.guard_bump = ctx.bumps.guard_config;
        guard.proposal_nonce = 0;
        Ok(())
    }

    pub fn create_minimal_proposal(
        ctx: Context<CreateMinimalProposal>,
        proposal_id: [u8; 32],
    ) -> Result<()> {
        let guard = &mut ctx.accounts.guard_config;
        validate_program_and_programdata(
            &ctx.accounts.target_program.to_account_info(),
            &ctx.accounts.program_data.to_account_info(),
        )?;
        require_keys_eq!(
            programdata_authority(&ctx.accounts.program_data.to_account_info())?,
            guard.key(),
            FaultlineError::GuardNotUpgradeAuthority
        );
        require_keys_eq!(
            buffer_authority(&ctx.accounts.candidate_buffer.to_account_info())?,
            guard.key(),
            FaultlineError::BufferNotLocked
        );

        let proposal = &mut ctx.accounts.proposal;
        proposal.guard_config = guard.key();
        proposal.proposal_id = proposal_id;
        proposal.target_program = ctx.accounts.target_program.key();
        proposal.program_data = ctx.accounts.program_data.key();
        proposal.candidate_buffer = ctx.accounts.candidate_buffer.key();
        proposal.proposer = ctx.accounts.proposer.key();
        proposal.state = MinimalProposalState::Pending;
        proposal.created_slot = Clock::get()?.slot;
        proposal.executed_slot = None;
        proposal.bump = ctx.bumps.proposal;

        let buffer_claim = &mut ctx.accounts.buffer_claim;
        buffer_claim.proposal = proposal.key();
        buffer_claim.candidate_buffer = ctx.accounts.candidate_buffer.key();
        buffer_claim.bump = ctx.bumps.buffer_claim;

        guard.proposal_nonce = guard
            .proposal_nonce
            .checked_add(1)
            .ok_or(FaultlineError::ArithmeticOverflow)?;
        Ok(())
    }

    // TEMPORARY MILESTONE-1 APPROVAL PATH.
    // This will be replaced by challenge-window resolution.
    pub fn approve_minimal_proposal(ctx: Context<GovernProposal>) -> Result<()> {
        require!(
            ctx.accounts.proposal.state == MinimalProposalState::Pending,
            FaultlineError::InvalidProposalState
        );
        require_keys_eq!(
            buffer_authority(&ctx.accounts.candidate_buffer.to_account_info())?,
            ctx.accounts.guard_config.key(),
            FaultlineError::BufferNotLocked
        );
        ctx.accounts.proposal.state = MinimalProposalState::Approved;
        Ok(())
    }

    pub fn reject_minimal_proposal(ctx: Context<GovernProposal>) -> Result<()> {
        require!(
            ctx.accounts.proposal.state == MinimalProposalState::Pending,
            FaultlineError::InvalidProposalState
        );
        ctx.accounts.proposal.state = MinimalProposalState::Rejected;
        Ok(())
    }

    pub fn execute_guarded_upgrade(ctx: Context<ExecuteGuardedUpgrade>) -> Result<()> {
        require!(
            ctx.accounts.proposal.state == MinimalProposalState::Approved,
            FaultlineError::ProposalNotApproved
        );

        validate_program_and_programdata(
            &ctx.accounts.target_program.to_account_info(),
            &ctx.accounts.program_data.to_account_info(),
        )?;
        require_keys_eq!(
            programdata_authority(&ctx.accounts.program_data.to_account_info())?,
            ctx.accounts.guard_config.key(),
            FaultlineError::GuardNotUpgradeAuthority
        );
        require_keys_eq!(
            buffer_authority(&ctx.accounts.candidate_buffer.to_account_info())?,
            ctx.accounts.guard_config.key(),
            FaultlineError::BufferNotLocked
        );

        let upgrade_ix = bpf_loader_upgradeable::upgrade(
            &ctx.accounts.target_program.key(),
            &ctx.accounts.candidate_buffer.key(),
            &ctx.accounts.guard_config.key(),
            &ctx.accounts.spill.key(),
        );
        let target_key = ctx.accounts.guard_config.target_program;
        let signer_seeds: &[&[u8]] = &[
            DOMAIN_SEED,
            GUARD_SEED,
            target_key.as_ref(),
            &[ctx.accounts.guard_config.guard_bump],
        ];

        invoke_signed(
            &upgrade_ix,
            &[
                ctx.accounts.program_data.to_account_info(),
                ctx.accounts.target_program.to_account_info(),
                ctx.accounts.candidate_buffer.to_account_info(),
                ctx.accounts.spill.to_account_info(),
                ctx.accounts.rent.to_account_info(),
                ctx.accounts.clock.to_account_info(),
                ctx.accounts.guard_config.to_account_info(),
                ctx.accounts.loader_program.to_account_info(),
            ],
            &[signer_seeds],
        )?;

        let proposal = &mut ctx.accounts.proposal;
        proposal.state = MinimalProposalState::Executed;
        proposal.executed_slot = Some(Clock::get()?.slot);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeGuard<'info> {
    #[account(mut)]
    pub governance: Signer<'info>,
    /// CHECK: Address, owner, executable bit, and embedded ProgramData are validated.
    pub target_program: UncheckedAccount<'info>,
    /// CHECK: Address, loader owner, and loader state are validated.
    pub program_data: UncheckedAccount<'info>,
    #[account(
        init,
        payer = governance,
        space = 8 + GuardConfig::INIT_SPACE,
        seeds = [DOMAIN_SEED, GUARD_SEED, target_program.key().as_ref()],
        bump
    )]
    pub guard_config: Account<'info, GuardConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(proposal_id: [u8; 32])]
pub struct CreateMinimalProposal<'info> {
    #[account(mut)]
    pub proposer: Signer<'info>,
    #[account(
        mut,
        seeds = [DOMAIN_SEED, GUARD_SEED, guard_config.target_program.as_ref()],
        bump = guard_config.guard_bump,
        constraint = guard_config.target_program == target_program.key() @ FaultlineError::WrongTargetProgram
    )]
    pub guard_config: Account<'info, GuardConfig>,
    /// CHECK: Fully validated against the loader and GuardConfig.
    pub target_program: UncheckedAccount<'info>,
    /// CHECK: Fully validated against the target and loader state.
    #[account(constraint = program_data.key() == program_data_address(&target_program.key()) @ FaultlineError::WrongProgramData)]
    pub program_data: UncheckedAccount<'info>,
    /// CHECK: Loader ownership, Buffer state, and Guard authority are validated.
    pub candidate_buffer: UncheckedAccount<'info>,
    #[account(
        init,
        payer = proposer,
        space = 8 + MinimalUpgradeProposal::INIT_SPACE,
        seeds = [DOMAIN_SEED, PROPOSAL_SEED, target_program.key().as_ref(), proposal_id.as_ref()],
        bump
    )]
    pub proposal: Account<'info, MinimalUpgradeProposal>,
    #[account(
        init,
        payer = proposer,
        space = 8 + BufferClaim::INIT_SPACE,
        seeds = [DOMAIN_SEED, b"buffer", candidate_buffer.key().as_ref()],
        bump
    )]
    pub buffer_claim: Account<'info, BufferClaim>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct GovernProposal<'info> {
    pub governance: Signer<'info>,
    #[account(
        seeds = [DOMAIN_SEED, GUARD_SEED, guard_config.target_program.as_ref()],
        bump = guard_config.guard_bump,
        constraint = guard_config.governance_authority == governance.key() @ FaultlineError::UnauthorizedGovernance
    )]
    pub guard_config: Account<'info, GuardConfig>,
    #[account(
        mut,
        seeds = [DOMAIN_SEED, PROPOSAL_SEED, proposal.target_program.as_ref(), proposal.proposal_id.as_ref()],
        bump = proposal.bump,
        has_one = guard_config,
        has_one = candidate_buffer
    )]
    pub proposal: Account<'info, MinimalUpgradeProposal>,
    #[account(
        seeds = [DOMAIN_SEED, b"buffer", candidate_buffer.key().as_ref()],
        bump = buffer_claim.bump,
        has_one = proposal,
        has_one = candidate_buffer
    )]
    pub buffer_claim: Account<'info, BufferClaim>,
    /// CHECK: Exact proposal address plus loader state/authority are validated.
    pub candidate_buffer: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ExecuteGuardedUpgrade<'info> {
    pub executor: Signer<'info>,
    #[account(
        seeds = [DOMAIN_SEED, GUARD_SEED, guard_config.target_program.as_ref()],
        bump = guard_config.guard_bump
    )]
    pub guard_config: Account<'info, GuardConfig>,
    #[account(
        mut,
        seeds = [DOMAIN_SEED, PROPOSAL_SEED, proposal.target_program.as_ref(), proposal.proposal_id.as_ref()],
        bump = proposal.bump,
        has_one = guard_config,
        has_one = target_program,
        has_one = program_data,
        has_one = candidate_buffer
    )]
    pub proposal: Account<'info, MinimalUpgradeProposal>,
    /// CHECK: Exact proposal address and loader state are validated.
    #[account(mut)]
    pub target_program: UncheckedAccount<'info>,
    /// CHECK: Exact proposal address, loader owner, and authority are validated.
    #[account(mut)]
    pub program_data: UncheckedAccount<'info>,
    /// CHECK: Exact proposal address, loader owner, state, and authority are validated.
    #[account(mut)]
    pub candidate_buffer: UncheckedAccount<'info>,
    /// CHECK: Refund recipient is fixed to configured governance.
    #[account(mut, address = guard_config.governance_authority)]
    pub spill: UncheckedAccount<'info>,
    pub rent: Sysvar<'info, Rent>,
    pub clock: Sysvar<'info, Clock>,
    /// CHECK: Fixed loader-v3 executable; arbitrary loaders are rejected.
    #[account(address = bpf_loader_upgradeable::id())]
    pub loader_program: UncheckedAccount<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct GuardConfig {
    pub version: u16,
    pub target_program: Pubkey,
    pub governance_authority: Pubkey,
    pub guard_bump: u8,
    pub proposal_nonce: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq)]
pub enum MinimalProposalState {
    Pending,
    Approved,
    Executed,
    Rejected,
    Cancelled,
}

#[account]
#[derive(InitSpace)]
pub struct MinimalUpgradeProposal {
    pub guard_config: Pubkey,
    pub proposal_id: [u8; 32],
    pub target_program: Pubkey,
    pub program_data: Pubkey,
    pub candidate_buffer: Pubkey,
    pub proposer: Pubkey,
    pub state: MinimalProposalState,
    pub created_slot: u64,
    pub executed_slot: Option<u64>,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct BufferClaim {
    pub proposal: Pubkey,
    pub candidate_buffer: Pubkey,
    pub bump: u8,
}

fn validate_program_and_programdata(
    program: &AccountInfo,
    program_data: &AccountInfo,
) -> Result<()> {
    require_keys_eq!(
        *program.owner,
        bpf_loader_upgradeable::id(),
        FaultlineError::WrongAccountOwner
    );
    require!(program.executable, FaultlineError::TargetNotExecutable);
    require_keys_eq!(
        *program_data.owner,
        bpf_loader_upgradeable::id(),
        FaultlineError::WrongAccountOwner
    );
    require_keys_eq!(
        program_data_address(program.key),
        *program_data.key,
        FaultlineError::WrongProgramData
    );
    match loader_state(program)? {
        UpgradeableLoaderState::Program {
            programdata_address,
        } => {
            require_keys_eq!(
                programdata_address,
                *program_data.key,
                FaultlineError::WrongProgramData
            );
        }
        _ => return err!(FaultlineError::InvalidLoaderState),
    }
    match loader_state(program_data)? {
        UpgradeableLoaderState::ProgramData { .. } => Ok(()),
        _ => err!(FaultlineError::InvalidLoaderState),
    }
}

fn programdata_authority(program_data: &AccountInfo) -> Result<Pubkey> {
    require_keys_eq!(
        *program_data.owner,
        bpf_loader_upgradeable::id(),
        FaultlineError::WrongAccountOwner
    );
    match loader_state(program_data)? {
        UpgradeableLoaderState::ProgramData {
            upgrade_authority_address: Some(authority),
            ..
        } => Ok(authority),
        UpgradeableLoaderState::ProgramData {
            upgrade_authority_address: None,
            ..
        } => err!(FaultlineError::ProgramImmutable),
        _ => err!(FaultlineError::InvalidLoaderState),
    }
}

fn buffer_authority(buffer: &AccountInfo) -> Result<Pubkey> {
    require_keys_eq!(
        *buffer.owner,
        bpf_loader_upgradeable::id(),
        FaultlineError::WrongAccountOwner
    );
    match loader_state(buffer)? {
        UpgradeableLoaderState::Buffer {
            authority_address: Some(authority),
        } => Ok(authority),
        UpgradeableLoaderState::Buffer {
            authority_address: None,
        } => err!(FaultlineError::BufferImmutable),
        _ => err!(FaultlineError::InvalidLoaderState),
    }
}

fn loader_state(account: &AccountInfo) -> Result<UpgradeableLoaderState> {
    bincode::deserialize(&account.try_borrow_data()?)
        .map_err(|_| error!(FaultlineError::InvalidLoaderState))
}

fn program_data_address(program: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[program.as_ref()], &bpf_loader_upgradeable::id()).0
}

#[error_code]
pub enum FaultlineError {
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("Candidate buffer is not locked to the Guard PDA")]
    BufferNotLocked,
    #[msg("Buffer has no authority")]
    BufferImmutable,
    #[msg("Guard PDA is not the current target upgrade authority")]
    GuardNotUpgradeAuthority,
    #[msg("Unexpected upgradeable-loader account state")]
    InvalidLoaderState,
    #[msg("Proposal is not approved")]
    ProposalNotApproved,
    #[msg("Program is immutable")]
    ProgramImmutable,
    #[msg("Proposal is in an invalid state for this operation")]
    InvalidProposalState,
    #[msg("Target program is not executable")]
    TargetNotExecutable,
    #[msg("Only configured governance may perform this action")]
    UnauthorizedGovernance,
    #[msg("Account is not owned by loader-v3")]
    WrongAccountOwner,
    #[msg("Incorrect ProgramData account")]
    WrongProgramData,
    #[msg("Incorrect target program")]
    WrongTargetProgram,
}
