import { type PublicKey } from "@solana/web3.js";
import { FAULTLINE_GATE_IDL } from "@faultline/idl";
import { decodeAccount, type EncodedAccount, type FaultlineIdl } from "./idl.js";
import type { PublicKeyInput } from "./validation.js";

const gateIdl = FAULTLINE_GATE_IDL as unknown as FaultlineIdl;
export type ClosedEnum<K extends string> = Readonly<{ kind: K }>;
export type VerificationRoundStatus = ClosedEnum<"Open" | "InvariantHolds" | "InvariantViolated">;
export type ReplayVerdictState = ClosedEnum<"InvariantHolds" | "InvariantViolated">;
export type StakeStatus = ClosedEnum<"Active" | "WithdrawalPending">;
export type RoundEconomicStatus = ClosedEnum<"Open" | "FinalizedHold" | "FinalizedViolation" | "TimedOut" | "Aborted">;
export type PolicyStatus = ClosedEnum<"Active" | "Paused">;
export type ProposalState = ClosedEnum<"Draft" | "ChallengeActive" | "Approved" | "Rejected" | "Expired" | "Executed">;
export type InvariantKind = ClosedEnum<"Authorization" | "AssetConservation" | "BalancePreservation" | "Solvency" | "PrivilegeBoundary">;
export type ChallengeCommitStatus = ClosedEnum<"Committed" | "Revealed">;

export interface GuardConfigView { readonly version: number; readonly target_program: PublicKey; readonly governance_authority: PublicKey; readonly guard_bump: number; readonly proposal_nonce: bigint; }
export interface BufferClaimView { readonly proposal: PublicKey; readonly candidate_buffer: PublicKey; readonly bump: number; }
export interface SafetyPolicyView { readonly authority: PublicKey; readonly governance_authority: PublicKey; readonly target_program: PublicKey; readonly policy_id: bigint; readonly policy_version: number; readonly min_challenge_slots: bigint; readonly verifier_quorum_required: number; readonly allowed_invariant_set_hash: Buffer; readonly status: PolicyStatus; readonly created_at_slot: bigint; readonly bump: number; }
export interface UpgradeProposalView { readonly policy: PublicKey; readonly proposal_id: bigint; readonly target_program: PublicKey; readonly program_data: PublicKey; readonly candidate_buffer: PublicKey; readonly candidate_buffer_hash: Buffer; readonly proposer: PublicKey; readonly created_at_slot: bigint; readonly challenge_start_slot: bigint | null; readonly challenge_end_slot: bigint | null; readonly state: ProposalState; readonly decision_authority: PublicKey | null; readonly decision_slot: bigint | null; readonly decision_reason_code: number | null; readonly executed_at_slot: bigint | null; readonly bump: number; }
export interface InvariantDefinitionView { readonly safety_policy: PublicKey; readonly invariant_id: bigint; readonly invariant_kind: InvariantKind; readonly name_hash: Buffer; readonly specification_hash: Buffer; readonly enabled: boolean; readonly created_by: PublicKey; readonly created_at_slot: bigint; readonly disabled_at_slot: bigint | null; readonly bump: number; }
export interface ChallengeCommitView { readonly proposal: PublicKey; readonly invariant: PublicKey; readonly hunter: PublicKey; readonly commitment_hash: Buffer; readonly committed_at_slot: bigint; readonly earliest_reveal_slot: bigint; readonly latest_reveal_slot: bigint; readonly status: ChallengeCommitStatus; readonly revealed_trace_hash: Buffer | null; readonly revealed_at_slot: bigint | null; readonly bump: number; }
export interface TraceClaimView { readonly proposal: PublicKey; readonly invariant: PublicKey; readonly challenge_commit: PublicKey; readonly trace_hash: Buffer; readonly hunter: PublicKey; readonly revealed_at_slot: bigint; readonly bump: number; }

export interface VerifierRegistryView { readonly safety_policy: PublicKey; readonly governance: PublicKey; readonly active_epoch: PublicKey | null; readonly next_epoch_id: bigint; readonly created_at_slot: bigint; readonly bump: number; }
export interface VerifierEpochView { readonly verifier_registry: PublicKey; readonly safety_policy: PublicKey; readonly epoch_id: bigint; readonly verifiers: readonly PublicKey[]; readonly threshold: number; readonly verifier_set_hash: Buffer; readonly creator: PublicKey; readonly created_at_slot: bigint; readonly bump: number; }
export interface ProposalVerificationGateView { readonly proposal: PublicKey; readonly pending_rounds: number; readonly confirmed_violation: boolean; readonly last_violation_round: PublicKey | null; readonly bump: number; }
export interface VerificationRoundView { readonly policy: PublicKey; readonly proposal: PublicKey; readonly invariant: PublicKey; readonly trace_claim: PublicKey; readonly trace_hash: Buffer; readonly candidate_buffer_hash: Buffer; readonly invariant_specification_hash: Buffer; readonly verifier_epoch: PublicKey; readonly threshold: number; readonly status: VerificationRoundStatus; readonly opened_slot: bigint; readonly finalized_slot: bigint | null; readonly winning_replay_result: PublicKey | null; readonly bump: number; }
export interface ReplayResultView { readonly verification_round: PublicKey; readonly result_hash: Buffer; readonly verdict: ReplayVerdictState; readonly replay_receipt_hash: Buffer; readonly vote_count: number; readonly created_at_slot: bigint; readonly bump: number; }
export interface VerifierAttestationView { readonly verification_round: PublicKey; readonly verifier_epoch: PublicKey; readonly verifier: PublicKey; readonly replay_result: PublicKey; readonly result_hash: Buffer; readonly attested_slot: bigint; readonly bump: number; }
export interface VerifierStakeView { readonly economic_policy: PublicKey; readonly verifier: PublicKey; readonly stake_vault: PublicKey; readonly payment_mint: PublicKey; readonly rent_recipient: PublicKey; readonly amount: bigint; readonly slash_lock_until_slot: bigint; readonly withdrawal_requested_slot: bigint | null; readonly withdrawal_available_slot: bigint | null; readonly total_slashed: bigint; readonly status: StakeStatus; readonly bump: number; }
export interface VerifierEpochEconomicsView { readonly verifier_epoch: PublicKey; readonly economic_policy: PublicKey; readonly verifier_registry: PublicKey; readonly activated_at_slot: bigint; readonly bump: number; }
export interface RoundEconomicStateView { readonly verification_round: PublicKey; readonly proposal_escrow: PublicKey; readonly verifier_epoch_economics: PublicKey; readonly status: RoundEconomicStatus; readonly fee_claim_deadline_slot: bigint; readonly slash_claim_deadline_slot: bigint; readonly opened_at_slot: bigint; readonly closed_at_slot: bigint | null; readonly bump: number; }
export interface VerifierFeeClaimView { readonly verification_round: PublicKey; readonly verifier: PublicKey; readonly attestation: PublicKey; readonly proposal_escrow: PublicKey; readonly amount: bigint; readonly claimed_at_slot: bigint; readonly bump: number; }
export interface EconomicPolicyView { readonly economic_policy_registry: PublicKey; readonly safety_policy: PublicKey; readonly governance: PublicKey; readonly payment_mint: PublicKey; readonly token_program: PublicKey; readonly config_id: bigint; readonly payment_mint_decimals: number; readonly bounty_amount: bigint; readonly challenger_bond_amount: bigint; readonly verifier_fee_amount: bigint; readonly minimum_verifier_stake: bigint; readonly verifier_non_reveal_slash_amount: bigint; readonly max_bonded_challenges: number; readonly fee_claim_grace_slots: bigint; readonly slash_claim_grace_slots: bigint; readonly stake_withdraw_cooldown_slots: bigint; readonly created_at_slot: bigint; readonly bump: number; }

function gateAccount<T>(name: string, account: EncodedAccount, expectedAddress?: PublicKeyInput): Readonly<T> {
  return decodeAccount(gateIdl, name, account, expectedAddress) as unknown as Readonly<T>;
}
export const decodeVerifierRegistry = (account: EncodedAccount, address?: PublicKeyInput) => gateAccount<VerifierRegistryView>("VerifierRegistry", account, address);
export const decodeGuardConfig = (account: EncodedAccount, address?: PublicKeyInput) => gateAccount<GuardConfigView>("GuardConfig", account, address);
export const decodeBufferClaim = (account: EncodedAccount, address?: PublicKeyInput) => gateAccount<BufferClaimView>("BufferClaim", account, address);
export const decodeSafetyPolicy = (account: EncodedAccount, address?: PublicKeyInput) => gateAccount<SafetyPolicyView>("SafetyPolicy", account, address);
export const decodeUpgradeProposal = (account: EncodedAccount, address?: PublicKeyInput) => gateAccount<UpgradeProposalView>("UpgradeProposal", account, address);
export const decodeInvariantDefinition = (account: EncodedAccount, address?: PublicKeyInput) => gateAccount<InvariantDefinitionView>("InvariantDefinition", account, address);
export const decodeChallengeCommit = (account: EncodedAccount, address?: PublicKeyInput) => gateAccount<ChallengeCommitView>("ChallengeCommit", account, address);
export const decodeTraceClaim = (account: EncodedAccount, address?: PublicKeyInput) => gateAccount<TraceClaimView>("TraceClaim", account, address);
export const decodeVerifierEpoch = (account: EncodedAccount, address?: PublicKeyInput) => gateAccount<VerifierEpochView>("VerifierEpoch", account, address);
export const decodeProposalVerificationGate = (account: EncodedAccount, address?: PublicKeyInput) => gateAccount<ProposalVerificationGateView>("ProposalVerificationGate", account, address);
export const decodeVerificationRound = (account: EncodedAccount, address?: PublicKeyInput) => gateAccount<VerificationRoundView>("VerificationRound", account, address);
export const decodeReplayResult = (account: EncodedAccount, address?: PublicKeyInput) => gateAccount<ReplayResultView>("ReplayResult", account, address);
export const decodeVerifierAttestation = (account: EncodedAccount, address?: PublicKeyInput) => gateAccount<VerifierAttestationView>("VerifierAttestation", account, address);
export const decodeVerifierStake = (account: EncodedAccount, address?: PublicKeyInput) => gateAccount<VerifierStakeView>("VerifierStake", account, address);
export const decodeVerifierEpochEconomics = (account: EncodedAccount, address?: PublicKeyInput) => gateAccount<VerifierEpochEconomicsView>("VerifierEpochEconomics", account, address);
export const decodeRoundEconomicState = (account: EncodedAccount, address?: PublicKeyInput) => gateAccount<RoundEconomicStateView>("RoundEconomicState", account, address);
export const decodeVerifierFeeClaim = (account: EncodedAccount, address?: PublicKeyInput) => gateAccount<VerifierFeeClaimView>("VerifierFeeClaim", account, address);
export const decodeEconomicPolicy = (account: EncodedAccount, address?: PublicKeyInput) => gateAccount<EconomicPolicyView>("EconomicPolicy", account, address);
