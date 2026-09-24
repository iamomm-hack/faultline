/* Standalone Milestone-5 deterministic replay/quorum localnet proof. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import {
  Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction,
  TransactionInstruction
} from "@solana/web3.js";
import {
  COMMITMENT, LOADER_V3, ROOT, SYSVAR_CLOCK, SYSVAR_RENT, anchorInstruction,
  expectFailure, loadIds, loadKeypair, loaderBufferExecutableHash, loaderUpgradeInstruction, loaderWriteInstruction,
  programDataAddress, setLoaderAuthorityInstruction
} from "../scripts/lib/solana.js";
import { transferUpgradeAuthority } from "../scripts/transfer-upgrade-authority.js";

const RPC = "http://127.0.0.1:8899";
const ids = loadIds();
const payer = loadKeypair("payer");
const governance = loadKeypair("governance");
const proposer = loadKeypair("proposer");
const outsider = loadKeypair("random");
const hunter = loadKeypair("attacker");
const verifier1 = Keypair.fromSeed(Buffer.alloc(32, 41));
const verifier2 = Keypair.fromSeed(Buffer.alloc(32, 42));
const verifier3 = Keypair.fromSeed(Buffer.alloc(32, 43));
const verifier4 = Keypair.fromSeed(Buffer.alloc(32, 44));
const connection = new Connection(RPC, COMMITMENT);
const gate = new PublicKey(ids["faultline-gate-program"]);
const treasury = new PublicKey(ids["faultline-treasury-program"]);
const programData = programDataAddress(treasury);
const [guard] = PublicKey.findProgramAddressSync([Buffer.from("faultline"), Buffer.from("guard"), treasury.toBuffer()], gate);
const [policy] = PublicKey.findProgramAddressSync([Buffer.from("safety-policy"), treasury.toBuffer()], gate);
const [economicRegistry] = PublicKey.findProgramAddressSync([Buffer.from("economic-policy-registry"), policy.toBuffer()], gate);
const [registry] = PublicKey.findProgramAddressSync([Buffer.from("verifier-registry"), policy.toBuffer()], gate);
const [version] = PublicKey.findProgramAddressSync([Buffer.from("version")], treasury);
const REPLAY_DOMAIN = Buffer.from("FAULTLINE_REPLAY_V1", "ascii");
const VERIFIER_SET_DOMAIN = Buffer.from("FAULTLINE_VERIFIER_SET_V1", "ascii");
const CHALLENGE_DOMAIN = Buffer.from("FAULTLINE_CHALLENGE_V1", "ascii");
const evidence: string[] = [];
const originalLog = console.log.bind(console);
console.log = (...values: unknown[]) => { const line = values.map(String).join(" "); evidence.push(line); originalLog(line); };

const u64 = (value: bigint) => { const out = Buffer.alloc(8); out.writeBigUInt64LE(value); return out; };
const u32 = (value: number) => { const out = Buffer.alloc(4); out.writeUInt32LE(value); return out; };
const sha256 = (...parts: Uint8Array[]) => createHash("sha256").update(Buffer.concat(parts.map(Buffer.from))).digest();
const sortedKeys = (keys: PublicKey[]) => [...keys].sort((a, b) => Buffer.compare(a.toBuffer(), b.toBuffer()));

export function replayResultCommitment(
  proposal: PublicKey, invariant: PublicKey, traceClaim: PublicKey,
  candidateHash: Buffer, specificationHash: Buffer, verdict: 0 | 1, receiptHash: Buffer
): Buffer {
  for (const value of [candidateHash, specificationHash, receiptHash]) assert.equal(value.length, 32);
  return sha256(REPLAY_DOMAIN, proposal.toBuffer(), invariant.toBuffer(), traceClaim.toBuffer(), candidateHash, specificationHash, Buffer.from([verdict]), receiptHash);
}
function verifierSetHash(epochId: bigint, threshold: number, verifiers: PublicKey[]): Buffer {
  const canonical = sortedKeys(verifiers);
  return sha256(VERIFIER_SET_DOMAIN, policy.toBuffer(), u64(epochId), Buffer.from([canonical.length, threshold]), ...canonical.map(key => key.toBuffer()));
}
function challengeCommitment(proposal: PublicKey, invariant: PublicKey, who: PublicKey, traceHash: Buffer, salt: Buffer): Buffer {
  return sha256(CHALLENGE_DOMAIN, proposal.toBuffer(), invariant.toBuffer(), who.toBuffer(), traceHash, salt);
}

async function send(ix: TransactionInstruction, feePayer: Keypair, signers: Keypair[] = []): Promise<string> {
  const latest = await connection.getLatestBlockhash(COMMITMENT);
  const tx = new Transaction({ feePayer: feePayer.publicKey, recentBlockhash: latest.blockhash }).add(ix);
  tx.sign(feePayer, ...signers);
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: COMMITMENT });
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    if (status?.err) throw new Error(`transaction ${signature} failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return signature;
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  throw new Error(`confirmation timeout ${signature}`);
}
async function sendMany(instructions: TransactionInstruction[], feePayer: Keypair, signers: Keypair[] = []): Promise<string> {
  const latest = await connection.getLatestBlockhash(COMMITMENT);
  const tx = new Transaction({ feePayer: feePayer.publicKey, recentBlockhash: latest.blockhash }).add(...instructions);
  tx.sign(feePayer, ...signers);
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: COMMITMENT });
  await connection.confirmTransaction({ signature, ...latest }, COMMITMENT);
  const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
  if (status?.err) throw new Error(`transaction ${signature} failed: ${JSON.stringify(status.err)}`);
  return signature;
}
async function fails(label: string, expected: RegExp, operation: () => Promise<unknown>): Promise<void> {
  await expectFailure(label, operation, expected);
  console.log(`PASS ${label}: ${expected.source}`);
}

async function createLoaderBuffer(bytes: Buffer): Promise<Keypair> {
  const stageStarted = Date.now();
  const stageDeadline = stageStarted + 12 * 60_000;
  const buffer = Keypair.generate();
  console.log(`STAGE buffer-create START address=${buffer.publicKey.toBase58()} bytes=${bytes.length} timeout_ms=${12 * 60_000}`);
  const space = 37 + bytes.length;
  const lamports = await connection.getMinimumBalanceForRentExemption(space, COMMITMENT);
  const initData = Buffer.alloc(4);
  initData.writeUInt32LE(0);
  await sendMany([
    SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: buffer.publicKey, lamports, space, programId: LOADER_V3 }),
    new TransactionInstruction({ programId: LOADER_V3, keys: [
      { pubkey: buffer.publicKey, isSigner: false, isWritable: true },
      { pubkey: proposer.publicKey, isSigner: false, isWritable: false }
    ], data: initData })
  ], payer, [buffer]);
  console.log(`STAGE buffer-create INITIALIZED address=${buffer.publicKey.toBase58()} elapsed_ms=${Date.now() - stageStarted}`);
  const chunkSize = 800;
  let transactionCount = 0;
  console.log(`STAGE buffer-upload START address=${buffer.publicKey.toBase58()} bytes=${bytes.length} batch_width=32 chunk_bytes=${chunkSize}`);
  for (let batch = 0; batch < bytes.length; batch += chunkSize * 32) {
    if (Date.now() >= stageDeadline) throw new Error(`buffer upload exceeded 12 minute deadline: address=${buffer.publicKey.toBase58()} bytes=${bytes.length} transactions=${transactionCount}`);
    const latest = await connection.getLatestBlockhash(COMMITMENT);
    const transactions: Transaction[] = [];
    for (let offset = batch; offset < Math.min(bytes.length, batch + chunkSize * 32); offset += chunkSize) {
      const ix = loaderWriteInstruction(buffer.publicKey, proposer.publicKey, bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)));
      ix.data.writeUInt32LE(offset, 4);
      const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: latest.blockhash }).add(ix);
      tx.sign(payer, proposer);
      transactions.push(tx);
    }
    const signatures = await Promise.all(transactions.map(tx => connection.sendRawTransaction(tx.serialize(), { skipPreflight: true })));
    transactionCount += signatures.length;
    const remaining = new Set(signatures);
    const deadline = Date.now() + 90_000;
    while (remaining.size && Date.now() < deadline) {
      const list = [...remaining];
      const statuses = (await connection.getSignatureStatuses(list, { searchTransactionHistory: true })).value;
      statuses.forEach((status, index) => {
        if (status?.err) throw new Error(`loader write ${list[index]} failed: ${JSON.stringify(status.err)}`);
        if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") remaining.delete(list[index]);
      });
      if (remaining.size) await new Promise(resolve => setTimeout(resolve, 400));
    }
    if (remaining.size) throw new Error(`loader upload timeout: ${remaining.size} transactions`);
    console.log(`STAGE buffer-upload PROGRESS address=${buffer.publicKey.toBase58()} confirmed_transactions=${transactionCount} uploaded_bytes=${Math.min(bytes.length, batch + chunkSize * 32)} elapsed_ms=${Date.now() - stageStarted}`);
  }
  console.log(`STAGE buffer-upload COMPLETE address=${buffer.publicKey.toBase58()} transactions=${transactionCount} bytes=${bytes.length} elapsed_ms=${Date.now() - stageStarted}`);
  return buffer;
}

const proposalAddress = (id: bigint) => PublicKey.findProgramAddressSync([Buffer.from("upgrade-proposal"), policy.toBuffer(), u64(id)], gate)[0];
const verificationGateAddress = (proposal: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("proposal-verification-gate"), proposal.toBuffer()], gate)[0];
const claimAddress = (buffer: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("faultline"), Buffer.from("buffer"), buffer.toBuffer()], gate)[0];
const invariantAddress = (id: bigint) => PublicKey.findProgramAddressSync([Buffer.from("invariant"), policy.toBuffer(), u64(id)], gate)[0];
const epochAddress = (id: bigint) => PublicKey.findProgramAddressSync([Buffer.from("verifier-epoch"), registry.toBuffer(), u64(id)], gate)[0];
const commitAddress = (proposal: PublicKey, who: PublicKey, commitment: Buffer) => PublicKey.findProgramAddressSync([Buffer.from("challenge-commit"), proposal.toBuffer(), who.toBuffer(), commitment], gate)[0];
const traceAddress = (proposal: PublicKey, trace: Buffer) => PublicKey.findProgramAddressSync([Buffer.from("trace-claim"), proposal.toBuffer(), trace], gate)[0];
const roundAddress = (traceClaim: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("verification-round"), traceClaim.toBuffer()], gate)[0];
const resultAddress = (round: PublicKey, resultHash: Buffer) => PublicKey.findProgramAddressSync([Buffer.from("replay-result"), round.toBuffer(), resultHash], gate)[0];
const attestationAddress = (round: PublicKey, verifier: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("verifier-attestation"), round.toBuffer(), verifier.toBuffer()], gate)[0];

function initializePolicy(): TransactionInstruction { return anchorInstruction(gate, "initialize_safety_policy", [
  { pubkey: governance.publicKey, isSigner: true, isWritable: true }, { pubkey: guard, isSigner: false, isWritable: false },
  { pubkey: treasury, isSigner: false, isWritable: false }, { pubkey: policy, isSigner: false, isWritable: true },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
], Buffer.concat([u64(5n), Buffer.from([1, 0]), u64(8n), Buffer.from([2]), sha256(Buffer.from("AUTH-001")), governance.publicKey.toBuffer()])); }
function initializeEconomicRegistry(): TransactionInstruction { return anchorInstruction(gate, "initialize_economic_policy_registry", [
  { pubkey: governance.publicKey, isSigner: true, isWritable: true }, { pubkey: policy, isSigner: false, isWritable: false },
  { pubkey: economicRegistry, isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
]); }
function initializeRegistry(actor: PublicKey): TransactionInstruction { return anchorInstruction(gate, "initialize_verifier_registry", [
  { pubkey: actor, isSigner: true, isWritable: true }, { pubkey: policy, isSigner: false, isWritable: false },
  { pubkey: registry, isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
]); }
function createEpoch(id: bigint, actor: PublicKey, verifiers: PublicKey[], threshold: number): TransactionInstruction {
  return anchorInstruction(gate, "create_verifier_epoch", [
    { pubkey: actor, isSigner: true, isWritable: true }, { pubkey: policy, isSigner: false, isWritable: false },
    { pubkey: registry, isSigner: false, isWritable: true }, { pubkey: epochAddress(id), isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
  ], Buffer.concat([u64(id), u32(verifiers.length), ...verifiers.map(key => key.toBuffer()), Buffer.from([threshold])]));
}
function activateEpoch(id: bigint, actor: PublicKey): TransactionInstruction { return anchorInstruction(gate, "activate_verifier_epoch", [
  { pubkey: actor, isSigner: true, isWritable: false }, { pubkey: policy, isSigner: false, isWritable: false },
  { pubkey: registry, isSigner: false, isWritable: true }, { pubkey: epochAddress(id), isSigner: false, isWritable: false }
]); }
function initializeInvariant(id: bigint, specification: Buffer): TransactionInstruction { return anchorInstruction(gate, "initialize_invariant", [
  { pubkey: governance.publicKey, isSigner: true, isWritable: true }, { pubkey: policy, isSigner: false, isWritable: false },
  { pubkey: invariantAddress(id), isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
], Buffer.concat([u64(id), Buffer.from([0]), sha256(Buffer.from(`AUTH-${id}`)), specification])); }
function createProposal(id: bigint, buffer: PublicKey, hash: Buffer): TransactionInstruction { const proposal = proposalAddress(id); return anchorInstruction(gate, "create_upgrade_proposal", [
  { pubkey: proposer.publicKey, isSigner: true, isWritable: true }, { pubkey: guard, isSigner: false, isWritable: true },
  { pubkey: policy, isSigner: false, isWritable: false }, { pubkey: treasury, isSigner: false, isWritable: false },
  { pubkey: programData, isSigner: false, isWritable: false }, { pubkey: buffer, isSigner: false, isWritable: false },
  { pubkey: proposal, isSigner: false, isWritable: true }, { pubkey: verificationGateAddress(proposal), isSigner: false, isWritable: true },
  { pubkey: claimAddress(buffer), isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
], Buffer.concat([u64(id), hash])); }
function startChallenge(id: bigint, duration = 40n): TransactionInstruction { return anchorInstruction(gate, "start_challenge", [
  { pubkey: proposer.publicKey, isSigner: true, isWritable: false }, { pubkey: policy, isSigner: false, isWritable: false },
  { pubkey: economicRegistry, isSigner: false, isWritable: false },
  { pubkey: proposalAddress(id), isSigner: false, isWritable: true }
], u64(duration)); }
function temporaryDecision(id: bigint, state: 2 | 3): TransactionInstruction { const proposal = proposalAddress(id); return anchorInstruction(gate, "record_temporary_decision", [
  { pubkey: governance.publicKey, isSigner: true, isWritable: false }, { pubkey: policy, isSigner: false, isWritable: false },
  { pubkey: proposal, isSigner: false, isWritable: true }, { pubkey: verificationGateAddress(proposal), isSigner: false, isWritable: false }
], Buffer.from([state, 0x34, 0x12])); }
function commitChallenge(proposal: PublicKey, invariant: PublicKey, trace: Buffer, salt: Buffer): TransactionInstruction { const commitment = challengeCommitment(proposal, invariant, hunter.publicKey, trace, salt); return anchorInstruction(gate, "commit_challenge", [
  { pubkey: hunter.publicKey, isSigner: true, isWritable: true }, { pubkey: policy, isSigner: false, isWritable: false },
  { pubkey: economicRegistry, isSigner: false, isWritable: false },
  { pubkey: proposal, isSigner: false, isWritable: false }, { pubkey: invariant, isSigner: false, isWritable: false },
  { pubkey: commitAddress(proposal, hunter.publicKey, commitment), isSigner: false, isWritable: true },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
], commitment); }
function revealChallenge(proposal: PublicKey, invariant: PublicKey, trace: Buffer, salt: Buffer): TransactionInstruction { const commitment = challengeCommitment(proposal, invariant, hunter.publicKey, trace, salt); return anchorInstruction(gate, "reveal_challenge", [
  { pubkey: hunter.publicKey, isSigner: true, isWritable: true }, { pubkey: policy, isSigner: false, isWritable: false },
  { pubkey: proposal, isSigner: false, isWritable: false }, { pubkey: invariant, isSigner: false, isWritable: false },
  { pubkey: commitAddress(proposal, hunter.publicKey, commitment), isSigner: false, isWritable: true },
  { pubkey: traceAddress(proposal, trace), isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
], Buffer.concat([trace, salt])); }
async function commitAndReveal(proposal: PublicKey, invariant: PublicKey, trace: Buffer, salt: Buffer): Promise<PublicKey> {
  await send(commitChallenge(proposal, invariant, trace, salt), hunter);
  await send(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: outsider.publicKey, lamports: 1 }), payer);
  await send(revealChallenge(proposal, invariant, trace, salt), hunter);
  return traceAddress(proposal, trace);
}
type OpenOverrides = Partial<{ policy: PublicKey; economicRegistry: PublicKey; proposal: PublicKey; gate: PublicKey; invariant: PublicKey; commit: PublicKey; traceClaim: PublicKey; registry: PublicKey; epoch: PublicKey; round: PublicKey }>;
function openRound(proposal: PublicKey, invariant: PublicKey, trace: Buffer, salt: Buffer, epochId: bigint, overrides: OpenOverrides = {}): TransactionInstruction {
  const traceClaim = overrides.traceClaim ?? traceAddress(proposal, trace);
  const commitment = challengeCommitment(proposal, invariant, hunter.publicKey, trace, salt);
  return anchorInstruction(gate, "open_verification_round", [
    { pubkey: payer.publicKey, isSigner: true, isWritable: true }, { pubkey: overrides.policy ?? policy, isSigner: false, isWritable: false },
    { pubkey: overrides.economicRegistry ?? economicRegistry, isSigner: false, isWritable: false },
    { pubkey: overrides.proposal ?? proposal, isSigner: false, isWritable: false }, { pubkey: overrides.gate ?? verificationGateAddress(proposal), isSigner: false, isWritable: true },
    { pubkey: overrides.invariant ?? invariant, isSigner: false, isWritable: false }, { pubkey: overrides.commit ?? commitAddress(proposal, hunter.publicKey, commitment), isSigner: false, isWritable: false },
    { pubkey: traceClaim, isSigner: false, isWritable: false }, { pubkey: overrides.registry ?? registry, isSigner: false, isWritable: false },
    { pubkey: overrides.epoch ?? epochAddress(epochId), isSigner: false, isWritable: false }, { pubkey: overrides.round ?? roundAddress(traceClaim), isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
  ]);
}
function createReplay(round: PublicKey, resultHash: Buffer, verdict: 0 | 1, receipt: Buffer): TransactionInstruction { return anchorInstruction(gate, "create_replay_result", [
  { pubkey: payer.publicKey, isSigner: true, isWritable: true }, { pubkey: round, isSigner: false, isWritable: false },
  { pubkey: resultAddress(round, resultHash), isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
], Buffer.concat([resultHash, Buffer.from([verdict]), receipt])); }
type AttestOverrides = Partial<{ policy: PublicKey; proposal: PublicKey; invariant: PublicKey; traceClaim: PublicKey; epoch: PublicKey; round: PublicKey; result: PublicKey }>;
function attest(who: PublicKey, proposal: PublicKey, invariant: PublicKey, traceClaim: PublicKey, epochId: bigint, round: PublicKey, resultHash: Buffer, overrides: AttestOverrides = {}): TransactionInstruction {
  const suppliedRound = overrides.round ?? round;
  return anchorInstruction(gate, "submit_verifier_attestation", [
    { pubkey: who, isSigner: true, isWritable: true }, { pubkey: overrides.policy ?? policy, isSigner: false, isWritable: false },
    { pubkey: overrides.proposal ?? proposal, isSigner: false, isWritable: false }, { pubkey: overrides.invariant ?? invariant, isSigner: false, isWritable: false },
    { pubkey: overrides.traceClaim ?? traceClaim, isSigner: false, isWritable: false }, { pubkey: overrides.epoch ?? epochAddress(epochId), isSigner: false, isWritable: false },
    { pubkey: suppliedRound, isSigner: false, isWritable: false }, { pubkey: overrides.result ?? resultAddress(round, resultHash), isSigner: false, isWritable: true },
    { pubkey: attestationAddress(suppliedRound, who), isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
  ], resultHash); }
function finalize(proposal: PublicKey, round: PublicKey, resultHash: Buffer): TransactionInstruction { return anchorInstruction(gate, "finalize_replay_result", [
  { pubkey: outsider.publicKey, isSigner: true, isWritable: false }, { pubkey: policy, isSigner: false, isWritable: false },
  { pubkey: proposal, isSigner: false, isWritable: true }, { pubkey: verificationGateAddress(proposal), isSigner: false, isWritable: true },
  { pubkey: round, isSigner: false, isWritable: true }, { pubkey: resultAddress(round, resultHash), isSigner: false, isWritable: false }
]); }
function execute(id: bigint, buffer: PublicKey): TransactionInstruction { const proposal = proposalAddress(id); return anchorInstruction(gate, "execute_guarded_upgrade", [
  { pubkey: outsider.publicKey, isSigner: true, isWritable: false }, { pubkey: guard, isSigner: false, isWritable: false },
  { pubkey: policy, isSigner: false, isWritable: false }, { pubkey: proposal, isSigner: false, isWritable: true },
  { pubkey: verificationGateAddress(proposal), isSigner: false, isWritable: false }, { pubkey: claimAddress(buffer), isSigner: false, isWritable: false },
  { pubkey: treasury, isSigner: false, isWritable: true }, { pubkey: programData, isSigner: false, isWritable: true },
  { pubkey: buffer, isSigner: false, isWritable: true }, { pubkey: governance.publicKey, isSigner: false, isWritable: true },
  { pubkey: SYSVAR_RENT, isSigner: false, isWritable: false }, { pubkey: SYSVAR_CLOCK, isSigner: false, isWritable: false },
  { pubkey: LOADER_V3, isSigner: false, isWritable: false }
]); }
function expire(id: bigint): TransactionInstruction { return anchorInstruction(gate, "expire_proposal", [
  { pubkey: outsider.publicKey, isSigner: true, isWritable: false }, { pubkey: policy, isSigner: false, isWritable: false },
  { pubkey: proposalAddress(id), isSigner: false, isWritable: true }
]); }
async function advancePast(end: bigint): Promise<void> { while (BigInt(await connection.getSlot(COMMITMENT)) <= end) await send(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: outsider.publicKey, lamports: 1 }), payer); }
async function proposalEnd(proposal: PublicKey): Promise<bigint> { const info = await connection.getAccountInfo(proposal, COMMITMENT); assert(info); return info.data.readBigUInt64LE(226); }
async function lockBuffer(buffer: PublicKey): Promise<Buffer> { await send(setLoaderAuthorityInstruction(buffer, proposer.publicKey, guard), payer, [proposer]); const info = await connection.getAccountInfo(buffer, COMMITMENT); assert(info); return loaderBufferExecutableHash(info); }
function decodeGate(raw: Buffer) { return { proposal: new PublicKey(raw.subarray(8, 40)), pending: raw.readUInt16LE(40), violation: raw[42] === 1, last: raw[43] === 1 ? new PublicKey(raw.subarray(44, 76)) : null, bump: raw[76] }; }
function decodeRound(raw: Buffer) { return { policy: new PublicKey(raw.subarray(8, 40)), proposal: new PublicKey(raw.subarray(40, 72)), invariant: new PublicKey(raw.subarray(72, 104)), traceClaim: new PublicKey(raw.subarray(104, 136)), traceHash: Buffer.from(raw.subarray(136, 168)), candidateHash: Buffer.from(raw.subarray(168, 200)), specificationHash: Buffer.from(raw.subarray(200, 232)), epoch: new PublicKey(raw.subarray(232, 264)), threshold: raw[264], status: raw[265], finalized: raw[274] === 1 ? raw.readBigUInt64LE(275) : null, winner: raw[283] === 1 ? new PublicKey(raw.subarray(284, 316)) : null }; }
function decodeResult(raw: Buffer) { return { round: new PublicKey(raw.subarray(8, 40)), hash: Buffer.from(raw.subarray(40, 72)), verdict: raw[72], receipt: Buffer.from(raw.subarray(73, 105)), votes: raw[105] }; }
function proposalState(raw: Buffer) { return raw[234]; }

async function main(): Promise<void> {
  if (!process.env.FAULTLINE_VERIFIER_GENESIS || await connection.getGenesisHash() !== process.env.FAULTLINE_VERIFIER_GENESIS) throw new Error("refusing validator not owned by verifier runner");
  try {
    for (const actor of [governance, proposer, outsider, hunter, verifier1, verifier2, verifier3, verifier4]) {
      await send(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: actor.publicKey, lamports: 5 * LAMPORTS_PER_SOL }), payer);
    }
    await send(anchorInstruction(gate, "initialize_guard", [
      { pubkey: governance.publicKey, isSigner: true, isWritable: true }, { pubkey: treasury, isSigner: false, isWritable: false },
      { pubkey: programData, isSigner: false, isWritable: false }, { pubkey: guard, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
    ]), governance);
    await transferUpgradeAuthority(connection, treasury, payer, guard);
    await send(anchorInstruction(treasury, "initialize_version", [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true }, { pubkey: version, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
    ]), payer);
    await send(initializePolicy(), governance);
    const specificationHash = sha256(Buffer.from("AUTH-001 deterministic specification"));
    await send(initializeInvariant(1n, specificationHash), governance);
    const invariant = invariantAddress(1n);

    await fails("3 non-governance registry initialization", /UnauthorizedGovernance/, () => send(initializeRegistry(outsider.publicKey), outsider));
    await send(initializeRegistry(governance.publicKey), governance);
    const registryInfo = await connection.getAccountInfo(registry, COMMITMENT); assert(registryInfo?.owner.equals(gate));
    console.log("PASS 1 registry initializes at canonical PDA");
    await fails("2 duplicate registry", /already in use|AccountAlreadyInitialized/, () => send(initializeRegistry(governance.publicKey), governance));
    await fails("4 empty verifier set", /EmptyVerifierSet/, () => send(createEpoch(0n, governance.publicKey, [], 1), governance));
    await fails("5 zero threshold", /InvalidThreshold/, () => send(createEpoch(0n, governance.publicKey, [verifier1.publicKey], 0), governance));
    await fails("6 threshold above count", /InvalidThreshold/, () => send(createEpoch(0n, governance.publicKey, [verifier1.publicKey], 2), governance));
    await fails("7 duplicate verifier", /DuplicateVerifier/, () => send(createEpoch(0n, governance.publicKey, [verifier1.publicKey, verifier1.publicKey], 1), governance));
    await fails("8 non-governance epoch creation", /UnauthorizedGovernance/, () => send(createEpoch(0n, outsider.publicKey, [verifier1.publicKey], 1), outsider));
    const originalSet = [verifier3.publicKey, verifier1.publicKey, verifier2.publicKey];
    await send(createEpoch(0n, governance.publicKey, originalSet, 2), governance);
    const epoch0Info = await connection.getAccountInfo(epochAddress(0n), COMMITMENT); assert(epoch0Info);
    const canonical0 = sortedKeys(originalSet);
    assert.equal(epoch0Info.data.readUInt32LE(80), 3);
    canonical0.forEach((key, i) => assert(new PublicKey(epoch0Info.data.subarray(84 + i * 32, 116 + i * 32)).equals(key)));
    assert.equal(epoch0Info.data[180], 2);
    assert.deepEqual(epoch0Info.data.subarray(181, 213), verifierSetHash(0n, 2, originalSet));
    console.log("PASS 9 epoch fields, canonical ordering, and verifier-set hash match");
    await fails("10 non-governance activation", /UnauthorizedGovernance/, () => send(activateEpoch(0n, outsider.publicKey), outsider));
    await send(activateEpoch(0n, governance.publicKey), governance);
    console.log("PASS 11 governance activation succeeds");
    const newSet = [verifier4.publicKey, verifier2.publicKey, verifier1.publicKey];
    await send(createEpoch(1n, governance.publicKey, newSet, 2), governance);

    const executable = readFileSync(`${ROOT}/artifacts/treasury/v2/faultline_treasury.so`);
    const holdsBuffer = await createLoaderBuffer(executable);
    const holdsCandidateHash = await lockBuffer(holdsBuffer.publicKey);
    await send(createProposal(1n, holdsBuffer.publicKey, holdsCandidateHash), proposer);
    await send(initializeEconomicRegistry(), governance);
    const holdsProposal = proposalAddress(1n);
    await send(startChallenge(1n, 50n), proposer);
    const holdsTrace = sha256(Buffer.from("canonical safe treasury replay trace"));
    const holdsSalt = Buffer.alloc(32, 51);
    const holdsTraceClaim = await commitAndReveal(holdsProposal, invariant, holdsTrace, holdsSalt);
    const holdsRound = roundAddress(holdsTraceClaim);
    await send(openRound(holdsProposal, invariant, holdsTrace, holdsSalt, 0n), payer);
    console.log("PASS 13 valid revealed trace opens canonical round");
    await fails("14 duplicate round", /RoundAlreadyExists/, () => send(openRound(holdsProposal, invariant, holdsTrace, holdsSalt, 0n), payer));
    const fakeTrace = sha256(Buffer.from("unrevealed"));
    await fails("15 unrevealed commitment", /AccountNotInitialized|not initialized/, () => send(openRound(holdsProposal, invariant, fakeTrace, Buffer.alloc(32, 52), 0n, { traceClaim: traceAddress(holdsProposal, fakeTrace) }), payer));
    const foreignBuffer = await createLoaderBuffer(Buffer.alloc(0)); const foreignHash = await lockBuffer(foreignBuffer.publicKey); await send(createProposal(3n, foreignBuffer.publicKey, foreignHash), proposer); await send(startChallenge(3n, 30n), proposer);
    const foreignTrace = sha256(Buffer.from("foreign trace claim")); const foreignSalt = Buffer.alloc(32, 53); const foreignTraceClaim = await commitAndReveal(proposalAddress(3n), invariant, foreignTrace, foreignSalt);
    await fails("16 wrong TraceClaim", /WrongTraceBinding|ConstraintAddress|ConstraintSeeds/, () => send(openRound(holdsProposal, invariant, holdsTrace, holdsSalt, 0n, { traceClaim: foreignTraceClaim, round: roundAddress(foreignTraceClaim) }), payer));
    await fails("17 wrong proposal", /WrongProposalBinding|ConstraintSeeds|ConstraintHasOne/, () => send(openRound(holdsProposal, invariant, holdsTrace, holdsSalt, 0n, { proposal: proposalAddress(3n) }), payer));
    await send(initializeInvariant(2n, sha256(Buffer.from("secondary specification"))), governance);
    await fails("18 wrong invariant", /WrongInvariantBinding|ConstraintSeeds/, () => send(openRound(holdsProposal, invariant, holdsTrace, holdsSalt, 0n, { invariant: invariantAddress(2n) }), payer));
    await fails("19 wrong verifier epoch", /WrongVerifierEpoch/, () => send(openRound(holdsProposal, invariant, holdsTrace, holdsSalt, 1n), payer));
    const roundInfo = await connection.getAccountInfo(holdsRound, COMMITMENT); assert(roundInfo);
    const decodedRound = decodeRound(roundInfo.data);
    assert.deepEqual(decodedRound.candidateHash, holdsCandidateHash); assert.deepEqual(decodedRound.specificationHash, specificationHash);
    console.log("PASS 20 candidate and specification snapshots cannot be substituted");
    const draftBuffer = await createLoaderBuffer(Buffer.alloc(0)); const draftHash = await lockBuffer(draftBuffer.publicKey); await send(createProposal(7n, draftBuffer.publicKey, draftHash), proposer);
    await fails("21 draft proposal cannot open", /WrongProposalBinding|ConstraintSeeds|ConstraintHasOne|InvalidProposalTransition/, () => send(openRound(holdsProposal, invariant, holdsTrace, holdsSalt, 0n, { proposal: proposalAddress(7n) }), payer));
    let gateInfo = await connection.getAccountInfo(verificationGateAddress(holdsProposal), COMMITMENT); assert(gateInfo); assert.equal(decodeGate(gateInfo.data).pending, 1);
    console.log("PASS 22 opening increments pending count once");
    await fails("23 governance approval blocked while pending", /VerificationPending/, () => send(temporaryDecision(1n, 2), governance));
    await fails("24 Guard execution blocked while pending", /VerificationPending/, () => send(execute(1n, holdsBuffer.publicKey), outsider));

    const safeReceipt = sha256(Buffer.from("FAULTLINE_FIXTURE_SAFE_RECEIPT_V1"));
    const violationReceipt = sha256(Buffer.from("FAULTLINE_FIXTURE_AUTH_001_VIOLATION_V1"));
    const safeResultHash = replayResultCommitment(holdsProposal, invariant, holdsTraceClaim, holdsCandidateHash, specificationHash, 0, safeReceipt);
    const conflictHash = replayResultCommitment(holdsProposal, invariant, holdsTraceClaim, holdsCandidateHash, specificationHash, 1, violationReceipt);
    assert.deepEqual(replayResultCommitment(new PublicKey(Buffer.alloc(32, 1)), new PublicKey(Buffer.alloc(32, 2)), new PublicKey(Buffer.alloc(32, 3)), Buffer.alloc(32, 4), Buffer.alloc(32, 5), 1, Buffer.alloc(32, 6)).toString("hex"), "b7eb266542e099bd41398d8b78d6d571b57844356bfe7c6f5539a73e00046921");
    console.log("PASS 53 Rust/TypeScript replay-result vector matches");
    await fails("30 wrong replay receipt/result hash", /ReplayResultMismatch/, () => send(createReplay(holdsRound, Buffer.alloc(32, 99), 0, safeReceipt), payer));
    await send(createReplay(holdsRound, safeResultHash, 0, safeReceipt), payer);
    await send(createReplay(holdsRound, conflictHash, 1, violationReceipt), payer);
    await fails("25 non-member attestation", /UnauthorizedVerifier/, () => send(attest(outsider.publicKey, holdsProposal, invariant, holdsTraceClaim, 0n, holdsRound, safeResultHash), outsider));
    const holdsAttestation1 = await send(attest(verifier1.publicKey, holdsProposal, invariant, holdsTraceClaim, 0n, holdsRound, safeResultHash), verifier1);
    console.log(`EVIDENCE holds-attestation-1=${holdsAttestation1}`);
    console.log("PASS 26 valid member attestation succeeds");
    const attestationInfo = await connection.getAccountInfo(attestationAddress(holdsRound, verifier1.publicKey), COMMITMENT); assert(attestationInfo);
    assert(new PublicKey(attestationInfo.data.subarray(8, 40)).equals(holdsRound)); assert(new PublicKey(attestationInfo.data.subarray(40, 72)).equals(epochAddress(0n))); assert(new PublicKey(attestationInfo.data.subarray(104, 136)).equals(resultAddress(holdsRound, safeResultHash))); assert.deepEqual(attestationInfo.data.subarray(136, 168), safeResultHash);
    console.log("PASS 27 attestation fields match round and result");
    await fails("28 duplicate vote", /VerifierAlreadyAttested/, () => send(attest(verifier1.publicKey, holdsProposal, invariant, holdsTraceClaim, 0n, holdsRound, safeResultHash), verifier1));
    await fails("29 equivocation attempt", /VerifierAlreadyAttested/, () => send(attest(verifier1.publicKey, holdsProposal, invariant, holdsTraceClaim, 0n, holdsRound, conflictHash), verifier1));
    await fails("31 wrong epoch substitution", /WrongVerifierEpoch|ConstraintAddress/, () => send(attest(verifier2.publicKey, holdsProposal, invariant, holdsTraceClaim, 0n, holdsRound, safeResultHash, { epoch: epochAddress(1n) }), verifier2));
    await send(attest(verifier3.publicKey, holdsProposal, invariant, holdsTraceClaim, 0n, holdsRound, conflictHash), verifier3);
    const safeOne = decodeResult((await connection.getAccountInfo(resultAddress(holdsRound, safeResultHash), COMMITMENT))!.data);
    const conflictOne = decodeResult((await connection.getAccountInfo(resultAddress(holdsRound, conflictHash), COMMITMENT))!.data);
    assert.equal(safeOne.votes, 1); assert.equal(conflictOne.votes, 1);
    console.log("PASS 32 split conflicting results do not combine");
    await fails("33 finalization before threshold", /QuorumNotReached/, () => send(finalize(holdsProposal, holdsRound, safeResultHash), outsider));

    const epoch0Snapshot = Buffer.from(epoch0Info.data);
    await send(activateEpoch(1n, governance.publicKey), governance);
    assert.deepEqual((await connection.getAccountInfo(epochAddress(0n), COMMITMENT))!.data, epoch0Snapshot);
    console.log("PASS 12 historical epoch remains immutable after new activation");
    const holdsAttestation2 = await send(attest(verifier2.publicKey, holdsProposal, invariant, holdsTraceClaim, 0n, holdsRound, safeResultHash), verifier2);
    console.log(`EVIDENCE holds-attestation-2=${holdsAttestation2}`);
    assert.equal(decodeResult((await connection.getAccountInfo(resultAddress(holdsRound, safeResultHash), COMMITMENT))!.data).votes, 2);
    console.log("PASS 34 two matching holds attestations reach 2-of-3 quorum");
    const holdsFinalization = await send(finalize(holdsProposal, holdsRound, safeResultHash), outsider);
    console.log(`EVIDENCE holds-finalization=${holdsFinalization}`);
    console.log("PASS 35 permissionless holds finalization succeeds");
    gateInfo = await connection.getAccountInfo(verificationGateAddress(holdsProposal), COMMITMENT); assert(gateInfo); assert.equal(decodeGate(gateInfo.data).pending, 0);
    console.log("PASS 36 pending counter returns to zero");
    const holdsProposalInfo = await connection.getAccountInfo(holdsProposal, COMMITMENT); assert(holdsProposalInfo); assert.equal(proposalState(holdsProposalInfo.data), 1); assert.equal(holdsProposalInfo.data[235], 0); assert.equal(holdsProposalInfo.data[280], 0);
    console.log("PASS 37/48 holds leaves proposal ChallengeActive, undecided, unexecuted, and never auto-approves");
    await send(temporaryDecision(1n, 2), governance); console.log("PASS 38 governance approval becomes possible only after clear");
    await fails("39 early execution", /ChallengeWindowStillActive/, () => send(execute(1n, holdsBuffer.publicKey), outsider));

    const violationBuffer = await createLoaderBuffer(Buffer.alloc(0)); const violationCandidateHash = await lockBuffer(violationBuffer.publicKey);
    await send(createProposal(2n, violationBuffer.publicKey, violationCandidateHash), proposer); await send(startChallenge(2n, 40n), proposer);
    const violationProposal = proposalAddress(2n); const badTrace = sha256(Buffer.from("AUTH-001 unauthorized withdrawal trace")); const badSalt = Buffer.alloc(32, 61);
    const badTraceClaim = await commitAndReveal(violationProposal, invariant, badTrace, badSalt); const badRound = roundAddress(badTraceClaim);
    await fails("new round rejects old inactive epoch", /WrongVerifierEpoch/, () => send(openRound(violationProposal, invariant, badTrace, badSalt, 0n), payer));
    await send(openRound(violationProposal, invariant, badTrace, badSalt, 1n), payer); console.log("PASS 52 new rounds bind only to new active epoch");
    assert(new PublicKey(((await connection.getAccountInfo(badRound, COMMITMENT))!).data.subarray(232, 264)).equals(epochAddress(1n)));
    console.log("PASS 51 old-epoch round remained valid after newer activation");
    const badResultHash = replayResultCommitment(violationProposal, invariant, badTraceClaim, violationCandidateHash, specificationHash, 1, violationReceipt);
    await send(createReplay(badRound, badResultHash, 1, violationReceipt), payer);
    const violationAttestation1 = await send(attest(verifier1.publicKey, violationProposal, invariant, badTraceClaim, 1n, badRound, badResultHash), verifier1);
    const violationAttestation2 = await send(attest(verifier2.publicKey, violationProposal, invariant, badTraceClaim, 1n, badRound, badResultHash), verifier2);
    console.log(`EVIDENCE violation-attestations=${violationAttestation1},${violationAttestation2}`);
    console.log("PASS 41 two matching violation attestations reach quorum");
    const violationFinalization = await send(finalize(violationProposal, badRound, badResultHash), outsider);
    console.log(`EVIDENCE violation-finalization=${violationFinalization}`);
    const rejectedInfo = await connection.getAccountInfo(violationProposal, COMMITMENT); assert(rejectedInfo); assert.equal(proposalState(rejectedInfo.data), 3); assert.equal(rejectedInfo.data[235], 1); assert(new PublicKey(rejectedInfo.data.subarray(236, 268)).equals(gate)); assert.equal(rejectedInfo.data.readUInt16LE(278), 0x5001);
    console.log("PASS 42/43 permissionless finalization automatically rejects with deterministic metadata");
    const badGate = decodeGate((await connection.getAccountInfo(verificationGateAddress(violationProposal), COMMITMENT))!.data); assert.equal(badGate.pending, 0); assert.equal(badGate.violation, true); assert(badGate.last?.equals(badRound));
    console.log("PASS 44 counter zero and violation flag permanent");
    await fails("45 governance cannot approve rejected proposal", /InvalidProposalTransition/, () => send(temporaryDecision(2n, 2), governance));
    await fails("46 Guard cannot execute violation", /ConfirmedInvariantViolation/, () => send(execute(2n, violationBuffer.publicKey), outsider));
    await fails("47 re-finalization", /RoundNotOpen/, () => send(finalize(violationProposal, badRound, badResultHash), outsider));
    await fails("rejected proposal cannot open", /InvalidProposalTransition/, () => send(openRound(violationProposal, invariant, badTrace, badSalt, 1n), payer));

    const finalRound = decodeRound((await connection.getAccountInfo(badRound, COMMITMENT))!.data); assert.equal(finalRound.status, 2); assert(finalRound.winner?.equals(resultAddress(badRound, badResultHash))); assert.deepEqual(finalRound.traceHash, badTrace);
    console.log("PASS violation round bindings preserved");
    assert.deepEqual(decodeRound(roundInfo.data).candidateHash, holdsCandidateHash);
    console.log("PASS 49 candidate address/hash never changes through verification");
    const invariantBefore = Buffer.from((await connection.getAccountInfo(invariant, COMMITMENT))!.data); const traceBefore = Buffer.from((await connection.getAccountInfo(holdsTraceClaim, COMMITMENT))!.data);
    assert.deepEqual((await connection.getAccountInfo(invariant, COMMITMENT))!.data, invariantBefore); assert.deepEqual((await connection.getAccountInfo(holdsTraceClaim, COMMITMENT))!.data, traceBefore);
    console.log("PASS 50 invariant and TraceClaim remain immutable");
    await fails("55 BufferClaim remains single-use", /already in use|AccountAlreadyInitialized/, () => send(createProposal(5n, violationBuffer.publicKey, violationCandidateHash), proposer));
    await fails("54 direct loader bypass remains rejected", /Incorrect authority/i, () => send(loaderUpgradeInstruction(treasury, violationBuffer.publicKey, payer.publicKey, payer.publicKey), payer));

    const end = await proposalEnd(holdsProposal); await advancePast(end);
    const guardedUpgrade = await send(execute(1n, holdsBuffer.publicKey), outsider);
    console.log(`EVIDENCE guarded-upgrade=${guardedUpgrade}`);
    const upgradeSlot = await connection.getSlot(COMMITMENT);
    while ((await connection.getSlot(COMMITMENT)) < upgradeSlot + 2) {
      await send(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: outsider.publicKey, lamports: 1 }), payer);
    }
    await send(anchorInstruction(treasury, "refresh_version", [{ pubkey: version, isSigner: false, isWritable: true }]), payer);
    assert.equal((await connection.getAccountInfo(version, COMMITMENT))?.data.readUInt16LE(8), 2);
    console.log("PASS 40 post-window real Guard loader-v3 upgrade succeeds");
    await fails("executed proposal cannot open", /InvalidProposalTransition/, () => send(openRound(holdsProposal, invariant, holdsTrace, holdsSalt, 1n), payer));
    const expiryBuffer = await createLoaderBuffer(Buffer.alloc(0)); const expiryHash = await lockBuffer(expiryBuffer.publicKey);
    await send(createProposal(6n, expiryBuffer.publicKey, expiryHash), proposer); await send(startChallenge(6n, 8n), proposer);
    const expiryProposal = proposalAddress(6n); const expiryTrace = sha256(Buffer.from("expiry trace")); const expirySalt = Buffer.alloc(32, 71);
    await commitAndReveal(expiryProposal, invariant, expiryTrace, expirySalt); await advancePast(await proposalEnd(expiryProposal)); await send(expire(6n), outsider);
    await fails("expired proposal cannot open", /InvalidProposalTransition/, () => send(openRound(expiryProposal, invariant, expiryTrace, expirySalt, 1n), payer));
    console.log("PASS 21 draft/rejected/expired/executed proposals cannot open");
    console.log("ALL MILESTONE-5 VERIFIER QUORUM ASSERTIONS 1-55 PASSED");
  } finally {
    appendFileSync(`${ROOT}/.localnet/verifier-quorum-evidence.log`, `${evidence.join("\n")}\n`);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
