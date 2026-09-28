import vectors from '../../../manifests/checkpoint-1-vectors.json';
export type Candidate = 'v2' | 'v3';
export type Status =
  | 'Pending'
  | 'VIOLATION'
  | 'HOLD'
  | 'Approved'
  | 'Executed'
  | 'Expired'
  | 'Rejected';
export interface ProposalRecord {
  id: string;
  candidate: string;
  status: Status;
  target: string;
  buffer?: string;
  payload: string;
  round?: string;
  epoch?: string;
  receipt?: string;
  commitment?: string;
  invariant?: string;
  trace?: string;
  guard?: string;
  programData?: string;
  workers: { id: string; identity?: string; output: string }[];
  attestations: number;
  settlement: string;
  eligibility: string;
  signatures: string[];
  timeline: string[];
  source: 'demo' | 'rpc';
}
export const evidence = vectors;
export const demoSteps = [
  'Bind candidate',
  'Replay worker 01',
  'Replay worker 02',
  'Replay worker 03',
  'Submit three attestations',
  'Finalize result',
  'Settle economics',
  'Separate governance approval',
  'Complete eligibility delay',
  'Execute through Guard',
];
export interface DemoRun {
  candidate: Candidate;
  step: number;
  divergent: boolean;
}
export const newRun = (candidate: Candidate = 'v2'): DemoRun => ({
  candidate,
  step: 0,
  divergent: false,
});
export function advanceRun(run: DemoRun): DemoRun {
  if (run.divergent && run.step >= 4)
    throw new Error(
      'RESULT_MISMATCH: worker 03 did not agree. Attestation submission is blocked. Reset to replay.',
    );
  if (run.step >= (run.candidate === 'v2' ? 7 : 10))
    throw new Error('TERMINAL_STATE: reset to run this candidate again.');
  return { ...run, step: run.step + 1 };
}
export function recordFor(run: DemoRun): ProposalRecord {
  const v = run.candidate === 'v2' ? 0 : 1;
  const job = vectors.replay_jobs[v];
  const status: Status =
    run.step >= 10
      ? 'Executed'
      : run.step >= 8
        ? 'Approved'
        : run.step >= 6
          ? v === 0
            ? 'Rejected'
            : 'HOLD'
          : 'Pending';
  return {
    id: `proposal-${run.candidate}`,
    candidate: run.candidate,
    status,
    target: job.target_program_id,
    payload: job.candidate_executable_sha256,
    round: job.verification_round,
    invariant: job.invariant_account,
    trace: job.trace_claim,
    receipt:
      run.step >= 4
        ? vectors.unsigned_worker_outputs[v].receipt_hash
        : undefined,
    commitment:
      run.step >= 4
        ? vectors.unsigned_worker_outputs[v].replay_result_commitment
        : undefined,
    workers: [0, 1, 2].map((i) => ({
      id: `Worker 0${i + 1}`,
      identity:
        i === 0
          ? vectors.unsigned_worker_outputs[v].verifier_pubkey
          : undefined,
      output:
        run.step < i + 2
          ? 'Pending'
          : run.divergent && i === 2
            ? 'Runner fault'
            : v === 0
              ? 'Violation'
              : 'Preserved',
    })),
    attestations: run.step >= 5 ? 3 : 0,
    settlement:
      run.step < 7
        ? 'Not settled'
        : v === 0
          ? 'Bounty + bond return + three verifier fees (simulated)'
          : 'HOLD settlement + three verifier fees (simulated)',
    eligibility:
      status === 'Rejected'
        ? 'Permanently blocked'
        : status === 'HOLD'
          ? 'Blocked · HOLD is not approval'
          : status === 'Executed'
            ? 'Executed · demo simulation'
            : status === 'Approved'
              ? run.step >= 9
                ? 'Eligible · demo simulation'
                : 'Waiting for simulated eligibility delay'
              : 'Blocked · evidence incomplete',
    signatures: [],
    timeline: demoSteps
      .slice(0, run.step)
      .map((title, i) =>
        i === 5
          ? v === 0
            ? 'VIOLATION finalized · proposal rejected'
            : 'HOLD finalized · no approval'
          : title,
      ),
    source: 'demo',
  };
}
export const demoExamples = (): ProposalRecord[] => [
  recordFor({ ...newRun('v2'), step: 7 }),
  recordFor({ ...newRun('v3'), step: 7 }),
];
