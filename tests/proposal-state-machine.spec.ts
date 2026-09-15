/* Standalone Milestone-3 localnet integration proof. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  COMMITMENT, LOADER_V3, ROOT, SYSVAR_CLOCK, SYSVAR_RENT, anchorInstruction,
  expectFailure, loadIds, loadKeypair, loaderUpgradeInstruction, loaderWriteInstruction,
  programDataAddress, send, sendExpectingOnchainFailure, setLoaderAuthorityInstruction
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
const [version] = PublicKey.findProgramAddressSync([Buffer.from("version")], treasury);
const gateData = programDataAddress(gate);
const [secondaryGuard] = PublicKey.findProgramAddressSync([Buffer.from("faultline"), Buffer.from("guard"), gate.toBuffer()], gate);
const [secondaryPolicy] = PublicKey.findProgramAddressSync([Buffer.from("safety-policy"), gate.toBuffer()], gate);
const u64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; };
const hash = (b: Buffer) => createHash("sha256").update(b).digest();

function proposalAddress(id: bigint) { return PublicKey.findProgramAddressSync([Buffer.from("upgrade-proposal"), policy.toBuffer(), u64(id)], gate)[0]; }
function claimAddress(b: PublicKey) { return PublicKey.findProgramAddressSync([Buffer.from("faultline"), Buffer.from("buffer"), b.toBuffer()], gate)[0]; }
function initPolicy() { return anchorInstruction(gate, "initialize_safety_policy", [
  { pubkey: governance.publicKey, isSigner: true, isWritable: true }, { pubkey: guard, isSigner: false, isWritable: false },
  { pubkey: treasury, isSigner: false, isWritable: false }, { pubkey: policy, isSigner: false, isWritable: true },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
], Buffer.concat([u64(3n), Buffer.from([1, 0]), u64(4n), Buffer.from([1]), hash(Buffer.from("AUTH-001")), governance.publicKey.toBuffer()])); }
function status(actor: PublicKey, paused: boolean) { return anchorInstruction(gate, "set_safety_policy_status", [{ pubkey: actor, isSigner: true, isWritable: false }, { pubkey: policy, isSigner: false, isWritable: true }], Buffer.from([paused ? 1 : 0])); }
function create(id: bigint, candidate: PublicKey, expected: Buffer, target = treasury) { return anchorInstruction(gate, "create_upgrade_proposal", [
  { pubkey: proposer.publicKey, isSigner: true, isWritable: true }, { pubkey: guard, isSigner: false, isWritable: true }, { pubkey: policy, isSigner: false, isWritable: false },
  { pubkey: target, isSigner: false, isWritable: false }, { pubkey: target.equals(treasury) ? data : programDataAddress(target), isSigner: false, isWritable: false },
  { pubkey: candidate, isSigner: false, isWritable: false }, { pubkey: proposalAddress(id), isSigner: false, isWritable: true }, { pubkey: claimAddress(candidate), isSigner: false, isWritable: true },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
], Buffer.concat([u64(id), expected])); }
function start(actor: PublicKey, id: bigint, duration: bigint) { return anchorInstruction(gate, "start_challenge", [{ pubkey: actor, isSigner: true, isWritable: false }, { pubkey: policy, isSigner: false, isWritable: false }, { pubkey: proposalAddress(id), isSigner: false, isWritable: true }], u64(duration)); }
function decision(actor: PublicKey, id: bigint, choice: number) { return anchorInstruction(gate, "record_temporary_decision", [{ pubkey: actor, isSigner: true, isWritable: false }, { pubkey: policy, isSigner: false, isWritable: false }, { pubkey: proposalAddress(id), isSigner: false, isWritable: true }], Buffer.from([choice, 0, 0])); }
function execute(id: bigint, candidate = buffer) { return anchorInstruction(gate, "execute_guarded_upgrade", [
  { pubkey: random.publicKey, isSigner: true, isWritable: false }, { pubkey: guard, isSigner: false, isWritable: false }, { pubkey: policy, isSigner: false, isWritable: false },
  { pubkey: proposalAddress(id), isSigner: false, isWritable: true }, { pubkey: claimAddress(candidate), isSigner: false, isWritable: false }, { pubkey: treasury, isSigner: false, isWritable: true },
  { pubkey: data, isSigner: false, isWritable: true }, { pubkey: candidate, isSigner: false, isWritable: true }, { pubkey: governance.publicKey, isSigner: false, isWritable: true },
  { pubkey: SYSVAR_RENT, isSigner: false, isWritable: false }, { pubkey: SYSVAR_CLOCK, isSigner: false, isWritable: false }, { pubkey: LOADER_V3, isSigner: false, isWritable: false }
]); }
type ExecuteOverrides = Partial<{ guard: PublicKey; policy: PublicKey; proposal: PublicKey; claim: PublicKey; target: PublicKey; programData: PublicKey; candidate: PublicKey; loader: PublicKey }>;
function executeWith(id: bigint, overrides: ExecuteOverrides = {}) {
  const candidate = overrides.candidate ?? buffer;
  return anchorInstruction(gate, "execute_guarded_upgrade", [
    { pubkey: random.publicKey, isSigner: true, isWritable: false }, { pubkey: overrides.guard ?? guard, isSigner: false, isWritable: false },
    { pubkey: overrides.policy ?? policy, isSigner: false, isWritable: false }, { pubkey: overrides.proposal ?? proposalAddress(id), isSigner: false, isWritable: true },
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
  const ledger = `${ROOT}/.localnet/ledger-proposal-state-machine`;
  if (existsSync(ledger)) rmSync(ledger, { recursive: true, force: true });
  try {
    execFileSync("powershell", ["-NoProfile", "-Command", "if (Get-NetTCPConnection -LocalPort 8899 -State Listen -ErrorAction SilentlyContinue) { exit 42 }"], { stdio: "pipe" });
  } catch {
    throw new Error("refusing to attach to an existing process on port 8899");
  }
  const validatorExe = execFileSync("where.exe", ["solana-test-validator.exe"], { encoding: "utf8" }).trim().split(/\r?\n/)[0];
  const validator = spawn(validatorExe, ["--reset", "--ledger", ledger, "--rpc-port", "8899", "--faucet-port", "9900", "--mint", payer.publicKey.toBase58(), "--log"], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  let validatorError = "";
  validator.stderr?.on("data", data => { validatorError += data.toString(); });
  validator.on("error", error => { validatorError += error.message; });
  try {
    for (let i = 0; i < 80; i++) { try { await connection.getLatestBlockhash(COMMITMENT); break; } catch { await new Promise(r => setTimeout(r, 100)); if (i === 79) throw new Error(`validator did not start: ${validatorError}`); } }
    const cli = (...a: string[]) => execFileSync("solana", a, { cwd: ROOT, stdio: "pipe" });
    cli("program", "deploy", "artifacts/gate/faultline_gate.so", "--program-id", ".localnet/faultline-gate-program.json", "--upgrade-authority", ".localnet/payer.json", "--keypair", ".localnet/payer.json", "--url", RPC);
    cli("program", "deploy", "artifacts/treasury/v1/faultline_treasury.so", "--program-id", ".localnet/faultline-treasury-program.json", "--upgrade-authority", ".localnet/payer.json", "--keypair", ".localnet/payer.json", "--url", RPC, "--max-len", "500000");
    for (const name of ["candidate-v2", "candidate-spare", "candidate-approved", "candidate-rejected"]) cli("program", "write-buffer", "artifacts/treasury/v2/faultline_treasury.so", "--buffer", `.localnet/${name}.json`, "--buffer-authority", ".localnet/proposer.json", "--fee-payer", ".localnet/payer.json", "--keypair", ".localnet/payer.json", "--url", RPC);
    await send(connection, anchorInstruction(treasury, "initialize_version", [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }, { pubkey: version, isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }]), payer);
    console.log(`Guard init: ${await send(connection, anchorInstruction(gate, "initialize_guard", [{ pubkey: governance.publicKey, isSigner: true, isWritable: true }, { pubkey: treasury, isSigner: false, isWritable: false }, { pubkey: data, isSigner: false, isWritable: false }, { pubkey: guard, isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }]), governance)}`);
    await send(connection, anchorInstruction(gate, "initialize_guard", [{ pubkey: governance.publicKey, isSigner: true, isWritable: true }, { pubkey: gate, isSigner: false, isWritable: false }, { pubkey: gateData, isSigner: false, isWritable: false }, { pubkey: secondaryGuard, isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }]), governance);
    await send(connection, anchorInstruction(gate, "initialize_safety_policy", [
      { pubkey: governance.publicKey, isSigner: true, isWritable: true }, { pubkey: secondaryGuard, isSigner: false, isWritable: false }, { pubkey: gate, isSigner: false, isWritable: false }, { pubkey: secondaryPolicy, isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
    ], Buffer.concat([u64(99n), Buffer.from([1, 0]), u64(4n), Buffer.from([1]), hash(Buffer.from("SECONDARY")), governance.publicKey.toBuffer()])), governance);
    cli("program", "set-upgrade-authority", gate.toBase58(), "--final", "--upgrade-authority", ".localnet/payer.json", "--keypair", ".localnet/payer.json", "--url", RPC);
    await transferUpgradeAuthority(connection, treasury, payer, guard);
    const rejectedBuffer = new PublicKey(ids["candidate-approved"]);
    const uncommittedBuffer = new PublicKey(ids["candidate-rejected"]);
    for (const b of [buffer, substituteBuffer, rejectedBuffer, uncommittedBuffer]) await send(connection, setLoaderAuthorityInstruction(b, proposer.publicKey, guard), payer, [proposer]);
    const lockedHash = hash((await connection.getAccountInfo(buffer))!.data);
    const directDeployerSig = await sendExpectingOnchainFailure(connection, loaderUpgradeInstruction(treasury, buffer, payer.publicKey, payer.publicKey), payer, "24 original deployer direct upgrade", /Incorrect authority|incorrect authority/i);
    assert.equal(await versionNumber(), 1); console.log(`PASS 24 deployer rejected onchain: ${directDeployerSig}`);
    const directRandomSig = await sendExpectingOnchainFailure(connection, loaderUpgradeInstruction(treasury, buffer, random.publicKey, payer.publicKey), payer, "25 random direct upgrade", /Incorrect authority|incorrect authority/i, [random]);
    assert.equal(await versionNumber(), 1); console.log(`PASS 25 random rejected onchain: ${directRandomSig}`);
    const lockedWriteSig = await sendExpectingOnchainFailure(connection, loaderWriteInstruction(buffer, proposer.publicKey, Buffer.from([0x42])), payer, "27 previous buffer authority write", /Incorrect authority|incorrect authority/i, [proposer]);
    assert.deepEqual(hash((await connection.getAccountInfo(buffer))!.data), lockedHash); console.log(`PASS 27 locked buffer immutable: ${lockedWriteSig}`);
    console.log(`Policy init: ${await send(connection, initPolicy(), governance)}`); console.log("PASS 1 policy initialized");
    assert((await connection.getAccountInfo(policy))?.owner.equals(gate));
    await fails("2 duplicate policy", /already in use|AccountAlreadyInitialized/, () => send(connection, initPolicy(), governance));
    await fails("3 non-governance pause", /UnauthorizedGovernance/, () => send(connection, status(random.publicKey, true), random));
    await send(connection, status(governance.publicKey, true), governance); await send(connection, status(governance.publicKey, false), governance); console.log("PASS 4 governance pause/unpause");
    await send(connection, status(governance.publicKey, true), governance); const good = hash((await connection.getAccountInfo(buffer))!.data); await fails("5 paused policy create", /PolicyPaused/, () => send(connection, create(1n, buffer, good), proposer)); await send(connection, status(governance.publicKey, false), governance);
    await fails("6 wrong target", /ConstraintHasOne|WrongTargetProgram/, () => send(connection, create(1n, buffer, good, gate), proposer));
    await fails("7 wrong expected hash", /CandidateHashMismatch/, () => send(connection, create(1n, buffer, Buffer.alloc(32, 9)), proposer));
    await fails("8 substituted buffer claim", /CandidateHashMismatch/, () => send(connection, create(1n, substituteBuffer, good), proposer));
    await send(connection, create(1n, buffer, good), proposer); console.log("PASS proposal Draft created");
    const committedAtCreate = proposalSnapshot((await connection.getAccountInfo(proposalAddress(1n)))!.data);
    await fails("28 claimed buffer reused", /already in use|AccountAlreadyInitialized/, () => send(connection, create(4n, buffer, good), proposer));
    assert.equal(await connection.getAccountInfo(proposalAddress(4n)), null);
    await fails("9 duplicate proposal PDA", /already in use|AccountAlreadyInitialized/, () => send(connection, create(1n, buffer, good), proposer));
    await fails("10 duration below minimum", /ChallengeDurationTooShort/, () => send(connection, start(proposer.publicKey, 1n, 3n), proposer));
    await fails("11 Draft execute", /ProposalNotApproved/, () => send(connection, execute(1n), random));
    await fails("12 unauthorized challenge starter", /UnauthorizedChallengeStarter/, () => send(connection, start(random.publicKey, 1n, 4n), random));
    await send(connection, start(proposer.publicKey, 1n, 4n), proposer);
    await fails("13 unauthorized decision", /UnauthorizedGovernance/, () => send(connection, decision(random.publicKey, 1n, 2), random));
    await send(connection, decision(governance.publicKey, 1n, 2), governance);
    await fails("14 early approved execution", /ChallengeWindowStillActive/, () => send(connection, execute(1n), random));
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
    const upgradeSig = await send(connection, execute(1n), random); console.log(`PASS 21 Guard loader-v3 upgrade: ${upgradeSig}`);
    for (let i = 0; i < 2; i++) await send(connection, SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: random.publicKey, lamports: 1 }), payer);
    await send(connection, anchorInstruction(treasury, "refresh_version", [{ pubkey: version, isSigner: false, isWritable: true }]), payer);
    const versionInfo = await connection.getAccountInfo(version); assert(versionInfo); assert.equal(versionInfo.data.readUInt16LE(8), 2, "treasury did not report v2 after Guard upgrade");
    const proposalInfo = await connection.getAccountInfo(proposalAddress(1n)); assert(proposalInfo); assert.equal(proposalInfo.data[234], 5, "proposal state must be Executed"); assert.equal(proposalInfo.data[280], 1, "executed_at_slot option missing"); console.log("PASS 23 Executed metadata retained; treasury version=2");
    await fails("22 Executed execute", /ProposalNotApproved/, () => send(connection, execute(1n), random));
    await fails("22 Executed approve", /InvalidProposalTransition/, () => send(connection, decision(governance.publicKey, 1n, 2), governance));
    await fails("22 Executed reject", /InvalidProposalTransition/, () => send(connection, decision(governance.publicKey, 1n, 3), governance));
    await fails("22 Executed expire", /InvalidProposalTransition/, () => send(connection, expire(1n), random));
    await fails("22 Executed restart", /InvalidProposalTransition/, () => send(connection, start(proposer.publicKey, 1n, 4n), proposer));
    console.log("ALL 14 PRE-DECISION/STATE ASSERTIONS PASSED");
  } finally {
    if (validator.exitCode === null) {
      validator.kill();
      await new Promise<void>(resolve => validator.once("exit", () => resolve()));
    }
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
