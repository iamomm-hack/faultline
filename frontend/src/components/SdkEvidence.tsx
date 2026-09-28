import { useState } from 'react';
import { evidence } from '../protocol/model';
import { CopyValue } from '../pages/Landing';
export function SdkEvidence({ candidate }: { candidate: string }) {
  const [result, setResult] = useState<{
    hash: string;
    bytes: number;
    address: string;
  } | null>(null);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const inspect = async () => {
    setBusy(true);
    setError('');
    try {
      const sdk = await import('@faultline/sdk');
      const { Buffer } = await import('buffer');
      const i = candidate === 'v3' ? 1 : 0,
        job = evidence.replay_jobs[i],
        output = evidence.unsigned_worker_outputs[i];
      const hash = sdk.replayResultCommitment({
        proposal: job.proposal,
        invariant: job.invariant_account,
        traceClaim: job.trace_claim,
        candidateBufferHash: Buffer.from(job.candidate_buffer_hash, 'hex'),
        invariantSpecificationHash: Buffer.from(
          job.invariant_specification_hash,
          'hex',
        ),
        verdict: sdk.ReplayVerdict.InvariantHolds,
        replayReceiptHash: Buffer.from(output.receipt_hash, 'hex'),
      });
      if (hash.toString('hex') !== output.replay_result_commitment)
        throw new Error('Committed vector parity mismatch');
      const address = sdk.deriveReplayResult(job.verification_round, hash)[0];
      const instruction = sdk.buildCreateReplayResultInstruction(
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
      setResult({
        hash: hash.toString('hex'),
        bytes: instruction.data.byteLength,
        address: address.toBase58(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'SDK inspection failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="product-panel">
      <span className="mono">SDK / FORMAT-VECTOR INSPECTION</span>
      <p>
        Recompute the original HOLD commitment and construct its unsigned
        create_replay_result instruction from the committed IDL.
      </p>
      <button className="button" disabled={busy} onClick={() => void inspect()}>
        {busy ? 'Checking SDK bindings…' : 'Inspect with SDK'}
      </button>
      {result && (
        <div className="sdk-result" role="status">
          <p>
            Commitment matches the committed vector. Unsigned instruction:{' '}
            {result.bytes} bytes. No transaction sent.
          </p>
          <CopyValue label="SDK replay result PDA" value={result.address} />
          <CopyValue label="SDK recomputed commitment" value={result.hash} />
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
