import { FAULTLINE_GATE_IDL, FAULTLINE_TREASURY_IDL } from "@faultline/idl";
import { buildIdlInstruction, type BuiltInstruction } from "./idl.js";
import type { PublicKeyInput } from "./validation.js";
import { FAULTLINE_GATE_PROGRAM_ID, FAULTLINE_TREASURY_PROGRAM_ID } from "./constants.js";

const gateIdl = FAULTLINE_GATE_IDL as unknown as import("./idl.js").FaultlineIdl;
const treasuryIdl = FAULTLINE_TREASURY_IDL as unknown as import("./idl.js").FaultlineIdl;

export type InstructionAccounts = Readonly<Record<string, PublicKeyInput>>;
export type InstructionArguments = Readonly<Record<string, unknown>>;

export function buildGateInstruction(name: string, accounts: InstructionAccounts, args: InstructionArguments = {}): BuiltInstruction {
  return buildIdlInstruction({ idl: gateIdl, programId: FAULTLINE_GATE_PROGRAM_ID, name, accounts, args });
}

export function buildTreasuryInstruction(name: string, accounts: InstructionAccounts, args: InstructionArguments = {}): BuiltInstruction {
  return buildIdlInstruction({ idl: treasuryIdl, programId: FAULTLINE_TREASURY_PROGRAM_ID, name, accounts, args });
}

function gateBuilder(name: string) {
  return (accounts: InstructionAccounts, args: InstructionArguments = {}): BuiltInstruction =>
    buildGateInstruction(name, accounts, args);
}

export const buildCreateVerifierEpochInstruction = gateBuilder("create_verifier_epoch");
export const buildActivateVerifierEpochInstruction = gateBuilder("activate_verifier_epoch");
export const buildInitializeVerifierStakeInstruction = gateBuilder("initialize_verifier_stake");
export const buildActivateVerifierEpochEconomicsInstruction = gateBuilder("activate_verifier_epoch_economics");
export const buildOpenEconomicVerificationRoundInstruction = gateBuilder("open_economic_verification_round");
export const buildCreateReplayResultInstruction = gateBuilder("create_replay_result");
export const buildSubmitVerifierAttestationInstruction = gateBuilder("submit_verifier_attestation");
export const buildFinalizeReplayResultInstruction = gateBuilder("finalize_replay_result");
export const buildCloseFinalizedRoundEconomicsInstruction = gateBuilder("close_finalized_round_economics");
export const buildSettleAcceptedChallengeInstruction = gateBuilder("settle_accepted_challenge");
export const buildSettleHoldChallengeInstruction = gateBuilder("settle_hold_challenge");
export const buildClaimVerifierFeeInstruction = gateBuilder("claim_verifier_fee");
export const buildRefundProposalEscrowInstruction = gateBuilder("refund_proposal_escrow");
export const buildRecordTemporaryDecisionInstruction = gateBuilder("record_temporary_decision");
export const buildExecuteGuardedUpgradeInstruction = gateBuilder("execute_guarded_upgrade");
