export type ProposalState =
  | "draft"
  | "funded"
  | "challenging"
  | "verifying"
  | "approved"
  | "rejected"
  | "executed"
  | "cancelled"
  | "expired"
  | "emergency_bypassed";

export type ChallengeState =
  | "committed"
  | "revealed"
  | "assigned"
  | "accepted"
  | "rejected"
  | "non_reveal"
  | "expired";

export type VerifierVerdict =
  | "pending"
  | "reproduced"
  | "preserved"
  | "invalid_evidence"
  | "unsupported_environment"
  | "runner_fault";

export type InvariantStatus = "untested" | "testing" | "preserved" | "violated" | "inconclusive";

export interface TokenAmount { baseUnits: string; decimals: number; symbol: string }
export interface ArtifactCommitment { label: string; hash: string }
export interface Policy { id: string; version: string; quorum: { required: number; total: number }; challengeDurationSeconds: number; challengerBond: TokenAmount }
export interface Invariant { id: string; title: string; statement: string; status: InvariantStatus; evaluator: string }
export interface VerifierResult { workerId: string; verdict: VerifierVerdict; resultHash?: string; durationMs?: number }
export interface ReplayAssignment { id: string; challengeId: string; results: VerifierResult[] }
export interface Challenge { id: string; proposalId: string; state: ChallengeState; hunter: string; commitmentHash: string; evidenceHash?: string; invariantId: string; trace: string[] }
export interface Settlement { id: string; recipient: string; amount: TokenAmount; kind: "bounty" | "refund"; status: "settled" }
export interface ActivityEvent { id: string; at: number; title: string; detail: string; tone: "neutral" | "info" | "warning" | "danger" | "success" }
export interface ProposalSummary { id: string; candidateVersion: string; state: ProposalState; bounty: TokenAmount; deadline?: number }
export interface ProposalDetail extends ProposalSummary {
  currentVersion: string; targetProgram: string; guardPda: string; candidateBuffer: string;
  sourceCommit: string; artifacts: ArtifactCommitment[]; policy: Policy; invariants: Invariant[];
  challenge?: Challenge; assignment?: ReplayAssignment; settlement?: Settlement;
}
export interface CreateProposalInput { candidateVersion: string; candidateBuffer: string; sourceCommit: string; executableHash: string; buildManifestHash: string; fixtureManifestHash: string; runnerManifestHash: string; invariantBundleId: string; bounty: TokenAmount; challengeDurationSeconds: number }
export interface CommitChallengeInput { proposalId: string; invariantId: string; commitmentHash: string }
export type ActionErrorCode = "INSUFFICIENT_BOUNTY" | "CHALLENGE_WINDOW_CLOSED" | "EVIDENCE_COMMITMENT_MISMATCH" | "VERIFIER_TIMEOUT" | "UPGRADE_REJECTED" | "EXECUTION_NOT_APPROVED" | "CANDIDATE_ARTIFACT_MISMATCH" | "INVALID_TRANSITION" | "ALREADY_EXECUTED";
export type ActionResult = { ok: true; actionId: string; message: string } | { ok: false; code: ActionErrorCode; message: string };
export interface DemoSnapshot { step: number; stepTitle: string; stepDescription: string; deployedVersion: string; deployedHash: string; treasuryBalance: TokenAmount; hunterBalance: TokenAmount; proposals: ProposalDetail[]; activeProposalId?: string; events: ActivityEvent[]; complete: boolean }
