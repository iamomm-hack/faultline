use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    bpf_loader_upgradeable::{self, UpgradeableLoaderState},
    hash::{hash, hashv},
    instruction::{AccountMeta, Instruction},
    program::{invoke, invoke_signed},
    system_instruction, system_program as solana_system_program,
};

declare_id!("9PFPNC6TMNKBCVsm4RoCgVYmqTJJTwnHHuRcysosSCCe");

const GUARD_VERSION: u16 = 1;
const DOMAIN_SEED: &[u8] = b"faultline";
const GUARD_SEED: &[u8] = b"guard";
const BUFFER_SEED: &[u8] = b"buffer";
const SAFETY_POLICY_SEED: &[u8] = b"safety-policy";
const UPGRADE_PROPOSAL_SEED: &[u8] = b"upgrade-proposal";
const INVARIANT_SEED: &[u8] = b"invariant";
const CHALLENGE_COMMIT_SEED: &[u8] = b"challenge-commit";
const TRACE_CLAIM_SEED: &[u8] = b"trace-claim";
const VERIFIER_REGISTRY_SEED: &[u8] = b"verifier-registry";
const VERIFIER_EPOCH_SEED: &[u8] = b"verifier-epoch";
const PROPOSAL_VERIFICATION_GATE_SEED: &[u8] = b"proposal-verification-gate";
const VERIFICATION_ROUND_SEED: &[u8] = b"verification-round";
const REPLAY_RESULT_SEED: &[u8] = b"replay-result";
const VERIFIER_ATTESTATION_SEED: &[u8] = b"verifier-attestation";
pub const ECONOMIC_POLICY_REGISTRY_SEED: &[u8] = b"economic-policy-registry";
pub const ECONOMIC_POLICY_SEED: &[u8] = b"economic-policy";
pub const PROPOSAL_ESCROW_SEED: &[u8] = b"proposal-escrow";
pub const BOUNTY_VAULT_SEED: &[u8] = b"bounty-vault";
pub const FEE_VAULT_SEED: &[u8] = b"fee-vault";
pub const PENALTY_VAULT_SEED: &[u8] = b"penalty-vault";
pub const CHALLENGE_BOND_SEED: &[u8] = b"challenge-bond";
pub const BOND_VAULT_SEED: &[u8] = b"bond-vault";
pub const VERIFIER_STAKE_SEED: &[u8] = b"verifier-stake";
pub const STAKE_VAULT_SEED: &[u8] = b"stake-vault";
pub const VERIFIER_EPOCH_ECONOMICS_SEED: &[u8] = b"verifier-epoch-economics";
pub const ROUND_ECONOMICS_SEED: &[u8] = b"round-economics";
pub const VERIFIER_FEE_CLAIM_SEED: &[u8] = b"verifier-fee-claim";
pub const VERIFIER_SLASH_SEED: &[u8] = b"verifier-slash";
const CHALLENGE_DOMAIN: &[u8] = b"FAULTLINE_CHALLENGE_V1";
const REPLAY_DOMAIN: &[u8] = b"FAULTLINE_REPLAY_V1";
const VERIFIER_SET_DOMAIN: &[u8] = b"FAULTLINE_VERIFIER_SET_V1";
const MIN_REVEAL_DELAY_SLOTS: u64 = 1;
const MAX_REVEAL_HORIZON_SLOTS: u64 = 8;
const MIN_VERIFICATION_REMAINING_SLOTS: u64 = 2;
const MAX_VERIFIERS: usize = 8;
const AUTOMATIC_VIOLATION_REASON_CODE: u16 = 0x5001;
pub const ECONOMIC_POLICY_FIRST_CONFIG_ID: u64 = 0;
pub const ECONOMIC_ENFORCEMENT_DELAY_SLOTS: u64 = 32;
pub const MAX_BONDED_CHALLENGES: u8 = 8;
pub const BPS_DENOMINATOR: u16 = 10_000;
pub const HOLD_BOND_SLASH_BPS: u16 = 2_500;
pub const HUNTER_NON_REVEAL_SLASH_BPS: u16 = 10_000;
pub const MIN_FEE_CLAIM_GRACE_SLOTS: u64 = 1;
pub const MAX_FEE_CLAIM_GRACE_SLOTS: u64 = 216_000;
pub const MIN_SLASH_CLAIM_GRACE_SLOTS: u64 = 1;
pub const MAX_SLASH_CLAIM_GRACE_SLOTS: u64 = 216_000;
pub const MIN_STAKE_WITHDRAW_COOLDOWN_SLOTS: u64 = 1;
pub const MAX_STAKE_WITHDRAW_COOLDOWN_SLOTS: u64 = 1_296_000;
const TOKEN_PROGRAM_ID: Pubkey =
    anchor_lang::solana_program::pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID: Pubkey =
    anchor_lang::solana_program::pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const TOKEN_ACCOUNT_LEN: usize = 165;
const MINT_LEN: usize = 82;
const TOKEN_ACCOUNT_INITIALIZED: u8 = 1;
const SPL_TOKEN_TRANSFER_TAG: u8 = 3;
const SPL_TOKEN_CLOSE_ACCOUNT_TAG: u8 = 9;
const SPL_TOKEN_INITIALIZE_ACCOUNT3_TAG: u8 = 18;

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

    pub fn initialize_safety_policy(
        ctx: Context<InitializeSafetyPolicy>,
        policy_id: u64,
        policy_version: u16,
        min_challenge_slots: u64,
        verifier_quorum_required: u8,
        allowed_invariant_set_hash: [u8; 32],
        governance_authority: Pubkey,
    ) -> Result<()> {
        require!(
            min_challenge_slots > 0,
            FaultlineError::ZeroChallengeDuration
        );
        require!(
            verifier_quorum_required > 0,
            FaultlineError::ZeroVerifierQuorum
        );
        require_keys_eq!(
            ctx.accounts.authority.key(),
            governance_authority,
            FaultlineError::UnauthorizedPolicyAuthority
        );
        require_keys_eq!(
            ctx.accounts.guard_config.governance_authority,
            governance_authority,
            FaultlineError::UnauthorizedGovernance
        );
        let slot = Clock::get()?.slot;
        let policy = &mut ctx.accounts.policy;
        policy.authority = ctx.accounts.authority.key();
        policy.governance_authority = governance_authority;
        policy.target_program = ctx.accounts.target_program.key();
        policy.policy_id = policy_id;
        policy.policy_version = policy_version;
        policy.min_challenge_slots = min_challenge_slots;
        policy.verifier_quorum_required = verifier_quorum_required;
        policy.allowed_invariant_set_hash = allowed_invariant_set_hash;
        policy.status = PolicyStatus::Active;
        policy.created_at_slot = slot;
        policy.bump = ctx.bumps.policy;
        emit!(SafetyPolicyInitialized {
            policy: policy.key(),
            target_program: policy.target_program,
            actor: policy.authority,
            slot,
            policy_id,
            policy_version
        });
        Ok(())
    }

    pub fn set_safety_policy_status(
        ctx: Context<SetSafetyPolicyStatus>,
        status: PolicyStatus,
    ) -> Result<()> {
        let policy = &mut ctx.accounts.policy;
        require!(
            policy.status != status,
            FaultlineError::RepeatedPolicyStatus
        );
        let old_status = policy.status;
        policy.status = status;
        emit!(SafetyPolicyStatusChanged {
            policy: policy.key(),
            actor: ctx.accounts.governance.key(),
            slot: Clock::get()?.slot,
            old_status,
            new_status: status
        });
        Ok(())
    }

    pub fn initialize_economic_policy_registry(
        ctx: Context<InitializeEconomicPolicyRegistry>,
    ) -> Result<()> {
        let slot = Clock::get()?.slot;
        let enforcement_slot = slot
            .checked_add(ECONOMIC_ENFORCEMENT_DELAY_SLOTS)
            .ok_or(FaultlineError::ArithmeticOverflow)?;
        let registry = &mut ctx.accounts.economic_policy_registry;
        registry.safety_policy = ctx.accounts.policy.key();
        registry.governance = ctx.accounts.governance.key();
        registry.next_config_id = ECONOMIC_POLICY_FIRST_CONFIG_ID;
        registry.economic_enforcement_slot = enforcement_slot;
        registry.created_at_slot = slot;
        registry.bump = ctx.bumps.economic_policy_registry;
        emit!(EconomicPolicyRegistryInitialized {
            safety_policy: registry.safety_policy,
            economic_policy_registry: registry.key(),
            governance: registry.governance,
            economic_enforcement_slot: enforcement_slot,
            slot,
        });
        Ok(())
    }

    pub fn initialize_economic_policy(
        ctx: Context<InitializeEconomicPolicy>,
        config_id: u64,
        parameters: EconomicPolicyParameters,
    ) -> Result<()> {
        let advanced_config_id = next_config_id(
            ctx.accounts.economic_policy_registry.next_config_id,
            config_id,
        )?;
        validate_economic_policy_parameters(&parameters)?;
        let mint = parse_mint(&ctx.accounts.payment_mint.to_account_info())?;
        require!(
            !mint.has_freeze_authority,
            FaultlineError::MintHasFreezeAuthority
        );
        let fee_reserve = maximum_fee_reserve(
            parameters.verifier_fee_amount,
            parameters.max_bonded_challenges,
        )?;
        require!(fee_reserve > 0, FaultlineError::ZeroVerifierFee);

        let slot = Clock::get()?.slot;
        let economic_policy = &mut ctx.accounts.economic_policy;
        economic_policy.economic_policy_registry = ctx.accounts.economic_policy_registry.key();
        economic_policy.safety_policy = ctx.accounts.policy.key();
        economic_policy.governance = ctx.accounts.governance.key();
        economic_policy.payment_mint = ctx.accounts.payment_mint.key();
        economic_policy.token_program = TOKEN_PROGRAM_ID;
        economic_policy.config_id = config_id;
        economic_policy.payment_mint_decimals = mint.decimals;
        economic_policy.bounty_amount = parameters.bounty_amount;
        economic_policy.challenger_bond_amount = parameters.challenger_bond_amount;
        economic_policy.verifier_fee_amount = parameters.verifier_fee_amount;
        economic_policy.minimum_verifier_stake = parameters.minimum_verifier_stake;
        economic_policy.verifier_non_reveal_slash_amount =
            parameters.verifier_non_reveal_slash_amount;
        economic_policy.max_bonded_challenges = parameters.max_bonded_challenges;
        economic_policy.fee_claim_grace_slots = parameters.fee_claim_grace_slots;
        economic_policy.slash_claim_grace_slots = parameters.slash_claim_grace_slots;
        economic_policy.stake_withdraw_cooldown_slots = parameters.stake_withdraw_cooldown_slots;
        economic_policy.created_at_slot = slot;
        economic_policy.bump = ctx.bumps.economic_policy;

        ctx.accounts.economic_policy_registry.next_config_id = advanced_config_id;
        emit!(EconomicPolicyInitialized {
            safety_policy: ctx.accounts.policy.key(),
            economic_policy_registry: ctx.accounts.economic_policy_registry.key(),
            economic_policy: economic_policy.key(),
            config_id,
            payment_mint: economic_policy.payment_mint,
            governance: ctx.accounts.governance.key(),
            slot,
        });
        Ok(())
    }

    pub fn initialize_verifier_stake(
        ctx: Context<InitializeVerifierStake>,
        amount: u64,
    ) -> Result<()> {
        require!(amount > 0, FaultlineError::ZeroStakeAmount);
        require!(
            amount >= ctx.accounts.economic_policy.minimum_verifier_stake,
            FaultlineError::StakeBelowMinimum
        );
        validate_canonical_ata(
            &ctx.accounts.verifier_token_account.to_account_info(),
            &ctx.accounts.verifier.key(),
            &ctx.accounts.economic_policy.payment_mint,
        )?;
        create_token_vault(
            &ctx.accounts.verifier.to_account_info(),
            &ctx.accounts.stake_vault.to_account_info(),
            &ctx.accounts.payment_mint.to_account_info(),
            &ctx.accounts.verifier_stake.key(),
            &ctx.accounts.system_program.to_account_info(),
            &ctx.accounts.token_program.to_account_info(),
            &[
                STAKE_VAULT_SEED,
                ctx.accounts.economic_policy.key().as_ref(),
                ctx.accounts.verifier.key().as_ref(),
                &[ctx.bumps.stake_vault],
            ],
        )?;
        spl_token_transfer(
            &ctx.accounts.token_program.to_account_info(),
            &ctx.accounts.verifier_token_account.to_account_info(),
            &ctx.accounts.stake_vault.to_account_info(),
            &ctx.accounts.verifier.to_account_info(),
            amount,
            None,
        )?;
        let stake = &mut ctx.accounts.verifier_stake;
        stake.economic_policy = ctx.accounts.economic_policy.key();
        stake.verifier = ctx.accounts.verifier.key();
        stake.stake_vault = ctx.accounts.stake_vault.key();
        stake.payment_mint = ctx.accounts.payment_mint.key();
        stake.rent_recipient = ctx.accounts.verifier.key();
        stake.amount = amount;
        stake.slash_lock_until_slot = 0;
        stake.withdrawal_requested_slot = None;
        stake.withdrawal_available_slot = None;
        stake.total_slashed = 0;
        stake.status = StakeStatus::Active;
        stake.bump = ctx.bumps.verifier_stake;
        emit!(VerifierStakeInitialized {
            economic_policy: stake.economic_policy,
            verifier_stake: stake.key(),
            verifier: stake.verifier,
            stake_vault: stake.stake_vault,
            amount,
            slot: Clock::get()?.slot,
        });
        Ok(())
    }

    pub fn top_up_verifier_stake(ctx: Context<TopUpVerifierStake>, amount: u64) -> Result<()> {
        require!(amount > 0, FaultlineError::ZeroStakeAmount);
        require!(
            ctx.accounts.verifier_stake.status == StakeStatus::Active,
            FaultlineError::StakeWithdrawalPending
        );
        validate_canonical_ata(
            &ctx.accounts.verifier_token_account.to_account_info(),
            &ctx.accounts.verifier.key(),
            &ctx.accounts.economic_policy.payment_mint,
        )?;
        validate_token_vault(
            &ctx.accounts.stake_vault.to_account_info(),
            &ctx.accounts.economic_policy.payment_mint,
            &ctx.accounts.verifier_stake.key(),
        )?;
        spl_token_transfer(
            &ctx.accounts.token_program.to_account_info(),
            &ctx.accounts.verifier_token_account.to_account_info(),
            &ctx.accounts.stake_vault.to_account_info(),
            &ctx.accounts.verifier.to_account_info(),
            amount,
            None,
        )?;
        ctx.accounts.verifier_stake.amount = ctx
            .accounts
            .verifier_stake
            .amount
            .checked_add(amount)
            .ok_or(FaultlineError::ArithmeticOverflow)?;
        emit!(VerifierStakeToppedUp {
            economic_policy: ctx.accounts.economic_policy.key(),
            verifier_stake: ctx.accounts.verifier_stake.key(),
            verifier: ctx.accounts.verifier.key(),
            amount,
            new_amount: ctx.accounts.verifier_stake.amount,
            slot: Clock::get()?.slot,
        });
        Ok(())
    }

    pub fn request_verifier_stake_withdrawal(ctx: Context<ManageVerifierStake>) -> Result<()> {
        let stake = &mut ctx.accounts.verifier_stake;
        require!(
            stake.status == StakeStatus::Active,
            FaultlineError::StakeWithdrawalPending
        );
        let slot = Clock::get()?.slot;
        let base = core::cmp::max(slot, stake.slash_lock_until_slot);
        let available = withdrawal_available_slot(
            slot,
            stake.slash_lock_until_slot,
            ctx.accounts.economic_policy.stake_withdraw_cooldown_slots,
        )?;
        debug_assert_eq!(
            base.checked_add(ctx.accounts.economic_policy.stake_withdraw_cooldown_slots),
            Some(available)
        );
        stake.status = StakeStatus::WithdrawalPending;
        stake.withdrawal_requested_slot = Some(slot);
        stake.withdrawal_available_slot = Some(available);
        emit!(VerifierStakeWithdrawalRequested {
            economic_policy: ctx.accounts.economic_policy.key(),
            verifier_stake: stake.key(),
            verifier: ctx.accounts.verifier.key(),
            requested_slot: slot,
            available_slot: available,
        });
        Ok(())
    }

    pub fn cancel_verifier_stake_withdrawal(ctx: Context<ManageVerifierStake>) -> Result<()> {
        let stake = &mut ctx.accounts.verifier_stake;
        require!(
            stake.status == StakeStatus::WithdrawalPending,
            FaultlineError::WithdrawalNotRequested
        );
        stake.status = StakeStatus::Active;
        stake.withdrawal_requested_slot = None;
        stake.withdrawal_available_slot = None;
        emit!(VerifierStakeWithdrawalCancelled {
            economic_policy: ctx.accounts.economic_policy.key(),
            verifier_stake: stake.key(),
            verifier: ctx.accounts.verifier.key(),
            slot: Clock::get()?.slot,
        });
        Ok(())
    }

    pub fn withdraw_verifier_stake(ctx: Context<WithdrawVerifierStake>) -> Result<()> {
        let stake = &ctx.accounts.verifier_stake;
        require!(
            stake.status == StakeStatus::WithdrawalPending,
            FaultlineError::WithdrawalNotRequested
        );
        let available = stake
            .withdrawal_available_slot
            .ok_or(FaultlineError::WithdrawalNotRequested)?;
        let slot = Clock::get()?.slot;
        require!(slot >= available, FaultlineError::WithdrawalCooldownActive);
        require!(
            slot > stake.slash_lock_until_slot,
            FaultlineError::StakeStillLocked
        );
        validate_canonical_ata(
            &ctx.accounts.verifier_token_account.to_account_info(),
            &ctx.accounts.verifier.key(),
            &ctx.accounts.economic_policy.payment_mint,
        )?;
        let vault = validate_token_vault(
            &ctx.accounts.stake_vault.to_account_info(),
            &ctx.accounts.economic_policy.payment_mint,
            &ctx.accounts.verifier_stake.key(),
        )?;
        require!(
            vault.amount == stake.amount,
            FaultlineError::VaultBalanceMismatch
        );
        let policy_key = ctx.accounts.economic_policy.key();
        let verifier_key = ctx.accounts.verifier.key();
        let signer_seeds: &[&[u8]] = &[
            VERIFIER_STAKE_SEED,
            policy_key.as_ref(),
            verifier_key.as_ref(),
            &[stake.bump],
        ];
        if stake.amount > 0 {
            spl_token_transfer(
                &ctx.accounts.token_program.to_account_info(),
                &ctx.accounts.stake_vault.to_account_info(),
                &ctx.accounts.verifier_token_account.to_account_info(),
                &ctx.accounts.verifier_stake.to_account_info(),
                stake.amount,
                Some(signer_seeds),
            )?;
        }
        spl_token_close(
            &ctx.accounts.token_program.to_account_info(),
            &ctx.accounts.stake_vault.to_account_info(),
            &ctx.accounts.rent_recipient.to_account_info(),
            &ctx.accounts.verifier_stake.to_account_info(),
            signer_seeds,
        )?;
        emit!(VerifierStakeWithdrawn {
            economic_policy: ctx.accounts.economic_policy.key(),
            verifier_stake: ctx.accounts.verifier_stake.key(),
            verifier: ctx.accounts.verifier.key(),
            amount: stake.amount,
            slot,
        });
        Ok(())
    }

    pub fn activate_verifier_epoch_economics<'info>(
        ctx: Context<'_, '_, 'info, 'info, ActivateVerifierEpochEconomics<'info>>,
    ) -> Result<()> {
        let verifiers = &ctx.accounts.verifier_epoch.verifiers;
        require!(
            ctx.remaining_accounts.len() == verifiers.len(),
            FaultlineError::WrongRemainingAccountCount
        );
        for (expected_verifier, stake_info) in verifiers.iter().zip(ctx.remaining_accounts.iter()) {
            require_keys_eq!(
                *stake_info.owner,
                crate::ID,
                FaultlineError::WrongAccountOwner
            );
            let (expected_stake, _) = Pubkey::find_program_address(
                &[
                    VERIFIER_STAKE_SEED,
                    ctx.accounts.economic_policy.key().as_ref(),
                    expected_verifier.as_ref(),
                ],
                &crate::ID,
            );
            require_keys_eq!(
                expected_stake,
                *stake_info.key,
                FaultlineError::WrongVerifierStake
            );
            let stake = Account::<VerifierStake>::try_from(stake_info)?;
            require_keys_eq!(
                stake.economic_policy,
                ctx.accounts.economic_policy.key(),
                FaultlineError::WrongEconomicPolicy
            );
            require_keys_eq!(
                stake.verifier,
                *expected_verifier,
                FaultlineError::WrongVerifierStake
            );
            require_keys_eq!(
                stake.payment_mint,
                ctx.accounts.economic_policy.payment_mint,
                FaultlineError::WrongPaymentMint
            );
            require!(
                stake.status == StakeStatus::Active,
                FaultlineError::StakeWithdrawalPending
            );
            require!(
                stake.amount >= ctx.accounts.economic_policy.minimum_verifier_stake,
                FaultlineError::StakeBelowMinimum
            );
        }
        let binding = &mut ctx.accounts.verifier_epoch_economics;
        binding.verifier_epoch = ctx.accounts.verifier_epoch.key();
        binding.economic_policy = ctx.accounts.economic_policy.key();
        binding.verifier_registry = ctx.accounts.verifier_registry.key();
        binding.activated_at_slot = Clock::get()?.slot;
        binding.bump = ctx.bumps.verifier_epoch_economics;
        emit!(VerifierEpochEconomicsActivated {
            verifier_epoch: binding.verifier_epoch,
            economic_policy: binding.economic_policy,
            verifier_epoch_economics: binding.key(),
            verifier_count: verifiers.len() as u8,
            actor: ctx.accounts.governance.key(),
            slot: binding.activated_at_slot,
        });
        Ok(())
    }

    pub fn fund_proposal_escrow(ctx: Context<FundProposalEscrow>) -> Result<()> {
        let funder = ctx.accounts.funder.key();
        require!(
            ctx.accounts.policy.status == PolicyStatus::Active,
            FaultlineError::PolicyPaused
        );
        require!(
            ctx.accounts.proposal.state == ProposalState::Draft,
            FaultlineError::InvalidProposalTransition
        );
        require!(
            funder == ctx.accounts.proposal.proposer
                || funder == ctx.accounts.policy.governance_authority,
            FaultlineError::UnauthorizedEconomicFunder
        );
        require!(
            ctx.accounts.proposal.created_at_slot
                >= ctx
                    .accounts
                    .economic_policy_registry
                    .economic_enforcement_slot,
            FaultlineError::HistoricalProposalCannotUseEconomics
        );
        validate_canonical_ata(
            &ctx.accounts.funder_token_account.to_account_info(),
            &funder,
            &ctx.accounts.economic_policy.payment_mint,
        )?;
        let fee_reserve = maximum_fee_reserve(
            ctx.accounts.economic_policy.verifier_fee_amount,
            ctx.accounts.economic_policy.max_bonded_challenges,
        )?;
        let proposal_key = ctx.accounts.proposal.key();
        let escrow_key = ctx.accounts.proposal_escrow.key();
        create_token_vault(
            &ctx.accounts.funder.to_account_info(),
            &ctx.accounts.bounty_vault.to_account_info(),
            &ctx.accounts.payment_mint.to_account_info(),
            &escrow_key,
            &ctx.accounts.system_program.to_account_info(),
            &ctx.accounts.token_program.to_account_info(),
            &[
                BOUNTY_VAULT_SEED,
                proposal_key.as_ref(),
                &[ctx.bumps.bounty_vault],
            ],
        )?;
        create_token_vault(
            &ctx.accounts.funder.to_account_info(),
            &ctx.accounts.fee_vault.to_account_info(),
            &ctx.accounts.payment_mint.to_account_info(),
            &escrow_key,
            &ctx.accounts.system_program.to_account_info(),
            &ctx.accounts.token_program.to_account_info(),
            &[
                FEE_VAULT_SEED,
                proposal_key.as_ref(),
                &[ctx.bumps.fee_vault],
            ],
        )?;
        create_token_vault(
            &ctx.accounts.funder.to_account_info(),
            &ctx.accounts.penalty_vault.to_account_info(),
            &ctx.accounts.payment_mint.to_account_info(),
            &escrow_key,
            &ctx.accounts.system_program.to_account_info(),
            &ctx.accounts.token_program.to_account_info(),
            &[
                PENALTY_VAULT_SEED,
                proposal_key.as_ref(),
                &[ctx.bumps.penalty_vault],
            ],
        )?;
        spl_token_transfer(
            &ctx.accounts.token_program.to_account_info(),
            &ctx.accounts.funder_token_account.to_account_info(),
            &ctx.accounts.bounty_vault.to_account_info(),
            &ctx.accounts.funder.to_account_info(),
            ctx.accounts.economic_policy.bounty_amount,
            None,
        )?;
        spl_token_transfer(
            &ctx.accounts.token_program.to_account_info(),
            &ctx.accounts.funder_token_account.to_account_info(),
            &ctx.accounts.fee_vault.to_account_info(),
            &ctx.accounts.funder.to_account_info(),
            fee_reserve,
            None,
        )?;
        let escrow = &mut ctx.accounts.proposal_escrow;
        escrow.proposal = proposal_key;
        escrow.economic_policy = ctx.accounts.economic_policy.key();
        escrow.funder = funder;
        escrow.payment_mint = ctx.accounts.payment_mint.key();
        escrow.bounty_vault = ctx.accounts.bounty_vault.key();
        escrow.fee_vault = ctx.accounts.fee_vault.key();
        escrow.penalty_vault = ctx.accounts.penalty_vault.key();
        escrow.bounty_amount = ctx.accounts.economic_policy.bounty_amount;
        escrow.fee_reserve_amount = fee_reserve;
        escrow.max_bonded_challenges = ctx.accounts.economic_policy.max_bonded_challenges;
        escrow.committed_challenge_count = 0;
        escrow.unsettled_bonds = 0;
        escrow.unclosed_rounds = 0;
        escrow.bounty_status = BountyStatus::Pending;
        escrow.winning_round = None;
        escrow.winning_trace_claim = None;
        escrow.funded_at_slot = Clock::get()?.slot;
        escrow.refund_eligible_slot = None;
        escrow.bounty_settled_at_slot = None;
        escrow.bounty_paid = 0;
        escrow.fees_claimed = 0;
        escrow.refunds_paid = 0;
        escrow.bump = ctx.bumps.proposal_escrow;
        emit!(ProposalEscrowFunded {
            proposal: proposal_key,
            proposal_escrow: escrow.key(),
            economic_policy: escrow.economic_policy,
            funder,
            bounty_amount: escrow.bounty_amount,
            fee_reserve_amount: fee_reserve,
            slot: escrow.funded_at_slot,
        });
        Ok(())
    }

    pub fn initialize_invariant(
        ctx: Context<InitializeInvariant>,
        invariant_id: u64,
        invariant_kind: InvariantKind,
        name_hash: [u8; 32],
        specification_hash: [u8; 32],
    ) -> Result<()> {
        require!(!is_zero_hash(&name_hash), FaultlineError::ZeroNameHash);
        require!(
            !is_zero_hash(&specification_hash),
            FaultlineError::ZeroSpecificationHash
        );
        let slot = Clock::get()?.slot;
        let invariant = &mut ctx.accounts.invariant;
        invariant.safety_policy = ctx.accounts.policy.key();
        invariant.invariant_id = invariant_id;
        invariant.invariant_kind = invariant_kind;
        invariant.name_hash = name_hash;
        invariant.specification_hash = specification_hash;
        invariant.enabled = true;
        invariant.created_by = ctx.accounts.governance.key();
        invariant.created_at_slot = slot;
        invariant.disabled_at_slot = None;
        invariant.bump = ctx.bumps.invariant;
        emit!(InvariantInitialized {
            policy: invariant.safety_policy,
            invariant: invariant.key(),
            invariant_id,
            invariant_kind,
            actor: invariant.created_by,
            slot,
        });
        Ok(())
    }

    pub fn set_invariant_enabled(ctx: Context<SetInvariantEnabled>, enabled: bool) -> Result<()> {
        let invariant = &mut ctx.accounts.invariant;
        require!(
            invariant.enabled != enabled,
            FaultlineError::RepeatedInvariantStatus
        );
        let slot = Clock::get()?.slot;
        invariant.enabled = enabled;
        invariant.disabled_at_slot = if enabled { None } else { Some(slot) };
        emit!(InvariantStatusChanged {
            policy: ctx.accounts.policy.key(),
            invariant: invariant.key(),
            invariant_id: invariant.invariant_id,
            actor: ctx.accounts.governance.key(),
            slot,
            enabled,
        });
        Ok(())
    }

    pub fn create_upgrade_proposal(
        ctx: Context<CreateUpgradeProposal>,
        proposal_id: u64,
        expected_candidate_hash: [u8; 32],
    ) -> Result<()> {
        let policy = &ctx.accounts.policy;
        require!(
            policy.status == PolicyStatus::Active,
            FaultlineError::PolicyPaused
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
        let actual_hash = candidate_buffer_hash(&ctx.accounts.candidate_buffer.to_account_info())?;
        require!(
            actual_hash == expected_candidate_hash,
            FaultlineError::CandidateHashMismatch
        );
        let slot = Clock::get()?.slot;
        let proposal = &mut ctx.accounts.proposal;
        proposal.policy = policy.key();
        proposal.proposal_id = proposal_id;
        proposal.target_program = ctx.accounts.target_program.key();
        proposal.program_data = ctx.accounts.program_data.key();
        proposal.candidate_buffer = ctx.accounts.candidate_buffer.key();
        proposal.candidate_buffer_hash = actual_hash;
        proposal.proposer = ctx.accounts.proposer.key();
        proposal.created_at_slot = slot;
        proposal.challenge_start_slot = None;
        proposal.challenge_end_slot = None;
        proposal.state = ProposalState::Draft;
        proposal.decision_authority = None;
        proposal.decision_slot = None;
        proposal.decision_reason_code = None;
        proposal.executed_at_slot = None;
        proposal.bump = ctx.bumps.proposal;
        let claim = &mut ctx.accounts.buffer_claim;
        claim.proposal = proposal.key();
        claim.candidate_buffer = ctx.accounts.candidate_buffer.key();
        claim.bump = ctx.bumps.buffer_claim;
        let verification_gate = &mut ctx.accounts.proposal_verification_gate;
        verification_gate.proposal = proposal.key();
        verification_gate.pending_rounds = 0;
        verification_gate.confirmed_violation = false;
        verification_gate.last_violation_round = None;
        verification_gate.bump = ctx.bumps.proposal_verification_gate;
        ctx.accounts.guard_config.proposal_nonce = ctx
            .accounts
            .guard_config
            .proposal_nonce
            .checked_add(1)
            .ok_or(FaultlineError::ArithmeticOverflow)?;
        emit!(UpgradeProposalCreated {
            policy: policy.key(),
            proposal: proposal.key(),
            target_program: proposal.target_program,
            candidate_buffer: proposal.candidate_buffer,
            actor: proposal.proposer,
            slot,
            state: proposal.state
        });
        Ok(())
    }

    /// The proposer opens its own proposal; governance may open it as the configured recovery operator.
    pub fn start_challenge(
        ctx: Context<StartChallenge>,
        challenge_duration_slots: u64,
    ) -> Result<()> {
        require_historical_proposal(
            &ctx.accounts.proposal,
            &ctx.accounts.economic_policy_registry,
        )?;
        require!(
            ctx.accounts.policy.status == PolicyStatus::Active,
            FaultlineError::PolicyPaused
        );
        let actor = ctx.accounts.actor.key();
        let policy = &ctx.accounts.policy;
        let proposal = &mut ctx.accounts.proposal;
        require!(
            proposal.state == ProposalState::Draft,
            FaultlineError::InvalidProposalTransition
        );
        require!(
            actor == proposal.proposer || actor == policy.governance_authority,
            FaultlineError::UnauthorizedChallengeStarter
        );
        require!(
            challenge_duration_slots >= policy.min_challenge_slots,
            FaultlineError::ChallengeDurationTooShort
        );
        let start = Clock::get()?.slot;
        let end = start
            .checked_add(challenge_duration_slots)
            .ok_or(FaultlineError::ArithmeticOverflow)?;
        proposal.challenge_start_slot = Some(start);
        proposal.challenge_end_slot = Some(end);
        proposal.state = ProposalState::ChallengeActive;
        emit!(ChallengeStarted {
            policy: policy.key(),
            proposal: proposal.key(),
            target_program: proposal.target_program,
            candidate_buffer: proposal.candidate_buffer,
            actor,
            start_slot: start,
            end_slot: end,
            state: proposal.state
        });
        Ok(())
    }

    pub fn commit_challenge(
        ctx: Context<CommitChallenge>,
        commitment_hash: [u8; 32],
    ) -> Result<()> {
        require_historical_proposal(
            &ctx.accounts.proposal,
            &ctx.accounts.economic_policy_registry,
        )?;
        require!(
            ctx.accounts.policy.status == PolicyStatus::Active,
            FaultlineError::PolicyPaused
        );
        require!(
            ctx.accounts.proposal.state == ProposalState::ChallengeActive,
            FaultlineError::ChallengeNotActive
        );
        require!(
            ctx.accounts.invariant.enabled,
            FaultlineError::InvariantDisabled
        );
        require!(
            !is_zero_hash(&commitment_hash),
            FaultlineError::ZeroCommitmentHash
        );
        let start = ctx
            .accounts
            .proposal
            .challenge_start_slot
            .ok_or(FaultlineError::MissingChallengeWindow)?;
        let end = ctx
            .accounts
            .proposal
            .challenge_end_slot
            .ok_or(FaultlineError::MissingChallengeWindow)?;
        let slot = Clock::get()?.slot;
        require!(slot >= start, FaultlineError::ChallengeWindowNotStarted);
        require!(slot <= end, FaultlineError::ChallengeWindowEnded);
        let earliest_reveal_slot = slot
            .checked_add(MIN_REVEAL_DELAY_SLOTS)
            .ok_or(FaultlineError::ArithmeticOverflow)?;
        require!(
            earliest_reveal_slot <= end,
            FaultlineError::InsufficientRevealWindow
        );
        let horizon = slot
            .checked_add(MAX_REVEAL_HORIZON_SLOTS)
            .ok_or(FaultlineError::ArithmeticOverflow)?;
        let latest_reveal_slot = core::cmp::min(horizon, end);
        let challenge_commit = &mut ctx.accounts.challenge_commit;
        challenge_commit.proposal = ctx.accounts.proposal.key();
        challenge_commit.invariant = ctx.accounts.invariant.key();
        challenge_commit.hunter = ctx.accounts.hunter.key();
        challenge_commit.commitment_hash = commitment_hash;
        challenge_commit.committed_at_slot = slot;
        challenge_commit.earliest_reveal_slot = earliest_reveal_slot;
        challenge_commit.latest_reveal_slot = latest_reveal_slot;
        challenge_commit.status = ChallengeCommitStatus::Committed;
        challenge_commit.revealed_trace_hash = None;
        challenge_commit.revealed_at_slot = None;
        challenge_commit.bump = ctx.bumps.challenge_commit;
        emit!(ChallengeCommitted {
            policy: ctx.accounts.policy.key(),
            proposal: challenge_commit.proposal,
            invariant: challenge_commit.invariant,
            challenge_commit: challenge_commit.key(),
            hunter: challenge_commit.hunter,
            commitment_hash,
            committed_at_slot: slot,
            earliest_reveal_slot,
            latest_reveal_slot,
        });
        Ok(())
    }

    pub fn reveal_challenge(
        ctx: Context<RevealChallenge>,
        trace_hash: [u8; 32],
        salt: [u8; 32],
    ) -> Result<()> {
        let challenge_commit = &mut ctx.accounts.challenge_commit;
        require!(
            challenge_commit.status == ChallengeCommitStatus::Committed,
            FaultlineError::ChallengeAlreadyRevealed
        );
        let slot = Clock::get()?.slot;
        require!(
            slot >= challenge_commit.earliest_reveal_slot,
            FaultlineError::RevealTooEarly
        );
        require!(
            slot <= challenge_commit.latest_reveal_slot,
            FaultlineError::RevealWindowEnded
        );
        let expected = challenge_commitment(
            &challenge_commit.proposal,
            &challenge_commit.invariant,
            &challenge_commit.hunter,
            &trace_hash,
            &salt,
        );
        require!(
            expected == challenge_commit.commitment_hash,
            FaultlineError::CommitmentMismatch
        );
        let trace_claim = &mut ctx.accounts.trace_claim;
        require!(
            trace_claim.proposal == Pubkey::default(),
            FaultlineError::TraceAlreadyClaimed
        );
        trace_claim.proposal = ctx.accounts.proposal.key();
        trace_claim.invariant = ctx.accounts.invariant.key();
        trace_claim.challenge_commit = challenge_commit.key();
        trace_claim.trace_hash = trace_hash;
        trace_claim.hunter = ctx.accounts.hunter.key();
        trace_claim.revealed_at_slot = slot;
        trace_claim.bump = ctx.bumps.trace_claim;
        challenge_commit.status = ChallengeCommitStatus::Revealed;
        challenge_commit.revealed_trace_hash = Some(trace_hash);
        challenge_commit.revealed_at_slot = Some(slot);
        emit!(ChallengeRevealed {
            policy: ctx.accounts.policy.key(),
            proposal: ctx.accounts.proposal.key(),
            invariant: ctx.accounts.invariant.key(),
            challenge_commit: challenge_commit.key(),
            trace_claim: trace_claim.key(),
            hunter: ctx.accounts.hunter.key(),
            trace_hash,
            slot,
        });
        Ok(())
    }

    pub fn initialize_verifier_registry(ctx: Context<InitializeVerifierRegistry>) -> Result<()> {
        let slot = Clock::get()?.slot;
        let registry = &mut ctx.accounts.verifier_registry;
        registry.safety_policy = ctx.accounts.policy.key();
        registry.governance = ctx.accounts.governance.key();
        registry.active_epoch = None;
        registry.next_epoch_id = 0;
        registry.created_at_slot = slot;
        registry.bump = ctx.bumps.verifier_registry;
        emit!(VerifierRegistryInitialized {
            policy: registry.safety_policy,
            verifier_registry: registry.key(),
            governance: registry.governance,
            slot,
        });
        Ok(())
    }

    pub fn create_verifier_epoch(
        ctx: Context<CreateVerifierEpoch>,
        epoch_id: u64,
        verifiers: Vec<Pubkey>,
        threshold: u8,
    ) -> Result<()> {
        let mut verifiers = verifiers;
        require!(!verifiers.is_empty(), FaultlineError::EmptyVerifierSet);
        require!(
            verifiers.len() <= MAX_VERIFIERS,
            FaultlineError::TooManyVerifiers
        );
        require!(threshold > 0, FaultlineError::InvalidThreshold);
        require!(
            usize::from(threshold) <= verifiers.len(),
            FaultlineError::InvalidThreshold
        );
        require!(
            epoch_id == ctx.accounts.verifier_registry.next_epoch_id,
            FaultlineError::WrongVerifierEpoch
        );
        verifiers.sort_unstable();
        require!(
            !verifiers.windows(2).any(|pair| pair[0] == pair[1]),
            FaultlineError::DuplicateVerifier
        );
        let verifier_set_hash =
            verifier_set_hash(&ctx.accounts.policy.key(), epoch_id, threshold, &verifiers);
        let slot = Clock::get()?.slot;
        let epoch = &mut ctx.accounts.verifier_epoch;
        epoch.verifier_registry = ctx.accounts.verifier_registry.key();
        epoch.safety_policy = ctx.accounts.policy.key();
        epoch.epoch_id = epoch_id;
        epoch.verifiers = verifiers;
        epoch.threshold = threshold;
        epoch.verifier_set_hash = verifier_set_hash;
        epoch.creator = ctx.accounts.governance.key();
        epoch.created_at_slot = slot;
        epoch.bump = ctx.bumps.verifier_epoch;
        ctx.accounts.verifier_registry.next_epoch_id = ctx
            .accounts
            .verifier_registry
            .next_epoch_id
            .checked_add(1)
            .ok_or(FaultlineError::CounterOverflow)?;
        emit!(VerifierEpochCreated {
            policy: epoch.safety_policy,
            verifier_registry: epoch.verifier_registry,
            verifier_epoch: epoch.key(),
            epoch_id,
            threshold,
            verifier_set_hash,
            creator: epoch.creator,
            slot,
        });
        Ok(())
    }

    pub fn activate_verifier_epoch(ctx: Context<ActivateVerifierEpoch>) -> Result<()> {
        let registry = &mut ctx.accounts.verifier_registry;
        registry.active_epoch = Some(ctx.accounts.verifier_epoch.key());
        emit!(VerifierEpochActivated {
            policy: ctx.accounts.policy.key(),
            verifier_registry: registry.key(),
            verifier_epoch: ctx.accounts.verifier_epoch.key(),
            epoch_id: ctx.accounts.verifier_epoch.epoch_id,
            actor: ctx.accounts.governance.key(),
            slot: Clock::get()?.slot,
        });
        Ok(())
    }

    pub fn open_verification_round(ctx: Context<OpenVerificationRound>) -> Result<()> {
        require_historical_proposal(
            &ctx.accounts.proposal,
            &ctx.accounts.economic_policy_registry,
        )?;
        require!(
            ctx.accounts.policy.status == PolicyStatus::Active,
            FaultlineError::PolicyPaused
        );
        require!(
            ctx.accounts.proposal.state == ProposalState::ChallengeActive,
            FaultlineError::InvalidProposalTransition
        );
        require!(
            ctx.accounts.challenge_commit.status == ChallengeCommitStatus::Revealed,
            FaultlineError::ChallengeNotRevealed
        );
        require!(
            ctx.accounts.verifier_registry.active_epoch.is_some(),
            FaultlineError::NoActiveVerifierEpoch
        );
        require!(
            ctx.accounts.verifier_registry.active_epoch == Some(ctx.accounts.verifier_epoch.key()),
            FaultlineError::WrongVerifierEpoch
        );
        require!(
            ctx.accounts.verification_round.proposal == Pubkey::default(),
            FaultlineError::RoundAlreadyExists
        );
        let end = ctx
            .accounts
            .proposal
            .challenge_end_slot
            .ok_or(FaultlineError::MissingChallengeWindow)?;
        let slot = Clock::get()?.slot;
        let required_end = slot
            .checked_add(MIN_VERIFICATION_REMAINING_SLOTS)
            .ok_or(FaultlineError::CounterOverflow)?;
        require!(required_end <= end, FaultlineError::VerificationWindowEnded);
        let round = &mut ctx.accounts.verification_round;
        round.policy = ctx.accounts.policy.key();
        round.proposal = ctx.accounts.proposal.key();
        round.invariant = ctx.accounts.invariant.key();
        round.trace_claim = ctx.accounts.trace_claim.key();
        round.trace_hash = ctx.accounts.trace_claim.trace_hash;
        round.candidate_buffer_hash = ctx.accounts.proposal.candidate_buffer_hash;
        round.invariant_specification_hash = ctx.accounts.invariant.specification_hash;
        round.verifier_epoch = ctx.accounts.verifier_epoch.key();
        round.threshold = ctx.accounts.verifier_epoch.threshold;
        round.status = VerificationRoundStatus::Open;
        round.opened_slot = slot;
        round.finalized_slot = None;
        round.winning_replay_result = None;
        round.bump = ctx.bumps.verification_round;
        let verification_gate = &mut ctx.accounts.proposal_verification_gate;
        verification_gate.pending_rounds = verification_gate
            .pending_rounds
            .checked_add(1)
            .ok_or(FaultlineError::CounterOverflow)?;
        emit!(VerificationRoundOpened {
            policy: round.policy,
            proposal: round.proposal,
            invariant: round.invariant,
            trace_claim: round.trace_claim,
            verification_round: round.key(),
            verifier_epoch: round.verifier_epoch,
            threshold: round.threshold,
            slot,
        });
        Ok(())
    }

    pub fn start_funded_challenge(
        ctx: Context<StartFundedChallenge>,
        challenge_duration_slots: u64,
    ) -> Result<()> {
        require!(
            ctx.accounts.policy.status == PolicyStatus::Active,
            FaultlineError::PolicyPaused
        );
        require_m6_proposal(
            &ctx.accounts.proposal,
            &ctx.accounts.economic_policy_registry,
        )?;
        let mint = parse_mint(&ctx.accounts.payment_mint.to_account_info())?;
        require!(
            !mint.has_freeze_authority
                && mint.decimals == ctx.accounts.economic_policy.payment_mint_decimals,
            FaultlineError::InvalidEconomicMint
        );
        require_fully_funded_untouched_escrow(
            &ctx.accounts.proposal_escrow,
            &ctx.accounts.economic_policy,
            &ctx.accounts.bounty_vault.to_account_info(),
            &ctx.accounts.fee_vault.to_account_info(),
            &ctx.accounts.penalty_vault.to_account_info(),
        )?;
        let actor = ctx.accounts.actor.key();
        let policy = &ctx.accounts.policy;
        require!(
            ctx.accounts.proposal.state == ProposalState::Draft,
            FaultlineError::InvalidProposalTransition
        );
        require!(
            actor == ctx.accounts.proposal.proposer || actor == policy.governance_authority,
            FaultlineError::UnauthorizedChallengeStarter
        );
        require!(
            challenge_duration_slots >= policy.min_challenge_slots,
            FaultlineError::ChallengeDurationTooShort
        );
        let start = Clock::get()?.slot;
        let end = start
            .checked_add(challenge_duration_slots)
            .ok_or(FaultlineError::ArithmeticOverflow)?;
        let (_, _, refund_eligible_slot) = economic_deadlines(end, &ctx.accounts.economic_policy)?;
        let proposal = &mut ctx.accounts.proposal;
        proposal.challenge_start_slot = Some(start);
        proposal.challenge_end_slot = Some(end);
        proposal.state = ProposalState::ChallengeActive;
        ctx.accounts.proposal_escrow.refund_eligible_slot = Some(refund_eligible_slot);
        emit!(ChallengeStarted {
            policy: policy.key(),
            proposal: proposal.key(),
            target_program: proposal.target_program,
            candidate_buffer: proposal.candidate_buffer,
            actor,
            start_slot: start,
            end_slot: end,
            state: proposal.state
        });
        Ok(())
    }

    pub fn commit_bonded_challenge(
        ctx: Context<CommitBondedChallenge>,
        commitment_hash: [u8; 32],
    ) -> Result<()> {
        require!(
            ctx.accounts.policy.status == PolicyStatus::Active,
            FaultlineError::PolicyPaused
        );
        require_m6_proposal(
            &ctx.accounts.proposal,
            &ctx.accounts.economic_policy_registry,
        )?;
        require!(
            ctx.accounts.proposal.state == ProposalState::ChallengeActive,
            FaultlineError::ChallengeNotActive
        );
        require!(
            ctx.accounts.invariant.enabled,
            FaultlineError::InvariantDisabled
        );
        require!(
            !is_zero_hash(&commitment_hash),
            FaultlineError::ZeroCommitmentHash
        );
        require!(
            ctx.accounts.proposal_escrow.bounty_status == BountyStatus::Pending,
            FaultlineError::EscrowNotAvailable
        );
        require_escrow_policy_parameters(
            &ctx.accounts.proposal_escrow,
            &ctx.accounts.economic_policy,
        )?;
        let (new_committed_count, new_unsettled_bonds) = increment_bond_counters(
            ctx.accounts.proposal_escrow.committed_challenge_count,
            ctx.accounts.proposal_escrow.unsettled_bonds,
            ctx.accounts.proposal_escrow.max_bonded_challenges,
        )?;
        let start = ctx
            .accounts
            .proposal
            .challenge_start_slot
            .ok_or(FaultlineError::MissingChallengeWindow)?;
        let end = ctx
            .accounts
            .proposal
            .challenge_end_slot
            .ok_or(FaultlineError::MissingChallengeWindow)?;
        let slot = Clock::get()?.slot;
        require!(slot >= start, FaultlineError::ChallengeWindowNotStarted);
        require!(slot <= end, FaultlineError::ChallengeWindowEnded);
        let earliest_reveal_slot = slot
            .checked_add(MIN_REVEAL_DELAY_SLOTS)
            .ok_or(FaultlineError::ArithmeticOverflow)?;
        require!(
            earliest_reveal_slot <= end,
            FaultlineError::InsufficientRevealWindow
        );
        let horizon = slot
            .checked_add(MAX_REVEAL_HORIZON_SLOTS)
            .ok_or(FaultlineError::ArithmeticOverflow)?;
        let latest_reveal_slot = core::cmp::min(horizon, end);
        validate_canonical_ata(
            &ctx.accounts.hunter_token_account.to_account_info(),
            &ctx.accounts.hunter.key(),
            &ctx.accounts.economic_policy.payment_mint,
        )?;
        let commit_key = ctx.accounts.challenge_commit.key();
        let bond_key = ctx.accounts.challenge_bond.key();
        create_token_vault(
            &ctx.accounts.hunter.to_account_info(),
            &ctx.accounts.bond_vault.to_account_info(),
            &ctx.accounts.payment_mint.to_account_info(),
            &bond_key,
            &ctx.accounts.system_program.to_account_info(),
            &ctx.accounts.token_program.to_account_info(),
            &[
                BOND_VAULT_SEED,
                commit_key.as_ref(),
                &[ctx.bumps.bond_vault],
            ],
        )?;
        spl_token_transfer(
            &ctx.accounts.token_program.to_account_info(),
            &ctx.accounts.hunter_token_account.to_account_info(),
            &ctx.accounts.bond_vault.to_account_info(),
            &ctx.accounts.hunter.to_account_info(),
            ctx.accounts.economic_policy.challenger_bond_amount,
            None,
        )?;
        let challenge_commit = &mut ctx.accounts.challenge_commit;
        challenge_commit.proposal = ctx.accounts.proposal.key();
        challenge_commit.invariant = ctx.accounts.invariant.key();
        challenge_commit.hunter = ctx.accounts.hunter.key();
        challenge_commit.commitment_hash = commitment_hash;
        challenge_commit.committed_at_slot = slot;
        challenge_commit.earliest_reveal_slot = earliest_reveal_slot;
        challenge_commit.latest_reveal_slot = latest_reveal_slot;
        challenge_commit.status = ChallengeCommitStatus::Committed;
        challenge_commit.revealed_trace_hash = None;
        challenge_commit.revealed_at_slot = None;
        challenge_commit.bump = ctx.bumps.challenge_commit;
        let bond = &mut ctx.accounts.challenge_bond;
        bond.challenge_commit = commit_key;
        bond.proposal_escrow = ctx.accounts.proposal_escrow.key();
        bond.hunter = ctx.accounts.hunter.key();
        bond.bond_vault = ctx.accounts.bond_vault.key();
        bond.rent_recipient = ctx.accounts.hunter.key();
        bond.amount = ctx.accounts.economic_policy.challenger_bond_amount;
        bond.status = BondStatus::Pending;
        bond.funded_at_slot = slot;
        bond.settled_at_slot = None;
        bond.refunded_amount = 0;
        bond.forfeited_amount = 0;
        bond.bump = ctx.bumps.challenge_bond;
        ctx.accounts.proposal_escrow.committed_challenge_count = new_committed_count;
        ctx.accounts.proposal_escrow.unsettled_bonds = new_unsettled_bonds;
        emit!(ChallengeCommitted {
            policy: ctx.accounts.policy.key(),
            proposal: challenge_commit.proposal,
            invariant: challenge_commit.invariant,
            challenge_commit: commit_key,
            hunter: challenge_commit.hunter,
            commitment_hash,
            committed_at_slot: slot,
            earliest_reveal_slot,
            latest_reveal_slot,
        });
        Ok(())
    }

    pub fn open_economic_verification_round<'info>(
        ctx: Context<'_, '_, 'info, 'info, OpenEconomicVerificationRound<'info>>,
    ) -> Result<()> {
        let bindings = &mut ctx.accounts.bindings;
        require!(
            bindings.policy.status == PolicyStatus::Active,
            FaultlineError::PolicyPaused
        );
        require_m6_proposal(&bindings.proposal, &bindings.economic_policy_registry)?;
        require!(
            bindings.proposal.state == ProposalState::ChallengeActive,
            FaultlineError::InvalidProposalTransition
        );
        require!(
            bindings.challenge_commit.status == ChallengeCommitStatus::Revealed,
            FaultlineError::ChallengeNotRevealed
        );
        require!(
            bindings.challenge_bond.status == BondStatus::Pending,
            FaultlineError::BondNotPending
        );
        require!(
            bindings.challenge_bond.amount == bindings.economic_policy.challenger_bond_amount,
            FaultlineError::WrongChallengeBond
        );
        require_escrow_policy_parameters(&bindings.proposal_escrow, &bindings.economic_policy)?;
        require!(
            bindings.verifier_registry.active_epoch == Some(bindings.verifier_epoch.key()),
            FaultlineError::WrongVerifierEpoch
        );
        require!(
            ctx.accounts.verification_round.proposal == Pubkey::default(),
            FaultlineError::RoundAlreadyExists
        );
        require!(
            ctx.accounts.round_economic_state.verification_round == Pubkey::default(),
            FaultlineError::RoundAlreadyExists
        );
        let verifiers = &bindings.verifier_epoch.verifiers;
        require!(
            verifiers.len() <= MAX_VERIFIERS,
            FaultlineError::TooManyVerifiers
        );
        require!(
            ctx.remaining_accounts.len() == verifiers.len(),
            FaultlineError::WrongRemainingAccountCount
        );
        let end = bindings
            .proposal
            .challenge_end_slot
            .ok_or(FaultlineError::MissingChallengeWindow)?;
        let slot = Clock::get()?.slot;
        let required_end = slot
            .checked_add(MIN_VERIFICATION_REMAINING_SLOTS)
            .ok_or(FaultlineError::CounterOverflow)?;
        require!(required_end <= end, FaultlineError::VerificationWindowEnded);
        let (fee_deadline, slash_deadline, _) = economic_deadlines(end, &bindings.economic_policy)?;
        require!(
            bindings.proposal_escrow.refund_eligible_slot
                == Some(core::cmp::max(fee_deadline, slash_deadline)),
            FaultlineError::EscrowNotAvailable
        );
        let new_unclosed_rounds = bindings
            .proposal_escrow
            .unclosed_rounds
            .checked_add(1)
            .ok_or(FaultlineError::CounterOverflow)?;
        let new_pending_rounds = bindings
            .proposal_verification_gate
            .pending_rounds
            .checked_add(1)
            .ok_or(FaultlineError::CounterOverflow)?;
        for (expected_verifier, stake_info) in verifiers.iter().zip(ctx.remaining_accounts.iter()) {
            require!(stake_info.is_writable, FaultlineError::StakeMustBeWritable);
            require_keys_eq!(
                *stake_info.owner,
                crate::ID,
                FaultlineError::WrongAccountOwner
            );
            let (expected_stake, _) = Pubkey::find_program_address(
                &[
                    VERIFIER_STAKE_SEED,
                    bindings.economic_policy.key().as_ref(),
                    expected_verifier.as_ref(),
                ],
                &crate::ID,
            );
            require_keys_eq!(
                expected_stake,
                *stake_info.key,
                FaultlineError::WrongVerifierStake
            );
            let mut stake = Account::<VerifierStake>::try_from(stake_info)?;
            require_keys_eq!(
                stake.economic_policy,
                bindings.economic_policy.key(),
                FaultlineError::WrongEconomicPolicy
            );
            require_keys_eq!(
                stake.verifier,
                *expected_verifier,
                FaultlineError::WrongVerifierStake
            );
            require_keys_eq!(
                stake.payment_mint,
                bindings.economic_policy.payment_mint,
                FaultlineError::WrongPaymentMint
            );
            require!(
                stake.status == StakeStatus::Active,
                FaultlineError::StakeWithdrawalPending
            );
            require!(
                stake.amount >= bindings.economic_policy.minimum_verifier_stake,
                FaultlineError::StakeBelowMinimum
            );
            stake.slash_lock_until_slot =
                extended_slash_lock(stake.slash_lock_until_slot, slash_deadline);
            stake.exit(&crate::ID)?;
        }
        let round = &mut ctx.accounts.verification_round;
        round.policy = bindings.policy.key();
        round.proposal = bindings.proposal.key();
        round.invariant = bindings.invariant.key();
        round.trace_claim = bindings.trace_claim.key();
        round.trace_hash = bindings.trace_claim.trace_hash;
        round.candidate_buffer_hash = bindings.proposal.candidate_buffer_hash;
        round.invariant_specification_hash = bindings.invariant.specification_hash;
        round.verifier_epoch = bindings.verifier_epoch.key();
        round.threshold = bindings.verifier_epoch.threshold;
        round.status = VerificationRoundStatus::Open;
        round.opened_slot = slot;
        round.finalized_slot = None;
        round.winning_replay_result = None;
        round.bump = ctx.bumps.verification_round;
        let round_economics = &mut ctx.accounts.round_economic_state;
        round_economics.verification_round = round.key();
        round_economics.proposal_escrow = bindings.proposal_escrow.key();
        round_economics.verifier_epoch_economics = bindings.verifier_epoch_economics.key();
        round_economics.status = RoundEconomicStatus::Open;
        round_economics.fee_claim_deadline_slot = fee_deadline;
        round_economics.slash_claim_deadline_slot = slash_deadline;
        round_economics.opened_at_slot = slot;
        round_economics.closed_at_slot = None;
        round_economics.bump = ctx.bumps.round_economic_state;
        bindings.proposal_verification_gate.pending_rounds = new_pending_rounds;
        bindings.proposal_escrow.unclosed_rounds = new_unclosed_rounds;
        emit!(VerificationRoundOpened {
            policy: round.policy,
            proposal: round.proposal,
            invariant: round.invariant,
            trace_claim: round.trace_claim,
            verification_round: round.key(),
            verifier_epoch: round.verifier_epoch,
            threshold: round.threshold,
            slot,
        });
        Ok(())
    }

    pub fn close_finalized_round_economics(
        ctx: Context<CloseFinalizedRoundEconomics>,
    ) -> Result<()> {
        require_open_round_economics(ctx.accounts.round_economic_state.status)?;
        require!(
            ctx.accounts.verification_round.finalized_slot.is_some(),
            FaultlineError::RoundNotFinalized
        );
        let new_unclosed_rounds = decrement_liability(
            ctx.accounts.proposal_escrow.unclosed_rounds,
            FaultlineError::UnclosedRoundsUnderflow,
        )?;
        let new_status = match ctx.accounts.verification_round.status {
            VerificationRoundStatus::InvariantHolds => RoundEconomicStatus::FinalizedHold,
            VerificationRoundStatus::InvariantViolated => {
                require!(
                    ctx.accounts.proposal_verification_gate.confirmed_violation,
                    FaultlineError::WrongWinningRound
                );
                require!(
                    ctx.accounts.proposal_verification_gate.last_violation_round
                        == Some(ctx.accounts.verification_round.key()),
                    FaultlineError::WrongWinningRound
                );
                let (winning_round, winning_trace_claim) = canonical_winner(
                    ctx.accounts.proposal_escrow.winning_round,
                    ctx.accounts.proposal_escrow.winning_trace_claim,
                    ctx.accounts.proposal_verification_gate.last_violation_round,
                    ctx.accounts.verification_round.key(),
                    ctx.accounts.verification_round.trace_claim,
                )?;
                ctx.accounts.proposal_escrow.winning_round = Some(winning_round);
                ctx.accounts.proposal_escrow.winning_trace_claim = Some(winning_trace_claim);
                RoundEconomicStatus::FinalizedViolation
            }
            VerificationRoundStatus::Open => return err!(FaultlineError::RoundNotFinalized),
        };
        ctx.accounts.round_economic_state.status = new_status;
        ctx.accounts.round_economic_state.closed_at_slot = Some(Clock::get()?.slot);
        ctx.accounts.proposal_escrow.unclosed_rounds = new_unclosed_rounds;
        Ok(())
    }

    pub fn close_unfinalized_round_economics(
        ctx: Context<CloseUnfinalizedRoundEconomics>,
    ) -> Result<()> {
        require_open_round_economics(ctx.accounts.round_economic_state.status)?;
        require!(
            ctx.accounts.verification_round.status == VerificationRoundStatus::Open
                && ctx.accounts.verification_round.finalized_slot.is_none(),
            FaultlineError::RoundAlreadyFinalized
        );
        let end = ctx
            .accounts
            .proposal
            .challenge_end_slot
            .ok_or(FaultlineError::MissingChallengeWindow)?;
        let slot = Clock::get()?.slot;
        require!(
            strictly_after_deadline(slot, end),
            FaultlineError::ChallengeWindowStillActive
        );
        let new_status = unfinalized_round_economic_status(
            ctx.accounts.proposal.state,
            ctx.accounts.proposal_verification_gate.confirmed_violation,
            ctx.accounts.proposal_verification_gate.last_violation_round,
            ctx.accounts.verification_round.key(),
        )?;
        let new_unclosed_rounds = decrement_liability(
            ctx.accounts.proposal_escrow.unclosed_rounds,
            FaultlineError::UnclosedRoundsUnderflow,
        )?;
        ctx.accounts.round_economic_state.status = new_status;
        ctx.accounts.round_economic_state.closed_at_slot = Some(slot);
        ctx.accounts.proposal_escrow.unclosed_rounds = new_unclosed_rounds;
        Ok(())
    }

    pub fn settle_accepted_challenge(ctx: Context<SettleAcceptedChallenge>) -> Result<()> {
        validate_settlement_base(&ctx.accounts.base)?;
        require!(
            ctx.accounts.round_economic_state.status == RoundEconomicStatus::FinalizedViolation,
            FaultlineError::WrongRoundEconomicStatus
        );
        require!(
            ctx.accounts.challenge_commit.status == ChallengeCommitStatus::Revealed,
            FaultlineError::ChallengeNotRevealed
        );
        require_canonical_accepted_winner(
            ctx.accounts.proposal_verification_gate.confirmed_violation,
            ctx.accounts.proposal_verification_gate.last_violation_round,
            ctx.accounts.base.proposal_escrow.winning_round,
            ctx.accounts.base.proposal_escrow.winning_trace_claim,
            ctx.accounts.verification_round.key(),
            ctx.accounts.trace_claim.key(),
        )?;
        require!(
            ctx.accounts.challenge_bond.status == BondStatus::Pending,
            FaultlineError::BondNotPending
        );
        require!(
            ctx.accounts.base.proposal_escrow.bounty_status == BountyStatus::Pending,
            FaultlineError::BountyAlreadySettled
        );
        require!(
            ctx.accounts
                .base
                .proposal_escrow
                .bounty_settled_at_slot
                .is_none()
                && ctx.accounts.base.proposal_escrow.bounty_paid == 0,
            FaultlineError::BountyAlreadySettled
        );
        validate_canonical_ata(
            &ctx.accounts.hunter_token_account.to_account_info(),
            &ctx.accounts.challenge_bond.hunter,
            &ctx.accounts.base.economic_policy.payment_mint,
        )?;
        let bounty = validate_token_vault(
            &ctx.accounts.bounty_vault.to_account_info(),
            &ctx.accounts.base.economic_policy.payment_mint,
            &ctx.accounts.base.proposal_escrow.key(),
        )?;
        let configured_bounty = configured_bounty_payout(
            bounty.amount,
            ctx.accounts.base.proposal_escrow.bounty_amount,
        )?;
        let bond_vault = validate_bond_vault(
            &ctx.accounts.challenge_bond,
            &ctx.accounts.bond_vault.to_account_info(),
            &ctx.accounts.base.economic_policy.payment_mint,
        )?;
        let new_unsettled = decrement_liability(
            ctx.accounts.base.proposal_escrow.unsettled_bonds,
            FaultlineError::UnsettledBondsUnderflow,
        )?;
        let (bounty_amount, bond_amount) =
            accepted_settlement_amounts(configured_bounty, ctx.accounts.challenge_bond.amount);
        transfer_from_proposal_escrow(
            &ctx.accounts.base,
            &ctx.accounts.bounty_vault.to_account_info(),
            &ctx.accounts.hunter_token_account.to_account_info(),
            bounty_amount,
        )?;
        transfer_from_challenge_bond(
            &ctx.accounts.base,
            &ctx.accounts.challenge_commit,
            &ctx.accounts.challenge_bond,
            &ctx.accounts.bond_vault.to_account_info(),
            &ctx.accounts.hunter_token_account.to_account_info(),
            bond_vault.amount,
        )?;
        close_empty_bond_vault(
            &ctx.accounts.base,
            &ctx.accounts.challenge_commit,
            &ctx.accounts.challenge_bond,
            &ctx.accounts.bond_vault.to_account_info(),
            &ctx.accounts.rent_recipient.to_account_info(),
        )?;
        let slot = Clock::get()?.slot;
        ctx.accounts.base.proposal_escrow.bounty_status = BountyStatus::PaidToHunter;
        ctx.accounts.base.proposal_escrow.bounty_settled_at_slot = Some(slot);
        ctx.accounts.base.proposal_escrow.bounty_paid = bounty_amount;
        ctx.accounts.base.proposal_escrow.unsettled_bonds = new_unsettled;
        ctx.accounts.challenge_bond.status = BondStatus::AcceptedReturned;
        ctx.accounts.challenge_bond.settled_at_slot = Some(slot);
        ctx.accounts.challenge_bond.refunded_amount = bond_amount;
        ctx.accounts.challenge_bond.forfeited_amount = 0;
        Ok(())
    }

    pub fn settle_hold_challenge(ctx: Context<SettleHoldChallenge>) -> Result<()> {
        validate_settlement_base(&ctx.accounts.base)?;
        require!(
            ctx.accounts.round_economic_state.status == RoundEconomicStatus::FinalizedHold,
            FaultlineError::WrongRoundEconomicStatus
        );
        require!(
            ctx.accounts.challenge_commit.status == ChallengeCommitStatus::Revealed,
            FaultlineError::ChallengeNotRevealed
        );
        require!(
            ctx.accounts.challenge_bond.status == BondStatus::Pending,
            FaultlineError::BondNotPending
        );
        validate_canonical_ata(
            &ctx.accounts.hunter_token_account.to_account_info(),
            &ctx.accounts.challenge_bond.hunter,
            &ctx.accounts.base.economic_policy.payment_mint,
        )?;
        let bond_vault = validate_bond_vault(
            &ctx.accounts.challenge_bond,
            &ctx.accounts.bond_vault.to_account_info(),
            &ctx.accounts.base.economic_policy.payment_mint,
        )?;
        validate_token_vault(
            &ctx.accounts.penalty_vault.to_account_info(),
            &ctx.accounts.base.economic_policy.payment_mint,
            &ctx.accounts.base.proposal_escrow.key(),
        )?;
        let (penalty, refund) = hold_bond_split(ctx.accounts.challenge_bond.amount)?;
        let new_unsettled = decrement_liability(
            ctx.accounts.base.proposal_escrow.unsettled_bonds,
            FaultlineError::UnsettledBondsUnderflow,
        )?;
        transfer_from_challenge_bond(
            &ctx.accounts.base,
            &ctx.accounts.challenge_commit,
            &ctx.accounts.challenge_bond,
            &ctx.accounts.bond_vault.to_account_info(),
            &ctx.accounts.penalty_vault.to_account_info(),
            penalty,
        )?;
        transfer_from_challenge_bond(
            &ctx.accounts.base,
            &ctx.accounts.challenge_commit,
            &ctx.accounts.challenge_bond,
            &ctx.accounts.bond_vault.to_account_info(),
            &ctx.accounts.hunter_token_account.to_account_info(),
            refund,
        )?;
        require!(
            bond_vault.amount
                == penalty
                    .checked_add(refund)
                    .ok_or(FaultlineError::ArithmeticOverflow)?,
            FaultlineError::VaultBalanceMismatch
        );
        close_empty_bond_vault(
            &ctx.accounts.base,
            &ctx.accounts.challenge_commit,
            &ctx.accounts.challenge_bond,
            &ctx.accounts.bond_vault.to_account_info(),
            &ctx.accounts.rent_recipient.to_account_info(),
        )?;
        settle_bond_tombstone(
            &mut ctx.accounts.challenge_bond,
            BondStatus::HoldPenalized,
            refund,
            penalty,
            Clock::get()?.slot,
        );
        ctx.accounts.base.proposal_escrow.unsettled_bonds = new_unsettled;
        Ok(())
    }

    pub fn settle_non_reveal_challenge(ctx: Context<SettleNonRevealChallenge>) -> Result<()> {
        validate_settlement_base(&ctx.accounts.base)?;
        require!(
            ctx.accounts.challenge_commit.status == ChallengeCommitStatus::Committed,
            FaultlineError::ChallengeAlreadyRevealed
        );
        require!(
            strictly_after_deadline(
                Clock::get()?.slot,
                ctx.accounts.challenge_commit.latest_reveal_slot
            ),
            FaultlineError::RevealWindowStillActive
        );
        require!(
            ctx.accounts.challenge_bond.status == BondStatus::Pending,
            FaultlineError::BondNotPending
        );
        let bond_vault = validate_bond_vault(
            &ctx.accounts.challenge_bond,
            &ctx.accounts.bond_vault.to_account_info(),
            &ctx.accounts.base.economic_policy.payment_mint,
        )?;
        validate_token_vault(
            &ctx.accounts.penalty_vault.to_account_info(),
            &ctx.accounts.base.economic_policy.payment_mint,
            &ctx.accounts.base.proposal_escrow.key(),
        )?;
        let penalty = penalty_amount(
            ctx.accounts.challenge_bond.amount,
            HUNTER_NON_REVEAL_SLASH_BPS,
        )?;
        require!(penalty > 0, FaultlineError::ZeroSettlementAmount);
        require!(
            bond_vault.amount == penalty,
            FaultlineError::VaultBalanceMismatch
        );
        let new_unsettled = decrement_liability(
            ctx.accounts.base.proposal_escrow.unsettled_bonds,
            FaultlineError::UnsettledBondsUnderflow,
        )?;
        transfer_from_challenge_bond(
            &ctx.accounts.base,
            &ctx.accounts.challenge_commit,
            &ctx.accounts.challenge_bond,
            &ctx.accounts.bond_vault.to_account_info(),
            &ctx.accounts.penalty_vault.to_account_info(),
            penalty,
        )?;
        close_empty_bond_vault(
            &ctx.accounts.base,
            &ctx.accounts.challenge_commit,
            &ctx.accounts.challenge_bond,
            &ctx.accounts.bond_vault.to_account_info(),
            &ctx.accounts.rent_recipient.to_account_info(),
        )?;
        settle_bond_tombstone(
            &mut ctx.accounts.challenge_bond,
            BondStatus::NonRevealPenalized,
            0,
            penalty,
            Clock::get()?.slot,
        );
        ctx.accounts.base.proposal_escrow.unsettled_bonds = new_unsettled;
        Ok(())
    }

    pub fn settle_timed_out_or_aborted_challenge(
        ctx: Context<SettleRoundRefundChallenge>,
    ) -> Result<()> {
        validate_settlement_base(&ctx.accounts.base)?;
        let status = match ctx.accounts.round_economic_state.status {
            RoundEconomicStatus::TimedOut => BondStatus::TimeoutReturned,
            RoundEconomicStatus::Aborted => BondStatus::AbortedReturned,
            _ => return err!(FaultlineError::WrongRoundEconomicStatus),
        };
        require!(
            ctx.accounts.challenge_commit.status == ChallengeCommitStatus::Revealed,
            FaultlineError::ChallengeNotRevealed
        );
        settle_full_bond_refund(
            &mut ctx.accounts.base,
            &ctx.accounts.challenge_commit,
            &mut ctx.accounts.challenge_bond,
            &ctx.accounts.hunter_token_account.to_account_info(),
            &ctx.accounts.bond_vault.to_account_info(),
            &ctx.accounts.rent_recipient.to_account_info(),
            status,
        )
    }

    pub fn settle_revealed_unopened_challenge(
        ctx: Context<SettleRevealedUnopenedChallenge>,
    ) -> Result<()> {
        validate_settlement_base(&ctx.accounts.base)?;
        require!(
            ctx.accounts.challenge_commit.status == ChallengeCommitStatus::Revealed,
            FaultlineError::ChallengeNotRevealed
        );
        require!(
            canonical_account_absent(&ctx.accounts.verification_round.to_account_info())
                && canonical_account_absent(&ctx.accounts.round_economic_state.to_account_info()),
            FaultlineError::RoundAlreadyExists
        );
        let end = ctx
            .accounts
            .base
            .proposal
            .challenge_end_slot
            .ok_or(FaultlineError::MissingChallengeWindow)?;
        let slot = Clock::get()?.slot;
        require!(
            revealed_unopened_eligible(ctx.accounts.base.proposal.state, slot, end),
            FaultlineError::RevealedUnopenedNotEligible
        );
        settle_full_bond_refund(
            &mut ctx.accounts.base,
            &ctx.accounts.challenge_commit,
            &mut ctx.accounts.challenge_bond,
            &ctx.accounts.hunter_token_account.to_account_info(),
            &ctx.accounts.bond_vault.to_account_info(),
            &ctx.accounts.rent_recipient.to_account_info(),
            BondStatus::RevealedUnopenedReturned,
        )
    }

    pub fn claim_verifier_fee(ctx: Context<ClaimVerifierFee>) -> Result<()> {
        validate_settlement_base(&ctx.accounts.base)?;
        require_keys_eq!(
            ctx.accounts.round_economic_state.verifier_epoch_economics,
            verifier_epoch_economics_address(
                &ctx.accounts.verifier_epoch.key(),
                &ctx.accounts.base.economic_policy.key(),
            ),
            FaultlineError::WrongVerifierEpochEconomics
        );
        require_finalized_economic_result(
            ctx.accounts.verification_round.status,
            ctx.accounts.round_economic_state.status,
            ctx.accounts.replay_result.verdict,
        )?;
        require!(
            ctx.accounts.verification_round.winning_replay_result
                == Some(ctx.accounts.replay_result.key()),
            FaultlineError::WrongResultBinding
        );
        require!(
            ctx.accounts
                .verifier_epoch
                .verifiers
                .contains(&ctx.accounts.verifier.key()),
            FaultlineError::UnauthorizedVerifier
        );
        require!(
            attestation_matches_winner(
                &ctx.accounts.verifier_attestation,
                ctx.accounts.verification_round.key(),
                ctx.accounts.verifier.key(),
                ctx.accounts.verifier_epoch.key(),
                ctx.accounts.replay_result.key(),
                ctx.accounts.replay_result.result_hash,
            ),
            FaultlineError::WrongAttestationBinding
        );
        require!(
            ctx.accounts.verifier_attestation.attested_slot
                <= ctx
                    .accounts
                    .verification_round
                    .finalized_slot
                    .ok_or(FaultlineError::RoundNotFinalized)?,
            FaultlineError::AttestationAfterFinalization
        );
        let slot = Clock::get()?.slot;
        require!(
            fee_claim_is_timely(
                slot,
                ctx.accounts.round_economic_state.fee_claim_deadline_slot
            ),
            FaultlineError::FeeClaimDeadlinePassed
        );
        require!(
            ctx.accounts.verifier_fee_claim.verification_round == Pubkey::default(),
            FaultlineError::VerifierFeeAlreadyClaimed
        );
        validate_canonical_ata(
            &ctx.accounts.verifier_token_account.to_account_info(),
            &ctx.accounts.verifier.key(),
            &ctx.accounts.base.economic_policy.payment_mint,
        )?;
        let fee_vault = validate_token_vault(
            &ctx.accounts.fee_vault.to_account_info(),
            &ctx.accounts.base.economic_policy.payment_mint,
            &ctx.accounts.base.proposal_escrow.key(),
        )?;
        let fee_amount = ctx.accounts.base.economic_policy.verifier_fee_amount;
        require!(
            fee_vault.amount >= fee_amount,
            FaultlineError::VaultBalanceMismatch
        );
        let new_fees_claimed = checked_fee_claim_total(
            ctx.accounts.base.proposal_escrow.fees_claimed,
            fee_amount,
            ctx.accounts.base.proposal_escrow.fee_reserve_amount,
        )?;
        transfer_from_proposal_escrow(
            &ctx.accounts.base,
            &ctx.accounts.fee_vault.to_account_info(),
            &ctx.accounts.verifier_token_account.to_account_info(),
            fee_amount,
        )?;
        let claim = &mut ctx.accounts.verifier_fee_claim;
        claim.verification_round = ctx.accounts.verification_round.key();
        claim.verifier = ctx.accounts.verifier.key();
        claim.attestation = ctx.accounts.verifier_attestation.key();
        claim.proposal_escrow = ctx.accounts.base.proposal_escrow.key();
        claim.amount = fee_amount;
        claim.claimed_at_slot = slot;
        claim.bump = ctx.bumps.verifier_fee_claim;
        ctx.accounts.base.proposal_escrow.fees_claimed = new_fees_claimed;
        Ok(())
    }

    pub fn slash_verifier_non_reveal(ctx: Context<SlashVerifierNonReveal>) -> Result<()> {
        validate_settlement_base(&ctx.accounts.base)?;
        require!(
            ctx.accounts
                .verifier_epoch
                .verifiers
                .contains(&ctx.accounts.verifier.key()),
            FaultlineError::UnauthorizedVerifier
        );
        require_keys_eq!(
            ctx.accounts.round_economic_state.verifier_epoch_economics,
            verifier_epoch_economics_address(
                &ctx.accounts.verifier_epoch.key(),
                &ctx.accounts.base.economic_policy.key(),
            ),
            FaultlineError::WrongVerifierEpochEconomics
        );
        require!(
            ctx.accounts.verifier_stake.slash_lock_until_slot
                >= ctx.accounts.round_economic_state.slash_claim_deadline_slot,
            FaultlineError::StakeSlashLockTooShort
        );
        let end = ctx
            .accounts
            .base
            .proposal
            .challenge_end_slot
            .ok_or(FaultlineError::MissingChallengeWindow)?;
        let slot = Clock::get()?.slot;
        objective_slash_is_allowed(
            ctx.accounts.base.proposal.state,
            ctx.accounts.verification_round.status,
            ctx.accounts.round_economic_state.status,
            slot,
            end,
            ctx.accounts.round_economic_state.slash_claim_deadline_slot,
            canonical_account_absent(&ctx.accounts.verifier_attestation.to_account_info()),
        )?;
        require!(
            stake_status_is_slashable(ctx.accounts.verifier_stake.status),
            FaultlineError::WrongStakeStatus
        );
        require!(
            ctx.accounts.verifier_slash_receipt.verification_round == Pubkey::default(),
            FaultlineError::VerifierAlreadySlashed
        );
        let stake_vault = validate_token_vault(
            &ctx.accounts.stake_vault.to_account_info(),
            &ctx.accounts.base.economic_policy.payment_mint,
            &ctx.accounts.verifier_stake.key(),
        )?;
        require!(
            stake_vault.amount == ctx.accounts.verifier_stake.amount,
            FaultlineError::VaultBalanceMismatch
        );
        validate_token_vault(
            &ctx.accounts.penalty_vault.to_account_info(),
            &ctx.accounts.base.economic_policy.payment_mint,
            &ctx.accounts.base.proposal_escrow.key(),
        )?;
        let slash_amount = objective_slash_amount(
            ctx.accounts
                .base
                .economic_policy
                .verifier_non_reveal_slash_amount,
            ctx.accounts.verifier_stake.amount,
        )?;
        let remaining_stake = ctx
            .accounts
            .verifier_stake
            .amount
            .checked_sub(slash_amount)
            .ok_or(FaultlineError::ArithmeticOverflow)?;
        let total_slashed = ctx
            .accounts
            .verifier_stake
            .total_slashed
            .checked_add(slash_amount)
            .ok_or(FaultlineError::ArithmeticOverflow)?;
        transfer_from_verifier_stake(
            &ctx.accounts.base,
            &ctx.accounts.verifier,
            &ctx.accounts.verifier_stake,
            &ctx.accounts.stake_vault.to_account_info(),
            &ctx.accounts.penalty_vault.to_account_info(),
            slash_amount,
        )?;
        ctx.accounts.verifier_stake.amount = remaining_stake;
        ctx.accounts.verifier_stake.total_slashed = total_slashed;
        let receipt = &mut ctx.accounts.verifier_slash_receipt;
        receipt.verification_round = ctx.accounts.verification_round.key();
        receipt.verifier_stake = ctx.accounts.verifier_stake.key();
        receipt.verifier = ctx.accounts.verifier.key();
        receipt.proposal_escrow = ctx.accounts.base.proposal_escrow.key();
        receipt.amount = slash_amount;
        receipt.slashed_at_slot = slot;
        receipt.bump = ctx.bumps.verifier_slash_receipt;
        Ok(())
    }

    pub fn refund_proposal_escrow(ctx: Context<RefundProposalEscrow>) -> Result<()> {
        validate_settlement_base(&ctx.accounts.base)?;
        require!(
            proposal_is_terminal_for_refund(ctx.accounts.base.proposal.state),
            FaultlineError::ProposalNotTerminal
        );
        let refund_slot = ctx
            .accounts
            .base
            .proposal_escrow
            .refund_eligible_slot
            .ok_or(FaultlineError::RefundNotAvailable)?;
        require!(
            refund_is_timely(Clock::get()?.slot, refund_slot),
            FaultlineError::RefundDeadlineNotReached
        );
        require_refund_liabilities_clear(
            ctx.accounts.base.proposal_escrow.unsettled_bonds,
            ctx.accounts.base.proposal_escrow.unclosed_rounds,
        )?;
        let post_refund_bounty_status =
            bounty_status_after_refund(ctx.accounts.base.proposal_escrow.bounty_status)?;
        validate_canonical_ata(
            &ctx.accounts.funder_token_account.to_account_info(),
            &ctx.accounts.base.proposal_escrow.funder,
            &ctx.accounts.base.economic_policy.payment_mint,
        )?;
        let bounty = validate_token_vault(
            &ctx.accounts.bounty_vault.to_account_info(),
            &ctx.accounts.base.economic_policy.payment_mint,
            &ctx.accounts.base.proposal_escrow.key(),
        )?;
        let fee = validate_token_vault(
            &ctx.accounts.fee_vault.to_account_info(),
            &ctx.accounts.base.economic_policy.payment_mint,
            &ctx.accounts.base.proposal_escrow.key(),
        )?;
        let penalty = validate_token_vault(
            &ctx.accounts.penalty_vault.to_account_info(),
            &ctx.accounts.base.economic_policy.payment_mint,
            &ctx.accounts.base.proposal_escrow.key(),
        )?;
        let refund_total = checked_refund_total(bounty.amount, fee.amount, penalty.amount)?;
        transfer_and_close_proposal_vault(
            &ctx.accounts.base,
            &ctx.accounts.bounty_vault.to_account_info(),
            &ctx.accounts.funder_token_account.to_account_info(),
            &ctx.accounts.rent_recipient.to_account_info(),
            bounty.amount,
        )?;
        transfer_and_close_proposal_vault(
            &ctx.accounts.base,
            &ctx.accounts.fee_vault.to_account_info(),
            &ctx.accounts.funder_token_account.to_account_info(),
            &ctx.accounts.rent_recipient.to_account_info(),
            fee.amount,
        )?;
        transfer_and_close_proposal_vault(
            &ctx.accounts.base,
            &ctx.accounts.penalty_vault.to_account_info(),
            &ctx.accounts.funder_token_account.to_account_info(),
            &ctx.accounts.rent_recipient.to_account_info(),
            penalty.amount,
        )?;
        ctx.accounts.base.proposal_escrow.bounty_status = post_refund_bounty_status;
        ctx.accounts.base.proposal_escrow.refunds_paid = ctx
            .accounts
            .base
            .proposal_escrow
            .refunds_paid
            .checked_add(refund_total)
            .ok_or(FaultlineError::ArithmeticOverflow)?;
        Ok(())
    }

    pub fn create_replay_result(
        ctx: Context<CreateReplayResult>,
        result_hash: [u8; 32],
        verdict: ReplayVerdict,
        replay_receipt_hash: [u8; 32],
    ) -> Result<()> {
        require!(
            ctx.accounts.verification_round.status == VerificationRoundStatus::Open,
            FaultlineError::RoundNotOpen
        );
        let expected = replay_result_commitment(
            &ctx.accounts.verification_round.proposal,
            &ctx.accounts.verification_round.invariant,
            &ctx.accounts.verification_round.trace_claim,
            &ctx.accounts.verification_round.candidate_buffer_hash,
            &ctx.accounts.verification_round.invariant_specification_hash,
            verdict,
            &replay_receipt_hash,
        );
        require!(
            expected == result_hash,
            FaultlineError::ReplayResultMismatch
        );
        let slot = Clock::get()?.slot;
        let replay_result = &mut ctx.accounts.replay_result;
        replay_result.verification_round = ctx.accounts.verification_round.key();
        replay_result.result_hash = result_hash;
        replay_result.verdict = verdict;
        replay_result.replay_receipt_hash = replay_receipt_hash;
        replay_result.vote_count = 0;
        replay_result.created_at_slot = slot;
        replay_result.bump = ctx.bumps.replay_result;
        Ok(())
    }

    pub fn submit_verifier_attestation(
        ctx: Context<SubmitVerifierAttestation>,
        result_hash: [u8; 32],
    ) -> Result<()> {
        require!(
            ctx.accounts.verification_round.status == VerificationRoundStatus::Open,
            FaultlineError::RoundNotOpen
        );
        require!(
            ctx.accounts.proposal.state == ProposalState::ChallengeActive,
            FaultlineError::InvalidProposalTransition
        );
        require!(
            ctx.accounts
                .verifier_epoch
                .verifiers
                .contains(&ctx.accounts.verifier.key()),
            FaultlineError::UnauthorizedVerifier
        );
        require!(
            ctx.accounts.verifier_attestation.verification_round == Pubkey::default(),
            FaultlineError::VerifierAlreadyAttested
        );
        require!(
            ctx.accounts.replay_result.result_hash == result_hash,
            FaultlineError::WrongResultBinding
        );
        let expected = replay_result_commitment(
            &ctx.accounts.verification_round.proposal,
            &ctx.accounts.verification_round.invariant,
            &ctx.accounts.verification_round.trace_claim,
            &ctx.accounts.verification_round.candidate_buffer_hash,
            &ctx.accounts.verification_round.invariant_specification_hash,
            ctx.accounts.replay_result.verdict,
            &ctx.accounts.replay_result.replay_receipt_hash,
        );
        require!(
            expected == result_hash,
            FaultlineError::ReplayResultMismatch
        );
        let end = ctx
            .accounts
            .proposal
            .challenge_end_slot
            .ok_or(FaultlineError::MissingChallengeWindow)?;
        let slot = Clock::get()?.slot;
        require!(slot <= end, FaultlineError::VerificationWindowEnded);
        let attestation = &mut ctx.accounts.verifier_attestation;
        attestation.verification_round = ctx.accounts.verification_round.key();
        attestation.verifier_epoch = ctx.accounts.verifier_epoch.key();
        attestation.verifier = ctx.accounts.verifier.key();
        attestation.replay_result = ctx.accounts.replay_result.key();
        attestation.result_hash = result_hash;
        attestation.attested_slot = slot;
        attestation.bump = ctx.bumps.verifier_attestation;
        let replay_result = &mut ctx.accounts.replay_result;
        replay_result.vote_count = replay_result
            .vote_count
            .checked_add(1)
            .ok_or(FaultlineError::CounterOverflow)?;
        emit!(VerifierAttested {
            verification_round: ctx.accounts.verification_round.key(),
            verifier_epoch: ctx.accounts.verifier_epoch.key(),
            verifier: ctx.accounts.verifier.key(),
            replay_result: replay_result.key(),
            result_hash,
            vote_count: replay_result.vote_count,
            slot,
        });
        if replay_result.vote_count == ctx.accounts.verification_round.threshold {
            emit!(ReplayResultReachedQuorum {
                verification_round: ctx.accounts.verification_round.key(),
                replay_result: replay_result.key(),
                result_hash,
                verdict: replay_result.verdict,
                vote_count: replay_result.vote_count,
                threshold: ctx.accounts.verification_round.threshold,
                slot,
            });
        }
        Ok(())
    }

    pub fn finalize_replay_result(ctx: Context<FinalizeReplayResult>) -> Result<()> {
        require!(
            ctx.accounts.verification_round.status == VerificationRoundStatus::Open,
            FaultlineError::RoundNotOpen
        );
        require!(
            ctx.accounts.proposal.state == ProposalState::ChallengeActive,
            FaultlineError::InvalidProposalTransition
        );
        require!(
            ctx.accounts.replay_result.vote_count >= ctx.accounts.verification_round.threshold,
            FaultlineError::QuorumNotReached
        );
        let end = ctx
            .accounts
            .proposal
            .challenge_end_slot
            .ok_or(FaultlineError::MissingChallengeWindow)?;
        let slot = Clock::get()?.slot;
        require!(slot <= end, FaultlineError::VerificationWindowEnded);
        let verification_gate = &mut ctx.accounts.proposal_verification_gate;
        verification_gate.pending_rounds = verification_gate
            .pending_rounds
            .checked_sub(1)
            .ok_or(FaultlineError::CounterUnderflow)?;
        let round = &mut ctx.accounts.verification_round;
        round.finalized_slot = Some(slot);
        round.winning_replay_result = Some(ctx.accounts.replay_result.key());
        match ctx.accounts.replay_result.verdict {
            ReplayVerdict::InvariantHolds => {
                round.status = VerificationRoundStatus::InvariantHolds;
            }
            ReplayVerdict::InvariantViolated => {
                round.status = VerificationRoundStatus::InvariantViolated;
                verification_gate.confirmed_violation = true;
                verification_gate.last_violation_round = Some(round.key());
                let proposal = &mut ctx.accounts.proposal;
                proposal.state = ProposalState::Rejected;
                proposal.decision_authority = Some(crate::ID);
                proposal.decision_slot = Some(slot);
                proposal.decision_reason_code = Some(AUTOMATIC_VIOLATION_REASON_CODE);
                emit!(ProposalAutomaticallyRejected {
                    policy: ctx.accounts.policy.key(),
                    proposal: proposal.key(),
                    verification_round: round.key(),
                    replay_result: ctx.accounts.replay_result.key(),
                    result_hash: ctx.accounts.replay_result.result_hash,
                    reason_code: AUTOMATIC_VIOLATION_REASON_CODE,
                    slot,
                });
            }
        }
        emit!(ReplayResultFinalized {
            policy: ctx.accounts.policy.key(),
            proposal: ctx.accounts.proposal.key(),
            verification_round: round.key(),
            replay_result: ctx.accounts.replay_result.key(),
            result_hash: ctx.accounts.replay_result.result_hash,
            verdict: ctx.accounts.replay_result.verdict,
            slot,
        });
        Ok(())
    }

    pub fn expire_proposal(ctx: Context<ExpireProposal>) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;
        require!(
            proposal.state == ProposalState::ChallengeActive,
            FaultlineError::InvalidProposalTransition
        );
        let end = proposal
            .challenge_end_slot
            .ok_or(FaultlineError::MissingChallengeWindow)?;
        let slot = Clock::get()?.slot;
        require!(slot > end, FaultlineError::ChallengeWindowStillActive);
        require!(
            proposal.decision_authority.is_none()
                && proposal.decision_slot.is_none()
                && proposal.decision_reason_code.is_none(),
            FaultlineError::DecisionAlreadyRecorded
        );
        proposal.state = ProposalState::Expired;
        emit!(ProposalExpired {
            policy: ctx.accounts.policy.key(),
            proposal: proposal.key(),
            target_program: proposal.target_program,
            candidate_buffer: proposal.candidate_buffer,
            actor: ctx.accounts.caller.key(),
            slot,
            state: proposal.state
        });
        Ok(())
    }

    // TEMPORARY MILESTONE-3 DECISION PATH.
    // This will be replaced by challenge submission and verifier-quorum resolution.
    pub fn record_temporary_decision(
        ctx: Context<RecordTemporaryDecision>,
        decision: ProposalState,
        reason_code: u16,
    ) -> Result<()> {
        require!(
            decision == ProposalState::Approved || decision == ProposalState::Rejected,
            FaultlineError::InvalidTemporaryDecision
        );
        let proposal = &mut ctx.accounts.proposal;
        require!(
            proposal.state == ProposalState::ChallengeActive,
            FaultlineError::InvalidProposalTransition
        );
        let end = proposal
            .challenge_end_slot
            .ok_or(FaultlineError::MissingChallengeWindow)?;
        let slot = Clock::get()?.slot;
        require!(slot <= end, FaultlineError::ChallengeWindowEnded);
        require!(
            proposal.decision_authority.is_none(),
            FaultlineError::DecisionAlreadyRecorded
        );
        if decision == ProposalState::Approved {
            require!(
                ctx.accounts.proposal_verification_gate.pending_rounds == 0,
                FaultlineError::VerificationPending
            );
            require!(
                !ctx.accounts.proposal_verification_gate.confirmed_violation,
                FaultlineError::ConfirmedInvariantViolation
            );
        }
        proposal.state = decision;
        proposal.decision_authority = Some(ctx.accounts.governance.key());
        proposal.decision_slot = Some(slot);
        proposal.decision_reason_code = Some(reason_code);
        emit!(TemporaryDecisionRecorded {
            policy: ctx.accounts.policy.key(),
            proposal: proposal.key(),
            target_program: proposal.target_program,
            candidate_buffer: proposal.candidate_buffer,
            actor: ctx.accounts.governance.key(),
            slot,
            decision,
            reason_code
        });
        Ok(())
    }

    /// This is the sole Faultline route which signs loader-v3 Upgrade with the Guard PDA.
    pub fn execute_guarded_upgrade(ctx: Context<ExecuteGuardedUpgrade>) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;
        require!(
            ctx.accounts.proposal_verification_gate.pending_rounds == 0,
            FaultlineError::VerificationPending
        );
        require!(
            !ctx.accounts.proposal_verification_gate.confirmed_violation,
            FaultlineError::ConfirmedInvariantViolation
        );
        require!(
            proposal.state == ProposalState::Approved,
            FaultlineError::ProposalNotApproved
        );
        let end = proposal
            .challenge_end_slot
            .ok_or(FaultlineError::MissingChallengeWindow)?;
        let slot = Clock::get()?.slot;
        require!(slot > end, FaultlineError::ChallengeWindowStillActive);
        require_keys_eq!(
            ctx.accounts.policy.target_program,
            proposal.target_program,
            FaultlineError::WrongTargetProgram
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
        require!(
            candidate_buffer_hash(&ctx.accounts.candidate_buffer.to_account_info())?
                == proposal.candidate_buffer_hash,
            FaultlineError::CandidateHashMismatch
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
        proposal.state = ProposalState::Executed;
        proposal.executed_at_slot = Some(slot);
        emit!(GuardedUpgradeExecuted {
            policy: ctx.accounts.policy.key(),
            proposal: proposal.key(),
            target_program: proposal.target_program,
            candidate_buffer: proposal.candidate_buffer,
            actor: ctx.accounts.executor.key(),
            slot,
            state: proposal.state
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeEconomicPolicyRegistry<'info> {
    #[account(mut)]
    pub governance: Signer<'info>,
    #[account(seeds = [SAFETY_POLICY_SEED, policy.target_program.as_ref()], bump = policy.bump, constraint = policy.governance_authority == governance.key() @ FaultlineError::UnauthorizedGovernance)]
    pub policy: Account<'info, SafetyPolicy>,
    #[account(init, payer = governance, space = 8 + EconomicPolicyRegistry::INIT_SPACE, seeds = [ECONOMIC_POLICY_REGISTRY_SEED, policy.key().as_ref()], bump)]
    pub economic_policy_registry: Account<'info, EconomicPolicyRegistry>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(config_id: u64)]
pub struct InitializeEconomicPolicy<'info> {
    #[account(mut)]
    pub governance: Signer<'info>,
    #[account(seeds = [SAFETY_POLICY_SEED, policy.target_program.as_ref()], bump = policy.bump, constraint = policy.governance_authority == governance.key() @ FaultlineError::UnauthorizedGovernance)]
    pub policy: Account<'info, SafetyPolicy>,
    #[account(mut, seeds = [ECONOMIC_POLICY_REGISTRY_SEED, policy.key().as_ref()], bump = economic_policy_registry.bump, constraint = economic_policy_registry.safety_policy == policy.key() @ FaultlineError::WrongPolicyBinding, constraint = economic_policy_registry.governance == governance.key() @ FaultlineError::UnauthorizedGovernance)]
    pub economic_policy_registry: Account<'info, EconomicPolicyRegistry>,
    /// CHECK: exact legacy Mint layout and owner are validated in the handler.
    pub payment_mint: UncheckedAccount<'info>,
    #[account(init, payer = governance, space = 8 + EconomicPolicy::INIT_SPACE, seeds = [ECONOMIC_POLICY_SEED, economic_policy_registry.key().as_ref(), &config_id.to_le_bytes()], bump)]
    pub economic_policy: Box<Account<'info, EconomicPolicy>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeVerifierStake<'info> {
    #[account(mut)]
    pub verifier: Signer<'info>,
    #[account(seeds = [ECONOMIC_POLICY_SEED, economic_policy.economic_policy_registry.as_ref(), &economic_policy.config_id.to_le_bytes()], bump = economic_policy.bump, constraint = economic_policy.token_program == TOKEN_PROGRAM_ID @ FaultlineError::UnsupportedEconomicTokenProgram)]
    pub economic_policy: Box<Account<'info, EconomicPolicy>>,
    /// CHECK: key, owner, mint, state and token owner are validated in the handler.
    #[account(mut)]
    pub verifier_token_account: UncheckedAccount<'info>,
    /// CHECK: exact legacy Mint is bound by EconomicPolicy and validated here.
    #[account(address = economic_policy.payment_mint @ FaultlineError::WrongPaymentMint)]
    pub payment_mint: UncheckedAccount<'info>,
    #[account(init, payer = verifier, space = 8 + VerifierStake::INIT_SPACE, seeds = [VERIFIER_STAKE_SEED, economic_policy.key().as_ref(), verifier.key().as_ref()], bump)]
    pub verifier_stake: Box<Account<'info, VerifierStake>>,
    /// CHECK: created and initialized as a Tokenkeg account by the handler.
    #[account(mut, seeds = [STAKE_VAULT_SEED, economic_policy.key().as_ref(), verifier.key().as_ref()], bump)]
    pub stake_vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: fixed legacy SPL Token program.
    #[account(address = TOKEN_PROGRAM_ID @ FaultlineError::UnsupportedEconomicTokenProgram)]
    pub token_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct TopUpVerifierStake<'info> {
    #[account(mut)]
    pub verifier: Signer<'info>,
    #[account(seeds = [ECONOMIC_POLICY_SEED, economic_policy.economic_policy_registry.as_ref(), &economic_policy.config_id.to_le_bytes()], bump = economic_policy.bump, constraint = economic_policy.token_program == TOKEN_PROGRAM_ID @ FaultlineError::UnsupportedEconomicTokenProgram)]
    pub economic_policy: Box<Account<'info, EconomicPolicy>>,
    #[account(mut, seeds = [VERIFIER_STAKE_SEED, economic_policy.key().as_ref(), verifier.key().as_ref()], bump = verifier_stake.bump, constraint = verifier_stake.economic_policy == economic_policy.key() @ FaultlineError::WrongEconomicPolicy, constraint = verifier_stake.verifier == verifier.key() @ FaultlineError::WrongVerifierStake)]
    pub verifier_stake: Box<Account<'info, VerifierStake>>,
    /// CHECK: validated as the verifier's canonical ATA.
    #[account(mut)]
    pub verifier_token_account: UncheckedAccount<'info>,
    /// CHECK: validated legacy vault.
    #[account(mut, address = verifier_stake.stake_vault @ FaultlineError::WrongVault)]
    pub stake_vault: UncheckedAccount<'info>,
    /// CHECK: fixed legacy SPL Token program.
    #[account(address = TOKEN_PROGRAM_ID @ FaultlineError::UnsupportedEconomicTokenProgram)]
    pub token_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ManageVerifierStake<'info> {
    pub verifier: Signer<'info>,
    #[account(seeds = [ECONOMIC_POLICY_SEED, economic_policy.economic_policy_registry.as_ref(), &economic_policy.config_id.to_le_bytes()], bump = economic_policy.bump, constraint = economic_policy.token_program == TOKEN_PROGRAM_ID @ FaultlineError::UnsupportedEconomicTokenProgram)]
    pub economic_policy: Box<Account<'info, EconomicPolicy>>,
    #[account(mut, seeds = [VERIFIER_STAKE_SEED, economic_policy.key().as_ref(), verifier.key().as_ref()], bump = verifier_stake.bump, constraint = verifier_stake.economic_policy == economic_policy.key() @ FaultlineError::WrongEconomicPolicy, constraint = verifier_stake.verifier == verifier.key() @ FaultlineError::WrongVerifierStake)]
    pub verifier_stake: Box<Account<'info, VerifierStake>>,
}

#[derive(Accounts)]
pub struct WithdrawVerifierStake<'info> {
    #[account(mut)]
    pub verifier: Signer<'info>,
    #[account(seeds = [ECONOMIC_POLICY_SEED, economic_policy.economic_policy_registry.as_ref(), &economic_policy.config_id.to_le_bytes()], bump = economic_policy.bump, constraint = economic_policy.token_program == TOKEN_PROGRAM_ID @ FaultlineError::UnsupportedEconomicTokenProgram)]
    pub economic_policy: Box<Account<'info, EconomicPolicy>>,
    #[account(mut, close = rent_recipient, seeds = [VERIFIER_STAKE_SEED, economic_policy.key().as_ref(), verifier.key().as_ref()], bump = verifier_stake.bump, constraint = verifier_stake.economic_policy == economic_policy.key() @ FaultlineError::WrongEconomicPolicy, constraint = verifier_stake.verifier == verifier.key() @ FaultlineError::WrongVerifierStake)]
    pub verifier_stake: Box<Account<'info, VerifierStake>>,
    /// CHECK: validated as verifier's canonical ATA.
    #[account(mut)]
    pub verifier_token_account: UncheckedAccount<'info>,
    /// CHECK: validated legacy Tokenkeg vault.
    #[account(mut, address = verifier_stake.stake_vault @ FaultlineError::WrongVault)]
    pub stake_vault: UncheckedAccount<'info>,
    /// CHECK: immutable fixed recipient stored at stake initialization.
    #[account(mut, address = verifier_stake.rent_recipient @ FaultlineError::WrongRentRecipient)]
    pub rent_recipient: UncheckedAccount<'info>,
    /// CHECK: fixed legacy SPL Token program.
    #[account(address = TOKEN_PROGRAM_ID @ FaultlineError::UnsupportedEconomicTokenProgram)]
    pub token_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ActivateVerifierEpochEconomics<'info> {
    #[account(mut)]
    pub governance: Signer<'info>,
    #[account(seeds = [SAFETY_POLICY_SEED, policy.target_program.as_ref()], bump = policy.bump, constraint = policy.governance_authority == governance.key() @ FaultlineError::UnauthorizedGovernance)]
    pub policy: Account<'info, SafetyPolicy>,
    #[account(seeds = [ECONOMIC_POLICY_REGISTRY_SEED, policy.key().as_ref()], bump = economic_policy_registry.bump, constraint = economic_policy_registry.safety_policy == policy.key() @ FaultlineError::WrongPolicyBinding)]
    pub economic_policy_registry: Account<'info, EconomicPolicyRegistry>,
    #[account(seeds = [ECONOMIC_POLICY_SEED, economic_policy_registry.key().as_ref(), &economic_policy.config_id.to_le_bytes()], bump = economic_policy.bump, constraint = economic_policy.safety_policy == policy.key() @ FaultlineError::WrongPolicyBinding)]
    pub economic_policy: Box<Account<'info, EconomicPolicy>>,
    #[account(seeds = [VERIFIER_REGISTRY_SEED, policy.key().as_ref()], bump = verifier_registry.bump, constraint = verifier_registry.safety_policy == policy.key() @ FaultlineError::WrongPolicyBinding, constraint = verifier_registry.governance == governance.key() @ FaultlineError::UnauthorizedGovernance)]
    pub verifier_registry: Account<'info, VerifierRegistry>,
    #[account(seeds = [VERIFIER_EPOCH_SEED, verifier_registry.key().as_ref(), &verifier_epoch.epoch_id.to_le_bytes()], bump = verifier_epoch.bump, constraint = verifier_epoch.verifier_registry == verifier_registry.key() @ FaultlineError::WrongVerifierEpoch, constraint = verifier_epoch.safety_policy == policy.key() @ FaultlineError::WrongPolicyBinding)]
    pub verifier_epoch: Box<Account<'info, VerifierEpoch>>,
    #[account(init, payer = governance, space = 8 + VerifierEpochEconomics::INIT_SPACE, seeds = [VERIFIER_EPOCH_ECONOMICS_SEED, verifier_epoch.key().as_ref(), economic_policy.key().as_ref()], bump)]
    pub verifier_epoch_economics: Account<'info, VerifierEpochEconomics>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundProposalEscrow<'info> {
    #[account(mut)]
    pub funder: Signer<'info>,
    #[account(seeds = [SAFETY_POLICY_SEED, policy.target_program.as_ref()], bump = policy.bump)]
    pub policy: Account<'info, SafetyPolicy>,
    #[account(seeds = [ECONOMIC_POLICY_REGISTRY_SEED, policy.key().as_ref()], bump = economic_policy_registry.bump, constraint = economic_policy_registry.safety_policy == policy.key() @ FaultlineError::WrongPolicyBinding)]
    pub economic_policy_registry: Account<'info, EconomicPolicyRegistry>,
    #[account(seeds = [ECONOMIC_POLICY_SEED, economic_policy_registry.key().as_ref(), &economic_policy.config_id.to_le_bytes()], bump = economic_policy.bump, constraint = economic_policy.safety_policy == policy.key() @ FaultlineError::WrongPolicyBinding)]
    pub economic_policy: Box<Account<'info, EconomicPolicy>>,
    #[account(seeds = [UPGRADE_PROPOSAL_SEED, policy.key().as_ref(), &proposal.proposal_id.to_le_bytes()], bump = proposal.bump, has_one = policy)]
    pub proposal: Box<Account<'info, UpgradeProposal>>,
    /// CHECK: validated as funder's canonical ATA.
    #[account(mut)]
    pub funder_token_account: UncheckedAccount<'info>,
    /// CHECK: exact legacy Mint bound by EconomicPolicy.
    #[account(address = economic_policy.payment_mint @ FaultlineError::WrongPaymentMint)]
    pub payment_mint: UncheckedAccount<'info>,
    #[account(init, payer = funder, space = 8 + ProposalEscrow::INIT_SPACE, seeds = [PROPOSAL_ESCROW_SEED, proposal.key().as_ref()], bump)]
    pub proposal_escrow: Box<Account<'info, ProposalEscrow>>,
    /// CHECK: created and initialized as a Tokenkeg account by the handler.
    #[account(mut, seeds = [BOUNTY_VAULT_SEED, proposal.key().as_ref()], bump)]
    pub bounty_vault: UncheckedAccount<'info>,
    /// CHECK: created and initialized as a Tokenkeg account by the handler.
    #[account(mut, seeds = [FEE_VAULT_SEED, proposal.key().as_ref()], bump)]
    pub fee_vault: UncheckedAccount<'info>,
    /// CHECK: created and initialized as a Tokenkeg account by the handler.
    #[account(mut, seeds = [PENALTY_VAULT_SEED, proposal.key().as_ref()], bump)]
    pub penalty_vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: fixed legacy SPL Token program.
    #[account(address = TOKEN_PROGRAM_ID @ FaultlineError::UnsupportedEconomicTokenProgram)]
    pub token_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct InitializeGuard<'info> {
    #[account(mut)]
    pub governance: Signer<'info>,
    /// CHECK: loader state is validated.
    pub target_program: UncheckedAccount<'info>,
    /// CHECK: loader state is validated.
    pub program_data: UncheckedAccount<'info>,
    #[account(init, payer = governance, space = 8 + GuardConfig::INIT_SPACE, seeds = [DOMAIN_SEED, GUARD_SEED, target_program.key().as_ref()], bump)]
    pub guard_config: Account<'info, GuardConfig>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct InitializeSafetyPolicy<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [DOMAIN_SEED, GUARD_SEED, target_program.key().as_ref()], bump = guard_config.guard_bump, has_one = target_program)]
    pub guard_config: Account<'info, GuardConfig>,
    /// CHECK: bound to GuardConfig.
    pub target_program: UncheckedAccount<'info>,
    #[account(init, payer = authority, space = 8 + SafetyPolicy::INIT_SPACE, seeds = [SAFETY_POLICY_SEED, target_program.key().as_ref()], bump)]
    pub policy: Account<'info, SafetyPolicy>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct SetSafetyPolicyStatus<'info> {
    pub governance: Signer<'info>,
    #[account(mut, seeds = [SAFETY_POLICY_SEED, policy.target_program.as_ref()], bump = policy.bump, constraint = policy.governance_authority == governance.key() @ FaultlineError::UnauthorizedGovernance)]
    pub policy: Account<'info, SafetyPolicy>,
}
#[derive(Accounts)]
#[instruction(invariant_id: u64)]
pub struct InitializeInvariant<'info> {
    #[account(mut)]
    pub governance: Signer<'info>,
    #[account(seeds = [SAFETY_POLICY_SEED, policy.target_program.as_ref()], bump = policy.bump, constraint = policy.governance_authority == governance.key() @ FaultlineError::UnauthorizedGovernance)]
    pub policy: Account<'info, SafetyPolicy>,
    #[account(init, payer = governance, space = 8 + InvariantDefinition::INIT_SPACE, seeds = [INVARIANT_SEED, policy.key().as_ref(), &invariant_id.to_le_bytes()], bump)]
    pub invariant: Account<'info, InvariantDefinition>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct SetInvariantEnabled<'info> {
    pub governance: Signer<'info>,
    #[account(seeds = [SAFETY_POLICY_SEED, policy.target_program.as_ref()], bump = policy.bump, constraint = policy.governance_authority == governance.key() @ FaultlineError::UnauthorizedGovernance)]
    pub policy: Account<'info, SafetyPolicy>,
    #[account(mut, seeds = [INVARIANT_SEED, policy.key().as_ref(), &invariant.invariant_id.to_le_bytes()], bump = invariant.bump, constraint = invariant.safety_policy == policy.key() @ FaultlineError::WrongInvariantPolicy)]
    pub invariant: Account<'info, InvariantDefinition>,
}
#[derive(Accounts)]
#[instruction(proposal_id: u64)]
pub struct CreateUpgradeProposal<'info> {
    #[account(mut)]
    pub proposer: Signer<'info>,
    #[account(mut, seeds = [DOMAIN_SEED, GUARD_SEED, target_program.key().as_ref()], bump = guard_config.guard_bump, constraint = guard_config.target_program == target_program.key() @ FaultlineError::WrongTargetProgram)]
    pub guard_config: Box<Account<'info, GuardConfig>>,
    #[account(seeds = [SAFETY_POLICY_SEED, target_program.key().as_ref()], bump = policy.bump, has_one = target_program)]
    pub policy: Box<Account<'info, SafetyPolicy>>,
    /// CHECK: loader state is validated.
    pub target_program: UncheckedAccount<'info>,
    /// CHECK: loader state is validated.
    #[account(constraint = program_data.key() == program_data_address(&target_program.key()) @ FaultlineError::WrongProgramData)]
    pub program_data: UncheckedAccount<'info>,
    /// CHECK: loader buffer is validated.
    pub candidate_buffer: UncheckedAccount<'info>,
    #[account(init, payer = proposer, space = 8 + UpgradeProposal::INIT_SPACE, seeds = [UPGRADE_PROPOSAL_SEED, policy.key().as_ref(), &proposal_id.to_le_bytes()], bump)]
    pub proposal: Box<Account<'info, UpgradeProposal>>,
    #[account(init, payer = proposer, space = 8 + ProposalVerificationGate::INIT_SPACE, seeds = [PROPOSAL_VERIFICATION_GATE_SEED, proposal.key().as_ref()], bump)]
    pub proposal_verification_gate: Box<Account<'info, ProposalVerificationGate>>,
    #[account(init, payer = proposer, space = 8 + BufferClaim::INIT_SPACE, seeds = [DOMAIN_SEED, BUFFER_SEED, candidate_buffer.key().as_ref()], bump)]
    pub buffer_claim: Box<Account<'info, BufferClaim>>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct StartChallenge<'info> {
    pub actor: Signer<'info>,
    #[account(seeds = [SAFETY_POLICY_SEED, policy.target_program.as_ref()], bump = policy.bump)]
    pub policy: Account<'info, SafetyPolicy>,
    #[account(seeds = [ECONOMIC_POLICY_REGISTRY_SEED, policy.key().as_ref()], bump = economic_policy_registry.bump, constraint = economic_policy_registry.safety_policy == policy.key() @ FaultlineError::WrongPolicyBinding)]
    pub economic_policy_registry: Account<'info, EconomicPolicyRegistry>,
    #[account(mut, seeds = [UPGRADE_PROPOSAL_SEED, policy.key().as_ref(), &proposal.proposal_id.to_le_bytes()], bump = proposal.bump, has_one = policy)]
    pub proposal: Account<'info, UpgradeProposal>,
}
#[derive(Accounts)]
#[instruction(commitment_hash: [u8; 32])]
pub struct CommitChallenge<'info> {
    #[account(mut)]
    pub hunter: Signer<'info>,
    #[account(seeds = [SAFETY_POLICY_SEED, policy.target_program.as_ref()], bump = policy.bump)]
    pub policy: Account<'info, SafetyPolicy>,
    #[account(seeds = [ECONOMIC_POLICY_REGISTRY_SEED, policy.key().as_ref()], bump = economic_policy_registry.bump, constraint = economic_policy_registry.safety_policy == policy.key() @ FaultlineError::WrongPolicyBinding)]
    pub economic_policy_registry: Account<'info, EconomicPolicyRegistry>,
    #[account(seeds = [UPGRADE_PROPOSAL_SEED, policy.key().as_ref(), &proposal.proposal_id.to_le_bytes()], bump = proposal.bump, has_one = policy)]
    pub proposal: Account<'info, UpgradeProposal>,
    #[account(seeds = [INVARIANT_SEED, policy.key().as_ref(), &invariant.invariant_id.to_le_bytes()], bump = invariant.bump, constraint = invariant.safety_policy == policy.key() @ FaultlineError::WrongInvariantPolicy)]
    pub invariant: Account<'info, InvariantDefinition>,
    #[account(init, payer = hunter, space = 8 + ChallengeCommit::INIT_SPACE, seeds = [CHALLENGE_COMMIT_SEED, proposal.key().as_ref(), hunter.key().as_ref(), commitment_hash.as_ref()], bump)]
    pub challenge_commit: Account<'info, ChallengeCommit>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
#[instruction(trace_hash: [u8; 32])]
pub struct RevealChallenge<'info> {
    #[account(mut)]
    pub hunter: Signer<'info>,
    #[account(seeds = [SAFETY_POLICY_SEED, policy.target_program.as_ref()], bump = policy.bump)]
    pub policy: Account<'info, SafetyPolicy>,
    #[account(seeds = [UPGRADE_PROPOSAL_SEED, policy.key().as_ref(), &proposal.proposal_id.to_le_bytes()], bump = proposal.bump, has_one = policy)]
    pub proposal: Account<'info, UpgradeProposal>,
    #[account(seeds = [INVARIANT_SEED, policy.key().as_ref(), &invariant.invariant_id.to_le_bytes()], bump = invariant.bump, constraint = invariant.safety_policy == policy.key() @ FaultlineError::WrongInvariantPolicy)]
    pub invariant: Account<'info, InvariantDefinition>,
    #[account(mut, seeds = [CHALLENGE_COMMIT_SEED, proposal.key().as_ref(), challenge_commit.hunter.as_ref(), challenge_commit.commitment_hash.as_ref()], bump = challenge_commit.bump, constraint = challenge_commit.proposal == proposal.key() @ FaultlineError::WrongChallengeProposal, constraint = challenge_commit.invariant == invariant.key() @ FaultlineError::WrongChallengeInvariant, constraint = challenge_commit.hunter == hunter.key() @ FaultlineError::UnauthorizedHunter)]
    pub challenge_commit: Account<'info, ChallengeCommit>,
    #[account(init_if_needed, payer = hunter, space = 8 + TraceClaim::INIT_SPACE, seeds = [TRACE_CLAIM_SEED, proposal.key().as_ref(), trace_hash.as_ref()], bump)]
    pub trace_claim: Account<'info, TraceClaim>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct InitializeVerifierRegistry<'info> {
    #[account(mut)]
    pub governance: Signer<'info>,
    #[account(seeds = [SAFETY_POLICY_SEED, policy.target_program.as_ref()], bump = policy.bump, constraint = policy.governance_authority == governance.key() @ FaultlineError::UnauthorizedGovernance)]
    pub policy: Account<'info, SafetyPolicy>,
    #[account(init, payer = governance, space = 8 + VerifierRegistry::INIT_SPACE, seeds = [VERIFIER_REGISTRY_SEED, policy.key().as_ref()], bump)]
    pub verifier_registry: Account<'info, VerifierRegistry>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
#[instruction(epoch_id: u64)]
pub struct CreateVerifierEpoch<'info> {
    #[account(mut)]
    pub governance: Signer<'info>,
    #[account(seeds = [SAFETY_POLICY_SEED, policy.target_program.as_ref()], bump = policy.bump, constraint = policy.governance_authority == governance.key() @ FaultlineError::UnauthorizedGovernance)]
    pub policy: Account<'info, SafetyPolicy>,
    #[account(mut, seeds = [VERIFIER_REGISTRY_SEED, policy.key().as_ref()], bump = verifier_registry.bump, constraint = verifier_registry.safety_policy == policy.key() @ FaultlineError::WrongPolicyBinding, constraint = verifier_registry.governance == governance.key() @ FaultlineError::UnauthorizedGovernance)]
    pub verifier_registry: Account<'info, VerifierRegistry>,
    #[account(init, payer = governance, space = 8 + VerifierEpoch::INIT_SPACE, seeds = [VERIFIER_EPOCH_SEED, verifier_registry.key().as_ref(), &epoch_id.to_le_bytes()], bump)]
    pub verifier_epoch: Box<Account<'info, VerifierEpoch>>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct ActivateVerifierEpoch<'info> {
    pub governance: Signer<'info>,
    #[account(seeds = [SAFETY_POLICY_SEED, policy.target_program.as_ref()], bump = policy.bump, constraint = policy.governance_authority == governance.key() @ FaultlineError::UnauthorizedGovernance)]
    pub policy: Account<'info, SafetyPolicy>,
    #[account(mut, seeds = [VERIFIER_REGISTRY_SEED, policy.key().as_ref()], bump = verifier_registry.bump, constraint = verifier_registry.safety_policy == policy.key() @ FaultlineError::WrongPolicyBinding, constraint = verifier_registry.governance == governance.key() @ FaultlineError::UnauthorizedGovernance)]
    pub verifier_registry: Account<'info, VerifierRegistry>,
    #[account(seeds = [VERIFIER_EPOCH_SEED, verifier_registry.key().as_ref(), &verifier_epoch.epoch_id.to_le_bytes()], bump = verifier_epoch.bump, constraint = verifier_epoch.verifier_registry == verifier_registry.key() @ FaultlineError::WrongVerifierEpoch, constraint = verifier_epoch.safety_policy == policy.key() @ FaultlineError::WrongPolicyBinding)]
    pub verifier_epoch: Account<'info, VerifierEpoch>,
}
#[derive(Accounts)]
pub struct OpenVerificationRound<'info> {
    #[account(mut)]
    pub opener: Signer<'info>,
    #[account(seeds = [SAFETY_POLICY_SEED, policy.target_program.as_ref()], bump = policy.bump)]
    pub policy: Account<'info, SafetyPolicy>,
    #[account(seeds = [ECONOMIC_POLICY_REGISTRY_SEED, policy.key().as_ref()], bump = economic_policy_registry.bump, constraint = economic_policy_registry.safety_policy == policy.key() @ FaultlineError::WrongPolicyBinding)]
    pub economic_policy_registry: Account<'info, EconomicPolicyRegistry>,
    #[account(seeds = [UPGRADE_PROPOSAL_SEED, policy.key().as_ref(), &proposal.proposal_id.to_le_bytes()], bump = proposal.bump, has_one = policy)]
    pub proposal: Account<'info, UpgradeProposal>,
    #[account(mut, seeds = [PROPOSAL_VERIFICATION_GATE_SEED, proposal.key().as_ref()], bump = proposal_verification_gate.bump, constraint = proposal_verification_gate.proposal == proposal.key() @ FaultlineError::WrongProposalBinding)]
    pub proposal_verification_gate: Account<'info, ProposalVerificationGate>,
    #[account(seeds = [INVARIANT_SEED, policy.key().as_ref(), &invariant.invariant_id.to_le_bytes()], bump = invariant.bump, constraint = invariant.safety_policy == policy.key() @ FaultlineError::WrongInvariantBinding)]
    pub invariant: Account<'info, InvariantDefinition>,
    #[account(seeds = [CHALLENGE_COMMIT_SEED, proposal.key().as_ref(), challenge_commit.hunter.as_ref(), challenge_commit.commitment_hash.as_ref()], bump = challenge_commit.bump, constraint = challenge_commit.proposal == proposal.key() @ FaultlineError::WrongProposalBinding, constraint = challenge_commit.invariant == invariant.key() @ FaultlineError::WrongInvariantBinding)]
    pub challenge_commit: Box<Account<'info, ChallengeCommit>>,
    #[account(seeds = [TRACE_CLAIM_SEED, proposal.key().as_ref(), trace_claim.trace_hash.as_ref()], bump = trace_claim.bump, constraint = trace_claim.proposal == proposal.key() @ FaultlineError::WrongProposalBinding, constraint = trace_claim.invariant == invariant.key() @ FaultlineError::WrongInvariantBinding, constraint = trace_claim.challenge_commit == challenge_commit.key() @ FaultlineError::WrongTraceBinding)]
    pub trace_claim: Box<Account<'info, TraceClaim>>,
    #[account(seeds = [VERIFIER_REGISTRY_SEED, policy.key().as_ref()], bump = verifier_registry.bump, constraint = verifier_registry.safety_policy == policy.key() @ FaultlineError::WrongPolicyBinding)]
    pub verifier_registry: Account<'info, VerifierRegistry>,
    #[account(seeds = [VERIFIER_EPOCH_SEED, verifier_registry.key().as_ref(), &verifier_epoch.epoch_id.to_le_bytes()], bump = verifier_epoch.bump, constraint = verifier_epoch.verifier_registry == verifier_registry.key() @ FaultlineError::WrongVerifierEpoch, constraint = verifier_epoch.safety_policy == policy.key() @ FaultlineError::WrongPolicyBinding)]
    pub verifier_epoch: Box<Account<'info, VerifierEpoch>>,
    #[account(init_if_needed, payer = opener, space = 8 + VerificationRound::INIT_SPACE, seeds = [VERIFICATION_ROUND_SEED, trace_claim.key().as_ref()], bump)]
    pub verification_round: Box<Account<'info, VerificationRound>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct StartFundedChallenge<'info> {
    pub actor: Signer<'info>,
    #[account(seeds = [SAFETY_POLICY_SEED, policy.target_program.as_ref()], bump = policy.bump)]
    pub policy: Account<'info, SafetyPolicy>,
    #[account(seeds = [ECONOMIC_POLICY_REGISTRY_SEED, policy.key().as_ref()], bump = economic_policy_registry.bump, constraint = economic_policy_registry.safety_policy == policy.key() @ FaultlineError::WrongPolicyBinding)]
    pub economic_policy_registry: Account<'info, EconomicPolicyRegistry>,
    #[account(seeds = [ECONOMIC_POLICY_SEED, economic_policy_registry.key().as_ref(), &economic_policy.config_id.to_le_bytes()], bump = economic_policy.bump, constraint = economic_policy.safety_policy == policy.key() @ FaultlineError::WrongPolicyBinding, constraint = economic_policy.token_program == TOKEN_PROGRAM_ID @ FaultlineError::UnsupportedEconomicTokenProgram)]
    pub economic_policy: Box<Account<'info, EconomicPolicy>>,
    #[account(mut, seeds = [UPGRADE_PROPOSAL_SEED, policy.key().as_ref(), &proposal.proposal_id.to_le_bytes()], bump = proposal.bump, has_one = policy)]
    pub proposal: Box<Account<'info, UpgradeProposal>>,
    #[account(mut, seeds = [PROPOSAL_ESCROW_SEED, proposal.key().as_ref()], bump = proposal_escrow.bump, constraint = proposal_escrow.proposal == proposal.key() @ FaultlineError::WrongProposalBinding, constraint = proposal_escrow.economic_policy == economic_policy.key() @ FaultlineError::WrongEconomicPolicy, constraint = proposal_escrow.payment_mint == economic_policy.payment_mint @ FaultlineError::WrongPaymentMint)]
    pub proposal_escrow: Box<Account<'info, ProposalEscrow>>,
    /// CHECK: exact immutable legacy mint bound by EconomicPolicy.
    #[account(address = economic_policy.payment_mint @ FaultlineError::WrongPaymentMint)]
    pub payment_mint: UncheckedAccount<'info>,
    /// CHECK: validated as the exact funded bounty vault.
    #[account(address = proposal_escrow.bounty_vault @ FaultlineError::WrongVault)]
    pub bounty_vault: UncheckedAccount<'info>,
    /// CHECK: validated as the exact funded fee vault.
    #[account(address = proposal_escrow.fee_vault @ FaultlineError::WrongVault)]
    pub fee_vault: UncheckedAccount<'info>,
    /// CHECK: validated as the exact empty penalty vault.
    #[account(address = proposal_escrow.penalty_vault @ FaultlineError::WrongVault)]
    pub penalty_vault: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(commitment_hash: [u8; 32])]
pub struct CommitBondedChallenge<'info> {
    #[account(mut)]
    pub hunter: Signer<'info>,
    #[account(seeds = [SAFETY_POLICY_SEED, policy.target_program.as_ref()], bump = policy.bump)]
    pub policy: Account<'info, SafetyPolicy>,
    #[account(seeds = [ECONOMIC_POLICY_REGISTRY_SEED, policy.key().as_ref()], bump = economic_policy_registry.bump, constraint = economic_policy_registry.safety_policy == policy.key() @ FaultlineError::WrongPolicyBinding)]
    pub economic_policy_registry: Account<'info, EconomicPolicyRegistry>,
    #[account(seeds = [ECONOMIC_POLICY_SEED, economic_policy_registry.key().as_ref(), &economic_policy.config_id.to_le_bytes()], bump = economic_policy.bump, constraint = economic_policy.safety_policy == policy.key() @ FaultlineError::WrongPolicyBinding, constraint = economic_policy.token_program == TOKEN_PROGRAM_ID @ FaultlineError::UnsupportedEconomicTokenProgram)]
    pub economic_policy: Box<Account<'info, EconomicPolicy>>,
    #[account(seeds = [UPGRADE_PROPOSAL_SEED, policy.key().as_ref(), &proposal.proposal_id.to_le_bytes()], bump = proposal.bump, has_one = policy)]
    pub proposal: Box<Account<'info, UpgradeProposal>>,
    #[account(mut, seeds = [PROPOSAL_ESCROW_SEED, proposal.key().as_ref()], bump = proposal_escrow.bump, constraint = proposal_escrow.proposal == proposal.key() @ FaultlineError::WrongProposalBinding, constraint = proposal_escrow.economic_policy == economic_policy.key() @ FaultlineError::WrongEconomicPolicy, constraint = proposal_escrow.payment_mint == economic_policy.payment_mint @ FaultlineError::WrongPaymentMint)]
    pub proposal_escrow: Box<Account<'info, ProposalEscrow>>,
    #[account(seeds = [INVARIANT_SEED, policy.key().as_ref(), &invariant.invariant_id.to_le_bytes()], bump = invariant.bump, constraint = invariant.safety_policy == policy.key() @ FaultlineError::WrongInvariantPolicy)]
    pub invariant: Account<'info, InvariantDefinition>,
    /// CHECK: validated as the hunter's canonical pre-existing ATA.
    #[account(mut)]
    pub hunter_token_account: UncheckedAccount<'info>,
    /// CHECK: exact immutable legacy mint bound by EconomicPolicy.
    #[account(address = economic_policy.payment_mint @ FaultlineError::WrongPaymentMint)]
    pub payment_mint: UncheckedAccount<'info>,
    #[account(init, payer = hunter, space = 8 + ChallengeCommit::INIT_SPACE, seeds = [CHALLENGE_COMMIT_SEED, proposal.key().as_ref(), hunter.key().as_ref(), commitment_hash.as_ref()], bump)]
    pub challenge_commit: Box<Account<'info, ChallengeCommit>>,
    #[account(init, payer = hunter, space = 8 + ChallengeBond::INIT_SPACE, seeds = [CHALLENGE_BOND_SEED, challenge_commit.key().as_ref()], bump)]
    pub challenge_bond: Box<Account<'info, ChallengeBond>>,
    /// CHECK: created and initialized as a genuine legacy Tokenkeg account.
    #[account(mut, seeds = [BOND_VAULT_SEED, challenge_commit.key().as_ref()], bump)]
    pub bond_vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: fixed legacy SPL Token program.
    #[account(address = TOKEN_PROGRAM_ID @ FaultlineError::UnsupportedEconomicTokenProgram)]
    pub token_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct OpenEconomicVerificationRound<'info> {
    #[account(mut)]
    pub opener: Signer<'info>,
    pub bindings: OpenEconomicRoundBindings<'info>,
    #[account(init, payer = opener, space = 8 + VerificationRound::INIT_SPACE, seeds = [VERIFICATION_ROUND_SEED, bindings.trace_claim.key().as_ref()], bump)]
    pub verification_round: Box<Account<'info, VerificationRound>>,
    #[account(init, payer = opener, space = 8 + RoundEconomicState::INIT_SPACE, seeds = [ROUND_ECONOMICS_SEED, verification_round.key().as_ref()], bump)]
    pub round_economic_state: Box<Account<'info, RoundEconomicState>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OpenEconomicRoundBindings<'info> {
    #[account(seeds = [SAFETY_POLICY_SEED, policy.target_program.as_ref()], bump = policy.bump)]
    pub policy: Box<Account<'info, SafetyPolicy>>,
    #[account(seeds = [ECONOMIC_POLICY_REGISTRY_SEED, policy.key().as_ref()], bump = economic_policy_registry.bump, constraint = economic_policy_registry.safety_policy == policy.key() @ FaultlineError::WrongPolicyBinding)]
    pub economic_policy_registry: Box<Account<'info, EconomicPolicyRegistry>>,
    #[account(seeds = [ECONOMIC_POLICY_SEED, economic_policy_registry.key().as_ref(), &economic_policy.config_id.to_le_bytes()], bump = economic_policy.bump, constraint = economic_policy.safety_policy == policy.key() @ FaultlineError::WrongPolicyBinding)]
    pub economic_policy: Box<Account<'info, EconomicPolicy>>,
    #[account(seeds = [UPGRADE_PROPOSAL_SEED, policy.key().as_ref(), &proposal.proposal_id.to_le_bytes()], bump = proposal.bump, has_one = policy)]
    pub proposal: Box<Account<'info, UpgradeProposal>>,
    #[account(mut, seeds = [PROPOSAL_ESCROW_SEED, proposal.key().as_ref()], bump = proposal_escrow.bump, constraint = proposal_escrow.proposal == proposal.key() @ FaultlineError::WrongProposalBinding, constraint = proposal_escrow.economic_policy == economic_policy.key() @ FaultlineError::WrongEconomicPolicy, constraint = proposal_escrow.payment_mint == economic_policy.payment_mint @ FaultlineError::WrongPaymentMint)]
    pub proposal_escrow: Box<Account<'info, ProposalEscrow>>,
    #[account(mut, seeds = [PROPOSAL_VERIFICATION_GATE_SEED, proposal.key().as_ref()], bump = proposal_verification_gate.bump, constraint = proposal_verification_gate.proposal == proposal.key() @ FaultlineError::WrongProposalBinding)]
    pub proposal_verification_gate: Box<Account<'info, ProposalVerificationGate>>,
    #[account(seeds = [INVARIANT_SEED, policy.key().as_ref(), &invariant.invariant_id.to_le_bytes()], bump = invariant.bump, constraint = invariant.safety_policy == policy.key() @ FaultlineError::WrongInvariantBinding)]
    pub invariant: Box<Account<'info, InvariantDefinition>>,
    #[account(seeds = [CHALLENGE_COMMIT_SEED, proposal.key().as_ref(), challenge_commit.hunter.as_ref(), challenge_commit.commitment_hash.as_ref()], bump = challenge_commit.bump, constraint = challenge_commit.proposal == proposal.key() @ FaultlineError::WrongProposalBinding, constraint = challenge_commit.invariant == invariant.key() @ FaultlineError::WrongInvariantBinding)]
    pub challenge_commit: Box<Account<'info, ChallengeCommit>>,
    #[account(seeds = [CHALLENGE_BOND_SEED, challenge_commit.key().as_ref()], bump = challenge_bond.bump, constraint = challenge_bond.challenge_commit == challenge_commit.key() @ FaultlineError::WrongChallengeBond, constraint = challenge_bond.proposal_escrow == proposal_escrow.key() @ FaultlineError::WrongProposalEscrow, constraint = challenge_bond.hunter == challenge_commit.hunter @ FaultlineError::UnauthorizedHunter)]
    pub challenge_bond: Box<Account<'info, ChallengeBond>>,
    #[account(seeds = [TRACE_CLAIM_SEED, proposal.key().as_ref(), trace_claim.trace_hash.as_ref()], bump = trace_claim.bump, constraint = trace_claim.proposal == proposal.key() @ FaultlineError::WrongProposalBinding, constraint = trace_claim.invariant == invariant.key() @ FaultlineError::WrongInvariantBinding, constraint = trace_claim.challenge_commit == challenge_commit.key() @ FaultlineError::WrongTraceBinding)]
    pub trace_claim: Box<Account<'info, TraceClaim>>,
    #[account(seeds = [VERIFIER_REGISTRY_SEED, policy.key().as_ref()], bump = verifier_registry.bump, constraint = verifier_registry.safety_policy == policy.key() @ FaultlineError::WrongPolicyBinding)]
    pub verifier_registry: Box<Account<'info, VerifierRegistry>>,
    #[account(seeds = [VERIFIER_EPOCH_SEED, verifier_registry.key().as_ref(), &verifier_epoch.epoch_id.to_le_bytes()], bump = verifier_epoch.bump, constraint = verifier_epoch.verifier_registry == verifier_registry.key() @ FaultlineError::WrongVerifierEpoch, constraint = verifier_epoch.safety_policy == policy.key() @ FaultlineError::WrongPolicyBinding)]
    pub verifier_epoch: Box<Account<'info, VerifierEpoch>>,
    #[account(seeds = [VERIFIER_EPOCH_ECONOMICS_SEED, verifier_epoch.key().as_ref(), economic_policy.key().as_ref()], bump = verifier_epoch_economics.bump, constraint = verifier_epoch_economics.verifier_epoch == verifier_epoch.key() @ FaultlineError::WrongVerifierEpoch, constraint = verifier_epoch_economics.economic_policy == economic_policy.key() @ FaultlineError::WrongEconomicPolicy, constraint = verifier_epoch_economics.verifier_registry == verifier_registry.key() @ FaultlineError::WrongVerifierEpoch)]
    pub verifier_epoch_economics: Box<Account<'info, VerifierEpochEconomics>>,
}

#[derive(Accounts)]
pub struct CloseFinalizedRoundEconomics<'info> {
    pub caller: Signer<'info>,
    #[account(seeds = [SAFETY_POLICY_SEED, policy.target_program.as_ref()], bump = policy.bump)]
    pub policy: Box<Account<'info, SafetyPolicy>>,
    #[account(seeds = [UPGRADE_PROPOSAL_SEED, policy.key().as_ref(), &proposal.proposal_id.to_le_bytes()], bump = proposal.bump, has_one = policy)]
    pub proposal: Box<Account<'info, UpgradeProposal>>,
    #[account(mut, seeds = [PROPOSAL_ESCROW_SEED, proposal.key().as_ref()], bump = proposal_escrow.bump, constraint = proposal_escrow.proposal == proposal.key() @ FaultlineError::WrongProposalBinding)]
    pub proposal_escrow: Box<Account<'info, ProposalEscrow>>,
    #[account(seeds = [PROPOSAL_VERIFICATION_GATE_SEED, proposal.key().as_ref()], bump = proposal_verification_gate.bump, constraint = proposal_verification_gate.proposal == proposal.key() @ FaultlineError::WrongProposalBinding)]
    pub proposal_verification_gate: Box<Account<'info, ProposalVerificationGate>>,
    #[account(seeds = [VERIFICATION_ROUND_SEED, verification_round.trace_claim.as_ref()], bump = verification_round.bump, constraint = verification_round.policy == policy.key() @ FaultlineError::WrongPolicyBinding, constraint = verification_round.proposal == proposal.key() @ FaultlineError::WrongProposalBinding)]
    pub verification_round: Box<Account<'info, VerificationRound>>,
    #[account(mut, seeds = [ROUND_ECONOMICS_SEED, verification_round.key().as_ref()], bump = round_economic_state.bump, constraint = round_economic_state.verification_round == verification_round.key() @ FaultlineError::WrongRoundBinding, constraint = round_economic_state.proposal_escrow == proposal_escrow.key() @ FaultlineError::WrongProposalEscrow)]
    pub round_economic_state: Box<Account<'info, RoundEconomicState>>,
}

#[derive(Accounts)]
pub struct CloseUnfinalizedRoundEconomics<'info> {
    pub caller: Signer<'info>,
    #[account(seeds = [SAFETY_POLICY_SEED, policy.target_program.as_ref()], bump = policy.bump)]
    pub policy: Box<Account<'info, SafetyPolicy>>,
    #[account(seeds = [UPGRADE_PROPOSAL_SEED, policy.key().as_ref(), &proposal.proposal_id.to_le_bytes()], bump = proposal.bump, has_one = policy)]
    pub proposal: Box<Account<'info, UpgradeProposal>>,
    #[account(mut, seeds = [PROPOSAL_ESCROW_SEED, proposal.key().as_ref()], bump = proposal_escrow.bump, constraint = proposal_escrow.proposal == proposal.key() @ FaultlineError::WrongProposalBinding)]
    pub proposal_escrow: Box<Account<'info, ProposalEscrow>>,
    #[account(seeds = [PROPOSAL_VERIFICATION_GATE_SEED, proposal.key().as_ref()], bump = proposal_verification_gate.bump, constraint = proposal_verification_gate.proposal == proposal.key() @ FaultlineError::WrongProposalBinding)]
    pub proposal_verification_gate: Box<Account<'info, ProposalVerificationGate>>,
    #[account(seeds = [VERIFICATION_ROUND_SEED, verification_round.trace_claim.as_ref()], bump = verification_round.bump, constraint = verification_round.policy == policy.key() @ FaultlineError::WrongPolicyBinding, constraint = verification_round.proposal == proposal.key() @ FaultlineError::WrongProposalBinding)]
    pub verification_round: Box<Account<'info, VerificationRound>>,
    #[account(mut, seeds = [ROUND_ECONOMICS_SEED, verification_round.key().as_ref()], bump = round_economic_state.bump, constraint = round_economic_state.verification_round == verification_round.key() @ FaultlineError::WrongRoundBinding, constraint = round_economic_state.proposal_escrow == proposal_escrow.key() @ FaultlineError::WrongProposalEscrow)]
    pub round_economic_state: Box<Account<'info, RoundEconomicState>>,
}

#[derive(Accounts)]
pub struct EconomicSettlementBase<'info> {
    #[account(seeds = [SAFETY_POLICY_SEED, policy.target_program.as_ref()], bump = policy.bump)]
    pub policy: Box<Account<'info, SafetyPolicy>>,
    #[account(seeds = [ECONOMIC_POLICY_REGISTRY_SEED, policy.key().as_ref()], bump = economic_policy_registry.bump, constraint = economic_policy_registry.safety_policy == policy.key() @ FaultlineError::WrongPolicyBinding)]
    pub economic_policy_registry: Box<Account<'info, EconomicPolicyRegistry>>,
    #[account(seeds = [ECONOMIC_POLICY_SEED, economic_policy_registry.key().as_ref(), &economic_policy.config_id.to_le_bytes()], bump = economic_policy.bump, constraint = economic_policy.economic_policy_registry == economic_policy_registry.key() @ FaultlineError::WrongEconomicPolicy, constraint = economic_policy.safety_policy == policy.key() @ FaultlineError::WrongPolicyBinding, constraint = economic_policy.token_program == TOKEN_PROGRAM_ID @ FaultlineError::UnsupportedEconomicTokenProgram)]
    pub economic_policy: Box<Account<'info, EconomicPolicy>>,
    #[account(seeds = [UPGRADE_PROPOSAL_SEED, policy.key().as_ref(), &proposal.proposal_id.to_le_bytes()], bump = proposal.bump, has_one = policy)]
    pub proposal: Box<Account<'info, UpgradeProposal>>,
    #[account(mut, seeds = [PROPOSAL_ESCROW_SEED, proposal.key().as_ref()], bump = proposal_escrow.bump, constraint = proposal_escrow.proposal == proposal.key() @ FaultlineError::WrongProposalBinding, constraint = proposal_escrow.economic_policy == economic_policy.key() @ FaultlineError::WrongEconomicPolicy, constraint = proposal_escrow.payment_mint == economic_policy.payment_mint @ FaultlineError::WrongPaymentMint)]
    pub proposal_escrow: Box<Account<'info, ProposalEscrow>>,
    /// CHECK: immutable legacy mint bound by EconomicPolicy.
    #[account(address = economic_policy.payment_mint @ FaultlineError::WrongPaymentMint)]
    pub payment_mint: UncheckedAccount<'info>,
    /// CHECK: fixed legacy SPL Token program.
    #[account(address = TOKEN_PROGRAM_ID @ FaultlineError::UnsupportedEconomicTokenProgram)]
    pub token_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SettleAcceptedChallenge<'info> {
    pub caller: Signer<'info>,
    pub base: EconomicSettlementBase<'info>,
    #[account(seeds = [PROPOSAL_VERIFICATION_GATE_SEED, base.proposal.key().as_ref()], bump = proposal_verification_gate.bump, constraint = proposal_verification_gate.proposal == base.proposal.key() @ FaultlineError::WrongProposalBinding)]
    pub proposal_verification_gate: Box<Account<'info, ProposalVerificationGate>>,
    #[account(seeds = [TRACE_CLAIM_SEED, base.proposal.key().as_ref(), trace_claim.trace_hash.as_ref()], bump = trace_claim.bump, constraint = trace_claim.proposal == base.proposal.key() @ FaultlineError::WrongProposalBinding)]
    pub trace_claim: Box<Account<'info, TraceClaim>>,
    #[account(seeds = [CHALLENGE_COMMIT_SEED, base.proposal.key().as_ref(), challenge_commit.hunter.as_ref(), challenge_commit.commitment_hash.as_ref()], bump = challenge_commit.bump, constraint = challenge_commit.proposal == base.proposal.key() @ FaultlineError::WrongProposalBinding, constraint = challenge_commit.invariant == trace_claim.invariant @ FaultlineError::WrongInvariantBinding, constraint = trace_claim.challenge_commit == challenge_commit.key() @ FaultlineError::WrongTraceBinding, constraint = trace_claim.hunter == challenge_commit.hunter @ FaultlineError::UnauthorizedHunter, constraint = challenge_commit.revealed_trace_hash == Some(trace_claim.trace_hash) @ FaultlineError::WrongTraceBinding)]
    pub challenge_commit: Box<Account<'info, ChallengeCommit>>,
    #[account(mut, seeds = [CHALLENGE_BOND_SEED, challenge_commit.key().as_ref()], bump = challenge_bond.bump, constraint = challenge_bond.challenge_commit == challenge_commit.key() @ FaultlineError::WrongChallengeBond, constraint = challenge_bond.proposal_escrow == base.proposal_escrow.key() @ FaultlineError::WrongProposalEscrow, constraint = challenge_bond.hunter == challenge_commit.hunter @ FaultlineError::UnauthorizedHunter)]
    pub challenge_bond: Box<Account<'info, ChallengeBond>>,
    #[account(seeds = [VERIFICATION_ROUND_SEED, trace_claim.key().as_ref()], bump = verification_round.bump, constraint = verification_round.policy == base.policy.key() @ FaultlineError::WrongPolicyBinding, constraint = verification_round.proposal == base.proposal.key() @ FaultlineError::WrongProposalBinding, constraint = verification_round.invariant == trace_claim.invariant @ FaultlineError::WrongInvariantBinding, constraint = verification_round.trace_claim == trace_claim.key() @ FaultlineError::WrongTraceBinding, constraint = verification_round.trace_hash == trace_claim.trace_hash @ FaultlineError::WrongTraceBinding)]
    pub verification_round: Box<Account<'info, VerificationRound>>,
    #[account(seeds = [ROUND_ECONOMICS_SEED, verification_round.key().as_ref()], bump = round_economic_state.bump, constraint = round_economic_state.verification_round == verification_round.key() @ FaultlineError::WrongRoundBinding, constraint = round_economic_state.proposal_escrow == base.proposal_escrow.key() @ FaultlineError::WrongProposalEscrow)]
    pub round_economic_state: Box<Account<'info, RoundEconomicState>>,
    /// CHECK: validated as recorded hunter's canonical ATA.
    #[account(mut)]
    pub hunter_token_account: UncheckedAccount<'info>,
    /// CHECK: validated Tokenkeg vault controlled by ProposalEscrow.
    #[account(mut, address = base.proposal_escrow.bounty_vault @ FaultlineError::WrongVault)]
    pub bounty_vault: UncheckedAccount<'info>,
    /// CHECK: validated Tokenkeg vault controlled by ChallengeBond.
    #[account(mut, address = challenge_bond.bond_vault @ FaultlineError::WrongVault)]
    pub bond_vault: UncheckedAccount<'info>,
    /// CHECK: immutable recorded hunter rent recipient.
    #[account(mut, address = challenge_bond.rent_recipient @ FaultlineError::WrongRentRecipient)]
    pub rent_recipient: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SettleHoldChallenge<'info> {
    pub caller: Signer<'info>,
    pub base: EconomicSettlementBase<'info>,
    #[account(seeds = [TRACE_CLAIM_SEED, base.proposal.key().as_ref(), trace_claim.trace_hash.as_ref()], bump = trace_claim.bump, constraint = trace_claim.proposal == base.proposal.key() @ FaultlineError::WrongProposalBinding)]
    pub trace_claim: Box<Account<'info, TraceClaim>>,
    #[account(seeds = [CHALLENGE_COMMIT_SEED, base.proposal.key().as_ref(), challenge_commit.hunter.as_ref(), challenge_commit.commitment_hash.as_ref()], bump = challenge_commit.bump, constraint = challenge_commit.proposal == base.proposal.key() @ FaultlineError::WrongProposalBinding, constraint = challenge_commit.invariant == trace_claim.invariant @ FaultlineError::WrongInvariantBinding, constraint = trace_claim.challenge_commit == challenge_commit.key() @ FaultlineError::WrongTraceBinding, constraint = trace_claim.hunter == challenge_commit.hunter @ FaultlineError::UnauthorizedHunter, constraint = challenge_commit.revealed_trace_hash == Some(trace_claim.trace_hash) @ FaultlineError::WrongTraceBinding)]
    pub challenge_commit: Box<Account<'info, ChallengeCommit>>,
    #[account(mut, seeds = [CHALLENGE_BOND_SEED, challenge_commit.key().as_ref()], bump = challenge_bond.bump, constraint = challenge_bond.challenge_commit == challenge_commit.key() @ FaultlineError::WrongChallengeBond, constraint = challenge_bond.proposal_escrow == base.proposal_escrow.key() @ FaultlineError::WrongProposalEscrow, constraint = challenge_bond.hunter == challenge_commit.hunter @ FaultlineError::UnauthorizedHunter)]
    pub challenge_bond: Box<Account<'info, ChallengeBond>>,
    #[account(seeds = [VERIFICATION_ROUND_SEED, trace_claim.key().as_ref()], bump = verification_round.bump, constraint = verification_round.policy == base.policy.key() @ FaultlineError::WrongPolicyBinding, constraint = verification_round.proposal == base.proposal.key() @ FaultlineError::WrongProposalBinding, constraint = verification_round.invariant == trace_claim.invariant @ FaultlineError::WrongInvariantBinding, constraint = verification_round.trace_claim == trace_claim.key() @ FaultlineError::WrongTraceBinding, constraint = verification_round.trace_hash == trace_claim.trace_hash @ FaultlineError::WrongTraceBinding)]
    pub verification_round: Box<Account<'info, VerificationRound>>,
    #[account(seeds = [ROUND_ECONOMICS_SEED, verification_round.key().as_ref()], bump = round_economic_state.bump, constraint = round_economic_state.verification_round == verification_round.key() @ FaultlineError::WrongRoundBinding, constraint = round_economic_state.proposal_escrow == base.proposal_escrow.key() @ FaultlineError::WrongProposalEscrow)]
    pub round_economic_state: Box<Account<'info, RoundEconomicState>>,
    /// CHECK: canonical recorded hunter ATA.
    #[account(mut)]
    pub hunter_token_account: UncheckedAccount<'info>,
    /// CHECK: validated Tokenkeg vault controlled by ChallengeBond.
    #[account(mut, address = challenge_bond.bond_vault @ FaultlineError::WrongVault)]
    pub bond_vault: UncheckedAccount<'info>,
    /// CHECK: validated Tokenkeg vault controlled by ProposalEscrow.
    #[account(mut, address = base.proposal_escrow.penalty_vault @ FaultlineError::WrongVault)]
    pub penalty_vault: UncheckedAccount<'info>,
    /// CHECK: immutable recorded hunter rent recipient.
    #[account(mut, address = challenge_bond.rent_recipient @ FaultlineError::WrongRentRecipient)]
    pub rent_recipient: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SettleNonRevealChallenge<'info> {
    pub caller: Signer<'info>,
    pub base: EconomicSettlementBase<'info>,
    #[account(seeds = [CHALLENGE_COMMIT_SEED, base.proposal.key().as_ref(), challenge_commit.hunter.as_ref(), challenge_commit.commitment_hash.as_ref()], bump = challenge_commit.bump, constraint = challenge_commit.proposal == base.proposal.key() @ FaultlineError::WrongProposalBinding)]
    pub challenge_commit: Box<Account<'info, ChallengeCommit>>,
    #[account(mut, seeds = [CHALLENGE_BOND_SEED, challenge_commit.key().as_ref()], bump = challenge_bond.bump, constraint = challenge_bond.challenge_commit == challenge_commit.key() @ FaultlineError::WrongChallengeBond, constraint = challenge_bond.proposal_escrow == base.proposal_escrow.key() @ FaultlineError::WrongProposalEscrow, constraint = challenge_bond.hunter == challenge_commit.hunter @ FaultlineError::UnauthorizedHunter)]
    pub challenge_bond: Box<Account<'info, ChallengeBond>>,
    /// CHECK: validated Tokenkeg vault controlled by ChallengeBond.
    #[account(mut, address = challenge_bond.bond_vault @ FaultlineError::WrongVault)]
    pub bond_vault: UncheckedAccount<'info>,
    /// CHECK: validated Tokenkeg vault controlled by ProposalEscrow.
    #[account(mut, address = base.proposal_escrow.penalty_vault @ FaultlineError::WrongVault)]
    pub penalty_vault: UncheckedAccount<'info>,
    /// CHECK: immutable recorded hunter rent recipient.
    #[account(mut, address = challenge_bond.rent_recipient @ FaultlineError::WrongRentRecipient)]
    pub rent_recipient: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SettleRoundRefundChallenge<'info> {
    pub caller: Signer<'info>,
    pub base: EconomicSettlementBase<'info>,
    #[account(seeds = [TRACE_CLAIM_SEED, base.proposal.key().as_ref(), trace_claim.trace_hash.as_ref()], bump = trace_claim.bump, constraint = trace_claim.proposal == base.proposal.key() @ FaultlineError::WrongProposalBinding)]
    pub trace_claim: Box<Account<'info, TraceClaim>>,
    #[account(seeds = [CHALLENGE_COMMIT_SEED, base.proposal.key().as_ref(), challenge_commit.hunter.as_ref(), challenge_commit.commitment_hash.as_ref()], bump = challenge_commit.bump, constraint = challenge_commit.proposal == base.proposal.key() @ FaultlineError::WrongProposalBinding, constraint = challenge_commit.invariant == trace_claim.invariant @ FaultlineError::WrongInvariantBinding, constraint = trace_claim.challenge_commit == challenge_commit.key() @ FaultlineError::WrongTraceBinding, constraint = trace_claim.hunter == challenge_commit.hunter @ FaultlineError::UnauthorizedHunter, constraint = challenge_commit.revealed_trace_hash == Some(trace_claim.trace_hash) @ FaultlineError::WrongTraceBinding)]
    pub challenge_commit: Box<Account<'info, ChallengeCommit>>,
    #[account(mut, seeds = [CHALLENGE_BOND_SEED, challenge_commit.key().as_ref()], bump = challenge_bond.bump, constraint = challenge_bond.challenge_commit == challenge_commit.key() @ FaultlineError::WrongChallengeBond, constraint = challenge_bond.proposal_escrow == base.proposal_escrow.key() @ FaultlineError::WrongProposalEscrow, constraint = challenge_bond.hunter == challenge_commit.hunter @ FaultlineError::UnauthorizedHunter)]
    pub challenge_bond: Box<Account<'info, ChallengeBond>>,
    #[account(seeds = [VERIFICATION_ROUND_SEED, trace_claim.key().as_ref()], bump = verification_round.bump, constraint = verification_round.policy == base.policy.key() @ FaultlineError::WrongPolicyBinding, constraint = verification_round.proposal == base.proposal.key() @ FaultlineError::WrongProposalBinding, constraint = verification_round.invariant == trace_claim.invariant @ FaultlineError::WrongInvariantBinding, constraint = verification_round.trace_claim == trace_claim.key() @ FaultlineError::WrongTraceBinding, constraint = verification_round.trace_hash == trace_claim.trace_hash @ FaultlineError::WrongTraceBinding)]
    pub verification_round: Box<Account<'info, VerificationRound>>,
    #[account(seeds = [ROUND_ECONOMICS_SEED, verification_round.key().as_ref()], bump = round_economic_state.bump, constraint = round_economic_state.verification_round == verification_round.key() @ FaultlineError::WrongRoundBinding, constraint = round_economic_state.proposal_escrow == base.proposal_escrow.key() @ FaultlineError::WrongProposalEscrow)]
    pub round_economic_state: Box<Account<'info, RoundEconomicState>>,
    /// CHECK: canonical recorded hunter ATA.
    #[account(mut)]
    pub hunter_token_account: UncheckedAccount<'info>,
    /// CHECK: validated Tokenkeg vault controlled by ChallengeBond.
    #[account(mut, address = challenge_bond.bond_vault @ FaultlineError::WrongVault)]
    pub bond_vault: UncheckedAccount<'info>,
    /// CHECK: immutable recorded hunter rent recipient.
    #[account(mut, address = challenge_bond.rent_recipient @ FaultlineError::WrongRentRecipient)]
    pub rent_recipient: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SettleRevealedUnopenedChallenge<'info> {
    pub caller: Signer<'info>,
    pub base: EconomicSettlementBase<'info>,
    #[account(seeds = [TRACE_CLAIM_SEED, base.proposal.key().as_ref(), trace_claim.trace_hash.as_ref()], bump = trace_claim.bump, constraint = trace_claim.proposal == base.proposal.key() @ FaultlineError::WrongProposalBinding)]
    pub trace_claim: Box<Account<'info, TraceClaim>>,
    #[account(seeds = [CHALLENGE_COMMIT_SEED, base.proposal.key().as_ref(), challenge_commit.hunter.as_ref(), challenge_commit.commitment_hash.as_ref()], bump = challenge_commit.bump, constraint = challenge_commit.proposal == base.proposal.key() @ FaultlineError::WrongProposalBinding, constraint = challenge_commit.invariant == trace_claim.invariant @ FaultlineError::WrongInvariantBinding, constraint = trace_claim.challenge_commit == challenge_commit.key() @ FaultlineError::WrongTraceBinding, constraint = trace_claim.hunter == challenge_commit.hunter @ FaultlineError::UnauthorizedHunter, constraint = challenge_commit.revealed_trace_hash == Some(trace_claim.trace_hash) @ FaultlineError::WrongTraceBinding)]
    pub challenge_commit: Box<Account<'info, ChallengeCommit>>,
    #[account(mut, seeds = [CHALLENGE_BOND_SEED, challenge_commit.key().as_ref()], bump = challenge_bond.bump, constraint = challenge_bond.challenge_commit == challenge_commit.key() @ FaultlineError::WrongChallengeBond, constraint = challenge_bond.proposal_escrow == base.proposal_escrow.key() @ FaultlineError::WrongProposalEscrow, constraint = challenge_bond.hunter == challenge_commit.hunter @ FaultlineError::UnauthorizedHunter)]
    pub challenge_bond: Box<Account<'info, ChallengeBond>>,
    /// CHECK: canonical PDA must remain an absent, empty system account.
    #[account(mut, seeds = [VERIFICATION_ROUND_SEED, trace_claim.key().as_ref()], bump)]
    pub verification_round: UncheckedAccount<'info>,
    /// CHECK: canonical PDA must remain an absent, empty system account.
    #[account(mut, seeds = [ROUND_ECONOMICS_SEED, verification_round.key().as_ref()], bump)]
    pub round_economic_state: UncheckedAccount<'info>,
    /// CHECK: canonical recorded hunter ATA.
    #[account(mut)]
    pub hunter_token_account: UncheckedAccount<'info>,
    /// CHECK: validated Tokenkeg vault controlled by ChallengeBond.
    #[account(mut, address = challenge_bond.bond_vault @ FaultlineError::WrongVault)]
    pub bond_vault: UncheckedAccount<'info>,
    /// CHECK: immutable recorded hunter rent recipient.
    #[account(mut, address = challenge_bond.rent_recipient @ FaultlineError::WrongRentRecipient)]
    pub rent_recipient: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ClaimVerifierFee<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    pub base: EconomicSettlementBase<'info>,
    /// CHECK: immutable verifier identity; membership and attestation bindings are validated.
    pub verifier: UncheckedAccount<'info>,
    #[account(seeds = [VERIFIER_EPOCH_SEED, verifier_epoch.verifier_registry.as_ref(), &verifier_epoch.epoch_id.to_le_bytes()], bump = verifier_epoch.bump, address = verification_round.verifier_epoch @ FaultlineError::WrongVerifierEpoch, constraint = verifier_epoch.safety_policy == base.policy.key() @ FaultlineError::WrongPolicyBinding)]
    pub verifier_epoch: Box<Account<'info, VerifierEpoch>>,
    #[account(seeds = [VERIFICATION_ROUND_SEED, verification_round.trace_claim.as_ref()], bump = verification_round.bump, constraint = verification_round.policy == base.policy.key() @ FaultlineError::WrongPolicyBinding, constraint = verification_round.proposal == base.proposal.key() @ FaultlineError::WrongProposalBinding)]
    pub verification_round: Box<Account<'info, VerificationRound>>,
    #[account(seeds = [ROUND_ECONOMICS_SEED, verification_round.key().as_ref()], bump = round_economic_state.bump, constraint = round_economic_state.verification_round == verification_round.key() @ FaultlineError::WrongRoundBinding, constraint = round_economic_state.proposal_escrow == base.proposal_escrow.key() @ FaultlineError::WrongProposalEscrow)]
    pub round_economic_state: Box<Account<'info, RoundEconomicState>>,
    #[account(seeds = [REPLAY_RESULT_SEED, verification_round.key().as_ref(), replay_result.result_hash.as_ref()], bump = replay_result.bump, constraint = replay_result.verification_round == verification_round.key() @ FaultlineError::WrongRoundBinding)]
    pub replay_result: Box<Account<'info, ReplayResult>>,
    #[account(seeds = [VERIFIER_ATTESTATION_SEED, verification_round.key().as_ref(), verifier.key().as_ref()], bump = verifier_attestation.bump)]
    pub verifier_attestation: Box<Account<'info, VerifierAttestation>>,
    #[account(init_if_needed, payer = caller, space = 8 + VerifierFeeClaim::INIT_SPACE, seeds = [VERIFIER_FEE_CLAIM_SEED, verification_round.key().as_ref(), verifier.key().as_ref()], bump)]
    pub verifier_fee_claim: Box<Account<'info, VerifierFeeClaim>>,
    /// CHECK: verifier's pre-existing canonical Tokenkeg ATA.
    #[account(mut)]
    pub verifier_token_account: UncheckedAccount<'info>,
    /// CHECK: canonical ProposalEscrow-controlled FeeVault.
    #[account(mut, seeds = [FEE_VAULT_SEED, base.proposal.key().as_ref()], bump, address = base.proposal_escrow.fee_vault @ FaultlineError::WrongVault)]
    pub fee_vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SlashVerifierNonReveal<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    pub base: EconomicSettlementBase<'info>,
    /// CHECK: immutable assigned verifier identity; epoch membership is validated.
    pub verifier: UncheckedAccount<'info>,
    #[account(seeds = [VERIFIER_EPOCH_SEED, verifier_epoch.verifier_registry.as_ref(), &verifier_epoch.epoch_id.to_le_bytes()], bump = verifier_epoch.bump, address = verification_round.verifier_epoch @ FaultlineError::WrongVerifierEpoch, constraint = verifier_epoch.safety_policy == base.policy.key() @ FaultlineError::WrongPolicyBinding)]
    pub verifier_epoch: Box<Account<'info, VerifierEpoch>>,
    #[account(seeds = [VERIFICATION_ROUND_SEED, verification_round.trace_claim.as_ref()], bump = verification_round.bump, constraint = verification_round.policy == base.policy.key() @ FaultlineError::WrongPolicyBinding, constraint = verification_round.proposal == base.proposal.key() @ FaultlineError::WrongProposalBinding)]
    pub verification_round: Box<Account<'info, VerificationRound>>,
    #[account(seeds = [ROUND_ECONOMICS_SEED, verification_round.key().as_ref()], bump = round_economic_state.bump, constraint = round_economic_state.verification_round == verification_round.key() @ FaultlineError::WrongRoundBinding, constraint = round_economic_state.proposal_escrow == base.proposal_escrow.key() @ FaultlineError::WrongProposalEscrow)]
    pub round_economic_state: Box<Account<'info, RoundEconomicState>>,
    #[account(mut, seeds = [VERIFIER_STAKE_SEED, base.economic_policy.key().as_ref(), verifier.key().as_ref()], bump = verifier_stake.bump, constraint = verifier_stake.economic_policy == base.economic_policy.key() @ FaultlineError::WrongEconomicPolicy, constraint = verifier_stake.verifier == verifier.key() @ FaultlineError::WrongVerifierStake, constraint = verifier_stake.payment_mint == base.economic_policy.payment_mint @ FaultlineError::WrongPaymentMint)]
    pub verifier_stake: Box<Account<'info, VerifierStake>>,
    /// CHECK: canonical Tokenkeg StakeVault controlled by VerifierStake.
    #[account(mut, seeds = [STAKE_VAULT_SEED, base.economic_policy.key().as_ref(), verifier.key().as_ref()], bump, address = verifier_stake.stake_vault @ FaultlineError::WrongVault)]
    pub stake_vault: UncheckedAccount<'info>,
    /// CHECK: canonical ProposalEscrow-controlled PenaltyVault.
    #[account(mut, seeds = [PENALTY_VAULT_SEED, base.proposal.key().as_ref()], bump, address = base.proposal_escrow.penalty_vault @ FaultlineError::WrongVault)]
    pub penalty_vault: UncheckedAccount<'info>,
    /// CHECK: canonical PDA is accepted only as an empty system-owned absence proof.
    #[account(seeds = [VERIFIER_ATTESTATION_SEED, verification_round.key().as_ref(), verifier.key().as_ref()], bump)]
    pub verifier_attestation: UncheckedAccount<'info>,
    #[account(init_if_needed, payer = caller, space = 8 + VerifierSlashReceipt::INIT_SPACE, seeds = [VERIFIER_SLASH_SEED, verification_round.key().as_ref(), verifier.key().as_ref()], bump)]
    pub verifier_slash_receipt: Box<Account<'info, VerifierSlashReceipt>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RefundProposalEscrow<'info> {
    pub caller: Signer<'info>,
    pub base: EconomicSettlementBase<'info>,
    /// CHECK: original funder's pre-existing canonical Tokenkeg ATA.
    #[account(mut)]
    pub funder_token_account: UncheckedAccount<'info>,
    /// CHECK: canonical ProposalEscrow-controlled BountyVault.
    #[account(mut, seeds = [BOUNTY_VAULT_SEED, base.proposal.key().as_ref()], bump, address = base.proposal_escrow.bounty_vault @ FaultlineError::WrongVault)]
    pub bounty_vault: UncheckedAccount<'info>,
    /// CHECK: canonical ProposalEscrow-controlled FeeVault.
    #[account(mut, seeds = [FEE_VAULT_SEED, base.proposal.key().as_ref()], bump, address = base.proposal_escrow.fee_vault @ FaultlineError::WrongVault)]
    pub fee_vault: UncheckedAccount<'info>,
    /// CHECK: canonical ProposalEscrow-controlled PenaltyVault.
    #[account(mut, seeds = [PENALTY_VAULT_SEED, base.proposal.key().as_ref()], bump, address = base.proposal_escrow.penalty_vault @ FaultlineError::WrongVault)]
    pub penalty_vault: UncheckedAccount<'info>,
    /// CHECK: immutable funder and vault-rent recipient recorded at funding.
    #[account(mut, address = base.proposal_escrow.funder @ FaultlineError::WrongRentRecipient, constraint = *rent_recipient.owner == solana_system_program::ID @ FaultlineError::WrongAccountOwner)]
    pub rent_recipient: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(result_hash: [u8; 32])]
pub struct CreateReplayResult<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [VERIFICATION_ROUND_SEED, verification_round.trace_claim.as_ref()], bump = verification_round.bump)]
    pub verification_round: Box<Account<'info, VerificationRound>>,
    #[account(init, payer = payer, space = 8 + ReplayResult::INIT_SPACE, seeds = [REPLAY_RESULT_SEED, verification_round.key().as_ref(), result_hash.as_ref()], bump)]
    pub replay_result: Account<'info, ReplayResult>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
#[instruction(result_hash: [u8; 32])]
pub struct SubmitVerifierAttestation<'info> {
    #[account(mut)]
    pub verifier: Signer<'info>,
    #[account(seeds = [SAFETY_POLICY_SEED, policy.target_program.as_ref()], bump = policy.bump)]
    pub policy: Account<'info, SafetyPolicy>,
    #[account(seeds = [UPGRADE_PROPOSAL_SEED, policy.key().as_ref(), &proposal.proposal_id.to_le_bytes()], bump = proposal.bump, has_one = policy)]
    pub proposal: Account<'info, UpgradeProposal>,
    #[account(address = verification_round.invariant @ FaultlineError::WrongInvariantBinding)]
    pub invariant: Account<'info, InvariantDefinition>,
    #[account(seeds = [TRACE_CLAIM_SEED, proposal.key().as_ref(), trace_claim.trace_hash.as_ref()], bump = trace_claim.bump, address = verification_round.trace_claim @ FaultlineError::WrongTraceBinding)]
    pub trace_claim: Account<'info, TraceClaim>,
    #[account(seeds = [VERIFIER_EPOCH_SEED, verifier_epoch.verifier_registry.as_ref(), &verifier_epoch.epoch_id.to_le_bytes()], bump = verifier_epoch.bump, address = verification_round.verifier_epoch @ FaultlineError::WrongVerifierEpoch)]
    pub verifier_epoch: Box<Account<'info, VerifierEpoch>>,
    #[account(seeds = [VERIFICATION_ROUND_SEED, trace_claim.key().as_ref()], bump = verification_round.bump, constraint = verification_round.policy == policy.key() @ FaultlineError::WrongPolicyBinding, constraint = verification_round.proposal == proposal.key() @ FaultlineError::WrongProposalBinding)]
    pub verification_round: Box<Account<'info, VerificationRound>>,
    #[account(mut, seeds = [REPLAY_RESULT_SEED, verification_round.key().as_ref(), result_hash.as_ref()], bump = replay_result.bump, constraint = replay_result.verification_round == verification_round.key() @ FaultlineError::WrongRoundBinding)]
    pub replay_result: Box<Account<'info, ReplayResult>>,
    #[account(init_if_needed, payer = verifier, space = 8 + VerifierAttestation::INIT_SPACE, seeds = [VERIFIER_ATTESTATION_SEED, verification_round.key().as_ref(), verifier.key().as_ref()], bump)]
    pub verifier_attestation: Box<Account<'info, VerifierAttestation>>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct FinalizeReplayResult<'info> {
    pub caller: Signer<'info>,
    #[account(seeds = [SAFETY_POLICY_SEED, policy.target_program.as_ref()], bump = policy.bump)]
    pub policy: Account<'info, SafetyPolicy>,
    #[account(mut, seeds = [UPGRADE_PROPOSAL_SEED, policy.key().as_ref(), &proposal.proposal_id.to_le_bytes()], bump = proposal.bump, has_one = policy)]
    pub proposal: Account<'info, UpgradeProposal>,
    #[account(mut, seeds = [PROPOSAL_VERIFICATION_GATE_SEED, proposal.key().as_ref()], bump = proposal_verification_gate.bump, constraint = proposal_verification_gate.proposal == proposal.key() @ FaultlineError::WrongProposalBinding)]
    pub proposal_verification_gate: Account<'info, ProposalVerificationGate>,
    #[account(mut, seeds = [VERIFICATION_ROUND_SEED, verification_round.trace_claim.as_ref()], bump = verification_round.bump, constraint = verification_round.policy == policy.key() @ FaultlineError::WrongPolicyBinding, constraint = verification_round.proposal == proposal.key() @ FaultlineError::WrongProposalBinding)]
    pub verification_round: Box<Account<'info, VerificationRound>>,
    #[account(seeds = [REPLAY_RESULT_SEED, verification_round.key().as_ref(), replay_result.result_hash.as_ref()], bump = replay_result.bump, constraint = replay_result.verification_round == verification_round.key() @ FaultlineError::WrongRoundBinding)]
    pub replay_result: Account<'info, ReplayResult>,
}
#[derive(Accounts)]
pub struct ExpireProposal<'info> {
    pub caller: Signer<'info>,
    #[account(seeds = [SAFETY_POLICY_SEED, policy.target_program.as_ref()], bump = policy.bump)]
    pub policy: Account<'info, SafetyPolicy>,
    #[account(mut, seeds = [UPGRADE_PROPOSAL_SEED, policy.key().as_ref(), &proposal.proposal_id.to_le_bytes()], bump = proposal.bump, has_one = policy)]
    pub proposal: Account<'info, UpgradeProposal>,
}
#[derive(Accounts)]
pub struct RecordTemporaryDecision<'info> {
    pub governance: Signer<'info>,
    #[account(seeds = [SAFETY_POLICY_SEED, policy.target_program.as_ref()], bump = policy.bump, constraint = policy.governance_authority == governance.key() @ FaultlineError::UnauthorizedGovernance)]
    pub policy: Account<'info, SafetyPolicy>,
    #[account(mut, seeds = [UPGRADE_PROPOSAL_SEED, policy.key().as_ref(), &proposal.proposal_id.to_le_bytes()], bump = proposal.bump, has_one = policy)]
    pub proposal: Account<'info, UpgradeProposal>,
    #[account(seeds = [PROPOSAL_VERIFICATION_GATE_SEED, proposal.key().as_ref()], bump = proposal_verification_gate.bump, constraint = proposal_verification_gate.proposal == proposal.key() @ FaultlineError::WrongProposalBinding)]
    pub proposal_verification_gate: Account<'info, ProposalVerificationGate>,
}
#[derive(Accounts)]
pub struct ExecuteGuardedUpgrade<'info> {
    pub executor: Signer<'info>,
    #[account(seeds = [DOMAIN_SEED, GUARD_SEED, guard_config.target_program.as_ref()], bump = guard_config.guard_bump)]
    pub guard_config: Account<'info, GuardConfig>,
    #[account(seeds = [SAFETY_POLICY_SEED, policy.target_program.as_ref()], bump = policy.bump, constraint = policy.target_program == guard_config.target_program @ FaultlineError::WrongTargetProgram)]
    pub policy: Account<'info, SafetyPolicy>,
    #[account(mut, seeds = [UPGRADE_PROPOSAL_SEED, policy.key().as_ref(), &proposal.proposal_id.to_le_bytes()], bump = proposal.bump, has_one = policy, has_one = target_program, has_one = program_data, has_one = candidate_buffer)]
    pub proposal: Account<'info, UpgradeProposal>,
    #[account(seeds = [PROPOSAL_VERIFICATION_GATE_SEED, proposal.key().as_ref()], bump = proposal_verification_gate.bump, constraint = proposal_verification_gate.proposal == proposal.key() @ FaultlineError::WrongProposalBinding)]
    pub proposal_verification_gate: Account<'info, ProposalVerificationGate>,
    #[account(seeds = [DOMAIN_SEED, BUFFER_SEED, candidate_buffer.key().as_ref()], bump = buffer_claim.bump, has_one = proposal, has_one = candidate_buffer)]
    pub buffer_claim: Account<'info, BufferClaim>,
    /// CHECK: loader state is validated.
    #[account(mut)]
    pub target_program: UncheckedAccount<'info>,
    /// CHECK: loader state is validated.
    #[account(mut)]
    pub program_data: UncheckedAccount<'info>,
    /// CHECK: loader buffer is validated.
    #[account(mut)]
    pub candidate_buffer: UncheckedAccount<'info>,
    /// CHECK: fixed governance refund account.
    #[account(mut, address = guard_config.governance_authority)]
    pub spill: UncheckedAccount<'info>,
    pub rent: Sysvar<'info, Rent>,
    pub clock: Sysvar<'info, Clock>,
    /// CHECK: fixed loader-v3 id.
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
#[account]
#[derive(InitSpace)]
pub struct SafetyPolicy {
    pub authority: Pubkey,
    pub governance_authority: Pubkey,
    pub target_program: Pubkey,
    pub policy_id: u64,
    pub policy_version: u16,
    pub min_challenge_slots: u64,
    pub verifier_quorum_required: u8,
    pub allowed_invariant_set_hash: [u8; 32],
    pub status: PolicyStatus,
    pub created_at_slot: u64,
    pub bump: u8,
}
#[account]
#[derive(InitSpace)]
pub struct UpgradeProposal {
    pub policy: Pubkey,
    pub proposal_id: u64,
    pub target_program: Pubkey,
    pub program_data: Pubkey,
    pub candidate_buffer: Pubkey,
    pub candidate_buffer_hash: [u8; 32],
    pub proposer: Pubkey,
    pub created_at_slot: u64,
    pub challenge_start_slot: Option<u64>,
    pub challenge_end_slot: Option<u64>,
    pub state: ProposalState,
    pub decision_authority: Option<Pubkey>,
    pub decision_slot: Option<u64>,
    pub decision_reason_code: Option<u16>,
    pub executed_at_slot: Option<u64>,
    pub bump: u8,
}
#[account]
#[derive(InitSpace)]
pub struct BufferClaim {
    pub proposal: Pubkey,
    pub candidate_buffer: Pubkey,
    pub bump: u8,
}
#[account]
#[derive(InitSpace)]
pub struct InvariantDefinition {
    pub safety_policy: Pubkey,
    pub invariant_id: u64,
    pub invariant_kind: InvariantKind,
    pub name_hash: [u8; 32],
    pub specification_hash: [u8; 32],
    pub enabled: bool,
    pub created_by: Pubkey,
    pub created_at_slot: u64,
    pub disabled_at_slot: Option<u64>,
    pub bump: u8,
}
#[account]
#[derive(InitSpace)]
pub struct ChallengeCommit {
    pub proposal: Pubkey,
    pub invariant: Pubkey,
    pub hunter: Pubkey,
    pub commitment_hash: [u8; 32],
    pub committed_at_slot: u64,
    pub earliest_reveal_slot: u64,
    pub latest_reveal_slot: u64,
    pub status: ChallengeCommitStatus,
    pub revealed_trace_hash: Option<[u8; 32]>,
    pub revealed_at_slot: Option<u64>,
    pub bump: u8,
}
#[account]
#[derive(InitSpace)]
pub struct TraceClaim {
    pub proposal: Pubkey,
    pub invariant: Pubkey,
    pub challenge_commit: Pubkey,
    pub trace_hash: [u8; 32],
    pub hunter: Pubkey,
    pub revealed_at_slot: u64,
    pub bump: u8,
}
#[account]
#[derive(InitSpace)]
pub struct VerifierRegistry {
    pub safety_policy: Pubkey,
    pub governance: Pubkey,
    pub active_epoch: Option<Pubkey>,
    pub next_epoch_id: u64,
    pub created_at_slot: u64,
    pub bump: u8,
}
#[account]
#[derive(InitSpace)]
pub struct VerifierEpoch {
    pub verifier_registry: Pubkey,
    pub safety_policy: Pubkey,
    pub epoch_id: u64,
    #[max_len(8)]
    pub verifiers: Vec<Pubkey>,
    pub threshold: u8,
    pub verifier_set_hash: [u8; 32],
    pub creator: Pubkey,
    pub created_at_slot: u64,
    pub bump: u8,
}
#[account]
#[derive(InitSpace)]
pub struct ProposalVerificationGate {
    pub proposal: Pubkey,
    pub pending_rounds: u16,
    pub confirmed_violation: bool,
    pub last_violation_round: Option<Pubkey>,
    pub bump: u8,
}
#[account]
#[derive(InitSpace)]
pub struct VerificationRound {
    pub policy: Pubkey,
    pub proposal: Pubkey,
    pub invariant: Pubkey,
    pub trace_claim: Pubkey,
    pub trace_hash: [u8; 32],
    pub candidate_buffer_hash: [u8; 32],
    pub invariant_specification_hash: [u8; 32],
    pub verifier_epoch: Pubkey,
    pub threshold: u8,
    pub status: VerificationRoundStatus,
    pub opened_slot: u64,
    pub finalized_slot: Option<u64>,
    pub winning_replay_result: Option<Pubkey>,
    pub bump: u8,
}
#[account]
#[derive(InitSpace)]
pub struct ReplayResult {
    pub verification_round: Pubkey,
    pub result_hash: [u8; 32],
    pub verdict: ReplayVerdict,
    pub replay_receipt_hash: [u8; 32],
    pub vote_count: u8,
    pub created_at_slot: u64,
    pub bump: u8,
}
#[account]
#[derive(InitSpace)]
pub struct VerifierAttestation {
    pub verification_round: Pubkey,
    pub verifier_epoch: Pubkey,
    pub verifier: Pubkey,
    pub replay_result: Pubkey,
    pub result_hash: [u8; 32],
    pub attested_slot: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct EconomicPolicyRegistry {
    pub safety_policy: Pubkey,
    pub governance: Pubkey,
    pub next_config_id: u64,
    pub economic_enforcement_slot: u64,
    pub created_at_slot: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct EconomicPolicy {
    pub economic_policy_registry: Pubkey,
    pub safety_policy: Pubkey,
    pub governance: Pubkey,
    pub payment_mint: Pubkey,
    pub token_program: Pubkey,
    pub config_id: u64,
    pub payment_mint_decimals: u8,
    pub bounty_amount: u64,
    pub challenger_bond_amount: u64,
    pub verifier_fee_amount: u64,
    pub minimum_verifier_stake: u64,
    pub verifier_non_reveal_slash_amount: u64,
    pub max_bonded_challenges: u8,
    pub fee_claim_grace_slots: u64,
    pub slash_claim_grace_slots: u64,
    pub stake_withdraw_cooldown_slots: u64,
    pub created_at_slot: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ProposalEscrow {
    pub proposal: Pubkey,
    pub economic_policy: Pubkey,
    pub funder: Pubkey,
    pub payment_mint: Pubkey,
    pub bounty_vault: Pubkey,
    pub fee_vault: Pubkey,
    pub penalty_vault: Pubkey,
    pub bounty_amount: u64,
    pub fee_reserve_amount: u64,
    pub max_bonded_challenges: u8,
    pub committed_challenge_count: u8,
    pub unsettled_bonds: u8,
    pub unclosed_rounds: u8,
    pub bounty_status: BountyStatus,
    pub winning_round: Option<Pubkey>,
    pub winning_trace_claim: Option<Pubkey>,
    pub funded_at_slot: u64,
    pub refund_eligible_slot: Option<u64>,
    pub bounty_settled_at_slot: Option<u64>,
    pub bounty_paid: u64,
    pub fees_claimed: u64,
    pub refunds_paid: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ChallengeBond {
    pub challenge_commit: Pubkey,
    pub proposal_escrow: Pubkey,
    pub hunter: Pubkey,
    pub bond_vault: Pubkey,
    pub rent_recipient: Pubkey,
    pub amount: u64,
    pub status: BondStatus,
    pub funded_at_slot: u64,
    pub settled_at_slot: Option<u64>,
    pub refunded_amount: u64,
    pub forfeited_amount: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct VerifierStake {
    pub economic_policy: Pubkey,
    pub verifier: Pubkey,
    pub stake_vault: Pubkey,
    pub payment_mint: Pubkey,
    pub rent_recipient: Pubkey,
    pub amount: u64,
    pub slash_lock_until_slot: u64,
    pub withdrawal_requested_slot: Option<u64>,
    pub withdrawal_available_slot: Option<u64>,
    pub total_slashed: u64,
    pub status: StakeStatus,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct VerifierEpochEconomics {
    pub verifier_epoch: Pubkey,
    pub economic_policy: Pubkey,
    pub verifier_registry: Pubkey,
    pub activated_at_slot: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct RoundEconomicState {
    pub verification_round: Pubkey,
    pub proposal_escrow: Pubkey,
    pub verifier_epoch_economics: Pubkey,
    pub status: RoundEconomicStatus,
    pub fee_claim_deadline_slot: u64,
    pub slash_claim_deadline_slot: u64,
    pub opened_at_slot: u64,
    pub closed_at_slot: Option<u64>,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct VerifierFeeClaim {
    pub verification_round: Pubkey,
    pub verifier: Pubkey,
    pub attestation: Pubkey,
    pub proposal_escrow: Pubkey,
    pub amount: u64,
    pub claimed_at_slot: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct VerifierSlashReceipt {
    pub verification_round: Pubkey,
    pub verifier_stake: Pubkey,
    pub verifier: Pubkey,
    pub proposal_escrow: Pubkey,
    pub amount: u64,
    pub slashed_at_slot: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub struct EconomicPolicyParameters {
    pub bounty_amount: u64,
    pub challenger_bond_amount: u64,
    pub verifier_fee_amount: u64,
    pub minimum_verifier_stake: u64,
    pub verifier_non_reveal_slash_amount: u64,
    pub max_bonded_challenges: u8,
    pub fee_claim_grace_slots: u64,
    pub slash_claim_grace_slots: u64,
    pub stake_withdraw_cooldown_slots: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq)]
pub enum BountyStatus {
    Pending,
    PaidToHunter,
    RefundedToFunder,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq)]
pub enum BondStatus {
    Pending,
    AcceptedReturned,
    HoldPenalized,
    NonRevealPenalized,
    TimeoutReturned,
    AbortedReturned,
    RevealedUnopenedReturned,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq)]
pub enum StakeStatus {
    Active,
    WithdrawalPending,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq)]
pub enum RoundEconomicStatus {
    Open,
    FinalizedHold,
    FinalizedViolation,
    TimedOut,
    Aborted,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq)]
pub enum PolicyStatus {
    Active,
    Paused,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq)]
pub enum ProposalState {
    Draft,
    ChallengeActive,
    Approved,
    Rejected,
    Expired,
    Executed,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq)]
pub enum InvariantKind {
    Authorization,
    AssetConservation,
    BalancePreservation,
    Solvency,
    PrivilegeBoundary,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq)]
pub enum ChallengeCommitStatus {
    Committed,
    Revealed,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq)]
pub enum VerificationRoundStatus {
    Open,
    InvariantHolds,
    InvariantViolated,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq)]
pub enum ReplayVerdict {
    InvariantHolds,
    InvariantViolated,
}

#[event]
pub struct EconomicPolicyRegistryInitialized {
    pub safety_policy: Pubkey,
    pub economic_policy_registry: Pubkey,
    pub governance: Pubkey,
    pub economic_enforcement_slot: u64,
    pub slot: u64,
}
#[event]
pub struct EconomicPolicyInitialized {
    pub safety_policy: Pubkey,
    pub economic_policy_registry: Pubkey,
    pub economic_policy: Pubkey,
    pub config_id: u64,
    pub payment_mint: Pubkey,
    pub governance: Pubkey,
    pub slot: u64,
}
#[event]
pub struct VerifierStakeInitialized {
    pub economic_policy: Pubkey,
    pub verifier_stake: Pubkey,
    pub verifier: Pubkey,
    pub stake_vault: Pubkey,
    pub amount: u64,
    pub slot: u64,
}
#[event]
pub struct VerifierStakeToppedUp {
    pub economic_policy: Pubkey,
    pub verifier_stake: Pubkey,
    pub verifier: Pubkey,
    pub amount: u64,
    pub new_amount: u64,
    pub slot: u64,
}
#[event]
pub struct VerifierStakeWithdrawalRequested {
    pub economic_policy: Pubkey,
    pub verifier_stake: Pubkey,
    pub verifier: Pubkey,
    pub requested_slot: u64,
    pub available_slot: u64,
}
#[event]
pub struct VerifierStakeWithdrawalCancelled {
    pub economic_policy: Pubkey,
    pub verifier_stake: Pubkey,
    pub verifier: Pubkey,
    pub slot: u64,
}
#[event]
pub struct VerifierStakeWithdrawn {
    pub economic_policy: Pubkey,
    pub verifier_stake: Pubkey,
    pub verifier: Pubkey,
    pub amount: u64,
    pub slot: u64,
}
#[event]
pub struct VerifierEpochEconomicsActivated {
    pub verifier_epoch: Pubkey,
    pub economic_policy: Pubkey,
    pub verifier_epoch_economics: Pubkey,
    pub verifier_count: u8,
    pub actor: Pubkey,
    pub slot: u64,
}
#[event]
pub struct ProposalEscrowFunded {
    pub proposal: Pubkey,
    pub proposal_escrow: Pubkey,
    pub economic_policy: Pubkey,
    pub funder: Pubkey,
    pub bounty_amount: u64,
    pub fee_reserve_amount: u64,
    pub slot: u64,
}
#[event]
pub struct SafetyPolicyInitialized {
    pub policy: Pubkey,
    pub target_program: Pubkey,
    pub actor: Pubkey,
    pub slot: u64,
    pub policy_id: u64,
    pub policy_version: u16,
}
#[event]
pub struct SafetyPolicyStatusChanged {
    pub policy: Pubkey,
    pub actor: Pubkey,
    pub slot: u64,
    pub old_status: PolicyStatus,
    pub new_status: PolicyStatus,
}
#[event]
pub struct InvariantInitialized {
    pub policy: Pubkey,
    pub invariant: Pubkey,
    pub invariant_id: u64,
    pub invariant_kind: InvariantKind,
    pub actor: Pubkey,
    pub slot: u64,
}
#[event]
pub struct InvariantStatusChanged {
    pub policy: Pubkey,
    pub invariant: Pubkey,
    pub invariant_id: u64,
    pub actor: Pubkey,
    pub slot: u64,
    pub enabled: bool,
}
#[event]
pub struct UpgradeProposalCreated {
    pub policy: Pubkey,
    pub proposal: Pubkey,
    pub target_program: Pubkey,
    pub candidate_buffer: Pubkey,
    pub actor: Pubkey,
    pub slot: u64,
    pub state: ProposalState,
}
#[event]
pub struct ChallengeStarted {
    pub policy: Pubkey,
    pub proposal: Pubkey,
    pub target_program: Pubkey,
    pub candidate_buffer: Pubkey,
    pub actor: Pubkey,
    pub start_slot: u64,
    pub end_slot: u64,
    pub state: ProposalState,
}
#[event]
pub struct ChallengeCommitted {
    pub policy: Pubkey,
    pub proposal: Pubkey,
    pub invariant: Pubkey,
    pub challenge_commit: Pubkey,
    pub hunter: Pubkey,
    pub commitment_hash: [u8; 32],
    pub committed_at_slot: u64,
    pub earliest_reveal_slot: u64,
    pub latest_reveal_slot: u64,
}
#[event]
pub struct ChallengeRevealed {
    pub policy: Pubkey,
    pub proposal: Pubkey,
    pub invariant: Pubkey,
    pub challenge_commit: Pubkey,
    pub trace_claim: Pubkey,
    pub hunter: Pubkey,
    pub trace_hash: [u8; 32],
    pub slot: u64,
}
#[event]
pub struct VerifierRegistryInitialized {
    pub policy: Pubkey,
    pub verifier_registry: Pubkey,
    pub governance: Pubkey,
    pub slot: u64,
}
#[event]
pub struct VerifierEpochCreated {
    pub policy: Pubkey,
    pub verifier_registry: Pubkey,
    pub verifier_epoch: Pubkey,
    pub epoch_id: u64,
    pub threshold: u8,
    pub verifier_set_hash: [u8; 32],
    pub creator: Pubkey,
    pub slot: u64,
}
#[event]
pub struct VerifierEpochActivated {
    pub policy: Pubkey,
    pub verifier_registry: Pubkey,
    pub verifier_epoch: Pubkey,
    pub epoch_id: u64,
    pub actor: Pubkey,
    pub slot: u64,
}
#[event]
pub struct VerificationRoundOpened {
    pub policy: Pubkey,
    pub proposal: Pubkey,
    pub invariant: Pubkey,
    pub trace_claim: Pubkey,
    pub verification_round: Pubkey,
    pub verifier_epoch: Pubkey,
    pub threshold: u8,
    pub slot: u64,
}
#[event]
pub struct VerifierAttested {
    pub verification_round: Pubkey,
    pub verifier_epoch: Pubkey,
    pub verifier: Pubkey,
    pub replay_result: Pubkey,
    pub result_hash: [u8; 32],
    pub vote_count: u8,
    pub slot: u64,
}
#[event]
pub struct ReplayResultReachedQuorum {
    pub verification_round: Pubkey,
    pub replay_result: Pubkey,
    pub result_hash: [u8; 32],
    pub verdict: ReplayVerdict,
    pub vote_count: u8,
    pub threshold: u8,
    pub slot: u64,
}
#[event]
pub struct ReplayResultFinalized {
    pub policy: Pubkey,
    pub proposal: Pubkey,
    pub verification_round: Pubkey,
    pub replay_result: Pubkey,
    pub result_hash: [u8; 32],
    pub verdict: ReplayVerdict,
    pub slot: u64,
}
#[event]
pub struct ProposalAutomaticallyRejected {
    pub policy: Pubkey,
    pub proposal: Pubkey,
    pub verification_round: Pubkey,
    pub replay_result: Pubkey,
    pub result_hash: [u8; 32],
    pub reason_code: u16,
    pub slot: u64,
}
#[event]
pub struct TemporaryDecisionRecorded {
    pub policy: Pubkey,
    pub proposal: Pubkey,
    pub target_program: Pubkey,
    pub candidate_buffer: Pubkey,
    pub actor: Pubkey,
    pub slot: u64,
    pub decision: ProposalState,
    pub reason_code: u16,
}
#[event]
pub struct ProposalExpired {
    pub policy: Pubkey,
    pub proposal: Pubkey,
    pub target_program: Pubkey,
    pub candidate_buffer: Pubkey,
    pub actor: Pubkey,
    pub slot: u64,
    pub state: ProposalState,
}
#[event]
pub struct GuardedUpgradeExecuted {
    pub policy: Pubkey,
    pub proposal: Pubkey,
    pub target_program: Pubkey,
    pub candidate_buffer: Pubkey,
    pub actor: Pubkey,
    pub slot: u64,
    pub state: ProposalState,
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
        } => require_keys_eq!(
            programdata_address,
            *program_data.key,
            FaultlineError::WrongProgramData
        ),
        _ => return err!(FaultlineError::InvalidLoaderState),
    };
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
fn candidate_buffer_hash(buffer: &AccountInfo) -> Result<[u8; 32]> {
    buffer_authority(buffer)?;
    Ok(hash(&buffer.try_borrow_data()?).to_bytes())
}
pub fn challenge_commitment(
    proposal: &Pubkey,
    invariant: &Pubkey,
    hunter: &Pubkey,
    trace_hash: &[u8; 32],
    salt: &[u8; 32],
) -> [u8; 32] {
    hashv(&[
        CHALLENGE_DOMAIN,
        proposal.as_ref(),
        invariant.as_ref(),
        hunter.as_ref(),
        trace_hash,
        salt,
    ])
    .to_bytes()
}
pub fn replay_result_commitment(
    proposal: &Pubkey,
    invariant: &Pubkey,
    trace_claim: &Pubkey,
    candidate_buffer_hash: &[u8; 32],
    invariant_specification_hash: &[u8; 32],
    verdict: ReplayVerdict,
    replay_receipt_hash: &[u8; 32],
) -> [u8; 32] {
    let verdict_byte = match verdict {
        ReplayVerdict::InvariantHolds => [0u8],
        ReplayVerdict::InvariantViolated => [1u8],
    };
    hashv(&[
        REPLAY_DOMAIN,
        proposal.as_ref(),
        invariant.as_ref(),
        trace_claim.as_ref(),
        candidate_buffer_hash,
        invariant_specification_hash,
        &verdict_byte,
        replay_receipt_hash,
    ])
    .to_bytes()
}
pub fn verifier_set_hash(
    safety_policy: &Pubkey,
    epoch_id: u64,
    threshold: u8,
    verifiers: &[Pubkey],
) -> [u8; 32] {
    let mut preimage =
        Vec::with_capacity(VERIFIER_SET_DOMAIN.len() + 32 + 8 + 1 + 1 + verifiers.len() * 32);
    preimage.extend_from_slice(VERIFIER_SET_DOMAIN);
    preimage.extend_from_slice(safety_policy.as_ref());
    preimage.extend_from_slice(&epoch_id.to_le_bytes());
    preimage.push(verifiers.len() as u8);
    preimage.push(threshold);
    for verifier in verifiers {
        preimage.extend_from_slice(verifier.as_ref());
    }
    hash(&preimage).to_bytes()
}
fn is_zero_hash(value: &[u8; 32]) -> bool {
    value.iter().all(|byte| *byte == 0)
}
fn loader_state(account: &AccountInfo) -> Result<UpgradeableLoaderState> {
    bincode::deserialize(&account.try_borrow_data()?)
        .map_err(|_| error!(FaultlineError::InvalidLoaderState))
}
fn program_data_address(program: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[program.as_ref()], &bpf_loader_upgradeable::id()).0
}

struct MintView {
    decimals: u8,
    has_freeze_authority: bool,
}

struct TokenAccountView {
    mint: Pubkey,
    owner: Pubkey,
    amount: u64,
}

fn parse_mint(account: &AccountInfo) -> Result<MintView> {
    require_keys_eq!(
        *account.owner,
        TOKEN_PROGRAM_ID,
        FaultlineError::UnsupportedEconomicTokenProgram
    );
    let data = account.try_borrow_data()?;
    require!(data.len() == MINT_LEN, FaultlineError::InvalidEconomicMint);
    require!(data[45] == 1, FaultlineError::InvalidEconomicMint);
    let freeze_tag = u32::from_le_bytes(
        data[46..50]
            .try_into()
            .map_err(|_| error!(FaultlineError::InvalidEconomicMint))?,
    );
    require!(freeze_tag <= 1, FaultlineError::InvalidEconomicMint);
    Ok(MintView {
        decimals: data[44],
        has_freeze_authority: freeze_tag == 1,
    })
}

fn parse_token_account(account: &AccountInfo) -> Result<TokenAccountView> {
    require_keys_eq!(
        *account.owner,
        TOKEN_PROGRAM_ID,
        FaultlineError::UnsupportedEconomicTokenProgram
    );
    let data = account.try_borrow_data()?;
    require!(
        token_account_layout_is_initialized(data.len(), data.get(108).copied()),
        FaultlineError::InvalidEconomicTokenAccount
    );
    Ok(TokenAccountView {
        mint: Pubkey::new_from_array(
            data[0..32]
                .try_into()
                .map_err(|_| error!(FaultlineError::InvalidEconomicTokenAccount))?,
        ),
        owner: Pubkey::new_from_array(
            data[32..64]
                .try_into()
                .map_err(|_| error!(FaultlineError::InvalidEconomicTokenAccount))?,
        ),
        amount: u64::from_le_bytes(
            data[64..72]
                .try_into()
                .map_err(|_| error!(FaultlineError::InvalidEconomicTokenAccount))?,
        ),
    })
}

pub fn token_account_layout_is_initialized(data_len: usize, state: Option<u8>) -> bool {
    data_len == TOKEN_ACCOUNT_LEN && state == Some(TOKEN_ACCOUNT_INITIALIZED)
}

fn canonical_ata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[owner.as_ref(), TOKEN_PROGRAM_ID.as_ref(), mint.as_ref()],
        &ASSOCIATED_TOKEN_PROGRAM_ID,
    )
    .0
}

fn validate_canonical_ata(account: &AccountInfo, owner: &Pubkey, mint: &Pubkey) -> Result<()> {
    require_keys_eq!(
        canonical_ata(owner, mint),
        *account.key,
        FaultlineError::NonCanonicalTokenAccount
    );
    let token_account = parse_token_account(account)?;
    require_keys_eq!(token_account.owner, *owner, FaultlineError::WrongTokenOwner);
    require_keys_eq!(token_account.mint, *mint, FaultlineError::WrongPaymentMint);
    Ok(())
}

fn validate_token_vault(
    account: &AccountInfo,
    mint: &Pubkey,
    authority: &Pubkey,
) -> Result<TokenAccountView> {
    let token_account = parse_token_account(account)?;
    require_keys_eq!(token_account.mint, *mint, FaultlineError::WrongPaymentMint);
    require_keys_eq!(
        token_account.owner,
        *authority,
        FaultlineError::WrongVaultAuthority
    );
    Ok(token_account)
}

fn create_token_vault<'info>(
    payer: &AccountInfo<'info>,
    vault: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    authority: &Pubkey,
    system_program: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    signer_seeds: &[&[u8]],
) -> Result<()> {
    require_keys_eq!(
        *token_program.key,
        TOKEN_PROGRAM_ID,
        FaultlineError::UnsupportedEconomicTokenProgram
    );
    require_keys_eq!(
        *mint.owner,
        TOKEN_PROGRAM_ID,
        FaultlineError::UnsupportedEconomicTokenProgram
    );
    let lamports = Rent::get()?.minimum_balance(TOKEN_ACCOUNT_LEN);
    if vault.lamports() == 0 {
        require!(
            vault.data_is_empty(),
            FaultlineError::VaultAlreadyInitialized
        );
        invoke_signed(
            &system_instruction::create_account(
                payer.key,
                vault.key,
                lamports,
                TOKEN_ACCOUNT_LEN as u64,
                &TOKEN_PROGRAM_ID,
            ),
            &[payer.clone(), vault.clone(), system_program.clone()],
            &[signer_seeds],
        )?;
    } else {
        require_keys_eq!(
            *vault.owner,
            solana_system_program::ID,
            FaultlineError::VaultAlreadyInitialized
        );
        require!(
            vault.data_is_empty(),
            FaultlineError::VaultAlreadyInitialized
        );
        match vault.lamports().cmp(&lamports) {
            core::cmp::Ordering::Less => invoke(
                &system_instruction::transfer(payer.key, vault.key, lamports - vault.lamports()),
                &[payer.clone(), vault.clone(), system_program.clone()],
            )?,
            core::cmp::Ordering::Greater => invoke_signed(
                &system_instruction::transfer(vault.key, payer.key, vault.lamports() - lamports),
                &[vault.clone(), payer.clone(), system_program.clone()],
                &[signer_seeds],
            )?,
            core::cmp::Ordering::Equal => {}
        }
        invoke_signed(
            &system_instruction::allocate(vault.key, TOKEN_ACCOUNT_LEN as u64),
            &[vault.clone(), system_program.clone()],
            &[signer_seeds],
        )?;
        invoke_signed(
            &system_instruction::assign(vault.key, &TOKEN_PROGRAM_ID),
            &[vault.clone(), system_program.clone()],
            &[signer_seeds],
        )?;
    }
    let mut data = Vec::with_capacity(33);
    data.push(SPL_TOKEN_INITIALIZE_ACCOUNT3_TAG);
    data.extend_from_slice(authority.as_ref());
    let initialize = Instruction {
        program_id: TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*vault.key, false),
            AccountMeta::new_readonly(*mint.key, false),
        ],
        data,
    };
    invoke(
        &initialize,
        &[vault.clone(), mint.clone(), token_program.clone()],
    )?;
    let initialized = validate_token_vault(vault, mint.key, authority)?;
    require!(initialized.amount == 0, FaultlineError::VaultMustStartEmpty);
    Ok(())
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
        *token_program.key,
        TOKEN_PROGRAM_ID,
        FaultlineError::UnsupportedEconomicTokenProgram
    );
    let mut data = Vec::with_capacity(9);
    data.push(SPL_TOKEN_TRANSFER_TAG);
    data.extend_from_slice(&amount.to_le_bytes());
    let instruction = Instruction {
        program_id: TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*source.key, false),
            AccountMeta::new(*destination.key, false),
            AccountMeta::new_readonly(*authority.key, true),
        ],
        data,
    };
    let infos = [
        source.clone(),
        destination.clone(),
        authority.clone(),
        token_program.clone(),
    ];
    match signer_seeds {
        Some(seeds) => invoke_signed(&instruction, &infos, &[seeds])?,
        None => invoke(&instruction, &infos)?,
    }
    Ok(())
}

fn spl_token_close<'info>(
    token_program: &AccountInfo<'info>,
    account: &AccountInfo<'info>,
    rent_recipient: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    signer_seeds: &[&[u8]],
) -> Result<()> {
    require_keys_eq!(
        *token_program.key,
        TOKEN_PROGRAM_ID,
        FaultlineError::UnsupportedEconomicTokenProgram
    );
    let instruction = Instruction {
        program_id: TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*account.key, false),
            AccountMeta::new(*rent_recipient.key, false),
            AccountMeta::new_readonly(*authority.key, true),
        ],
        data: vec![SPL_TOKEN_CLOSE_ACCOUNT_TAG],
    };
    invoke_signed(
        &instruction,
        &[
            account.clone(),
            rent_recipient.clone(),
            authority.clone(),
            token_program.clone(),
        ],
        &[signer_seeds],
    )?;
    Ok(())
}

fn validate_economic_policy_parameters(parameters: &EconomicPolicyParameters) -> Result<()> {
    require!(
        parameters.bounty_amount > 0,
        FaultlineError::ZeroBountyAmount
    );
    require!(
        parameters.challenger_bond_amount > 0,
        FaultlineError::ZeroBondAmount
    );
    hold_bond_split(parameters.challenger_bond_amount)?;
    require!(
        parameters.verifier_fee_amount > 0,
        FaultlineError::ZeroVerifierFee
    );
    require!(
        parameters.minimum_verifier_stake > 0,
        FaultlineError::ZeroMinimumStake
    );
    require!(
        parameters.verifier_non_reveal_slash_amount > 0,
        FaultlineError::ZeroSlashAmount
    );
    require!(
        parameters.verifier_non_reveal_slash_amount <= parameters.minimum_verifier_stake,
        FaultlineError::SlashExceedsMinimumStake
    );
    require!(
        (1..=MAX_BONDED_CHALLENGES).contains(&parameters.max_bonded_challenges),
        FaultlineError::InvalidChallengeLimit
    );
    validate_delay(
        parameters.fee_claim_grace_slots,
        MIN_FEE_CLAIM_GRACE_SLOTS,
        MAX_FEE_CLAIM_GRACE_SLOTS,
    )?;
    validate_delay(
        parameters.slash_claim_grace_slots,
        MIN_SLASH_CLAIM_GRACE_SLOTS,
        MAX_SLASH_CLAIM_GRACE_SLOTS,
    )?;
    validate_delay(
        parameters.stake_withdraw_cooldown_slots,
        MIN_STAKE_WITHDRAW_COOLDOWN_SLOTS,
        MAX_STAKE_WITHDRAW_COOLDOWN_SLOTS,
    )?;
    maximum_fee_reserve(
        parameters.verifier_fee_amount,
        parameters.max_bonded_challenges,
    )?;
    Ok(())
}

fn validate_delay(value: u64, minimum: u64, maximum: u64) -> Result<()> {
    require!(
        value >= minimum && value <= maximum,
        FaultlineError::InvalidEconomicDelay
    );
    Ok(())
}

pub fn maximum_fee_reserve(verifier_fee: u64, max_challenges: u8) -> Result<u64> {
    verifier_fee
        .checked_mul(MAX_VERIFIERS as u64)
        .and_then(|value| value.checked_mul(max_challenges as u64))
        .ok_or_else(|| error!(FaultlineError::FeeReserveOverflow))
}

pub fn penalty_amount(amount: u64, basis_points: u16) -> Result<u64> {
    require!(
        basis_points <= BPS_DENOMINATOR,
        FaultlineError::InvalidPenaltyBasisPoints
    );
    let penalty = (amount as u128)
        .checked_mul(basis_points as u128)
        .ok_or(FaultlineError::ArithmeticOverflow)?
        .checked_div(BPS_DENOMINATOR as u128)
        .ok_or(FaultlineError::ArithmeticOverflow)?;
    u64::try_from(penalty).map_err(|_| error!(FaultlineError::ArithmeticOverflow))
}

pub fn withdrawal_available_slot(
    request_slot: u64,
    slash_lock_until_slot: u64,
    cooldown_slots: u64,
) -> Result<u64> {
    core::cmp::max(request_slot, slash_lock_until_slot)
        .checked_add(cooldown_slots)
        .ok_or_else(|| error!(FaultlineError::ArithmeticOverflow))
}

pub fn extended_slash_lock(current_lock: u64, new_deadline: u64) -> u64 {
    core::cmp::max(current_lock, new_deadline)
}

fn require_historical_proposal(
    proposal: &UpgradeProposal,
    registry: &EconomicPolicyRegistry,
) -> Result<()> {
    require!(
        is_historical_proposal(proposal.created_at_slot, registry.economic_enforcement_slot),
        FaultlineError::M6ProposalRequiresFundedRoute
    );
    Ok(())
}

fn require_m6_proposal(
    proposal: &UpgradeProposal,
    registry: &EconomicPolicyRegistry,
) -> Result<()> {
    require!(
        !is_historical_proposal(proposal.created_at_slot, registry.economic_enforcement_slot),
        FaultlineError::HistoricalProposalCannotUseEconomics
    );
    Ok(())
}

pub fn is_historical_proposal(created_at_slot: u64, enforcement_slot: u64) -> bool {
    created_at_slot < enforcement_slot
}

fn economic_deadlines(end: u64, policy: &EconomicPolicy) -> Result<(u64, u64, u64)> {
    checked_economic_deadlines(
        end,
        policy.fee_claim_grace_slots,
        policy.slash_claim_grace_slots,
    )
}

pub fn checked_economic_deadlines(
    end: u64,
    fee_grace: u64,
    slash_grace: u64,
) -> Result<(u64, u64, u64)> {
    let fee = end
        .checked_add(fee_grace)
        .ok_or(FaultlineError::ArithmeticOverflow)?;
    let slash = end
        .checked_add(slash_grace)
        .ok_or(FaultlineError::ArithmeticOverflow)?;
    let refund = end
        .checked_add(core::cmp::max(fee_grace, slash_grace))
        .ok_or(FaultlineError::ArithmeticOverflow)?;
    Ok((fee, slash, refund))
}

fn increment_bond_counters(committed: u8, unsettled: u8, maximum: u8) -> Result<(u8, u8)> {
    require!(
        committed < maximum,
        FaultlineError::BondedChallengeLimitReached
    );
    let committed = committed
        .checked_add(1)
        .ok_or(FaultlineError::CounterOverflow)?;
    let unsettled = unsettled
        .checked_add(1)
        .ok_or(FaultlineError::CounterOverflow)?;
    Ok((committed, unsettled))
}

fn require_escrow_policy_parameters(
    escrow: &ProposalEscrow,
    policy: &EconomicPolicy,
) -> Result<()> {
    require!(
        escrow.bounty_amount == policy.bounty_amount,
        FaultlineError::EscrowNotFullyFunded
    );
    require!(
        escrow.fee_reserve_amount
            == maximum_fee_reserve(policy.verifier_fee_amount, policy.max_bonded_challenges)?,
        FaultlineError::EscrowNotFullyFunded
    );
    require!(
        escrow.max_bonded_challenges == policy.max_bonded_challenges,
        FaultlineError::EscrowNotFullyFunded
    );
    Ok(())
}

fn require_fully_funded_untouched_escrow(
    escrow: &ProposalEscrow,
    policy: &EconomicPolicy,
    bounty_vault: &AccountInfo,
    fee_vault: &AccountInfo,
    penalty_vault: &AccountInfo,
) -> Result<()> {
    require_escrow_policy_parameters(escrow, policy)?;
    require!(
        escrow.bounty_status == BountyStatus::Pending
            && escrow.committed_challenge_count == 0
            && escrow.unsettled_bonds == 0
            && escrow.unclosed_rounds == 0
            && escrow.winning_round.is_none()
            && escrow.winning_trace_claim.is_none()
            && escrow.refund_eligible_slot.is_none()
            && escrow.bounty_settled_at_slot.is_none()
            && escrow.bounty_paid == 0
            && escrow.fees_claimed == 0
            && escrow.refunds_paid == 0,
        FaultlineError::EscrowNotAvailable
    );
    let authority = Pubkey::find_program_address(
        &[PROPOSAL_ESCROW_SEED, escrow.proposal.as_ref()],
        &crate::ID,
    )
    .0;
    let bounty = validate_token_vault(bounty_vault, &policy.payment_mint, &authority)?;
    let fee = validate_token_vault(fee_vault, &policy.payment_mint, &authority)?;
    let penalty = validate_token_vault(penalty_vault, &policy.payment_mint, &authority)?;
    require!(
        bounty.amount == escrow.bounty_amount
            && fee.amount == escrow.fee_reserve_amount
            && penalty.amount == 0,
        FaultlineError::EscrowNotFullyFunded
    );
    Ok(())
}

fn validate_settlement_base(base: &EconomicSettlementBase) -> Result<()> {
    require_m6_proposal(&base.proposal, &base.economic_policy_registry)?;
    require_escrow_policy_parameters(&base.proposal_escrow, &base.economic_policy)?;
    let mint = parse_mint(&base.payment_mint.to_account_info())?;
    require!(
        !mint.has_freeze_authority && mint.decimals == base.economic_policy.payment_mint_decimals,
        FaultlineError::InvalidEconomicMint
    );
    Ok(())
}

fn validate_bond_vault(
    bond: &ChallengeBond,
    vault: &AccountInfo,
    mint: &Pubkey,
) -> Result<TokenAccountView> {
    let authority = Pubkey::find_program_address(
        &[CHALLENGE_BOND_SEED, bond.challenge_commit.as_ref()],
        &crate::ID,
    )
    .0;
    let view = validate_token_vault(vault, mint, &authority)?;
    require!(
        view.amount == bond.amount,
        FaultlineError::VaultBalanceMismatch
    );
    Ok(view)
}

fn decrement_liability(value: u8, underflow: FaultlineError) -> Result<u8> {
    value
        .checked_sub(1)
        .ok_or_else(|| anchor_lang::error::Error::from(underflow))
}

fn require_open_round_economics(status: RoundEconomicStatus) -> Result<()> {
    require!(
        status == RoundEconomicStatus::Open,
        FaultlineError::RoundEconomicsAlreadyClosed
    );
    Ok(())
}

pub fn accepted_settlement_amounts(bounty_amount: u64, bond_amount: u64) -> (u64, u64) {
    (bounty_amount, bond_amount)
}

pub fn configured_bounty_payout(vault_balance: u64, configured_bounty: u64) -> Result<u64> {
    require!(
        vault_balance >= configured_bounty,
        FaultlineError::VaultBalanceMismatch
    );
    Ok(configured_bounty)
}

pub fn fee_claim_is_timely(current_slot: u64, deadline_slot: u64) -> bool {
    current_slot <= deadline_slot
}

pub fn verifier_epoch_economics_address(epoch: &Pubkey, policy: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[
            VERIFIER_EPOCH_ECONOMICS_SEED,
            epoch.as_ref(),
            policy.as_ref(),
        ],
        &crate::ID,
    )
    .0
}

pub fn checked_fee_claim_total(current: u64, fee: u64, reserve: u64) -> Result<u64> {
    let next = current
        .checked_add(fee)
        .ok_or(FaultlineError::ArithmeticOverflow)?;
    require!(next <= reserve, FaultlineError::FeeReserveExceeded);
    Ok(next)
}

pub fn attestation_matches_winner(
    attestation: &VerifierAttestation,
    round: Pubkey,
    verifier: Pubkey,
    epoch: Pubkey,
    replay_result: Pubkey,
    result_hash: [u8; 32],
) -> bool {
    attestation.verification_round == round
        && attestation.verifier == verifier
        && attestation.verifier_epoch == epoch
        && attestation.replay_result == replay_result
        && attestation.result_hash == result_hash
}

pub fn require_finalized_economic_result(
    round_status: VerificationRoundStatus,
    economic_status: RoundEconomicStatus,
    verdict: ReplayVerdict,
) -> Result<()> {
    let matches = matches!(
        (round_status, economic_status, verdict),
        (
            VerificationRoundStatus::InvariantHolds,
            RoundEconomicStatus::FinalizedHold,
            ReplayVerdict::InvariantHolds
        ) | (
            VerificationRoundStatus::InvariantViolated,
            RoundEconomicStatus::FinalizedViolation,
            ReplayVerdict::InvariantViolated
        )
    );
    require!(matches, FaultlineError::WrongRoundEconomicStatus);
    Ok(())
}

pub fn objective_slash_is_allowed(
    proposal_state: ProposalState,
    round_status: VerificationRoundStatus,
    economic_status: RoundEconomicStatus,
    current_slot: u64,
    challenge_end_slot: u64,
    slash_deadline_slot: u64,
    attestation_absent: bool,
) -> Result<()> {
    require!(
        round_status == VerificationRoundStatus::Open,
        FaultlineError::RoundNotSlashable
    );
    require!(
        matches!(
            economic_status,
            RoundEconomicStatus::Open | RoundEconomicStatus::TimedOut
        ),
        FaultlineError::RoundNotSlashable
    );
    if economic_status == RoundEconomicStatus::Open {
        require!(
            matches!(
                proposal_state,
                ProposalState::ChallengeActive | ProposalState::Expired
            ),
            FaultlineError::RoundNotSlashable
        );
    }
    require!(
        current_slot > challenge_end_slot,
        FaultlineError::SlashWindowNotOpen
    );
    require!(
        current_slot <= slash_deadline_slot,
        FaultlineError::SlashClaimDeadlinePassed
    );
    require!(
        attestation_absent,
        FaultlineError::VerifierAttestationExists
    );
    Ok(())
}

pub fn objective_slash_amount(configured_amount: u64, remaining_stake: u64) -> Result<u64> {
    let amount = core::cmp::min(configured_amount, remaining_stake);
    require!(amount > 0, FaultlineError::ZeroSettlementAmount);
    Ok(amount)
}

pub fn stake_status_is_slashable(status: StakeStatus) -> bool {
    matches!(status, StakeStatus::Active | StakeStatus::WithdrawalPending)
}

pub fn proposal_is_terminal_for_refund(state: ProposalState) -> bool {
    matches!(
        state,
        ProposalState::Rejected | ProposalState::Expired | ProposalState::Executed
    )
}

pub fn refund_is_timely(current_slot: u64, refund_eligible_slot: u64) -> bool {
    current_slot > refund_eligible_slot
}

pub fn require_refund_liabilities_clear(unsettled_bonds: u8, unclosed_rounds: u8) -> Result<()> {
    require!(unsettled_bonds == 0, FaultlineError::UnsettledBondLiability);
    require!(unclosed_rounds == 0, FaultlineError::UnclosedRoundLiability);
    Ok(())
}

pub fn bounty_status_after_refund(status: BountyStatus) -> Result<BountyStatus> {
    match status {
        BountyStatus::Pending => Ok(BountyStatus::RefundedToFunder),
        BountyStatus::PaidToHunter => Ok(BountyStatus::PaidToHunter),
        BountyStatus::RefundedToFunder => err!(FaultlineError::EscrowAlreadyRefunded),
    }
}

pub fn checked_refund_total(bounty: u64, fee: u64, penalty: u64) -> Result<u64> {
    bounty
        .checked_add(fee)
        .and_then(|value| value.checked_add(penalty))
        .ok_or_else(|| error!(FaultlineError::ArithmeticOverflow))
}

pub fn require_canonical_accepted_winner(
    confirmed_violation: bool,
    last_violation_round: Option<Pubkey>,
    winning_round: Option<Pubkey>,
    winning_trace_claim: Option<Pubkey>,
    current_round: Pubkey,
    current_trace_claim: Pubkey,
) -> Result<()> {
    require!(confirmed_violation, FaultlineError::WrongWinningRound);
    require!(
        last_violation_round == Some(current_round)
            && winning_round == Some(current_round)
            && winning_trace_claim == Some(current_trace_claim),
        FaultlineError::WrongWinningRound
    );
    Ok(())
}

pub fn canonical_winner(
    existing_round: Option<Pubkey>,
    existing_trace: Option<Pubkey>,
    last_violation_round: Option<Pubkey>,
    current_round: Pubkey,
    current_trace: Pubkey,
) -> Result<(Pubkey, Pubkey)> {
    require!(
        last_violation_round == Some(current_round),
        FaultlineError::WrongWinningRound
    );
    require!(
        existing_round.is_none() && existing_trace.is_none(),
        FaultlineError::WinningRoundAlreadySelected
    );
    Ok((current_round, current_trace))
}

pub fn hold_bond_split(amount: u64) -> Result<(u64, u64)> {
    let penalty = penalty_amount(amount, HOLD_BOND_SLASH_BPS)?;
    require!(penalty > 0, FaultlineError::ZeroSettlementAmount);
    let refund = amount
        .checked_sub(penalty)
        .ok_or(FaultlineError::ArithmeticOverflow)?;
    Ok((penalty, refund))
}

pub fn unfinalized_round_economic_status(
    proposal_state: ProposalState,
    confirmed_violation: bool,
    last_violation_round: Option<Pubkey>,
    current_round: Pubkey,
) -> Result<RoundEconomicStatus> {
    if confirmed_violation {
        let winning_round = last_violation_round.ok_or(FaultlineError::WrongWinningRound)?;
        require!(
            proposal_state == ProposalState::Rejected && winning_round != current_round,
            FaultlineError::WrongWinningRound
        );
        Ok(RoundEconomicStatus::Aborted)
    } else {
        require!(
            last_violation_round.is_none(),
            FaultlineError::WrongWinningRound
        );
        Ok(RoundEconomicStatus::TimedOut)
    }
}

pub fn revealed_unopened_eligible(
    proposal_state: ProposalState,
    current_slot: u64,
    challenge_end_slot: u64,
) -> bool {
    matches!(
        proposal_state,
        ProposalState::Rejected | ProposalState::Expired | ProposalState::Executed
    ) || strictly_after_deadline(current_slot, challenge_end_slot)
}

fn canonical_account_absent(account: &AccountInfo) -> bool {
    canonical_account_absent_parts(account.owner, account.data_len(), account.lamports())
}

pub fn canonical_account_absent_parts(owner: &Pubkey, data_len: usize, _lamports: u64) -> bool {
    *owner == solana_system_program::ID && data_len == 0
}

pub fn strictly_after_deadline(current_slot: u64, deadline_slot: u64) -> bool {
    current_slot > deadline_slot
}

fn settle_bond_tombstone(
    bond: &mut ChallengeBond,
    status: BondStatus,
    refunded_amount: u64,
    forfeited_amount: u64,
    slot: u64,
) {
    bond.status = status;
    bond.settled_at_slot = Some(slot);
    bond.refunded_amount = refunded_amount;
    bond.forfeited_amount = forfeited_amount;
}

fn transfer_from_proposal_escrow<'info>(
    base: &EconomicSettlementBase<'info>,
    source: &AccountInfo<'info>,
    destination: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    let proposal_key = base.proposal.key();
    let signer_seeds: &[&[u8]] = &[
        PROPOSAL_ESCROW_SEED,
        proposal_key.as_ref(),
        &[base.proposal_escrow.bump],
    ];
    spl_token_transfer(
        &base.token_program.to_account_info(),
        source,
        destination,
        &base.proposal_escrow.to_account_info(),
        amount,
        Some(signer_seeds),
    )
}

fn transfer_from_verifier_stake<'info>(
    base: &EconomicSettlementBase<'info>,
    verifier: &UncheckedAccount<'info>,
    verifier_stake: &Account<'info, VerifierStake>,
    source: &AccountInfo<'info>,
    destination: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    let policy_key = base.economic_policy.key();
    let verifier_key = verifier.key();
    let signer_seeds: &[&[u8]] = &[
        VERIFIER_STAKE_SEED,
        policy_key.as_ref(),
        verifier_key.as_ref(),
        &[verifier_stake.bump],
    ];
    spl_token_transfer(
        &base.token_program.to_account_info(),
        source,
        destination,
        &verifier_stake.to_account_info(),
        amount,
        Some(signer_seeds),
    )
}

fn transfer_and_close_proposal_vault<'info>(
    base: &EconomicSettlementBase<'info>,
    vault: &AccountInfo<'info>,
    funder_token_account: &AccountInfo<'info>,
    rent_recipient: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    if amount > 0 {
        transfer_from_proposal_escrow(base, vault, funder_token_account, amount)?;
    }
    let remaining = validate_token_vault(
        vault,
        &base.economic_policy.payment_mint,
        &base.proposal_escrow.key(),
    )?;
    require!(remaining.amount == 0, FaultlineError::VaultBalanceMismatch);
    let proposal_key = base.proposal.key();
    let signer_seeds: &[&[u8]] = &[
        PROPOSAL_ESCROW_SEED,
        proposal_key.as_ref(),
        &[base.proposal_escrow.bump],
    ];
    spl_token_close(
        &base.token_program.to_account_info(),
        vault,
        rent_recipient,
        &base.proposal_escrow.to_account_info(),
        signer_seeds,
    )
}

fn transfer_from_challenge_bond<'info>(
    base: &EconomicSettlementBase<'info>,
    challenge_commit: &Account<'info, ChallengeCommit>,
    challenge_bond: &Account<'info, ChallengeBond>,
    source: &AccountInfo<'info>,
    destination: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    let commit_key = challenge_commit.key();
    let signer_seeds: &[&[u8]] = &[
        CHALLENGE_BOND_SEED,
        commit_key.as_ref(),
        &[challenge_bond.bump],
    ];
    spl_token_transfer(
        &base.token_program.to_account_info(),
        source,
        destination,
        &challenge_bond.to_account_info(),
        amount,
        Some(signer_seeds),
    )
}

fn close_empty_bond_vault<'info>(
    base: &EconomicSettlementBase<'info>,
    challenge_commit: &Account<'info, ChallengeCommit>,
    challenge_bond: &Account<'info, ChallengeBond>,
    bond_vault: &AccountInfo<'info>,
    rent_recipient: &AccountInfo<'info>,
) -> Result<()> {
    let remaining = validate_token_vault(
        bond_vault,
        &base.economic_policy.payment_mint,
        &challenge_bond.key(),
    )?;
    require!(remaining.amount == 0, FaultlineError::VaultBalanceMismatch);
    let commit_key = challenge_commit.key();
    let signer_seeds: &[&[u8]] = &[
        CHALLENGE_BOND_SEED,
        commit_key.as_ref(),
        &[challenge_bond.bump],
    ];
    spl_token_close(
        &base.token_program.to_account_info(),
        bond_vault,
        rent_recipient,
        &challenge_bond.to_account_info(),
        signer_seeds,
    )
}

fn settle_full_bond_refund<'info>(
    base: &mut EconomicSettlementBase<'info>,
    challenge_commit: &Account<'info, ChallengeCommit>,
    challenge_bond: &mut Account<'info, ChallengeBond>,
    hunter_token_account: &AccountInfo<'info>,
    bond_vault: &AccountInfo<'info>,
    rent_recipient: &AccountInfo<'info>,
    status: BondStatus,
) -> Result<()> {
    require!(
        challenge_bond.status == BondStatus::Pending,
        FaultlineError::BondNotPending
    );
    validate_canonical_ata(
        hunter_token_account,
        &challenge_bond.hunter,
        &base.economic_policy.payment_mint,
    )?;
    let vault = validate_bond_vault(
        challenge_bond,
        bond_vault,
        &base.economic_policy.payment_mint,
    )?;
    let new_unsettled = decrement_liability(
        base.proposal_escrow.unsettled_bonds,
        FaultlineError::UnsettledBondsUnderflow,
    )?;
    let amount = challenge_bond.amount;
    transfer_from_challenge_bond(
        base,
        challenge_commit,
        challenge_bond,
        bond_vault,
        hunter_token_account,
        vault.amount,
    )?;
    close_empty_bond_vault(
        base,
        challenge_commit,
        challenge_bond,
        bond_vault,
        rent_recipient,
    )?;
    settle_bond_tombstone(challenge_bond, status, amount, 0, Clock::get()?.slot);
    base.proposal_escrow.unsettled_bonds = new_unsettled;
    Ok(())
}

fn next_config_id(current: u64, requested: u64) -> Result<u64> {
    require!(
        current == requested,
        FaultlineError::InvalidEconomicConfigId
    );
    current
        .checked_add(1)
        .ok_or_else(|| error!(FaultlineError::ArithmeticOverflow))
}

#[cfg(test)]
fn legacy_transaction_serialized_size(explicit_accounts: usize, data_bytes: usize) -> usize {
    // One signature, one instruction, one-byte compact lengths, and one program key.
    105 + (explicit_accounts + 1) * 32 + explicit_accounts + data_bytes
}

#[error_code]
pub enum FaultlineError {
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("A confirmed invariant violation permanently blocks this proposal")]
    ConfirmedInvariantViolation,
    #[msg("Verification counter overflow")]
    CounterOverflow,
    #[msg("Verification counter underflow")]
    CounterUnderflow,
    #[msg("Verifier appears more than once in the epoch")]
    DuplicateVerifier,
    #[msg("Verifier set must not be empty")]
    EmptyVerifierSet,
    #[msg("Verifier threshold is invalid")]
    InvalidThreshold,
    #[msg("No active verifier epoch is configured")]
    NoActiveVerifierEpoch,
    #[msg("Replay result has not reached quorum")]
    QuorumNotReached,
    #[msg("Replay result commitment does not match its bound inputs")]
    ReplayResultMismatch,
    #[msg("A verification round already exists for this trace claim")]
    RoundAlreadyExists,
    #[msg("Verification round is not open")]
    RoundNotOpen,
    #[msg("Verifier set exceeds the protocol maximum")]
    TooManyVerifiers,
    #[msg("Signer is not a member of the round's verifier epoch")]
    UnauthorizedVerifier,
    #[msg("Verifier already attested in this round")]
    VerifierAlreadyAttested,
    #[msg("A verification round is still pending")]
    VerificationPending,
    #[msg("The verification window has ended or too little time remains")]
    VerificationWindowEnded,
    #[msg("Challenge commitment has not been revealed")]
    ChallengeNotRevealed,
    #[msg("Account belongs to another invariant")]
    WrongInvariantBinding,
    #[msg("Account belongs to another policy")]
    WrongPolicyBinding,
    #[msg("Account belongs to another proposal")]
    WrongProposalBinding,
    #[msg("Replay result belongs to another verification round")]
    WrongRoundBinding,
    #[msg("Replay result binding is incorrect")]
    WrongResultBinding,
    #[msg("Trace account binding is incorrect")]
    WrongTraceBinding,
    #[msg("Verifier epoch binding is incorrect")]
    WrongVerifierEpoch,
    #[msg("Challenge commitment was already revealed")]
    ChallengeAlreadyRevealed,
    #[msg("Proposal is not in an active challenge state")]
    ChallengeNotActive,
    #[msg("Candidate buffer hash does not match the proposal commitment")]
    CandidateHashMismatch,
    #[msg("Candidate buffer is not locked to the Guard PDA")]
    BufferNotLocked,
    #[msg("Buffer has no authority")]
    BufferImmutable,
    #[msg("Challenge duration is below the policy minimum")]
    ChallengeDurationTooShort,
    #[msg("Challenge window has ended")]
    ChallengeWindowEnded,
    #[msg("Challenge window has not started")]
    ChallengeWindowNotStarted,
    #[msg("Challenge window is still active")]
    ChallengeWindowStillActive,
    #[msg("A decision was already recorded")]
    DecisionAlreadyRecorded,
    #[msg("Guard PDA is not the current target upgrade authority")]
    GuardNotUpgradeAuthority,
    #[msg("Unexpected upgradeable-loader account state")]
    InvalidLoaderState,
    #[msg("Invalid proposal state transition")]
    InvalidProposalTransition,
    #[msg("Temporary decision must be Approved or Rejected")]
    InvalidTemporaryDecision,
    #[msg("Invariant is disabled")]
    InvariantDisabled,
    #[msg("Insufficient challenge-window time remains for a reveal")]
    InsufficientRevealWindow,
    #[msg("Challenge window has not been started")]
    MissingChallengeWindow,
    #[msg("Policy is paused")]
    PolicyPaused,
    #[msg("Only Approved proposals may execute")]
    ProposalNotApproved,
    #[msg("Program is immutable")]
    ProgramImmutable,
    #[msg("Repeated invariant status change")]
    RepeatedInvariantStatus,
    #[msg("Reveal window has ended")]
    RevealWindowEnded,
    #[msg("Reveal is before the earliest allowed slot")]
    RevealTooEarly,
    #[msg("Repeated policy status change")]
    RepeatedPolicyStatus,
    #[msg("Target program is not executable")]
    TargetNotExecutable,
    #[msg("Only configured governance may perform this action")]
    UnauthorizedGovernance,
    #[msg("Only the hunter that created this commitment may reveal it")]
    UnauthorizedHunter,
    #[msg("Only the proposer or governance may start a challenge")]
    UnauthorizedChallengeStarter,
    #[msg("Only the policy authority may initialize this policy")]
    UnauthorizedPolicyAuthority,
    #[msg("Account is not owned by loader-v3")]
    WrongAccountOwner,
    #[msg("Challenge commitment is bound to another invariant")]
    WrongChallengeInvariant,
    #[msg("Challenge commitment is bound to another proposal")]
    WrongChallengeProposal,
    #[msg("Invariant belongs to another SafetyPolicy")]
    WrongInvariantPolicy,
    #[msg("Incorrect ProgramData account")]
    WrongProgramData,
    #[msg("Incorrect target program")]
    WrongTargetProgram,
    #[msg("Challenge duration must be non-zero")]
    ZeroChallengeDuration,
    #[msg("Commitment hash must be non-zero")]
    ZeroCommitmentHash,
    #[msg("Invariant name hash must be non-zero")]
    ZeroNameHash,
    #[msg("Invariant specification hash must be non-zero")]
    ZeroSpecificationHash,
    #[msg("Verifier quorum configuration must be non-zero")]
    ZeroVerifierQuorum,
    #[msg("Revealed trace does not match the commitment")]
    CommitmentMismatch,
    #[msg("Trace has already been claimed for this proposal")]
    TraceAlreadyClaimed,
    #[msg("Economic policy config id is not the next sequential id")]
    InvalidEconomicConfigId,
    #[msg("Unsupported economic token program")]
    UnsupportedEconomicTokenProgram,
    #[msg("Economic mint account is invalid")]
    InvalidEconomicMint,
    #[msg("Economic mint must not have a freeze authority")]
    MintHasFreezeAuthority,
    #[msg("Economic token account is invalid")]
    InvalidEconomicTokenAccount,
    #[msg("Token account is not the canonical associated token account")]
    NonCanonicalTokenAccount,
    #[msg("Token account has the wrong owner")]
    WrongTokenOwner,
    #[msg("Payment mint binding is incorrect")]
    WrongPaymentMint,
    #[msg("Economic policy binding is incorrect")]
    WrongEconomicPolicy,
    #[msg("Bounty amount must be non-zero")]
    ZeroBountyAmount,
    #[msg("Bond amount must be non-zero")]
    ZeroBondAmount,
    #[msg("Verifier fee must be non-zero")]
    ZeroVerifierFee,
    #[msg("Minimum verifier stake must be non-zero")]
    ZeroMinimumStake,
    #[msg("Stake amount must be non-zero")]
    ZeroStakeAmount,
    #[msg("Verifier slash amount must be non-zero")]
    ZeroSlashAmount,
    #[msg("Verifier slash amount exceeds minimum stake")]
    SlashExceedsMinimumStake,
    #[msg("Bonded challenge limit is invalid")]
    InvalidChallengeLimit,
    #[msg("Economic timing delay is outside protocol bounds")]
    InvalidEconomicDelay,
    #[msg("Maximum verifier fee reserve overflows")]
    FeeReserveOverflow,
    #[msg("Penalty basis points are invalid")]
    InvalidPenaltyBasisPoints,
    #[msg("Verifier stake is below the policy minimum")]
    StakeBelowMinimum,
    #[msg("Verifier stake withdrawal is pending")]
    StakeWithdrawalPending,
    #[msg("Verifier stake binding is incorrect")]
    WrongVerifierStake,
    #[msg("Remaining account count is incorrect")]
    WrongRemainingAccountCount,
    #[msg("Stake withdrawal was not requested")]
    WithdrawalNotRequested,
    #[msg("Stake withdrawal cooldown remains active")]
    WithdrawalCooldownActive,
    #[msg("Verifier stake remains slash-locked")]
    StakeStillLocked,
    #[msg("Vault binding is incorrect")]
    WrongVault,
    #[msg("Vault authority is incorrect")]
    WrongVaultAuthority,
    #[msg("Vault must begin empty")]
    VaultMustStartEmpty,
    #[msg("Vault account is already initialized")]
    VaultAlreadyInitialized,
    #[msg("Vault balance differs from recorded liability")]
    VaultBalanceMismatch,
    #[msg("Rent recipient is incorrect")]
    WrongRentRecipient,
    #[msg("Only the proposer or SafetyPolicy governance may fund proposal escrow")]
    UnauthorizedEconomicFunder,
    #[msg("Historical proposals cannot opt into Milestone 6 economics")]
    HistoricalProposalCannotUseEconomics,
    #[msg("Milestone 6 proposals must use funded economic routes")]
    M6ProposalRequiresFundedRoute,
    #[msg("Proposal escrow is not available for this operation")]
    EscrowNotAvailable,
    #[msg("Proposal escrow is not fully funded according to its immutable policy")]
    EscrowNotFullyFunded,
    #[msg("The immutable bonded challenge limit has been reached")]
    BondedChallengeLimitReached,
    #[msg("Challenge bond is not pending")]
    BondNotPending,
    #[msg("Verifier stake account must be writable")]
    StakeMustBeWritable,
    #[msg("Challenge bond binding is incorrect")]
    WrongChallengeBond,
    #[msg("Proposal escrow binding is incorrect")]
    WrongProposalEscrow,
    #[msg("Round economic state is already closed")]
    RoundEconomicsAlreadyClosed,
    #[msg("Verification round has not been finalized")]
    RoundNotFinalized,
    #[msg("Verification round is already finalized")]
    RoundAlreadyFinalized,
    #[msg("Unclosed-round liability counter underflow")]
    UnclosedRoundsUnderflow,
    #[msg("Unsettled-bond liability counter underflow")]
    UnsettledBondsUnderflow,
    #[msg("Verification round is not the canonical winning violation")]
    WrongWinningRound,
    #[msg("A canonical winning violation was already selected")]
    WinningRoundAlreadySelected,
    #[msg("Round economic state has the wrong status")]
    WrongRoundEconomicStatus,
    #[msg("Proposal bounty was already settled")]
    BountyAlreadySettled,
    #[msg("The reveal window is still active")]
    RevealWindowStillActive,
    #[msg("Calculated settlement amount must be non-zero")]
    ZeroSettlementAmount,
    #[msg("Revealed unopened challenge is not yet eligible for recovery")]
    RevealedUnopenedNotEligible,
    #[msg("Verifier attestation binding is incorrect")]
    WrongAttestationBinding,
    #[msg("Verifier attestation was recorded after round finalization")]
    AttestationAfterFinalization,
    #[msg("Verifier fee claim deadline has passed")]
    FeeClaimDeadlinePassed,
    #[msg("Verifier already claimed the fee for this round")]
    VerifierFeeAlreadyClaimed,
    #[msg("Aggregate verifier fees exceed the reserved amount")]
    FeeReserveExceeded,
    #[msg("Round is not eligible for objective non-reveal slashing")]
    RoundNotSlashable,
    #[msg("Verifier epoch economics binding is incorrect")]
    WrongVerifierEpochEconomics,
    #[msg("Verifier stake slash lock does not cover the round deadline")]
    StakeSlashLockTooShort,
    #[msg("Objective slash window has not opened")]
    SlashWindowNotOpen,
    #[msg("Objective slash claim deadline has passed")]
    SlashClaimDeadlinePassed,
    #[msg("A valid verifier attestation prevents non-reveal slashing")]
    VerifierAttestationExists,
    #[msg("Verifier was already slashed for this round")]
    VerifierAlreadySlashed,
    #[msg("Verifier stake has an invalid status")]
    WrongStakeStatus,
    #[msg("Proposal is not terminal for escrow refund")]
    ProposalNotTerminal,
    #[msg("Proposal escrow refund is not configured")]
    RefundNotAvailable,
    #[msg("Proposal escrow refund deadline has not passed")]
    RefundDeadlineNotReached,
    #[msg("Proposal escrow still has unsettled bond liabilities")]
    UnsettledBondLiability,
    #[msg("Proposal escrow still has unclosed round liabilities")]
    UnclosedRoundLiability,
    #[msg("Proposal escrow was already refunded")]
    EscrowAlreadyRefunded,
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::Discriminator;

    #[test]
    fn challenge_commitment_vector_is_stable() {
        let proposal = Pubkey::new_from_array([1; 32]);
        let invariant = Pubkey::new_from_array([2; 32]);
        let hunter = Pubkey::new_from_array([3; 32]);
        let actual = challenge_commitment(&proposal, &invariant, &hunter, &[4; 32], &[5; 32]);
        assert_eq!(
            actual,
            [
                0x2d, 0xcc, 0x93, 0x3f, 0x33, 0x07, 0x28, 0x68, 0x60, 0x90, 0x0d, 0xcd, 0xf1, 0x22,
                0x56, 0x59, 0xb4, 0xfc, 0xfc, 0xc4, 0xdc, 0xad, 0x16, 0xd6, 0x59, 0xc9, 0x07, 0xf2,
                0x0c, 0x41, 0x74, 0xf0,
            ]
        );
    }

    #[test]
    fn replay_result_commitment_vector_is_stable() {
        let actual = replay_result_commitment(
            &Pubkey::new_from_array([1; 32]),
            &Pubkey::new_from_array([2; 32]),
            &Pubkey::new_from_array([3; 32]),
            &[4; 32],
            &[5; 32],
            ReplayVerdict::InvariantViolated,
            &[6; 32],
        );
        assert_eq!(
            actual,
            [
                0xb7, 0xeb, 0x26, 0x65, 0x42, 0xe0, 0x99, 0xbd, 0x41, 0x39, 0x8d, 0x8b, 0x78, 0xd6,
                0xd5, 0x71, 0xb5, 0x78, 0x44, 0x35, 0x6b, 0xfe, 0x7c, 0x6f, 0x55, 0x39, 0xa7, 0x3e,
                0x00, 0x04, 0x69, 0x21,
            ]
        );
    }

    #[test]
    fn milestone_five_account_sizes_are_stable() {
        assert_eq!(8 + VerifierRegistry::INIT_SPACE, 122);
        assert_eq!(8 + VerifierEpoch::INIT_SPACE, 414);
        assert_eq!(8 + ProposalVerificationGate::INIT_SPACE, 77);
        assert_eq!(8 + VerificationRound::INIT_SPACE, 317);
        assert_eq!(8 + ReplayResult::INIT_SPACE, 115);
        assert_eq!(8 + VerifierAttestation::INIT_SPACE, 177);
    }

    #[test]
    fn milestone_six_foundation_account_sizes_are_stable() {
        assert_eq!(8 + EconomicPolicyRegistry::INIT_SPACE, 97);
        assert_eq!(8 + EconomicPolicy::INIT_SPACE, 251);
        assert_eq!(8 + ProposalEscrow::INIT_SPACE, 370);
        assert_eq!(8 + ChallengeBond::INIT_SPACE, 211);
        assert_eq!(8 + VerifierStake::INIT_SPACE, 212);
        assert_eq!(8 + VerifierEpochEconomics::INIT_SPACE, 113);
        assert_eq!(8 + RoundEconomicState::INIT_SPACE, 139);
        assert_eq!(8 + VerifierFeeClaim::INIT_SPACE, 153);
        assert_eq!(8 + VerifierSlashReceipt::INIT_SPACE, 153);
    }

    #[test]
    fn milestone_six_foundation_discriminators_are_stable() {
        assert_eq!(
            EconomicPolicyRegistry::DISCRIMINATOR,
            [0xb7, 0x6f, 0x19, 0xea, 0xbb, 0x28, 0x65, 0x99]
        );
        assert_eq!(
            EconomicPolicy::DISCRIMINATOR,
            [0x9a, 0xe6, 0x27, 0xaa, 0xee, 0x39, 0xe1, 0xe8]
        );
        assert_eq!(
            ProposalEscrow::DISCRIMINATOR,
            [0x8b, 0x7f, 0x61, 0x7d, 0x11, 0xa0, 0x4d, 0x25]
        );
        assert_eq!(
            ChallengeBond::DISCRIMINATOR,
            [0x5b, 0x4c, 0x2e, 0x8a, 0x24, 0x40, 0x06, 0xee]
        );
        assert_eq!(
            VerifierStake::DISCRIMINATOR,
            [0x2f, 0xaa, 0x0c, 0x2b, 0xb7, 0xd5, 0xad, 0x7b]
        );
        assert_eq!(
            VerifierEpochEconomics::DISCRIMINATOR,
            [0xdd, 0x77, 0x98, 0xcd, 0x6a, 0xe8, 0x71, 0xe2]
        );
        assert_eq!(
            RoundEconomicState::DISCRIMINATOR,
            [0x21, 0xad, 0xea, 0xb2, 0xae, 0x0f, 0x7c, 0x3e]
        );
        assert_eq!(
            VerifierFeeClaim::DISCRIMINATOR,
            [0xf4, 0x05, 0x8d, 0x39, 0xe2, 0x10, 0xf2, 0xbf]
        );
        assert_eq!(
            VerifierSlashReceipt::DISCRIMINATOR,
            [0xe4, 0xd0, 0x83, 0xcf, 0x68, 0x1f, 0xdb, 0x7e]
        );
    }

    #[test]
    fn milestone_six_pda_vectors_are_stable() {
        use std::str::FromStr;
        let key = |byte| Pubkey::new_from_array([byte; 32]);
        let vectors: Vec<(&str, Pubkey, u8)> = vec![
            (
                "registry",
                Pubkey::find_program_address(
                    &[ECONOMIC_POLICY_REGISTRY_SEED, key(1).as_ref()],
                    &crate::ID,
                )
                .0,
                252,
            ),
            (
                "policy",
                Pubkey::find_program_address(
                    &[ECONOMIC_POLICY_SEED, key(2).as_ref(), &0u64.to_le_bytes()],
                    &crate::ID,
                )
                .0,
                255,
            ),
            (
                "escrow",
                Pubkey::find_program_address(&[PROPOSAL_ESCROW_SEED, key(3).as_ref()], &crate::ID)
                    .0,
                254,
            ),
            (
                "bounty",
                Pubkey::find_program_address(&[BOUNTY_VAULT_SEED, key(3).as_ref()], &crate::ID).0,
                254,
            ),
            (
                "fee",
                Pubkey::find_program_address(&[FEE_VAULT_SEED, key(3).as_ref()], &crate::ID).0,
                255,
            ),
            (
                "penalty",
                Pubkey::find_program_address(&[PENALTY_VAULT_SEED, key(3).as_ref()], &crate::ID).0,
                255,
            ),
            (
                "bond",
                Pubkey::find_program_address(&[CHALLENGE_BOND_SEED, key(4).as_ref()], &crate::ID).0,
                254,
            ),
            (
                "bond-vault",
                Pubkey::find_program_address(&[BOND_VAULT_SEED, key(4).as_ref()], &crate::ID).0,
                254,
            ),
            (
                "stake",
                Pubkey::find_program_address(
                    &[VERIFIER_STAKE_SEED, key(5).as_ref(), key(6).as_ref()],
                    &crate::ID,
                )
                .0,
                255,
            ),
            (
                "stake-vault",
                Pubkey::find_program_address(
                    &[STAKE_VAULT_SEED, key(5).as_ref(), key(6).as_ref()],
                    &crate::ID,
                )
                .0,
                255,
            ),
            (
                "epoch-economics",
                Pubkey::find_program_address(
                    &[
                        VERIFIER_EPOCH_ECONOMICS_SEED,
                        key(7).as_ref(),
                        key(5).as_ref(),
                    ],
                    &crate::ID,
                )
                .0,
                255,
            ),
            (
                "round-economics",
                Pubkey::find_program_address(&[ROUND_ECONOMICS_SEED, key(8).as_ref()], &crate::ID)
                    .0,
                254,
            ),
            (
                "fee-claim",
                Pubkey::find_program_address(
                    &[VERIFIER_FEE_CLAIM_SEED, key(8).as_ref(), key(6).as_ref()],
                    &crate::ID,
                )
                .0,
                254,
            ),
            (
                "slash",
                Pubkey::find_program_address(
                    &[VERIFIER_SLASH_SEED, key(8).as_ref(), key(6).as_ref()],
                    &crate::ID,
                )
                .0,
                254,
            ),
        ];
        let expected = [
            "9u3NWMs4rdqKZ1VbJD8EeRbGvpvsUbTPwZCbXp4aNoEe",
            "5EXY7mfdpfHrTJ4DxAULebhKcTrdNqaPenMDVTGxSYvh",
            "FqHf62Yy9CLpoPTCfatKppGN5U5hJwssizEhC7AzqAeG",
            "CNnK6wYYGePekn8mpCdNdgEmsdZ5jEq1UyxbjzTPCBNm",
            "EEDDQyutPCAJAdFTSCyq37iNjnJAWtKTxE5w3aYnKA55",
            "EdfWAHzN3DqMrzvq3Un1oM7e7gfZ8H3uLybQktpFhM1C",
            "DfesiCDmJLhuZJyVb7F8Mpx8qe3VksweoqcNJd5gXgu8",
            "BTsp3RfaJjHcLWBXcNk7UHWgNxv7dGC8y3FDcfwYRW5t",
            "7xAnha5oBd142Cjjn5HKZZVN8GQbsSQYPS7Ko6rkbFof",
            "25jN5qJuGizSZ2iktCtPZcMqpx5rKH4yFqs9aZ3UVFtd",
            "CSuV2NFDMwb5mwLLXaa8SKYxFvu9H6YD9zrqMNtDS62h",
            "DrTHx8dMvhBoi2RTTutAzvuRG6q4zeUbsVcDDnkTY8F",
            "EWWEZjrZSadFyZWms9U441ToxydxuVCSgX6tmaDGTu6H",
            "7G1CdNWszmMdmc5bBTp2VXqfC5mka8qCvP2e1qX1EnuD",
        ];
        for ((name, actual, bump), expected_address) in vectors.iter().zip(expected.iter()) {
            assert_eq!(
                *actual,
                Pubkey::from_str(expected_address).unwrap(),
                "{name}"
            );
            let seeds_bump = match *name {
                "registry" => {
                    Pubkey::find_program_address(
                        &[ECONOMIC_POLICY_REGISTRY_SEED, key(1).as_ref()],
                        &crate::ID,
                    )
                    .1
                }
                "policy" => {
                    Pubkey::find_program_address(
                        &[ECONOMIC_POLICY_SEED, key(2).as_ref(), &0u64.to_le_bytes()],
                        &crate::ID,
                    )
                    .1
                }
                "escrow" => {
                    Pubkey::find_program_address(
                        &[PROPOSAL_ESCROW_SEED, key(3).as_ref()],
                        &crate::ID,
                    )
                    .1
                }
                "bounty" => {
                    Pubkey::find_program_address(&[BOUNTY_VAULT_SEED, key(3).as_ref()], &crate::ID)
                        .1
                }
                "fee" => {
                    Pubkey::find_program_address(&[FEE_VAULT_SEED, key(3).as_ref()], &crate::ID).1
                }
                "penalty" => {
                    Pubkey::find_program_address(&[PENALTY_VAULT_SEED, key(3).as_ref()], &crate::ID)
                        .1
                }
                "bond" => {
                    Pubkey::find_program_address(
                        &[CHALLENGE_BOND_SEED, key(4).as_ref()],
                        &crate::ID,
                    )
                    .1
                }
                "bond-vault" => {
                    Pubkey::find_program_address(&[BOND_VAULT_SEED, key(4).as_ref()], &crate::ID).1
                }
                "stake" => {
                    Pubkey::find_program_address(
                        &[VERIFIER_STAKE_SEED, key(5).as_ref(), key(6).as_ref()],
                        &crate::ID,
                    )
                    .1
                }
                "stake-vault" => {
                    Pubkey::find_program_address(
                        &[STAKE_VAULT_SEED, key(5).as_ref(), key(6).as_ref()],
                        &crate::ID,
                    )
                    .1
                }
                "epoch-economics" => {
                    Pubkey::find_program_address(
                        &[
                            VERIFIER_EPOCH_ECONOMICS_SEED,
                            key(7).as_ref(),
                            key(5).as_ref(),
                        ],
                        &crate::ID,
                    )
                    .1
                }
                "round-economics" => {
                    Pubkey::find_program_address(
                        &[ROUND_ECONOMICS_SEED, key(8).as_ref()],
                        &crate::ID,
                    )
                    .1
                }
                "fee-claim" => {
                    Pubkey::find_program_address(
                        &[VERIFIER_FEE_CLAIM_SEED, key(8).as_ref(), key(6).as_ref()],
                        &crate::ID,
                    )
                    .1
                }
                "slash" => {
                    Pubkey::find_program_address(
                        &[VERIFIER_SLASH_SEED, key(8).as_ref(), key(6).as_ref()],
                        &crate::ID,
                    )
                    .1
                }
                _ => unreachable!(),
            };
            assert_eq!(*bump, seeds_bump, "{name} bump");
        }
    }

    #[test]
    fn economic_policy_versioning_is_atomic() {
        let mut next = ECONOMIC_POLICY_FIRST_CONFIG_ID;
        assert!(next_config_id(next, 1).is_err());
        assert_eq!(next, 0, "failed creation consumed a config id");
        next = next_config_id(next, 0).unwrap();
        assert_eq!(next, 1);
        assert!(next_config_id(next, 0).is_err());
    }

    #[test]
    fn fee_reserve_and_penalty_math_are_checked() {
        assert_eq!(maximum_fee_reserve(10, 8).unwrap(), 640);
        assert!(maximum_fee_reserve(u64::MAX, 8).is_err());
        assert_eq!(penalty_amount(101, HOLD_BOND_SLASH_BPS).unwrap(), 25);
        assert_eq!(
            penalty_amount(101, HUNTER_NON_REVEAL_SLASH_BPS).unwrap(),
            101
        );
        assert!(penalty_amount(1, BPS_DENOMINATOR + 1).is_err());
    }

    #[test]
    fn economic_timing_bounds_are_exact() {
        assert!(validate_delay(0, 1, 10).is_err());
        assert!(validate_delay(1, 1, 10).is_ok());
        assert!(validate_delay(10, 1, 10).is_ok());
        assert!(validate_delay(11, 1, 10).is_err());
        assert_eq!(withdrawal_available_slot(100, 120, 5).unwrap(), 125);
        assert_eq!(withdrawal_available_slot(130, 120, 5).unwrap(), 135);
        assert!(withdrawal_available_slot(u64::MAX, 0, 1).is_err());
        assert_eq!(extended_slash_lock(120, 100), 120);
        assert_eq!(extended_slash_lock(120, 140), 140);
    }

    #[test]
    fn economic_enforcement_boundary_is_exact() {
        assert!(is_historical_proposal(99, 100));
        assert!(!is_historical_proposal(100, 100));
        assert!(!is_historical_proposal(101, 100));
    }

    #[test]
    fn economic_deadlines_are_checked_and_share_the_challenge_end() {
        assert_eq!(
            checked_economic_deadlines(100, 5, 9).unwrap(),
            (105, 109, 109)
        );
        assert_eq!(
            checked_economic_deadlines(100, 11, 3).unwrap(),
            (111, 103, 111)
        );
        assert!(checked_economic_deadlines(u64::MAX, 1, 1).is_err());
        assert!(checked_economic_deadlines(u64::MAX - 1, 1, 2).is_err());
    }

    #[test]
    fn bonded_challenge_limit_and_counters_are_atomic() {
        assert_eq!(increment_bond_counters(0, 0, 2).unwrap(), (1, 1));
        assert_eq!(increment_bond_counters(1, 1, 2).unwrap(), (2, 2));
        assert!(increment_bond_counters(2, 1, 2).is_err());
        assert!(increment_bond_counters(7, u8::MAX, 8).is_err());
    }

    #[test]
    fn overlapping_round_locks_are_monotonic() {
        let first = extended_slash_lock(0, 140);
        let overlapping = extended_slash_lock(first, 180);
        let earlier_round_close = extended_slash_lock(overlapping, 140);
        assert_eq!(first, 140);
        assert_eq!(overlapping, 180);
        assert_eq!(earlier_round_close, 180);
    }

    #[test]
    fn pass_three_a_settlement_amounts_are_exact() {
        assert_eq!(hold_bond_split(101).unwrap(), (25, 76));
        assert_eq!(hold_bond_split(4).unwrap(), (1, 3));
        assert!(hold_bond_split(3).is_err());
        assert_eq!(
            penalty_amount(101, HUNTER_NON_REVEAL_SLASH_BPS).unwrap(),
            101
        );
        assert_eq!(accepted_settlement_amounts(700, 300), (700, 300));
        assert_eq!(configured_bounty_payout(700, 700).unwrap(), 700);
        assert_eq!(configured_bounty_payout(701, 700).unwrap(), 700);
        assert!(configured_bounty_payout(699, 700).is_err());
    }

    #[test]
    fn canonical_winner_is_selected_once() {
        let round = Pubkey::new_from_array([21; 32]);
        let trace = Pubkey::new_from_array([22; 32]);
        assert_eq!(
            canonical_winner(None, None, Some(round), round, trace).unwrap(),
            (round, trace)
        );
        assert!(canonical_winner(Some(round), Some(trace), Some(round), round, trace).is_err());
        assert!(canonical_winner(
            None,
            None,
            Some(Pubkey::new_from_array([23; 32])),
            round,
            trace
        )
        .is_err());
        assert!(require_canonical_accepted_winner(
            true,
            Some(round),
            Some(round),
            Some(trace),
            round,
            trace,
        )
        .is_ok());
        assert!(require_canonical_accepted_winner(
            false,
            Some(round),
            Some(round),
            Some(trace),
            round,
            trace,
        )
        .is_err());
        let sibling = Pubkey::new_from_array([24; 32]);
        assert!(require_canonical_accepted_winner(
            true,
            Some(round),
            Some(round),
            Some(trace),
            sibling,
            trace,
        )
        .is_err());
        assert!(require_canonical_accepted_winner(
            true,
            Some(round),
            Some(round),
            Some(trace),
            round,
            Pubkey::new_from_array([25; 32]),
        )
        .is_err());
    }

    #[test]
    fn economic_round_closure_and_liability_replay_guards_are_exact() {
        assert!(require_open_round_economics(RoundEconomicStatus::Open).is_ok());
        assert!(require_open_round_economics(RoundEconomicStatus::FinalizedHold).is_err());
        assert!(require_open_round_economics(RoundEconomicStatus::FinalizedViolation).is_err());
        assert_eq!(
            decrement_liability(1, FaultlineError::UnclosedRoundsUnderflow).unwrap(),
            0
        );
        assert!(decrement_liability(0, FaultlineError::UnclosedRoundsUnderflow).is_err());
        assert_eq!(
            decrement_liability(1, FaultlineError::UnsettledBondsUnderflow).unwrap(),
            0
        );
        assert!(decrement_liability(0, FaultlineError::UnsettledBondsUnderflow).is_err());
    }

    #[test]
    fn timed_out_and_aborted_classification_is_objective() {
        let current = Pubkey::new_from_array([31; 32]);
        let winner = Pubkey::new_from_array([32; 32]);
        assert!(
            unfinalized_round_economic_status(ProposalState::Approved, false, None, current)
                .unwrap()
                == RoundEconomicStatus::TimedOut
        );
        assert!(
            unfinalized_round_economic_status(ProposalState::Rejected, true, Some(winner), current)
                .unwrap()
                == RoundEconomicStatus::Aborted
        );
        assert!(unfinalized_round_economic_status(
            ProposalState::Rejected,
            true,
            Some(current),
            current
        )
        .is_err());
        assert!(unfinalized_round_economic_status(
            ProposalState::Approved,
            true,
            Some(winner),
            current
        )
        .is_err());
        assert!(!strictly_after_deadline(99, 100));
        assert!(!strictly_after_deadline(100, 100));
        assert!(strictly_after_deadline(101, 100));
    }

    #[test]
    fn revealed_unopened_deadline_and_tombstone_prevent_replay() {
        assert!(!revealed_unopened_eligible(
            ProposalState::ChallengeActive,
            100,
            100
        ));
        assert!(revealed_unopened_eligible(
            ProposalState::ChallengeActive,
            101,
            100
        ));
        assert!(revealed_unopened_eligible(ProposalState::Rejected, 50, 100));
        assert!(revealed_unopened_eligible(ProposalState::Expired, 50, 100));
        assert!(revealed_unopened_eligible(ProposalState::Executed, 50, 100));
        assert!(!revealed_unopened_eligible(ProposalState::Draft, 50, 100));
        assert!(!revealed_unopened_eligible(
            ProposalState::Approved,
            50,
            100
        ));
        for status in [
            BondStatus::AcceptedReturned,
            BondStatus::HoldPenalized,
            BondStatus::NonRevealPenalized,
            BondStatus::TimeoutReturned,
            BondStatus::AbortedReturned,
            BondStatus::RevealedUnopenedReturned,
        ] {
            assert!(status != BondStatus::Pending);
        }
    }

    #[test]
    fn non_reveal_deadline_is_strict() {
        assert!(!strictly_after_deadline(99, 100));
        assert!(!strictly_after_deadline(100, 100));
        assert!(strictly_after_deadline(101, 100));
    }

    #[test]
    fn absent_round_account_classification_allows_only_system_owned_empty_data() {
        assert!(canonical_account_absent_parts(
            &solana_system_program::ID,
            0,
            0
        ));
        assert!(canonical_account_absent_parts(
            &solana_system_program::ID,
            0,
            1_000_000
        ));
        assert!(!canonical_account_absent_parts(
            &crate::ID,
            RoundEconomicState::INIT_SPACE + 8,
            1_000_000
        ));
        assert!(!canonical_account_absent_parts(
            &Pubkey::new_from_array([77; 32]),
            0,
            1_000_000
        ));
        assert!(!canonical_account_absent_parts(
            &solana_system_program::ID,
            1,
            1_000_000
        ));
    }

    #[test]
    fn attestation_dust_and_closed_token_vault_classification_are_safe() {
        assert!(canonical_account_absent_parts(
            &solana_system_program::ID,
            0,
            0
        ));
        assert!(canonical_account_absent_parts(
            &solana_system_program::ID,
            0,
            999_999
        ));
        assert!(!canonical_account_absent_parts(
            &crate::ID,
            8 + VerifierAttestation::INIT_SPACE,
            999_999
        ));
        assert!(!canonical_account_absent_parts(
            &Pubkey::new_from_array([78; 32]),
            0,
            999_999
        ));
        assert!(token_account_layout_is_initialized(
            TOKEN_ACCOUNT_LEN,
            Some(TOKEN_ACCOUNT_INITIALIZED)
        ));
        assert!(!token_account_layout_is_initialized(
            TOKEN_ACCOUNT_LEN,
            Some(0)
        ));
        assert!(!token_account_layout_is_initialized(0, None));
    }

    #[test]
    fn verifier_fee_deadline_and_reserve_bounds_are_exact() {
        assert!(fee_claim_is_timely(99, 100));
        assert!(fee_claim_is_timely(100, 100));
        assert!(!fee_claim_is_timely(101, 100));
        assert_eq!(checked_fee_claim_total(315, 5, 320).unwrap(), 320);
        assert!(checked_fee_claim_total(320, 5, 320).is_err());
        assert!(checked_fee_claim_total(u64::MAX, 1, u64::MAX).is_err());
        assert_eq!(maximum_fee_reserve(5, MAX_BONDED_CHALLENGES).unwrap(), 320);
    }

    #[test]
    fn only_an_attestation_for_the_winning_result_is_fee_eligible() {
        let round = Pubkey::new_from_array([81; 32]);
        let verifier = Pubkey::new_from_array([82; 32]);
        let epoch = Pubkey::new_from_array([83; 32]);
        let winner = Pubkey::new_from_array([84; 32]);
        let winner_hash = [85; 32];
        let attestation = VerifierAttestation {
            verification_round: round,
            verifier_epoch: epoch,
            verifier,
            replay_result: winner,
            result_hash: winner_hash,
            attested_slot: 10,
            bump: 1,
        };
        assert!(attestation_matches_winner(
            &attestation,
            round,
            verifier,
            epoch,
            winner,
            winner_hash,
        ));
        assert!(!attestation_matches_winner(
            &attestation,
            round,
            verifier,
            epoch,
            Pubkey::new_from_array([86; 32]),
            [86; 32],
        ));
        assert!(require_finalized_economic_result(
            VerificationRoundStatus::InvariantHolds,
            RoundEconomicStatus::FinalizedHold,
            ReplayVerdict::InvariantHolds,
        )
        .is_ok());
        assert!(require_finalized_economic_result(
            VerificationRoundStatus::InvariantHolds,
            RoundEconomicStatus::FinalizedHold,
            ReplayVerdict::InvariantViolated,
        )
        .is_err());
    }

    #[test]
    fn fee_claim_and_slash_receipt_identities_are_unique_per_round_and_verifier() {
        let round = Pubkey::new_from_array([87; 32]);
        let verifier = Pubkey::new_from_array([88; 32]);
        let other = Pubkey::new_from_array([89; 32]);
        let fee = Pubkey::find_program_address(
            &[VERIFIER_FEE_CLAIM_SEED, round.as_ref(), verifier.as_ref()],
            &crate::ID,
        )
        .0;
        let duplicate_fee = Pubkey::find_program_address(
            &[VERIFIER_FEE_CLAIM_SEED, round.as_ref(), verifier.as_ref()],
            &crate::ID,
        )
        .0;
        let other_fee = Pubkey::find_program_address(
            &[VERIFIER_FEE_CLAIM_SEED, round.as_ref(), other.as_ref()],
            &crate::ID,
        )
        .0;
        assert_eq!(fee, duplicate_fee);
        assert_ne!(fee, other_fee);
        let slash = Pubkey::find_program_address(
            &[VERIFIER_SLASH_SEED, round.as_ref(), verifier.as_ref()],
            &crate::ID,
        )
        .0;
        let duplicate_slash = Pubkey::find_program_address(
            &[VERIFIER_SLASH_SEED, round.as_ref(), verifier.as_ref()],
            &crate::ID,
        )
        .0;
        assert_eq!(slash, duplicate_slash);
    }

    #[test]
    fn objective_non_reveal_slash_predicate_is_strict() {
        assert!(objective_slash_is_allowed(
            ProposalState::ChallengeActive,
            VerificationRoundStatus::Open,
            RoundEconomicStatus::Open,
            100,
            100,
            110,
            true,
        )
        .is_err());
        assert!(objective_slash_is_allowed(
            ProposalState::ChallengeActive,
            VerificationRoundStatus::Open,
            RoundEconomicStatus::TimedOut,
            110,
            100,
            110,
            true,
        )
        .is_ok());
        assert!(objective_slash_is_allowed(
            ProposalState::ChallengeActive,
            VerificationRoundStatus::Open,
            RoundEconomicStatus::TimedOut,
            111,
            100,
            110,
            true,
        )
        .is_err());
        assert!(objective_slash_is_allowed(
            ProposalState::ChallengeActive,
            VerificationRoundStatus::Open,
            RoundEconomicStatus::TimedOut,
            105,
            100,
            110,
            false,
        )
        .is_err());
        for status in [
            RoundEconomicStatus::Aborted,
            RoundEconomicStatus::FinalizedHold,
            RoundEconomicStatus::FinalizedViolation,
        ] {
            assert!(objective_slash_is_allowed(
                ProposalState::ChallengeActive,
                VerificationRoundStatus::Open,
                status,
                105,
                100,
                110,
                true,
            )
            .is_err());
        }
        assert!(objective_slash_is_allowed(
            ProposalState::ChallengeActive,
            VerificationRoundStatus::InvariantHolds,
            RoundEconomicStatus::TimedOut,
            105,
            100,
            110,
            true,
        )
        .is_err());
        assert!(objective_slash_is_allowed(
            ProposalState::Rejected,
            VerificationRoundStatus::Open,
            RoundEconomicStatus::Open,
            105,
            100,
            110,
            true,
        )
        .is_err());
        assert!(objective_slash_is_allowed(
            ProposalState::Rejected,
            VerificationRoundStatus::Open,
            RoundEconomicStatus::TimedOut,
            105,
            100,
            110,
            true,
        )
        .is_ok());
    }

    #[test]
    fn objective_slash_caps_at_remaining_stake_and_preserves_pending_withdrawal() {
        assert_eq!(objective_slash_amount(40, 100).unwrap(), 40);
        assert_eq!(objective_slash_amount(40, 25).unwrap(), 25);
        assert!(objective_slash_amount(40, 0).is_err());
        assert!(stake_status_is_slashable(StakeStatus::Active));
        assert!(stake_status_is_slashable(StakeStatus::WithdrawalPending));
    }

    #[test]
    fn final_escrow_refund_rules_and_replay_barriers_are_exact() {
        for state in [
            ProposalState::Rejected,
            ProposalState::Expired,
            ProposalState::Executed,
        ] {
            assert!(proposal_is_terminal_for_refund(state));
        }
        for state in [
            ProposalState::Draft,
            ProposalState::ChallengeActive,
            ProposalState::Approved,
        ] {
            assert!(!proposal_is_terminal_for_refund(state));
        }
        assert!(!refund_is_timely(99, 100));
        assert!(!refund_is_timely(100, 100));
        assert!(refund_is_timely(101, 100));
        assert!(require_refund_liabilities_clear(0, 0).is_ok());
        assert!(require_refund_liabilities_clear(1, 0).is_err());
        assert!(require_refund_liabilities_clear(0, 1).is_err());
        assert!(
            bounty_status_after_refund(BountyStatus::Pending).unwrap()
                == BountyStatus::RefundedToFunder
        );
        assert!(
            bounty_status_after_refund(BountyStatus::PaidToHunter).unwrap()
                == BountyStatus::PaidToHunter
        );
        assert!(bounty_status_after_refund(BountyStatus::RefundedToFunder).is_err());
        assert_eq!(checked_refund_total(0, 0, 0).unwrap(), 0);
        assert_eq!(checked_refund_total(10, 20, 30).unwrap(), 60);
        assert!(checked_refund_total(u64::MAX, 1, 0).is_err());
        assert!(checked_refund_total(u64::MAX - 1, 1, 1).is_err());
    }

    #[test]
    fn verifier_stake_derivation_is_policy_specific() {
        let verifier = Pubkey::new_from_array([9; 32]);
        let policy_a = Pubkey::new_from_array([10; 32]);
        let policy_b = Pubkey::new_from_array([11; 32]);
        let stake_a = Pubkey::find_program_address(
            &[VERIFIER_STAKE_SEED, policy_a.as_ref(), verifier.as_ref()],
            &crate::ID,
        )
        .0;
        let stake_b = Pubkey::find_program_address(
            &[VERIFIER_STAKE_SEED, policy_b.as_ref(), verifier.as_ref()],
            &crate::ID,
        )
        .0;
        assert_ne!(stake_a, stake_b);
    }

    #[test]
    fn eight_verifier_legacy_transaction_budget_is_bounded() {
        assert_eq!(legacy_transaction_serialized_size(16, 8), 673);
        assert_eq!(legacy_transaction_serialized_size(25, 8), 970);
        assert_eq!(legacy_transaction_serialized_size(6, 8), 343);
        assert_eq!(legacy_transaction_serialized_size(13, 8), 574);
        assert!(legacy_transaction_serialized_size(25, 8) < 1_232);
    }

    #[test]
    fn eight_verifier_economic_round_transaction_serializes_below_packet_limit() {
        use anchor_lang::solana_program::message::Message;

        let keys: Vec<Pubkey> = (1u8..=24)
            .map(|value| Pubkey::new_from_array([value; 32]))
            .collect();
        let mut accounts = vec![
            AccountMeta::new(keys[0], true),
            AccountMeta::new_readonly(keys[1], false),
            AccountMeta::new_readonly(keys[2], false),
            AccountMeta::new_readonly(keys[3], false),
            AccountMeta::new_readonly(keys[4], false),
            AccountMeta::new(keys[5], false),
            AccountMeta::new(keys[6], false),
            AccountMeta::new_readonly(keys[7], false),
            AccountMeta::new_readonly(keys[8], false),
            AccountMeta::new_readonly(keys[9], false),
            AccountMeta::new_readonly(keys[10], false),
            AccountMeta::new_readonly(keys[11], false),
            AccountMeta::new_readonly(keys[12], false),
            AccountMeta::new_readonly(keys[13], false),
            AccountMeta::new(keys[14], false),
            AccountMeta::new(keys[15], false),
            AccountMeta::new_readonly(solana_system_program::ID, false),
        ];
        accounts.extend(
            keys[16..24]
                .iter()
                .map(|stake| AccountMeta::new(*stake, false)),
        );
        assert_eq!(accounts.len(), 25);
        assert_eq!(accounts.iter().filter(|meta| meta.is_signer).count(), 1);
        assert_eq!(accounts.iter().filter(|meta| meta.is_writable).count(), 13);

        let discriminator_hash = hash(b"global:open_economic_verification_round").to_bytes();
        let instruction = Instruction {
            program_id: crate::ID,
            accounts,
            data: discriminator_hash[..8].to_vec(),
        };
        let message = Message::new(&[instruction], Some(&keys[0]));
        let serialized_message = bincode::serialize(&message).unwrap();
        let mut serialized_transaction = Vec::with_capacity(65 + serialized_message.len());
        serialized_transaction.push(1); // compact-u16 signature count
        serialized_transaction.extend_from_slice(&[0u8; 64]);
        serialized_transaction.extend_from_slice(&serialized_message);

        assert!(serialized_transaction.len() < 1_232);
        println!(
            "serialized OpenEconomicVerificationRound transaction: {} bytes",
            serialized_transaction.len()
        );
    }
}
