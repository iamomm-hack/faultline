import type { ActionErrorCode, ActionResult, CommitChallengeInput, CreateProposalInput, DemoSnapshot, ProposalDetail, ProposalSummary, TokenAmount } from "./types";
export interface FaultlineClient {
  listProposals(): Promise<ProposalSummary[]>; getProposal(proposalId: string): Promise<ProposalDetail>;
  createProposal(input: CreateProposalInput): Promise<ActionResult>; fundProposal(proposalId: string, amount: TokenAmount): Promise<ActionResult>;
  openChallengeWindow(proposalId: string): Promise<ActionResult>; commitChallenge(input: CommitChallengeInput): Promise<ActionResult>;
  revealChallenge(challengeId: string): Promise<ActionResult>; runVerifierReplay(assignmentId: string): Promise<ActionResult>;
  resolveProposal(proposalId: string): Promise<ActionResult>; executeUpgrade(proposalId: string): Promise<ActionResult>; resetDemo(): Promise<void>;
  getSnapshot(): DemoSnapshot; advanceDemo(): Promise<ActionResult>; subscribe(listener: () => void): () => void; setNextError(code: ActionErrorCode | null): void;
}
