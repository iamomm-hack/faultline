import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
  type Commitment, type TransactionInstruction,
} from "@solana/web3.js";
import {
  decodeBufferClaim, decodeEconomicPolicy, decodeInvariantDefinition, decodeRoundEconomicState,
  decodeSafetyPolicy, decodeTraceClaim, decodeUpgradeProposal, decodeVerificationRound,
  decodeVerifierEpoch, decodeVerifierEpochEconomics, decodeVerifierRegistry, decodeVerifierStake,
  type EconomicPolicyView, type InvariantDefinitionView, type RoundEconomicStateView,
  type SafetyPolicyView, type TraceClaimView, type UpgradeProposalView,
  type VerificationRoundView, type VerifierEpochEconomicsView, type VerifierEpochView,
  type VerifierRegistryView, type VerifierStakeView,
} from "./accounts.js";
import { FAULTLINE_GATE_PROGRAM_ID, LOADER_V3_PROGRAM_ID } from "./constants.js";
import { fail } from "./errors.js";
import { buildFinalizeReplayResultInstruction, buildSubmitVerifierAttestationInstruction } from "./instructions.js";
import {
  deriveBufferClaim, deriveGuard, deriveProposalVerificationGate, deriveReplayResult,
  deriveVerifierAttestation,
} from "./pdas.js";
import { replayResultCommitment } from "./replay.js";
import { validateAttestationIntent, validateSignedWorkerOutput, type AttestationIntent, type SignedWorkerOutput } from "./replay-schemas.js";
import { assertRpcGenesis, validateRpcBoundary, type RpcBoundary } from "./rpc.js";
import { exactObject, publicKey } from "./validation.js";

const PLAN_KEYS = ["schema", "canonicalization", "gate_program_id", "expected_genesis_hash", "verification_round", "verifier_epoch", "replay_job_hash", "replay_receipt_hash", "result_hash", "verdict_u8", "signed_worker_outputs", "attestation_intents"] as const;
const WORKER_DOMAIN = Buffer.from("FAULTLINE_WORKER_OUTPUT_V1", "ascii");
const JOB_DOMAIN = Buffer.from("FAULTLINE_REPLAY_JOB_V1", "ascii");
const LOADER_BUFFER_METADATA_SIZE = 37;

export interface LockedLoaderV3Buffer {
  readonly variant: "Buffer";
  readonly authority: PublicKey;
  readonly metadataLength: 37;
  readonly payload: Buffer;
}

export function decodeLockedLoaderV3Buffer(
  account: { readonly owner: PublicKey; readonly data: Uint8Array },
  expectedAuthority: PublicKey
): LockedLoaderV3Buffer {
  if (!account.owner.equals(LOADER_V3_PROGRAM_ID)) fail("INVALID_ACCOUNT_DATA", "candidate is not owned by loader-v3");
  const data = Buffer.from(account.data);
  if (data.length < LOADER_BUFFER_METADATA_SIZE) fail("INVALID_ACCOUNT_DATA", "candidate loader-v3 Buffer metadata is truncated");
  if (data.readUInt32LE(0) !== 1) fail("INVALID_ACCOUNT_DATA", "candidate loader-v3 account is not a Buffer");
  const authorityOption = data[4];
  if (authorityOption === 0) fail("INVALID_ACCOUNT_DATA", "candidate loader-v3 Buffer is immutable and cannot be upgraded");
  if (authorityOption !== 1) fail("INVALID_ACCOUNT_DATA", "candidate loader-v3 Buffer authority option is malformed");
  const authority = new PublicKey(data.subarray(5, LOADER_BUFFER_METADATA_SIZE));
  same(authority, expectedAuthority, "buffer authority");
  return Object.freeze({
    variant: "Buffer" as const,
    authority,
    metadataLength: LOADER_BUFFER_METADATA_SIZE,
    payload: Buffer.from(data.subarray(LOADER_BUFFER_METADATA_SIZE)),
  });
}

export interface WorkerRequestBinding {
  readonly coordinator_nonce: string;
  readonly worker_ordinal: number;
  readonly expected_verifier_pubkey: string;
  readonly replay_job: Record<string, unknown>;
}
export interface AttestationPlan {
  readonly schema: "faultline.attestation-plan.v1";
  readonly canonicalization: "faultline.canonical-json.v1";
  readonly gate_program_id: string;
  readonly expected_genesis_hash: string;
  readonly verification_round: string;
  readonly verifier_epoch: string;
  readonly replay_job_hash: string;
  readonly replay_receipt_hash: string;
  readonly result_hash: string;
  readonly verdict_u8: 0 | 1;
  readonly signed_worker_outputs: readonly SignedWorkerOutput[];
  readonly attestation_intents: readonly AttestationIntent[];
}

export function canonicalJson(value: unknown): Buffer {
  const visit = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(visit);
    if (current !== null && typeof current === "object") {
      return Object.fromEntries(Object.keys(current as Record<string, unknown>).sort().map((key) => [key, visit((current as Record<string, unknown>)[key])]));
    }
    return current;
  };
  return Buffer.from(JSON.stringify(visit(value)), "utf8");
}

function canonicalDigest(domain: Buffer, value: unknown): Buffer {
  const bytes = canonicalJson(value);
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  return sha256(domain, Buffer.from([0]), length, bytes);
}

function sha256(...parts: Uint8Array[]): Buffer {
  return createHash("sha256").update(Buffer.concat(parts.map(Buffer.from))).digest();
}

function hex32(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) fail("SCHEMA_INVALID", `${label} must be lowercase 32-byte hexadecimal`);
  return value;
}

function decodeBase58(value: string): Buffer {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = 0n;
  for (const character of value) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) fail("SCHEMA_INVALID", "signature is not base58");
    number = number * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (number > 0n) { bytes.push(Number(number & 0xffn)); number >>= 8n; }
  for (const character of value) { if (character === "1") bytes.push(0); else break; }
  return Buffer.from(bytes.reverse());
}

function authenticate(output: SignedWorkerOutput): void {
  const rawKey = new PublicKey(output.signer_pubkey).toBuffer();
  const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), rawKey]);
  const signature = decodeBase58(output.signature);
  if (signature.length !== 64 || !verifySignature(null, canonicalDigest(WORKER_DOMAIN, output.output), createPublicKey({ key: spki, format: "der", type: "spki" }), signature)) {
    fail("SCHEMA_INVALID", "worker signature authentication failed");
  }
}

export function validateAttestationPlan(value: unknown, requests: readonly WorkerRequestBinding[]): AttestationPlan {
  const record = exactObject(value, PLAN_KEYS, "attestation plan");
  if (record.schema !== "faultline.attestation-plan.v1" || record.canonicalization !== "faultline.canonical-json.v1") fail("SCHEMA_INVALID", "attestation plan schema is incompatible");
  const gate = publicKey(record.gate_program_id, "plan Gate program");
  if (!gate.equals(FAULTLINE_GATE_PROGRAM_ID)) fail("INVALID_PROGRAM_ID", "attestation plan uses an unexpected Gate program");
  const genesis = publicKey(record.expected_genesis_hash, "expected genesis hash").toBase58();
  const round = publicKey(record.verification_round, "verification round").toBase58();
  const epoch = publicKey(record.verifier_epoch, "verifier epoch").toBase58();
  const replayJobHash = hex32(record.replay_job_hash, "replay job hash");
  const receiptHash = hex32(record.replay_receipt_hash, "replay receipt hash");
  const resultHash = hex32(record.result_hash, "result hash");
  if (record.verdict_u8 !== 0 && record.verdict_u8 !== 1) fail("SCHEMA_INVALID", "verdict must be HOLD or VIOLATION");
  if (!Array.isArray(record.signed_worker_outputs) || !Array.isArray(record.attestation_intents) || requests.length !== 3 || record.signed_worker_outputs.length !== 3 || record.attestation_intents.length !== 3) fail("SCHEMA_INVALID", "exactly three requests, outputs, and intents are required");
  const outputs = record.signed_worker_outputs.map(validateSignedWorkerOutput);
  const intents = record.attestation_intents.map(validateAttestationIntent);
  const identities = new Set<string>();
  const nonces = new Set<string>();
  const signatures = new Set<string>();
  for (let ordinal = 0; ordinal < 3; ordinal++) {
    const output = outputs[ordinal]; const intent = intents[ordinal]; const request = requests[ordinal];
    authenticate(output);
    const expectedJobHash = canonicalDigest(JOB_DOMAIN, request.replay_job).toString("hex");
    if (request.worker_ordinal !== ordinal || output.output.worker_ordinal !== ordinal || output.output.coordinator_nonce !== request.coordinator_nonce || output.signer_pubkey !== request.expected_verifier_pubkey || output.output.verifier_pubkey !== request.expected_verifier_pubkey || output.output.replay_job_hash !== expectedJobHash || expectedJobHash !== replayJobHash) fail("SCHEMA_INVALID", "worker request, nonce, ordinal, job, or identity binding mismatch");
    if (!output.output.attestation_intent || JSON.stringify(output.output.attestation_intent) !== JSON.stringify(intent) || intent.verifier_pubkey !== output.signer_pubkey || intent.verification_round !== round || intent.receipt_hash !== receiptHash || intent.replay_result_commitment !== resultHash || intent.verdict_u8 !== record.verdict_u8) fail("SCHEMA_INVALID", "worker intent or result binding mismatch");
    identities.add(output.signer_pubkey); nonces.add(request.coordinator_nonce); signatures.add(output.signature);
  }
  if (identities.size !== 3 || nonces.size !== 3 || signatures.size !== 3) fail("SCHEMA_INVALID", "worker identities, nonces, and signatures must be distinct");
  return Object.freeze({ schema: "faultline.attestation-plan.v1", canonicalization: "faultline.canonical-json.v1", gate_program_id: gate.toBase58(), expected_genesis_hash: genesis, verification_round: round, verifier_epoch: epoch, replay_job_hash: replayJobHash, replay_receipt_hash: receiptHash, result_hash: resultHash, verdict_u8: record.verdict_u8, signed_worker_outputs: Object.freeze(outputs), attestation_intents: Object.freeze(intents) });
}

export interface DirectAttestationAddresses {
  readonly policy: PublicKey; readonly proposal: PublicKey; readonly invariant: PublicKey;
  readonly traceClaim: PublicKey; readonly verifierRegistry: PublicKey; readonly verifierEpoch: PublicKey;
  readonly verificationRound: PublicKey; readonly economicPolicy: PublicKey;
  readonly verifierEpochEconomics: PublicKey; readonly roundEconomics: PublicKey;
  readonly verifierStake: PublicKey; readonly candidateBuffer: PublicKey;
}
export interface DirectAttestationPreflight {
  readonly plan: AttestationPlan; readonly requests: readonly WorkerRequestBinding[];
  readonly signer: PublicKey; readonly addresses: DirectAttestationAddresses;
  readonly rawExecutable: Uint8Array; readonly manifestExecutableSha256: string;
}
export interface DirectAttestationEvidence {
  readonly verifier: string; readonly resultHash: string; readonly receiptHash: string;
  readonly executableSha256: string; readonly automaticRetries: 0;
}

async function withDeadline<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try { return await Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error("RPC deadline exceeded")), milliseconds); })]); }
  finally { if (timer) clearTimeout(timer); }
}

async function readAccount(connection: Connection, address: PublicKey, commitment: Commitment, timeout: number) {
  const account = await withDeadline(connection.getAccountInfo(address, commitment), timeout);
  if (!account) fail("RPC_RESPONSE_INVALID", "required account is absent");
  return { address, owner: account.owner, data: account.data };
}

function same(left: PublicKey, right: PublicKey, label: string): void { if (!left.equals(right)) fail("INVALID_INPUT", `${label} binding mismatch`); }
function sameHash(left: Uint8Array, right: Uint8Array, label: string): void { if (!Buffer.from(left).equals(Buffer.from(right))) fail("INVALID_INPUT", `${label} hash mismatch`); }

export async function preflightDirectAttestation(connection: Connection, boundary: RpcBoundary, input: DirectAttestationPreflight): Promise<{ readonly instruction: TransactionInstruction; readonly evidence: DirectAttestationEvidence }> {
  const rpc = validateRpcBoundary(boundary);
  assertRpcGenesis(rpc, await withDeadline(connection.getGenesisHash(), rpc.timeoutMilliseconds));
  const plan = validateAttestationPlan(input.plan, input.requests);
  if (plan.expected_genesis_hash !== rpc.genesisHash) fail("RPC_GENESIS_MISMATCH", "plan genesis does not match RPC boundary");
  const intentIndex = plan.attestation_intents.findIndex((value) => value.verifier_pubkey === input.signer.toBase58());
  if (intentIndex < 0) fail("INVALID_INPUT", "signer is not one of the unanimous plan identities");
  const intent = plan.attestation_intents[intentIndex]; const a = input.addresses;
  same(a.proposal, publicKey(intent.proposal), "proposal"); same(a.invariant, publicKey(intent.invariant_account), "invariant"); same(a.traceClaim, publicKey(intent.trace_claim), "trace"); same(a.verificationRound, publicKey(plan.verification_round), "round"); same(a.verifierEpoch, publicKey(plan.verifier_epoch), "epoch");
  const [policy, proposal, invariant, trace, registry, epoch, round, economic, epochEconomics, roundEconomics, stake, candidate, claim] = await Promise.all([
    readAccount(connection, a.policy, rpc.commitment, rpc.timeoutMilliseconds).then(decodeSafetyPolicy),
    readAccount(connection, a.proposal, rpc.commitment, rpc.timeoutMilliseconds).then(decodeUpgradeProposal),
    readAccount(connection, a.invariant, rpc.commitment, rpc.timeoutMilliseconds).then(decodeInvariantDefinition),
    readAccount(connection, a.traceClaim, rpc.commitment, rpc.timeoutMilliseconds).then(decodeTraceClaim),
    readAccount(connection, a.verifierRegistry, rpc.commitment, rpc.timeoutMilliseconds).then(decodeVerifierRegistry),
    readAccount(connection, a.verifierEpoch, rpc.commitment, rpc.timeoutMilliseconds).then(decodeVerifierEpoch),
    readAccount(connection, a.verificationRound, rpc.commitment, rpc.timeoutMilliseconds).then(decodeVerificationRound),
    readAccount(connection, a.economicPolicy, rpc.commitment, rpc.timeoutMilliseconds).then(decodeEconomicPolicy),
    readAccount(connection, a.verifierEpochEconomics, rpc.commitment, rpc.timeoutMilliseconds).then(decodeVerifierEpochEconomics),
    readAccount(connection, a.roundEconomics, rpc.commitment, rpc.timeoutMilliseconds).then(decodeRoundEconomicState),
    readAccount(connection, a.verifierStake, rpc.commitment, rpc.timeoutMilliseconds).then(decodeVerifierStake),
    readAccount(connection, a.candidateBuffer, rpc.commitment, rpc.timeoutMilliseconds),
    readAccount(connection, deriveBufferClaim(a.candidateBuffer)[0], rpc.commitment, rpc.timeoutMilliseconds).then(decodeBufferClaim),
  ]) as [SafetyPolicyView, UpgradeProposalView, InvariantDefinitionView, TraceClaimView, VerifierRegistryView, VerifierEpochView, VerificationRoundView, EconomicPolicyView, VerifierEpochEconomicsView, RoundEconomicStateView, VerifierStakeView, { address: PublicKey; owner: PublicKey; data: Uint8Array }, ReturnType<typeof decodeBufferClaim>];
  same(proposal.policy, a.policy, "proposal policy"); same(proposal.candidate_buffer, a.candidateBuffer, "candidate buffer"); same(invariant.safety_policy, a.policy, "invariant policy"); same(trace.proposal, a.proposal, "trace proposal"); same(trace.invariant, a.invariant, "trace invariant"); same(registry.safety_policy, a.policy, "registry policy"); same(epoch.verifier_registry, a.verifierRegistry, "epoch registry"); same(epoch.safety_policy, a.policy, "epoch policy"); same(round.policy, a.policy, "round policy"); same(round.proposal, a.proposal, "round proposal"); same(round.invariant, a.invariant, "round invariant"); same(round.trace_claim, a.traceClaim, "round trace"); same(round.verifier_epoch, a.verifierEpoch, "round epoch");
  if (proposal.state.kind !== "ChallengeActive" || round.status.kind !== "Open" || round.threshold !== 3 || epoch.threshold !== 3 || epoch.verifiers.length !== 3 || new Set(epoch.verifiers.map((value) => value.toBase58())).size !== 3 || !epoch.verifiers.some((value) => value.equals(input.signer))) fail("INVALID_INPUT", "proposal, round, or canonical three-of-three epoch is ineligible");
  same(epochEconomics.verifier_epoch, a.verifierEpoch, "epoch economics epoch"); same(epochEconomics.economic_policy, a.economicPolicy, "epoch economics policy"); same(epochEconomics.verifier_registry, a.verifierRegistry, "epoch economics registry"); same(roundEconomics.verification_round, a.verificationRound, "round economics round"); same(roundEconomics.verifier_epoch_economics, a.verifierEpochEconomics, "round economics epoch"); if (roundEconomics.status.kind !== "Open") fail("INVALID_INPUT", "round economics is not open"); same(stake.economic_policy, a.economicPolicy, "stake policy"); same(stake.verifier, input.signer, "stake verifier"); if (stake.status.kind !== "Active" || stake.amount < economic.minimum_verifier_stake) fail("INVALID_INPUT", "verifier stake is not active and sufficient"); if (!registry.active_epoch?.equals(a.verifierEpoch) && round.verifier_epoch.equals(a.verifierEpoch) === false) fail("INVALID_INPUT", "epoch binding is stale");
  same(claim.proposal, a.proposal, "BufferClaim proposal"); same(claim.candidate_buffer, a.candidateBuffer, "BufferClaim candidate"); const lockedCandidate = decodeLockedLoaderV3Buffer(candidate, deriveGuard(policy.target_program)[0]);
  const executableHash = sha256(input.rawExecutable); const payloadHash = sha256(lockedCandidate.payload); const manifestHash = Buffer.from(hex32(input.manifestExecutableSha256, "manifest executable hash"), "hex"); const requestHashes = input.requests.map((request) => hex32(request.replay_job.candidate_executable_sha256, "Milestone 7 executable hash"));
  for (const hash of [payloadHash, manifestHash, proposal.candidate_buffer_hash, round.candidate_buffer_hash, ...requestHashes.map((value) => Buffer.from(value, "hex"))]) sameHash(hash, executableHash, "executable");
  sameHash(round.invariant_specification_hash, invariant.specification_hash, "invariant specification"); sameHash(round.trace_hash, trace.trace_hash, "trace");
  const recomputed = replayResultCommitment({ proposal: a.proposal, invariant: a.invariant, traceClaim: a.traceClaim, candidateBufferHash: proposal.candidate_buffer_hash, invariantSpecificationHash: invariant.specification_hash, verdict: plan.verdict_u8, replayReceiptHash: Buffer.from(plan.replay_receipt_hash, "hex") });
  sameHash(recomputed, Buffer.from(plan.result_hash, "hex"), "result commitment");
  const replayResult = deriveReplayResult(a.verificationRound, recomputed)[0]; const attestation = deriveVerifierAttestation(a.verificationRound, input.signer)[0];
  const instruction = buildSubmitVerifierAttestationInstruction({ verifier: input.signer, policy: a.policy, proposal: a.proposal, invariant: a.invariant, trace_claim: a.traceClaim, verifier_epoch: a.verifierEpoch, verification_round: a.verificationRound, replay_result: replayResult, verifier_attestation: attestation, system_program: SystemProgram.programId }, { result_hash: recomputed });
  return { instruction, evidence: Object.freeze({ verifier: input.signer.toBase58(), resultHash: plan.result_hash, receiptHash: plan.replay_receipt_hash, executableSha256: executableHash.toString("hex"), automaticRetries: 0 }) };
}

export async function submitDirectAttestation(connection: Connection, boundary: RpcBoundary, signer: Keypair, input: DirectAttestationPreflight, confirmationDeadlineMilliseconds = 90_000): Promise<{ readonly signature: string; readonly slot: number; readonly evidence: DirectAttestationEvidence }> {
  if (!signer.publicKey.equals(input.signer)) fail("INVALID_INPUT", "loaded key does not match requested verifier");
  const { instruction, evidence } = await preflightDirectAttestation(connection, boundary, input);
  const latest = await withDeadline(connection.getLatestBlockhash(boundary.commitment), boundary.timeoutMilliseconds);
  const transaction = new Transaction({ feePayer: signer.publicKey, recentBlockhash: latest.blockhash }).add(instruction); transaction.sign(signer);
  const signature = await withDeadline(connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false, preflightCommitment: boundary.commitment, maxRetries: 0 }), boundary.timeoutMilliseconds);
  const deadline = Date.now() + confirmationDeadlineMilliseconds;
  while (Date.now() < deadline) {
    const status = (await withDeadline(connection.getSignatureStatuses([signature], { searchTransactionHistory: true }), boundary.timeoutMilliseconds)).value[0];
    if (status?.err) throw new Error(`transaction rejected: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === boundary.commitment || status?.confirmationStatus === "finalized") return { signature, slot: status.slot, evidence };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("attestation confirmation deadline exceeded");
}

export function buildReplayFinalizationInstruction(plan: AttestationPlan, caller: PublicKey, policy: PublicKey, proposal: PublicKey): TransactionInstruction {
  const round = publicKey(plan.verification_round); const resultHash = Buffer.from(plan.result_hash, "hex");
  return buildFinalizeReplayResultInstruction({ caller, policy, proposal, proposal_verification_gate: deriveProposalVerificationGate(proposal)[0], verification_round: round, replay_result: deriveReplayResult(round, resultHash)[0] });
}
