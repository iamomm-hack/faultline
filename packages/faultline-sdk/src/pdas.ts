import { PublicKey } from "@solana/web3.js";
import { FAULTLINE_GATE_PROGRAM_ID, FAULTLINE_TREASURY_PROGRAM_ID } from "./constants.js";
import { hash32, publicKey, type PublicKeyInput, u64le } from "./validation.js";

const seed = (value: string): Buffer => Buffer.from(value, "ascii");
const derive = (seeds: readonly Uint8Array[], programId: PublicKey): readonly [PublicKey, number] =>
  PublicKey.findProgramAddressSync(seeds.map(Buffer.from), programId);
const keyBytes = (value: PublicKeyInput, label: string): Buffer => publicKey(value, label).toBuffer();

export const deriveGuard = (target: PublicKeyInput) =>
  derive([seed("faultline"), seed("guard"), keyBytes(target, "target program")], FAULTLINE_GATE_PROGRAM_ID);
export const deriveBufferClaim = (buffer: PublicKeyInput) =>
  derive([seed("faultline"), seed("buffer"), keyBytes(buffer, "candidate buffer")], FAULTLINE_GATE_PROGRAM_ID);
export const deriveSafetyPolicy = (target: PublicKeyInput) =>
  derive([seed("safety-policy"), keyBytes(target, "target program")], FAULTLINE_GATE_PROGRAM_ID);
export const deriveUpgradeProposal = (policy: PublicKeyInput, id: bigint) =>
  derive([seed("upgrade-proposal"), keyBytes(policy, "policy"), u64le(id, "proposal id")], FAULTLINE_GATE_PROGRAM_ID);
export const deriveInvariantDefinition = (policy: PublicKeyInput, id: bigint) =>
  derive([seed("invariant"), keyBytes(policy, "policy"), u64le(id, "invariant id")], FAULTLINE_GATE_PROGRAM_ID);
export const deriveChallengeCommit = (
  proposal: PublicKeyInput,
  hunter: PublicKeyInput,
  commitmentHash: Uint8Array
) => derive([
  seed("challenge-commit"), keyBytes(proposal, "proposal"), keyBytes(hunter, "hunter"),
  hash32(commitmentHash, "commitment hash")
], FAULTLINE_GATE_PROGRAM_ID);
export const deriveTraceClaim = (proposal: PublicKeyInput, traceHash: Uint8Array) =>
  derive([seed("trace-claim"), keyBytes(proposal, "proposal"), hash32(traceHash, "trace hash")], FAULTLINE_GATE_PROGRAM_ID);
export const deriveVerifierRegistry = (policy: PublicKeyInput) =>
  derive([seed("verifier-registry"), keyBytes(policy, "policy")], FAULTLINE_GATE_PROGRAM_ID);
export const deriveVerifierEpoch = (registry: PublicKeyInput, epochId: bigint) =>
  derive([seed("verifier-epoch"), keyBytes(registry, "verifier registry"), u64le(epochId, "epoch id")], FAULTLINE_GATE_PROGRAM_ID);
export const deriveProposalVerificationGate = (proposal: PublicKeyInput) =>
  derive([seed("proposal-verification-gate"), keyBytes(proposal, "proposal")], FAULTLINE_GATE_PROGRAM_ID);
export const deriveVerificationRound = (traceClaim: PublicKeyInput) =>
  derive([seed("verification-round"), keyBytes(traceClaim, "trace claim")], FAULTLINE_GATE_PROGRAM_ID);
export const deriveReplayResult = (round: PublicKeyInput, resultHash: Uint8Array) =>
  derive([seed("replay-result"), keyBytes(round, "verification round"), hash32(resultHash, "result hash")], FAULTLINE_GATE_PROGRAM_ID);
export const deriveVerifierAttestation = (round: PublicKeyInput, verifier: PublicKeyInput) =>
  derive([seed("verifier-attestation"), keyBytes(round, "verification round"), keyBytes(verifier, "verifier")], FAULTLINE_GATE_PROGRAM_ID);
export const deriveEconomicPolicyRegistry = (policy: PublicKeyInput) =>
  derive([seed("economic-policy-registry"), keyBytes(policy, "policy")], FAULTLINE_GATE_PROGRAM_ID);
export const deriveEconomicPolicy = (registry: PublicKeyInput, configId: bigint) =>
  derive([seed("economic-policy"), keyBytes(registry, "economic registry"), u64le(configId, "config id")], FAULTLINE_GATE_PROGRAM_ID);
export const deriveProposalEscrow = (proposal: PublicKeyInput) =>
  derive([seed("proposal-escrow"), keyBytes(proposal, "proposal")], FAULTLINE_GATE_PROGRAM_ID);
export const deriveBountyVault = (proposal: PublicKeyInput) =>
  derive([seed("bounty-vault"), keyBytes(proposal, "proposal")], FAULTLINE_GATE_PROGRAM_ID);
export const deriveFeeVault = (proposal: PublicKeyInput) =>
  derive([seed("fee-vault"), keyBytes(proposal, "proposal")], FAULTLINE_GATE_PROGRAM_ID);
export const derivePenaltyVault = (proposal: PublicKeyInput) =>
  derive([seed("penalty-vault"), keyBytes(proposal, "proposal")], FAULTLINE_GATE_PROGRAM_ID);
export const deriveChallengeBond = (challengeCommit: PublicKeyInput) =>
  derive([seed("challenge-bond"), keyBytes(challengeCommit, "challenge commit")], FAULTLINE_GATE_PROGRAM_ID);
export const deriveBondVault = (challengeCommit: PublicKeyInput) =>
  derive([seed("bond-vault"), keyBytes(challengeCommit, "challenge commit")], FAULTLINE_GATE_PROGRAM_ID);
export const deriveVerifierStake = (economicPolicy: PublicKeyInput, verifier: PublicKeyInput) =>
  derive([seed("verifier-stake"), keyBytes(economicPolicy, "economic policy"), keyBytes(verifier, "verifier")], FAULTLINE_GATE_PROGRAM_ID);
export const deriveStakeVault = (economicPolicy: PublicKeyInput, verifier: PublicKeyInput) =>
  derive([seed("stake-vault"), keyBytes(economicPolicy, "economic policy"), keyBytes(verifier, "verifier")], FAULTLINE_GATE_PROGRAM_ID);
export const deriveVerifierEpochEconomics = (epoch: PublicKeyInput, economicPolicy: PublicKeyInput) =>
  derive([seed("verifier-epoch-economics"), keyBytes(epoch, "verifier epoch"), keyBytes(economicPolicy, "economic policy")], FAULTLINE_GATE_PROGRAM_ID);
export const deriveRoundEconomicState = (round: PublicKeyInput) =>
  derive([seed("round-economics"), keyBytes(round, "verification round")], FAULTLINE_GATE_PROGRAM_ID);
export const deriveVerifierFeeClaim = (round: PublicKeyInput, verifier: PublicKeyInput) =>
  derive([seed("verifier-fee-claim"), keyBytes(round, "verification round"), keyBytes(verifier, "verifier")], FAULTLINE_GATE_PROGRAM_ID);
export const deriveVerifierSlashReceipt = (round: PublicKeyInput, verifier: PublicKeyInput) =>
  derive([seed("verifier-slash"), keyBytes(round, "verification round"), keyBytes(verifier, "verifier")], FAULTLINE_GATE_PROGRAM_ID);
export const deriveTreasuryState = () => derive([seed("treasury")], FAULTLINE_TREASURY_PROGRAM_ID);
export const deriveTreasuryVersion = () => derive([seed("version")], FAULTLINE_TREASURY_PROGRAM_ID);
