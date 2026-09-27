import { afterEach, describe, expect, it, vi } from 'vitest';
import { advanceRun, newRun, recordFor, evidence } from '../src/protocol/model';
import { readProtocol } from '../src/protocol/rpc-adapter';
import {
  replayResultCommitment,
  deriveGuard,
  buildCreateReplayResultInstruction,
  deriveReplayResult,
  FAULTLINE_GATE_PROGRAM_ID,
} from '@faultline/sdk';
import { FAULTLINE_GATE_IDL } from '@faultline/idl';
import { Buffer } from 'buffer';

const runTo = (candidate: 'v2' | 'v3', steps: number) => {
  let state = newRun(candidate);
  for (let i = 0; i < steps; i++) state = advanceRun(state);
  return state;
};
afterEach(() => vi.unstubAllGlobals());
describe('demo authority boundary', () => {
  it('requires all three local workers before attestation and makes rejection terminal', () => {
    expect(
      recordFor(runTo('v2', 4)).workers.every((w) => w.output === 'Violation'),
    ).toBe(true);
    expect(recordFor(runTo('v2', 4)).attestations).toBe(0);
    expect(recordFor(runTo('v2', 5)).attestations).toBe(3);
    expect(recordFor(runTo('v2', 6)).status).toBe('Rejected');
    expect(() => advanceRun(runTo('v2', 7))).toThrow('TERMINAL_STATE');
  });
  it('keeps HOLD separate from governance approval, delay and execution', () => {
    expect(recordFor(runTo('v3', 6)).status).toBe('HOLD');
    expect(recordFor(runTo('v3', 7)).status).toBe('HOLD');
    expect(recordFor(runTo('v3', 8)).eligibility).toContain('Waiting');
    expect(recordFor(runTo('v3', 9)).eligibility).toContain('Eligible');
    expect(recordFor(runTo('v3', 10)).status).toBe('Executed');
  });
  it('never accepts disagreement or infrastructure failure as consensus', () => {
    expect(() => advanceRun({ ...runTo('v3', 4), divergent: true })).toThrow(
      'RESULT_MISMATCH',
    );
  });
  it('uses committed hashes without inventing keys or transaction receipts', () => {
    const p = recordFor(runTo('v2', 7));
    expect(p.payload).toBe(evidence.replay_jobs[0].candidate_executable_sha256);
    expect(p.commitment).toBe(
      evidence.unsigned_worker_outputs[0].replay_result_commitment,
    );
    expect(p.signatures).toEqual([]);
    expect(p.buffer).toBeUndefined();
    expect(p.workers.filter((w) => w.identity)).toHaveLength(1);
  });
});
describe('committed SDK browser boundary', () => {
  it('reproduces both canonical HOLD vector commitments using the SDK and browser SHA-256', () => {
    for (const [i, job] of evidence.replay_jobs.entries()) {
      const output = evidence.unsigned_worker_outputs[i];
      const result = replayResultCommitment({
        proposal: job.proposal,
        invariant: job.invariant_account,
        traceClaim: job.trace_claim,
        candidateBufferHash: Buffer.from(job.candidate_buffer_hash, 'hex'),
        invariantSpecificationHash: Buffer.from(
          job.invariant_specification_hash,
          'hex',
        ),
        verdict: 0,
        replayReceiptHash: Buffer.from(output.receipt_hash, 'hex'),
      });
      expect(result.toString('hex')).toBe(output.replay_result_commitment);
    }
  });
  it('derives addresses and builds an unsigned replay instruction from the committed IDL', () => {
    const job = evidence.replay_jobs[0],
      output = evidence.unsigned_worker_outputs[0];
    const hash = Buffer.from(output.replay_result_commitment, 'hex');
    const address = deriveReplayResult(job.verification_round, hash)[0];
    const instruction = buildCreateReplayResultInstruction(
      {
        payer: output.verifier_pubkey,
        verification_round: job.verification_round,
        replay_result: address,
        system_program: '11111111111111111111111111111111',
      },
      {
        result_hash: hash,
        verdict: { kind: 'InvariantHolds' },
        replay_receipt_hash: Buffer.from(output.receipt_hash, 'hex'),
      },
    );
    expect(instruction.programId.equals(FAULTLINE_GATE_PROGRAM_ID)).toBe(true);
    expect(instruction.bindingSummary.instructionName).toBe(
      'create_replay_result',
    );
    expect(deriveGuard(job.target_program_id)[0].toBase58()).toMatch(
      /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
    );
  });
});
describe('read-only RPC boundary', () => {
  const config = {
    endpoint: 'https://rpc.example.invalid',
    genesisHash: evidence.replay_jobs[0].target_program_id,
  };
  const mock = (results: unknown[]) =>
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_url: unknown, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: results.shift(),
          }),
        );
      }),
    );
  it('fails explicitly when not configured', async () => {
    await expect(readProtocol()).rejects.toThrow('RPC_NOT_CONFIGURED');
  });
  it('fails on transport and never returns demo data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(readProtocol(config)).rejects.toThrow('RPC_TRANSPORT');
  });
  it('rejects a different chain before reading program accounts', async () => {
    mock(['different-chain']);
    await expect(readProtocol(config)).rejects.toThrow('genesis hash');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('represents a genuinely empty configured chain as an empty list', async () => {
    mock([config.genesisHash, []]);
    await expect(readProtocol(config)).resolves.toEqual([]);
  });
  it('reports malformed SDK account data instead of swallowing decode failures', async () => {
    const discriminator = FAULTLINE_GATE_IDL.accounts.find(
      (a) => a.name === 'UpgradeProposal',
    )!.discriminator;
    mock([
      config.genesisHash,
      [
        {
          pubkey: config.genesisHash,
          account: {
            owner: FAULTLINE_GATE_PROGRAM_ID.toBase58(),
            data: [Buffer.from(discriminator).toString('base64'), 'base64'],
          },
        },
      ],
    ]);
    await expect(readProtocol(config)).rejects.toThrow('RPC_DECODE');
  });
});
