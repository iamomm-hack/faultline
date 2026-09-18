use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    bpf_loader_upgradeable::{self, UpgradeableLoaderState},
    hash::{hash, hashv},
    program::invoke_signed,
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
const CHALLENGE_DOMAIN: &[u8] = b"FAULTLINE_CHALLENGE_V1";
const REPLAY_DOMAIN: &[u8] = b"FAULTLINE_REPLAY_V1";
const VERIFIER_SET_DOMAIN: &[u8] = b"FAULTLINE_VERIFIER_SET_V1";
const MIN_REVEAL_DELAY_SLOTS: u64 = 1;
const MAX_REVEAL_HORIZON_SLOTS: u64 = 8;
const MIN_VERIFICATION_REMAINING_SLOTS: u64 = 2;
const MAX_VERIFIERS: usize = 8;
const AUTOMATIC_VIOLATION_REASON_CODE: u16 = 0x5001;

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
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
