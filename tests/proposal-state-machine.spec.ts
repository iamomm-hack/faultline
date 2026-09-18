/* Standalone Milestone-3 localnet integration proof. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  COMMITMENT, LOADER_V3, ROOT, SYSVAR_CLOCK, SYSVAR_RENT, anchorInstruction,
  expectFailure, loadIds, loadKeypair, loaderAuthority, loaderUpgradeInstruction, loaderWriteInstruction,
  programDataAddress, setLoaderAuthorityInstruction
} from "../scripts/lib/solana.js";
import { transferUpgradeAuthority } from "../scripts/transfer-upgrade-authority.js";

const RPC = "http://127.0.0.1:8899";
const ids = loadIds();
const payer = loadKeypair("payer"), governance = loadKeypair("governance"), proposer = loadKeypair("proposer"), random = loadKeypair("random");
const gate = new PublicKey(ids["faultline-gate-program"]), treasury = new PublicKey(ids["faultline-treasury-program"]);
const data = programDataAddress(treasury);
const buffer = new PublicKey(ids["candidate-v2"]), substituteBuffer = new PublicKey(ids["candidate-spare"]);
const connection = new Connection(RPC, COMMITMENT);
const [guard] = PublicKey.findProgramAddressSync([Buffer.from("faultline"), Buffer.from("guard"), treasury.toBuffer()], gate);
const [policy] = PublicKey.findProgramAddressSync([Buffer.from("safety-policy"), treasury.toBuffer()], gate);
const [economicRegistry] = PublicKey.findProgramAddressSync([Buffer.from("economic-policy-registry"), policy.toBuffer()], gate);
const [version] = PublicKey.findProgramAddressSync([Buffer.from("version")], treasury);
const gateData = programDataAddress(gate);
const [secondaryGuard] = PublicKey.findProgramAddressSync([Buffer.from("faultline"), Buffer.from("guard"), gate.toBuffer()], gate);
const [secondaryPolicy] = PublicKey.findProgramAddressSync([Buffer.from("safety-policy"), gate.toBuffer()], gate);
const u64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; };
const hash = (b: Buffer) => createHash("sha256").update(b).digest();
const evidence: string[] = [];
const stdout = console.log.bind(console);
console.log = (...values: unknown[]) => {
  evidence.push(values.map(value => String(value)).join(" "));
  stdout(...values);
};

async function send(connection: Connection, ix: TransactionInstruction, feePayer: Keypair, signers: Keypair[] = []) {
  const latest = await connection.getLatestBlockhash(COMMITMENT);
  const tx = new Transaction({ feePayer: feePayer.publicKey, recentBlockhash: latest.blockhash }).add(ix);
  tx.sign(feePayer, ...signers);
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: COMMITMENT });
  const deadline = Date.now() + 90_000;
  let observed: Awaited<ReturnType<Connection["getSignatureStatuses"]>>["value"][number] = null;
  while (Date.now() < deadline) {
    observed = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    if (observed?.err) throw new Error(`transaction ${signature} failed: ${JSON.stringify(observed.err)}`);
    const level = observed?.confirmationStatus;
    const reachedCommitment = COMMITMENT === "processed"
      ? level === "processed" || level === "confirmed" || level === "finalized"
      : COMMITMENT === "confirmed"
        ? level === "confirmed" || level === "finalized"
        : level === "finalized";
    if (reachedCommitment) return signature;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const currentSlot = await connection.getSlot(COMMITMENT).catch(error => `unavailable: ${String(error)}`);
  let rpcHealth: unknown;
  try {
    const response = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" })
    });
    rpcHealth = await response.json();
  } catch (error) {
    rpcHealth = `unavailable: ${String(error)}`;
  }
  throw new Error(`transaction confirmation timeout: signature=${signature} commitment=${COMMITMENT} latestStatus=${JSON.stringify(observed)} currentSlot=${String(currentSlot)} rpcHealth=${JSON.stringify(rpcHealth)}`);
}

function proposalAddress(id: bigint) { return PublicKey.findProgramAddressSync([Buffer.from("upgrade-proposal"), policy.toBuffer(), u64(id)], gate)[0]; }
function verificationGateAddress(proposal: PublicKey) { return PublicKey.findProgramAddressSync([Buffer.from("proposal-verification-gate"), proposal.toBuffer()], gate)[0]; }
function claimAddress(b: PublicKey) { return PublicKey.findProgramAddressSync([Buffer.from("faultline"), Buffer.from("buffer"), b.toBuffer()], gate)[0]; }
function initPolicy() { return anchorInstruction(gate, "initialize_safety_policy", [
  { pubkey: governance.publicKey, isSigner: true, isWritable: true }, { pubkey: guard, isSigner: false, isWritable: false },
  { pubkey: treasury, isSigner: false, isWritable: false }, { pubkey: policy, isSigner: false, isWritable: true },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
], Buffer.concat([u64(3n), Buffer.from([1, 0]), u64(4n), Buffer.from([1]), hash(Buffer.from("AUTH-001")), governance.publicKey.toBuffer()])); }
function initEconomicRegistry() { return anchorInstruction(gate, "initialize_economic_policy_registry", [
  { pubkey: governance.publicKey, isSigner: true, isWritable: true }, { pubkey: policy, isSigner: false, isWritable: false },
  { pubkey: economicRegistry, isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
]); }
function status(actor: PublicKey, paused: boolean) { return anchorInstruction(gate, "set_safety_policy_status", [{ pubkey: actor, isSigner: true, isWritable: false }, { pubkey: policy, isSigner: false, isWritable: true }], Buffer.from([paused ? 1 : 0])); }
function create(id: bigint, candidate: PublicKey, expected: Buffer, target = treasury) { return anchorInstruction(gate, "create_upgrade_proposal", [
  { pubkey: proposer.publicKey, isSigner: true, isWritable: true }, { pubkey: guard, isSigner: false, isWritable: true }, { pubkey: policy, isSigner: false, isWritable: false },
  { pubkey: target, isSigner: false, isWritable: false }, { pubkey: target.equals(treasury) ? data : programDataAddress(target), isSigner: false, isWritable: false },
  { pubkey: candidate, isSigner: false, isWritable: false }, { pubkey: proposalAddress(id), isSigner: false, isWritable: true }, { pubkey: verificationGateAddress(proposalAddress(id)), isSigner: false, isWritable: true }, { pubkey: claimAddress(candidate), isSigner: false, isWritable: true },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
], Buffer.concat([u64(id), expected])); }
function start(actor: PublicKey, id: bigint, duration: bigint) { return anchorInstruction(gate, "start_challenge", [{ pubkey: actor, isSigner: true, isWritable: false }, { pubkey: policy, isSigner: false, isWritable: false }, { pubkey: economicRegistry, isSigner: false, isWritable: false }, { pubkey: proposalAddress(id), isSigner: false, isWritable: true }], u64(duration)); }
function decision(actor: PublicKey, id: bigint, choice: number) { return anchorInstruction(gate, "record_temporary_decision", [{ pubkey: actor, isSigner: true, isWritable: false }, { pubkey: policy, isSigner: false, isWritable: false }, { pubkey: proposalAddress(id), isSigner: false, isWritable: true }, { pubkey: verificationGateAddress(proposalAddress(id)), isSigner: false, isWritable: false }], Buffer.from([choice, 0, 0])); }
function execute(id: bigint, candidate = buffer) { return anchorInstruction(gate, "execute_guarded_upgrade", [
  { pubkey: random.publicKey, isSigner: true, isWritable: false }, { pubkey: guard, isSigner: false, isWritable: false }, { pubkey: policy, isSigner: false, isWritable: false },
  { pubkey: proposalAddress(id), isSigner: false, isWritable: true }, { pubkey: verificationGateAddress(proposalAddress(id)), isSigner: false, isWritable: false }, { pubkey: claimAddress(candidate), isSigner: false, isWritable: false }, { pubkey: treasury, isSigner: false, isWritable: true },
  { pubkey: data, isSigner: false, isWritable: true }, { pubkey: candidate, isSigner: false, isWritable: true }, { pubkey: governance.publicKey, isSigner: false, isWritable: true },
  { pubkey: SYSVAR_RENT, isSigner: false, isWritable: false }, { pubkey: SYSVAR_CLOCK, isSigner: false, isWritable: false }, { pubkey: LOADER_V3, isSigner: false, isWritable: false }
]); }
type ExecuteOverrides = Partial<{ guard: PublicKey; policy: PublicKey; proposal: PublicKey; claim: PublicKey; target: PublicKey; programData: PublicKey; candidate: PublicKey; loader: PublicKey }>;
function executeWith(id: bigint, overrides: ExecuteOverrides = {}) {
  const candidate = overrides.candidate ?? buffer;
  return anchorInstruction(gate, "execute_guarded_upgrade", [
    { pubkey: random.publicKey, isSigner: true, isWritable: false }, { pubkey: overrides.guard ?? guard, isSigner: false, isWritable: false },
    { pubkey: overrides.policy ?? policy, isSigner: false, isWritable: false }, { pubkey: overrides.proposal ?? proposalAddress(id), isSigner: false, isWritable: true },
    { pubkey: verificationGateAddress(overrides.proposal ?? proposalAddress(id)), isSigner: false, isWritable: false },
    { pubkey: overrides.claim ?? claimAddress(candidate), isSigner: false, isWritable: false }, { pubkey: overrides.target ?? treasury, isSigner: false, isWritable: true },
    { pubkey: overrides.programData ?? data, isSigner: false, isWritable: true }, { pubkey: candidate, isSigner: false, isWritable: true },
    { pubkey: governance.publicKey, isSigner: false, isWritable: true }, { pubkey: SYSVAR_RENT, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_CLOCK, isSigner: false, isWritable: false }, { pubkey: overrides.loader ?? LOADER_V3, isSigner: false, isWritable: false }
  ]);
}
function expire(id: bigint) { return anchorInstruction(gate, "expire_proposal", [{ pubkey: random.publicKey, isSigner: true, isWritable: false }, { pubkey: policy, isSigner: false, isWritable: false }, { pubkey: proposalAddress(id), isSigner: false, isWritable: true }]); }
async function fails(label: string, expected: RegExp, fn: () => Promise<unknown>) { await expectFailure(label, fn, expected); console.log(`PASS negative: ${label} (${expected.source})`); }
async function endSlot(id: bigint) { const info = await connection.getAccountInfo(proposalAddress(id)); assert(info); return info.data.readBigUInt64LE(226); }
async function advancePast(slot: bigint) { while (BigInt(await connection.getSlot(COMMITMENT)) <= slot) await send(connection, SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: random.publicKey, lamports: 1 }), payer); }
async function broadcastFailure(label: string, ix: TransactionInstruction, signers: typeof payer[], expected: RegExp) {
  const latest = await connection.getLatestBlockhash(COMMITMENT);
  const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: latest.blockhash }).add(ix);
  tx.sign(payer, ...signers);
  let signature: string;
  try {
    signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  } catch (error) {
    throw new Error(`${label}: transaction was never accepted/broadcast: ${String(error)}`);
  }
  console.log(`BROADCAST negative: ${label}: ${signature}`);
  const deadline = Date.now() + 120_000;
  let status: Awaited<ReturnType<Connection["getSignatureStatuses"]>>["value"][number] = null;
  while (Date.now() < deadline) {
    status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    if (status) break;
    const blockHeight = await connection.getBlockHeight(COMMITMENT);
    if (blockHeight > latest.lastValidBlockHeight) throw new Error(`${label}: blockhash expired before status; signature=${signature} blockHeight=${blockHeight} lastValidBlockHeight=${latest.lastValidBlockHeight}`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!status) throw new Error(`${label}: signature status remained null until timeout; signature=${signature}`);
  if (!status.err) throw new Error(`${label}: SECURITY DEFECT: transaction landed successfully; signature=${signature} status=${JSON.stringify(status)}`);
  const landed = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  const logs = landed?.meta?.logMessages?.join("\n") ?? "";
  if (!expected.test(logs)) throw new Error(`${label}: transaction landed with unexpected error; signature=${signature} status=${JSON.stringify(status)} logs=${logs}`);
  console.log(`PASS negative: ${label}: signature=${signature} status=${JSON.stringify(status)} evidence=${logs.split("\n").find(line => expected.test(line))}`);
  return signature;
}
async function versionNumber() { const info = await connection.getAccountInfo(version); assert(info); return info.data.readUInt16LE(8); }
function proposalSnapshot(raw: Buffer) {
  return {
    candidate: new PublicKey(raw.subarray(112, 144)), candidateHash: Buffer.from(raw.subarray(144, 176)), state: raw[234],
    decisionAuthority: raw[235] === 1 ? new PublicKey(raw.subarray(236, 268)) : null,
    decisionSlot: raw[268] === 1 ? raw.readBigUInt64LE(269) : null,
    executedAt: raw[280] === 1 ? raw.readBigUInt64LE(281) : null
  };
}

async function main() {
  const shard = process.argv[process.argv.indexOf("--shard") + 1];
  if (shard !== "policy" && shard !== "terminal" && shard !== "authority") throw new Error("expected --shard policy|terminal|authority");
  if (!process.env.FAULTLINE_PROPOSAL_GENESIS || await connection.getGenesisHash() !== process.env.FAULTLINE_PROPOSAL_GENESIS) throw new Error("refusing a validator not started by the dedicated runner");
  try {
    for (const actor of [governance.publicKey, proposer.publicKey, random.publicKey]) {
      await send(connection, SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: actor, lamports: 10 * LAMPORTS_PER_SOL }), payer);
    }
    const cli = (...a: string[]) => execFileSync("solana", a, { cwd: ROOT, stdio: "pipe" });
    for (const name of ["candidate-v2", "candidate-spare", "candidate-approved", "candidate-rejected"]) cli("program", "write-buffer", "artifacts/treasury/v2/faultline_treasury.so", "--buffer", `.localnet/${name}.json`, "--buffer-authority", ".localnet/proposer.json", "--fee-payer", ".localnet/payer.json", "--keypair", ".localnet/payer.json", "--url", RPC);
    await send(connection, anchorInstruction(treasury, "initialize_version", [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }, { pubkey: version, isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }]), payer);
    console.log(`Guard init: ${await send(connection, anchorInstruction(gate, "initialize_guard", [{ pubkey: governance.publicKey, isSigner: true, isWritable: true }, { pubkey: treasury, isSigner: false, isWritable: false }, { pubkey: data, isSigner: false, isWritable: false }, { pubkey: guard, isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }]), governance)}`);
    await send(connection, anchorInstruction(gate, "initialize_guard", [{ pubkey: governance.publicKey, isSigner: true, isWritable: true }, { pubkey: gate, isSigner: false, isWritable: false }, { pubkey: gateData, isSigner: false, isWritable: false }, { pubkey: secondaryGuard, isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }]), governance);
    await send(connection, anchorInstruction(gate, "initialize_safety_policy", [
      { pubkey: governance.publicKey, isSigner: true, isWritable: true }, { pubkey: secondaryGuard, isSigner: false, isWritable: false }, { pubkey: gate, isSigner: false, isWritable: false }, { pubkey: secondaryPolicy, isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
    ], Buffer.concat([u64(99n), Buffer.from([1, 0]), u64(4n), Buffer.from([1]), hash(Buffer.from("SECONDARY")), governance.publicKey.toBuffer()])), governance);
    await transferUpgradeAuthority(connection, treasury, payer, guard);
    const rejectedBuffer = new PublicKey(ids["candidate-approved"]);
    const uncommittedBuffer = new PublicKey(ids["candidate-rejected"]);
    for (const b of [buffer, substituteBuffer, rejectedBuffer]) await send(connection, setLoaderAuthorityInstruction(b, proposer.publicKey, guard), payer, [proposer]);
    const lockedHash = hash((await connection.getAccountInfo(buffer))!.data);
    const good = hash((await connection.getAccountInfo(buffer))!.data);
    // Terminal and authority assertions require a real, approved proposal but do not
    // execute policy assertions 1-14 in their independent validator sessions.
    let committedAtCreate: ReturnType<typeof proposalSnapshot> | undefined;
    const seedApprovedProposal = async () => {
      await send(connection, initPolicy(), governance);
      await send(connection, create(1n, buffer, good), proposer);
      await send(connection, initEconomicRegistry(), governance);
      committedAtCreate = proposalSnapshot((await connection.getAccountInfo(proposalAddress(1n)))!.data);
      await send(connection, start(proposer.publicKey, 1n, 4n), proposer);
      await send(connection, decision(governance.publicKey, 1n, 2), governance);
    };
    if (shard === "authority") {
    const targetInfo = await connection.getAccountInfo(treasury, COMMITMENT);
    const programDataInfo = await connection.getAccountInfo(data, COMMITMENT);
    assert(targetInfo?.executable, "Treasury target is not executable");
    assert(targetInfo.owner.equals(LOADER_V3), "Treasury target is not loader-v3 owned");
    assert(programDataInfo, "Treasury ProgramData does not exist");
    assert(programDataInfo.owner.equals(LOADER_V3), "Treasury ProgramData is not loader-v3 owned");
    const recordedAuthority = await loaderAuthority(connection, data, 3);
    assert(recordedAuthority.equals(guard), "Treasury ProgramData authority is not the Guard PDA");
    assert(!recordedAuthority.equals(payer.publicKey), "Original deployer remains upgrade authority");
    assert((await loaderAuthority(connection, buffer, 1)).equals(guard), "Candidate buffer is not locked to the Guard PDA");
    const directDeployerSig = await broadcastFailure("24 original deployer direct upgrade", loaderUpgradeInstruction(treasury, buffer, payer.publicKey, payer.publicKey), [], /Incorrect authority/i);
    assert.equal(await versionNumber(), 1); console.log(`PASS 24 deployer rejected onchain: ${directDeployerSig}`);
    const directRandomSig = await broadcastFailure("25 random direct upgrade", loaderUpgradeInstruction(treasury, buffer, random.publicKey, payer.publicKey), [random], /Incorrect authority/i);
    assert.equal(await versionNumber(), 1); console.log(`PASS 25 random rejected onchain: ${directRandomSig}`);
    const lockedWriteSig = await broadcastFailure("27 previous buffer authority write", loaderWriteInstruction(buffer, proposer.publicKey, Buffer.from([0x42])), [proposer], /Incorrect authority/i);
    assert.deepEqual(hash((await connection.getAccountInfo(buffer))!.data), lockedHash); console.log(`PASS 27 locked buffer immutable: ${lockedWriteSig}`);
    }
    if (shard === "policy") {
    console.log(`Policy init: ${await send(connection, initPolicy(), governance)}`); console.log("PASS 1 policy initialized");
    assert((await connection.getAccountInfo(policy))?.owner.equals(gate));
    await fails("2 duplicate policy", /already in use|AccountAlreadyInitialized/, () => send(connection, initPolicy(), governance));
    await fails("3 non-governance pause", /UnauthorizedGovernance/, () => send(connection, status(random.publicKey, true), random));
    await send(connection, status(governance.publicKey, true), governance); await send(connection, status(governance.publicKey, false), governance); console.log("PASS 4 governance pause/unpause");
    await send(connection, status(governance.publicKey, true), governance); await fails("5 paused policy create", /PolicyPaused/, () => send(connection, create(1n, buffer, good), proposer)); await send(connection, status(governance.publicKey, false), governance);
    await fails("6 target program with mismatched GuardConfig PDA is rejected", /ConstraintSeeds/, () => send(connection, create(1n, buffer, good, gate), proposer));
    await fails("7 wrong expected hash", /CandidateHashMismatch/, () => send(connection, create(1n, buffer, Buffer.alloc(32, 9)), proposer));
    const unlockedHash = hash((await connection.getAccountInfo(uncommittedBuffer))!.data);
    await fails("8 candidate buffer not controlled by the Guard is rejected", /BufferNotLocked/, () => send(connection, create(1n, uncommittedBuffer, unlockedHash), proposer));
    assert.equal(await connection.getAccountInfo(proposalAddress(1n)), null, "failed unlocked-buffer proposal persisted");
    assert.equal(await connection.getAccountInfo(claimAddress(uncommittedBuffer)), null, "failed unlocked-buffer claim persisted");
    await send(connection, create(1n, buffer, good), proposer); console.log("PASS proposal Draft created");
    await send(connection, initEconomicRegistry(), governance);
    committedAtCreate = proposalSnapshot((await connection.getAccountInfo(proposalAddress(1n)))!.data);
    await fails("9 duplicate proposal PDA", /already in use|AccountAlreadyInitialized/, () => send(connection, create(1n, buffer, good), proposer));
    await fails("10 duration below minimum", /ChallengeDurationTooShort/, () => send(connection, start(proposer.publicKey, 1n, 3n), proposer));
    await fails("11 Draft execute", /ProposalNotApproved/, () => send(connection, execute(1n), random));
    await fails("12 unauthorized challenge starter", /UnauthorizedChallengeStarter/, () => send(connection, start(random.publicKey, 1n, 4n), random));
    await send(connection, start(proposer.publicKey, 1n, 4n), proposer);
    await fails("13 unauthorized decision", /UnauthorizedGovernance/, () => send(connection, decision(random.publicKey, 1n, 2), random));
    await send(connection, decision(governance.publicKey, 1n, 2), governance);
    await fails("14 early approved execution", /ChallengeWindowStillActive/, () => send(connection, execute(1n), random));
    console.log("POLICY SHARD ASSERTIONS 1-14 PASSED");
    return;
    }
    await seedApprovedProposal();
    if (shard === "authority") {
    await fails("28 claimed buffer reused", /already in use|AccountAlreadyInitialized/, () => send(connection, create(4n, buffer, good), proposer));
    assert.equal(await connection.getAccountInfo(proposalAddress(4n)), null);
    const afterDecision = proposalSnapshot((await connection.getAccountInfo(proposalAddress(1n)))!.data);
    assert(committedAtCreate, "seed proposal snapshot missing");
    assert.deepEqual(afterDecision.candidateHash, committedAtCreate.candidateHash);
    assert(afterDecision.candidate.equals(committedAtCreate.candidate));
    const gateSource = readFileSync(`${ROOT}/programs/faultline_gate/src/lib.rs`, "utf8");
    assert.equal((gateSource.match(/candidate_buffer_hash\s*=\s*actual_hash/g) ?? []).length, 1, "candidate hash must have one initialization assignment and no mutation route");
    console.log("PASS 30 candidate hash immutable across decision; no mutation instruction exists");
    const wrongPolicy = PublicKey.findProgramAddressSync([Buffer.from("safety-policy"), random.publicKey.toBuffer()], gate)[0];
    const wrongProposal = PublicKey.findProgramAddressSync([Buffer.from("upgrade-proposal"), policy.toBuffer(), u64(999n)], gate)[0];
    const substitution = async (label: string, expected: RegExp, ix: ReturnType<typeof executeWith>) => {
      await fails(label, expected, () => send(connection, ix, random));
      assert.equal(await versionNumber(), 1, `${label} changed target version`);
    };
    await substitution("26 substituted GuardConfig", /WrongTargetProgram/, executeWith(1n, { guard: secondaryGuard }));
    const originalBeforeSubstitution = proposalSnapshot((await connection.getAccountInfo(proposalAddress(1n)))!.data);
    await substitution("29 uncommitted candidate has no BufferClaim", /AccountNotInitialized/, executeWith(1n, { candidate: uncommittedBuffer }));
    const originalAfterMissingClaim = proposalSnapshot((await connection.getAccountInfo(proposalAddress(1n)))!.data);
    assert.equal(originalAfterMissingClaim.state, originalBeforeSubstitution.state, "missing-claim attempt changed the approved proposal state");
    assert.equal(originalAfterMissingClaim.executedAt, null, "missing-claim attempt executed the approved proposal");
    const foreignHash = hash((await connection.getAccountInfo(substituteBuffer))!.data);
    await send(connection, create(5n, substituteBuffer, foreignHash), proposer);
    await substitution("29b initialized foreign candidate and BufferClaim substitution", /ConstraintHasOne/, executeWith(1n, { candidate: substituteBuffer, claim: claimAddress(substituteBuffer) }));
    const originalAfterForeignClaim = proposalSnapshot((await connection.getAccountInfo(proposalAddress(1n)))!.data);
    const foreignAfterSubstitution = proposalSnapshot((await connection.getAccountInfo(proposalAddress(5n)))!.data);
    assert.equal(originalAfterForeignClaim.state, originalBeforeSubstitution.state, "foreign-claim attempt changed the approved proposal state");
    assert.equal(originalAfterForeignClaim.executedAt, null, "foreign-claim attempt executed the approved proposal");
    assert.equal(foreignAfterSubstitution.state, 0, "foreign proposal did not remain Draft");
    assert.equal(foreignAfterSubstitution.executedAt, null, "foreign proposal unexpectedly executed");
    assert.equal(await versionNumber(), 1, "candidate substitution changed Treasury version");
    await substitution("31 wrong SafetyPolicy PDA", /AccountNotInitialized/, executeWith(1n, { policy: wrongPolicy }));
    await substitution("32 wrong UpgradeProposal PDA", /AccountNotInitialized/, executeWith(1n, { proposal: wrongProposal }));
    await substitution("33 wrong target program", /ConstraintHasOne/, executeWith(1n, { target: gate }));
    await substitution("34 wrong ProgramData", /ConstraintHasOne/, executeWith(1n, { programData: gateData }));
    await substitution("35 wrong loader program", /ConstraintAddress/, executeWith(1n, { loader: SystemProgram.programId }));
    await substitution("36 candidate mismatched with committed BufferClaim", /ConstraintHasOne/, executeWith(1n, { candidate: rejectedBuffer, claim: claimAddress(buffer) }));
    await substitution("37 wrong Guard PDA", /WrongTargetProgram/, executeWith(1n, { guard: secondaryGuard }));
    await substitution("38 policy for different target", /WrongTargetProgram/, executeWith(1n, { policy: secondaryPolicy }));
    await advancePast(await endSlot(1n));
    const authorityUpgradeSig = await send(connection, execute(1n), random);
    for (let i = 0; i < 2; i++) await send(connection, SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: random.publicKey, lamports: 1 }), payer);
    await send(connection, anchorInstruction(treasury, "refresh_version", [{ pubkey: version, isSigner: false, isWritable: true }]), payer);
    assert.equal(await versionNumber(), 2, "authority completion did not execute the Guard upgrade");
    console.log(`PASS 39 authority guarded upgrade: ${authorityUpgradeSig}`);
    console.log("AUTHORITY SHARD ASSERTIONS 24-39 PASSED");
    return;
    }
    if (shard !== "terminal") throw new Error(`unhandled shard ${shard}`);
    // 15-18: expiry has its own locked Buffer and complete terminal-state proof.
    const spareHash = hash((await connection.getAccountInfo(substituteBuffer))!.data);
    await send(connection, create(2n, substituteBuffer, spareHash), proposer); await send(connection, start(proposer.publicKey, 2n, 4n), proposer);
    await fails("16 expire before end", /ChallengeWindowStillActive/, () => send(connection, expire(2n), random));
    await advancePast(await endSlot(2n));
    await fails("15 decision after end", /ChallengeWindowEnded/, () => send(connection, decision(governance.publicKey, 2n, 2), governance));
    await send(connection, expire(2n), random); console.log("PASS 17 expired state transition");
    await fails("18 Expired execute", /ProposalNotApproved/, () => send(connection, execute(2n, substituteBuffer), random));
    await fails("18 Expired approve", /InvalidProposalTransition/, () => send(connection, decision(governance.publicKey, 2n, 2), governance));
    await fails("18 Expired reject", /InvalidProposalTransition/, () => send(connection, decision(governance.publicKey, 2n, 3), governance));
    await fails("18 Expired restart", /InvalidProposalTransition/, () => send(connection, start(proposer.publicKey, 2n, 4n), proposer));
    // 19-20 rejected proposal.
    const rejectedHash = hash((await connection.getAccountInfo(rejectedBuffer))!.data);
    await send(connection, create(3n, rejectedBuffer, rejectedHash), proposer); await send(connection, start(proposer.publicKey, 3n, 4n), proposer); await send(connection, decision(governance.publicKey, 3n, 3), governance); console.log("PASS 19 governance rejection");
    await fails("20 Rejected execute", /ProposalNotApproved/, () => send(connection, execute(3n, rejectedBuffer), random));
    await fails("20 Rejected approve", /InvalidProposalTransition/, () => send(connection, decision(governance.publicKey, 3n, 2), governance));
    await fails("20 Rejected twice", /InvalidProposalTransition/, () => send(connection, decision(governance.publicKey, 3n, 3), governance));
    await fails("20 Rejected restart", /InvalidProposalTransition/, () => send(connection, start(proposer.publicKey, 3n, 4n), proposer));
    // 21-23 execute the already-approved proposal through the actual Guard loader CPI.
    await advancePast(await endSlot(1n));
    const beforeExecution = proposalSnapshot((await connection.getAccountInfo(proposalAddress(1n)))!.data);
    console.log(`Policy PDA: ${policy}`); console.log(`Proposal PDA: ${proposalAddress(1n)}`); console.log(`Guard PDA: ${guard}`);
    console.log(`Target ProgramData: ${data}`); console.log(`Candidate buffer: ${buffer}`); console.log(`Candidate SHA-256: ${good.toString("hex")}`);
    const upgradeSig = await send(connection, execute(1n), random); console.log(`PASS 21 Guard loader-v3 upgrade: ${upgradeSig}`);
    for (let i = 0; i < 2; i++) await send(connection, SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: random.publicKey, lamports: 1 }), payer);
    const refreshSig = await send(connection, anchorInstruction(treasury, "refresh_version", [{ pubkey: version, isSigner: false, isWritable: true }]), payer);
    const versionInfo = await connection.getAccountInfo(version); assert(versionInfo); assert.equal(versionInfo.data.readUInt16LE(8), 2, "treasury did not report v2 after Guard upgrade");
    const proposalInfo = await connection.getAccountInfo(proposalAddress(1n)); assert(proposalInfo); const terminal = proposalSnapshot(proposalInfo.data);
    assert.equal(terminal.state, 5, "proposal state must be Executed"); assert(terminal.executedAt !== null, "executed_at_slot missing");
    assert(terminal.decisionAuthority?.equals(governance.publicKey)); assert.equal(terminal.decisionSlot, beforeExecution.decisionSlot);
    assert(terminal.candidate.equals(beforeExecution.candidate)); assert.deepEqual(terminal.candidateHash, beforeExecution.candidateHash);
    console.log(`PASS 23 metadata retained; refresh=${refreshSig}; treasury version=2`);
    await fails("22 Executed execute", /ProposalNotApproved/, () => send(connection, execute(1n), random));
    await fails("22 Executed approve", /InvalidProposalTransition/, () => send(connection, decision(governance.publicKey, 1n, 2), governance));
    await fails("22 Executed reject", /InvalidProposalTransition/, () => send(connection, decision(governance.publicKey, 1n, 3), governance));
    await fails("22 Executed expire", /InvalidProposalTransition/, () => send(connection, expire(1n), random));
    await fails("22 Executed restart", /InvalidProposalTransition/, () => send(connection, start(proposer.publicKey, 1n, 4n), proposer));
    console.log("TERMINAL SHARD ASSERTIONS 15-23 PASSED");
  } finally {
    appendFileSync(`${ROOT}/.localnet/proposal-state-machine-evidence.log`, `${evidence.join("\n")}\n`);
  }
}
try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
