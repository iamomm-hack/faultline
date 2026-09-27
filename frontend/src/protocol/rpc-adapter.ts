import { Buffer } from 'buffer';
import { FAULTLINE_GATE_IDL } from '@faultline/idl';
import {
  FAULTLINE_GATE_PROGRAM_ID,
  decodeUpgradeProposal,
  decodeVerificationRound,
  decodeReplayResult,
  decodeVerifierEpoch,
  decodeVerifierAttestation,
  decodeRoundEconomicState,
  deriveGuard,
  assertRpcGenesis,
  validateRpcBoundary,
  decodeProtocolError,
  type EncodedAccount,
} from '@faultline/sdk';
import type { ProposalRecord, Status } from './model';
interface RpcAccount {
  pubkey: string;
  account: { owner: string; data: [string, string] };
}
export async function readProtocol(config?: {
  endpoint: string;
  genesisHash: string;
}): Promise<ProposalRecord[]> {
  const endpoint =
      config?.endpoint ??
      (import.meta.env.VITE_FAULTLINE_RPC_URL as string | undefined),
    genesis =
      config?.genesisHash ??
      (import.meta.env.VITE_FAULTLINE_GENESIS_HASH as string | undefined);
  if (!endpoint || !genesis)
    throw new Error(
      'RPC_NOT_CONFIGURED: set VITE_FAULTLINE_RPC_URL and VITE_FAULTLINE_GENESIS_HASH. No chain data has been loaded.',
    );
  const boundary = validateRpcBoundary({
    endpoint,
    genesisHash: genesis,
    commitment: 'confirmed',
    timeoutMilliseconds: 10000,
  });
  let counter = 0;
  const call = async <T>(
    method: string,
    params: unknown[] = [],
  ): Promise<T> => {
    const id = ++counter;
    let response: Response;
    try {
      response = await fetch(boundary.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal: AbortSignal.timeout(boundary.timeoutMilliseconds),
      });
    } catch {
      throw new Error(
        `RPC_TRANSPORT: ${method} failed or timed out. Check endpoint availability and browser CORS access.`,
      );
    }
    if (!response.ok)
      throw new Error(`RPC_HTTP_${response.status}: ${method} failed.`);
    const json = await response.json();
    if (json.id !== id || json.jsonrpc !== '2.0')
      throw new Error('RPC_RESPONSE_INVALID: response identity mismatch');
    if (json.error) {
      const decoded = decodeProtocolError('faultline_gate', json.error.code);
      throw new Error(
        decoded
          ? `${decoded.name}: ${decoded.message}`
          : `RPC_ERROR_${json.error.code}: ${String(json.error.message).slice(0, 220)}`,
      );
    }
    return json.result as T;
  };
  assertRpcGenesis(boundary, await call<string>('getGenesisHash'));
  const accounts = await call<RpcAccount[]>('getProgramAccounts', [
    FAULTLINE_GATE_PROGRAM_ID.toBase58(),
    { encoding: 'base64', commitment: 'confirmed' },
  ]);
  if (!Array.isArray(accounts))
    throw new Error('RPC_DECODE: program account response is not a list');
  const named = accounts.map((a) => {
    if (a.account?.owner !== FAULTLINE_GATE_PROGRAM_ID.toBase58())
      throw new Error(
        'RPC_DECODE: account owner does not match the committed Gate program',
      );
    if (
      !a.account ||
      !Array.isArray(a.account.data) ||
      a.account.data[1] !== 'base64'
    )
      throw new Error('RPC_DECODE: expected base64 account data');
    const encoded: EncodedAccount = {
      address: a.pubkey,
      owner: a.account.owner,
      data: Buffer.from(a.account.data[0], 'base64'),
    };
    const definition = FAULTLINE_GATE_IDL.accounts.find((d) =>
      d.discriminator.every((v, i) => encoded.data[i] === v),
    );
    if (!definition)
      throw new Error(
        `RPC_DECODE: unknown account discriminator at ${a.pubkey}`,
      );
    return { name: definition.name, encoded };
  });
  const get = (name: string) =>
    named.filter((a) => a.name === name).map((a) => a.encoded);
  try {
    const rounds = get('VerificationRound').map((a) => ({
      id: String(a.address),
      data: decodeVerificationRound(a),
    }));
    const results = get('ReplayResult').map((a) => ({
      id: String(a.address),
      data: decodeReplayResult(a),
    }));
    const epochs = get('VerifierEpoch').map((a) => ({
      id: String(a.address),
      data: decodeVerifierEpoch(a),
    }));
    const attestations = get('VerifierAttestation').map((a) =>
      decodeVerifierAttestation(a),
    );
    const economics = get('RoundEconomicState').map((a) =>
      decodeRoundEconomicState(a),
    );
    return get('UpgradeProposal').map((a) => {
      const p = decodeUpgradeProposal(a),
        id = String(a.address),
        round = rounds
          .filter((r) => r.data.proposal.toBase58() === id)
          .sort((a, b) =>
            a.data.opened_slot > b.data.opened_slot
              ? -1
              : a.data.opened_slot < b.data.opened_slot
                ? 1
                : 0,
          )[0],
        result = results.find(
          (r) =>
            r.id === round?.data.winning_replay_result?.toBase58() &&
            r.data.verification_round.toBase58() === round?.id,
        )?.data,
        epoch = epochs.find(
          (e) => e.id === round?.data.verifier_epoch.toBase58(),
        ),
        votes = attestations.filter(
          (v) => v.verification_round.toBase58() === round?.id,
        ),
        economic = economics.find(
          (e) => e.verification_round.toBase58() === round?.id,
        );
      const state = p.state.kind;
      const status: Status =
        state === 'Approved' ||
        state === 'Rejected' ||
        state === 'Executed' ||
        state === 'Expired'
          ? state
          : round?.data.status.kind === 'InvariantViolated'
            ? 'VIOLATION'
            : round?.data.status.kind === 'InvariantHolds'
              ? 'HOLD'
              : 'Pending';
      return {
        id,
        candidate: `#${p.proposal_id}`,
        status,
        target: p.target_program.toBase58(),
        buffer: p.candidate_buffer.toBase58(),
        payload: p.candidate_buffer_hash.toString('hex'),
        programData: p.program_data.toBase58(),
        guard: deriveGuard(p.target_program)[0].toBase58(),
        round: round?.id,
        epoch: round?.data.verifier_epoch.toBase58(),
        receipt: result?.replay_receipt_hash.toString('hex'),
        commitment: result?.result_hash.toString('hex'),
        invariant: round?.data.invariant.toBase58(),
        trace: round?.data.trace_claim.toBase58(),
        workers: (epoch?.data.verifiers ?? []).map((key, i) => ({
          id: `Verifier ${i + 1}`,
          identity: key.toBase58(),
          output: votes.some((v) => v.verifier.equals(key))
            ? 'Attested'
            : 'No attestation',
        })),
        attestations: result?.vote_count ?? 0,
        settlement: economic?.status.kind ?? 'Economic account not available',
        eligibility:
          status === 'Approved'
            ? 'Approved; execution eligibility requires full on-chain preflight'
            : status === 'Executed'
              ? 'Executed on configured chain'
              : 'Execution not approved',
        signatures: [],
        timeline: [
          `Created at slot ${p.created_at_slot}`,
          ...(round ? [`Round opened at slot ${round.data.opened_slot}`] : []),
          ...(p.decision_slot
            ? [`Decision at slot ${p.decision_slot}: ${state}`]
            : []),
          ...(p.executed_at_slot
            ? [`Executed at slot ${p.executed_at_slot}`]
            : []),
        ],
        source: 'rpc',
      };
    });
  } catch (e) {
    throw new Error(
      `RPC_DECODE: ${e instanceof Error ? e.message : 'account failed SDK validation'}`,
    );
  }
}
