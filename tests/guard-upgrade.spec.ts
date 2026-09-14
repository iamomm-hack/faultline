import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction
} from "@solana/web3.js";
import {
  COMMITMENT,
  LOADER_V3,
  RPC_URL,
  SYSVAR_CLOCK,
  SYSVAR_RENT,
  anchorInstruction,
  discriminator,
  expectFailure,
  loadIds,
  loadKeypair,
  loaderAuthority,
  loaderAuthorityOptional,
  loaderUpgradeInstruction,
  loaderWriteInstruction,
  programDataAddress,
  send,
  sendExpectingOnchainFailure,
  setLoaderAuthorityInstruction
} from "../scripts/lib/solana.js";
import { transferUpgradeAuthority } from "../scripts/transfer-upgrade-authority.js";
import { verifyGuardAuthority } from "../scripts/verify-guard-authority.js";

const connection = new Connection(RPC_URL, COMMITMENT);
const ids = loadIds();
const payer = loadKeypair("payer");
const governance = loadKeypair("governance");
const proposer = loadKeypair("proposer");
const random = loadKeypair("random");
const gateProgram = new PublicKey(ids["faultline-gate-program"]);
const treasuryProgram = new PublicKey(ids["faultline-treasury-program"]);
const approvedBuffer = new PublicKey(ids["candidate-approved"]);
const rejectedBuffer = new PublicKey(ids["candidate-rejected"]);
const spareBuffer = new PublicKey(ids["candidate-spare"]);
const treasuryProgramData = programDataAddress(treasuryProgram);
const gateProgramData = programDataAddress(gateProgram);

const [guardPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("faultline"), Buffer.from("guard"), treasuryProgram.toBuffer()],
  gateProgram
);
const [versionPda] = PublicKey.findProgramAddressSync([Buffer.from("version")], treasuryProgram);

function proposalId(label: string): Buffer {
  return createHash("sha256").update(`FAULTLINE_M1:${label}`).digest();
}

function proposalAddresses(id: Buffer, buffer: PublicKey): { proposal: PublicKey; claim: PublicKey } {
  const [proposal] = PublicKey.findProgramAddressSync(
    [Buffer.from("faultline"), Buffer.from("proposal"), treasuryProgram.toBuffer(), id],
    gateProgram
  );
  const [claim] = PublicKey.findProgramAddressSync(
    [Buffer.from("faultline"), Buffer.from("buffer"), buffer.toBuffer()],
    gateProgram
  );
  return { proposal, claim };
}

function createProposalIx(id: Buffer, buffer: PublicKey, proposal: PublicKey, claim: PublicKey) {
  return anchorInstruction(
    gateProgram,
    "create_minimal_proposal",
    [
      { pubkey: proposer.publicKey, isSigner: true, isWritable: true },
      { pubkey: guardPda, isSigner: false, isWritable: true },
      { pubkey: treasuryProgram, isSigner: false, isWritable: false },
      { pubkey: treasuryProgramData, isSigner: false, isWritable: false },
      { pubkey: buffer, isSigner: false, isWritable: false },
      { pubkey: proposal, isSigner: false, isWritable: true },
      { pubkey: claim, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
    ],
    id
  );
}

function governIx(
  name: "approve_minimal_proposal" | "reject_minimal_proposal",
  signer: PublicKey,
  proposal: PublicKey,
  claim: PublicKey,
  buffer: PublicKey
) {
  return anchorInstruction(gateProgram, name, [
    { pubkey: signer, isSigner: true, isWritable: false },
    { pubkey: guardPda, isSigner: false, isWritable: false },
    { pubkey: proposal, isSigner: false, isWritable: true },
    { pubkey: claim, isSigner: false, isWritable: false },
    { pubkey: buffer, isSigner: false, isWritable: false }
  ]);
}

type ExecuteOverrides = Partial<{
  guard: PublicKey;
  target: PublicKey;
  programData: PublicKey;
  buffer: PublicKey;
  loader: PublicKey;
}>;

function executeIx(proposal: PublicKey, overrides: ExecuteOverrides = {}) {
  return anchorInstruction(gateProgram, "execute_guarded_upgrade", [
    { pubkey: random.publicKey, isSigner: true, isWritable: false },
    { pubkey: overrides.guard ?? guardPda, isSigner: false, isWritable: false },
    { pubkey: proposal, isSigner: false, isWritable: true },
    { pubkey: overrides.target ?? treasuryProgram, isSigner: false, isWritable: true },
    { pubkey: overrides.programData ?? treasuryProgramData, isSigner: false, isWritable: true },
    { pubkey: overrides.buffer ?? approvedBuffer, isSigner: false, isWritable: true },
    { pubkey: governance.publicKey, isSigner: false, isWritable: true },
    { pubkey: SYSVAR_RENT, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_CLOCK, isSigner: false, isWritable: false },
    { pubkey: overrides.loader ?? LOADER_V3, isSigner: false, isWritable: false }
  ]);
}

async function readTreasuryVersion(): Promise<{ version: number; marker: string }> {
  const info = await connection.getAccountInfo(versionPda, COMMITMENT);
  if (!info) throw new Error("Treasury VersionState is missing");
  assert.deepEqual(info.data.subarray(0, 8), discriminator("account", "VersionState"));
  return {
    version: info.data.readUInt16LE(8),
    marker: info.data.subarray(10, 26).toString("ascii")
  };
}

async function fundActors(): Promise<void> {
  const tx = new Transaction();
  for (const recipient of [governance.publicKey, proposer.publicKey, random.publicKey]) {
    tx.add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: recipient, lamports: 5 * LAMPORTS_PER_SOL }));
  }
  const signature = await sendAndConfirmTransaction(connection, tx, [payer], { commitment: COMMITMENT });
  console.log(`Fund actors transaction: ${signature}`);
}

async function handoffBuffer(buffer: PublicKey): Promise<string> {
  const before = await loaderAuthority(connection, buffer, 1);
  assert(before.equals(proposer.publicKey), "buffer must initially belong to proposer");
  const signature = await send(
    connection,
    setLoaderAuthorityInstruction(buffer, proposer.publicKey, guardPda),
    payer,
    [proposer]
  );
  const after = await loaderAuthority(connection, buffer, 1);
  assert(after.equals(guardPda), "buffer handoff did not lock to Guard PDA");
  return signature;
}

async function main(): Promise<void> {
  console.log("\nFAULTLINE MILESTONE-1 REAL LOADER PROOF");
  console.log(`Faultline program ID: ${gateProgram}`);
  console.log(`Treasury program ID:  ${treasuryProgram}`);
  console.log(`ProgramData address:   ${treasuryProgramData}`);
  console.log(`Guard PDA:             ${guardPda}`);
  console.log(`Candidate buffer:      ${approvedBuffer}`);

  const [guardAgain] = PublicKey.findProgramAddressSync(
    [Buffer.from("faultline"), Buffer.from("guard"), treasuryProgram.toBuffer()],
    gateProgram
  );
  assert(guardAgain.equals(guardPda), "Guard PDA derivation is not deterministic");
  assert.equal(await loaderAuthorityOptional(connection, gateProgramData, 3), null, "gate program must be immutable");
  console.log("Verified Faultline gate is immutable (no deployer bypass authority)");
  await fundActors();

  const initializeVersion = anchorInstruction(treasuryProgram, "initialize_version", [
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: versionPda, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
  ]);
  console.log(`Initialize v1 state transaction: ${await send(connection, initializeVersion, payer)}`);
  assert.deepEqual(await readTreasuryVersion(), { version: 1, marker: "TREASURY_V1_____" });
  console.log("Treasury before upgrade: version=1 marker=TREASURY_V1_____");

  const initializeGuard = anchorInstruction(gateProgram, "initialize_guard", [
    { pubkey: governance.publicKey, isSigner: true, isWritable: true },
    { pubkey: treasuryProgram, isSigner: false, isWritable: false },
    { pubkey: treasuryProgramData, isSigner: false, isWritable: false },
    { pubkey: guardPda, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
  ]);
  console.log(`Initialize Guard transaction: ${await send(connection, initializeGuard, governance)}`);

  const transferSignature = await transferUpgradeAuthority(
    connection,
    treasuryProgram,
    payer,
    guardPda
  );
  console.log(`Transfer target authority transaction: ${transferSignature}`);
  assert((await verifyGuardAuthority(connection, treasuryProgram, guardPda)).equals(treasuryProgramData));
  console.log("Verified ProgramData upgrade authority equals Guard PDA");

  for (const buffer of [approvedBuffer, rejectedBuffer, spareBuffer]) {
    console.log(`Lock buffer ${buffer}: ${await handoffBuffer(buffer)}`);
  }

  await sendExpectingOnchainFailure(
    connection,
    loaderUpgradeInstruction(treasuryProgram, approvedBuffer, payer.publicKey, payer.publicKey),
    payer,
    "original deployer direct upgrade",
    /Buffer and upgrade authority don't match/
  );
  await sendExpectingOnchainFailure(
    connection,
    loaderUpgradeInstruction(treasuryProgram, approvedBuffer, random.publicKey, random.publicKey),
    random,
    "random wallet direct upgrade",
    /Buffer and upgrade authority don't match/
  );
  await sendExpectingOnchainFailure(
    connection,
    loaderWriteInstruction(approvedBuffer, proposer.publicKey, Buffer.from([0xff])),
    proposer,
    "proposer writes locked buffer",
    /Incorrect buffer authority provided/
  );

  const approvedId = proposalId("approved-v2");
  const approved = proposalAddresses(approvedId, approvedBuffer);
  console.log(`Proposal PDA:          ${approved.proposal}`);
  console.log(`Create proposal transaction: ${await send(connection, createProposalIx(approvedId, approvedBuffer, approved.proposal, approved.claim), proposer)}`);

  await expectFailure("pending proposal execution", () => send(connection, executeIx(approved.proposal), random));
  await expectFailure("fake Guard PDA", () =>
    send(connection, executeIx(approved.proposal, { guard: random.publicKey }), random)
  );
  await expectFailure("wrong target program", () =>
    send(connection, executeIx(approved.proposal, { target: gateProgram }), random)
  );
  await expectFailure("wrong ProgramData account", () =>
    send(connection, executeIx(approved.proposal, { programData: gateProgramData }), random)
  );
  await expectFailure("wrong loader program", () =>
    send(connection, executeIx(approved.proposal, { loader: SystemProgram.programId }), random)
  );
  await expectFailure("wrong candidate buffer", () =>
    send(connection, executeIx(approved.proposal, { buffer: spareBuffer }), random)
  );
  await expectFailure("non-governance approval", () =>
    send(
      connection,
      governIx("approve_minimal_proposal", random.publicKey, approved.proposal, approved.claim, approvedBuffer),
      random
    )
  );

  console.log(
    `Approve proposal transaction: ${await send(
      connection,
      governIx("approve_minimal_proposal", governance.publicKey, approved.proposal, approved.claim, approvedBuffer),
      governance
    )}`
  );
  await sendExpectingOnchainFailure(
    connection,
    loaderWriteInstruction(approvedBuffer, proposer.publicKey, Buffer.from([0x00])),
    proposer,
    "post-approval candidate mutation",
    /Incorrect buffer authority provided/
  );
  await expectFailure("approved proposal buffer replacement", () =>
    send(connection, executeIx(approved.proposal, { buffer: spareBuffer }), random)
  );

  const reuseId = proposalId("illegal-buffer-reuse");
  const reuse = proposalAddresses(reuseId, approvedBuffer);
  await expectFailure("buffer reused by another proposal", () =>
    send(connection, createProposalIx(reuseId, approvedBuffer, reuse.proposal, reuse.claim), proposer)
  );

  const rejectedId = proposalId("rejected-v2");
  const rejected = proposalAddresses(rejectedId, rejectedBuffer);
  console.log(`Create rejected-path proposal: ${await send(connection, createProposalIx(rejectedId, rejectedBuffer, rejected.proposal, rejected.claim), proposer)}`);
  console.log(
    `Reject proposal transaction: ${await send(
      connection,
      governIx("reject_minimal_proposal", governance.publicKey, rejected.proposal, rejected.claim, rejectedBuffer),
      governance
    )}`
  );
  await expectFailure("rejected proposal execution", () =>
    send(connection, executeIx(rejected.proposal, { buffer: rejectedBuffer }), random)
  );
  await expectFailure("rejected proposal cannot become approved", () =>
    send(
      connection,
      governIx("approve_minimal_proposal", governance.publicKey, rejected.proposal, rejected.claim, rejectedBuffer),
      governance
    )
  );

  const executeSignature = await send(connection, executeIx(approved.proposal), random);
  console.log(`Guarded loader upgrade transaction: ${executeSignature}`);
  const visibilityStartSlot = await connection.getSlot(COMMITMENT);
  while ((await connection.getSlot(COMMITMENT)) < visibilityStartSlot + 2) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const refreshVersion = anchorInstruction(treasuryProgram, "refresh_version", [
    { pubkey: versionPda, isSigner: false, isWritable: true }
  ]);
  console.log(`Refresh v2 behavior transaction: ${await send(connection, refreshVersion, payer)}`);
  assert.deepEqual(await readTreasuryVersion(), { version: 2, marker: "TREASURY_V2_____" });
  console.log("Treasury after upgrade:  version=2 marker=TREASURY_V2_____");

  assert(treasuryProgram.equals(new PublicKey(ids["faultline-treasury-program"])), "program ID changed");
  await verifyGuardAuthority(connection, treasuryProgram, guardPda);
  await expectFailure("repeat execution", () => send(connection, executeIx(approved.proposal), random));
  await expectFailure("executed proposal cannot be approved again", () =>
    send(
      connection,
      governIx("approve_minimal_proposal", governance.publicKey, approved.proposal, approved.claim, approvedBuffer),
      governance
    )
  );
  await expectFailure("executed proposal cannot be rejected", () =>
    send(
      connection,
      governIx("reject_minimal_proposal", governance.publicKey, approved.proposal, approved.claim, approvedBuffer),
      governance
    )
  );

  console.log("Cancellation test: not applicable; Milestone 1 intentionally exposes no cancellation instruction.");
  console.log("ALL 24 APPLICABLE LOADER/AUTHORITY/STATE ASSERTIONS PASSED");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
