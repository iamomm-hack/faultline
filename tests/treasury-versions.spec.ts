import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
  ROOT,
  RPC_URL,
  SYSVAR_CLOCK,
  SYSVAR_RENT,
  anchorInstruction,
  discriminator,
  expectFailure,
  loadIds,
  loadKeypair,
  loaderAuthority,
  programDataAddress,
  send,
  setLoaderAuthorityInstruction
} from "../scripts/lib/solana.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createTokenAccount,
  mintTo,
  tokenAmount
} from "../scripts/lib/spl-token-lite.js";
import { transferUpgradeAuthority } from "../scripts/transfer-upgrade-authority.js";
import { verifyGuardAuthority } from "../scripts/verify-guard-authority.js";

type Scenario = "v2" | "v3";
type TraceInstruction = {
  program_id_ref: string;
  instruction: string;
  data_base64: string;
  accounts: { ref: string; is_signer: boolean; is_writable: boolean }[];
};
type TraceTransaction = {
  step: number;
  label: string;
  signer_aliases: string[];
  instructions: TraceInstruction[];
};

const scenarioArg = process.argv.find((arg) => arg.startsWith("--scenario="));
const scenario = (scenarioArg?.split("=")[1] ?? "v2") as Scenario;
assert(["v2", "v3"].includes(scenario), "scenario must be v2 or v3");

const INITIAL_TREASURY_BALANCE = 1_000_000_000n;
const EXPLOIT_WITHDRAW_AMOUNT = 100_000_000n;
const LEGIT_WITHDRAW_AMOUNT = 50_000_000n;
const TREASURY_ACCOUNT_SIZE = 8 + 1 + 32 + 32 + 8 + 1 + 128;

const connection = new Connection(RPC_URL, COMMITMENT);
const ids = loadIds();
const payer = loadKeypair("payer");
const governance = loadKeypair("governance");
const proposer = loadKeypair("proposer");
const random = loadKeypair("random");
const admin = loadKeypair("treasury-admin");
const attacker = loadKeypair("attacker");
const user = loadKeypair("user");
const newAdmin = loadKeypair("new-admin");
const paymentMint = loadKeypair("payment-mint");
const wrongPaymentMint = loadKeypair("wrong-payment-mint");
const vaultToken = loadKeypair("treasury-vault-token");
const userToken = loadKeypair("user-token");
const attackerToken = loadKeypair("attacker-token");
const adminToken = loadKeypair("admin-token");
const newAdminToken = loadKeypair("new-admin-token");
const wrongVaultToken = loadKeypair("wrong-vault-token");
const wrongUserToken = loadKeypair("wrong-user-token");

const gateProgram = new PublicKey(ids["faultline-gate-program"]);
const treasuryProgram = new PublicKey(ids["faultline-treasury-program"]);
const selectedBuffer = new PublicKey(ids[scenario === "v2" ? "candidate-v2" : "candidate-v3"]);
const treasuryProgramData = programDataAddress(treasuryProgram);
const [guardPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("faultline"), Buffer.from("guard"), treasuryProgram.toBuffer()],
  gateProgram
);
const [treasuryPda] = PublicKey.findProgramAddressSync([Buffer.from("treasury")], treasuryProgram);
const [versionPda] = PublicKey.findProgramAddressSync([Buffer.from("version")], treasuryProgram);

function u64(value: bigint): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(value);
  return buffer;
}

function proposalId(label: string): Buffer {
  return createHash("sha256").update(`FAULTLINE_M2:${label}`).digest();
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

function approveIx(proposal: PublicKey, claim: PublicKey, buffer: PublicKey) {
  return anchorInstruction(gateProgram, "approve_minimal_proposal", [
    { pubkey: governance.publicKey, isSigner: true, isWritable: false },
    { pubkey: guardPda, isSigner: false, isWritable: false },
    { pubkey: proposal, isSigner: false, isWritable: true },
    { pubkey: claim, isSigner: false, isWritable: false },
    { pubkey: buffer, isSigner: false, isWritable: false }
  ]);
}

function executeUpgradeIx(proposal: PublicKey, buffer: PublicKey) {
  return anchorInstruction(gateProgram, "execute_guarded_upgrade", [
    { pubkey: random.publicKey, isSigner: true, isWritable: false },
    { pubkey: guardPda, isSigner: false, isWritable: false },
    { pubkey: proposal, isSigner: false, isWritable: true },
    { pubkey: treasuryProgram, isSigner: false, isWritable: true },
    { pubkey: treasuryProgramData, isSigner: false, isWritable: true },
    { pubkey: buffer, isSigner: false, isWritable: true },
    { pubkey: governance.publicKey, isSigner: false, isWritable: true },
    { pubkey: SYSVAR_RENT, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_CLOCK, isSigner: false, isWritable: false },
    { pubkey: LOADER_V3, isSigner: false, isWritable: false }
  ]);
}

function initializeTreasuryIx() {
  return anchorInstruction(treasuryProgram, "initialize_treasury", [
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: admin.publicKey, isSigner: true, isWritable: false },
    { pubkey: treasuryPda, isSigner: false, isWritable: true },
    { pubkey: vaultToken.publicKey, isSigner: false, isWritable: false },
    { pubkey: paymentMint.publicKey, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
  ]);
}

function depositIx(depositor: PublicKey, depositorToken: PublicKey, amount: bigint, mint = paymentMint.publicKey, tokenProgram = TOKEN_PROGRAM_ID) {
  return anchorInstruction(
    treasuryProgram,
    "deposit",
    [
      { pubkey: depositor, isSigner: true, isWritable: false },
      { pubkey: treasuryPda, isSigner: false, isWritable: true },
      { pubkey: depositorToken, isSigner: false, isWritable: true },
      { pubkey: vaultToken.publicKey, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false }
    ],
    u64(amount)
  );
}

function withdrawIx(adminKey: PublicKey, destination: PublicKey, amount: bigint, overrides: Partial<{ treasury: PublicKey; vault: PublicKey; mint: PublicKey; tokenProgram: PublicKey }> = {}) {
  return anchorInstruction(
    treasuryProgram,
    "admin_withdraw",
    [
      { pubkey: adminKey, isSigner: true, isWritable: false },
      { pubkey: overrides.treasury ?? treasuryPda, isSigner: false, isWritable: true },
      { pubkey: overrides.vault ?? vaultToken.publicKey, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: overrides.mint ?? paymentMint.publicKey, isSigner: false, isWritable: false },
      { pubkey: overrides.tokenProgram ?? TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
    ],
    u64(amount)
  );
}

function migrateIx(currentAdmin: PublicKey, newAuthority: PublicKey) {
  return anchorInstruction(treasuryProgram, "migrate_authority", [
    { pubkey: treasuryPda, isSigner: false, isWritable: true },
    { pubkey: currentAdmin, isSigner: true, isWritable: false },
    { pubkey: newAuthority, isSigner: true, isWritable: false },
    { pubkey: vaultToken.publicKey, isSigner: false, isWritable: false },
    { pubkey: paymentMint.publicKey, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
  ]);
}

async function fundActors(): Promise<void> {
  const tx = new Transaction();
  for (const recipient of [governance.publicKey, proposer.publicKey, random.publicKey, admin.publicKey, attacker.publicKey, user.publicKey, newAdmin.publicKey]) {
    tx.add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: recipient, lamports: 3 * LAMPORTS_PER_SOL }));
  }
  console.log(`Fund actors transaction: ${await sendAndConfirmTransaction(connection, tx, [payer], { commitment: COMMITMENT })}`);
}

async function initializeTokenFixture(): Promise<void> {
  console.log(`Create fUSDC mint: ${await createMint(connection, payer, paymentMint, payer.publicKey, 6)}`);
  console.log(`Create wrong mint: ${await createMint(connection, payer, wrongPaymentMint, payer.publicKey, 6)}`);
  console.log(`Create treasury vault token account: ${await createTokenAccount(connection, payer, vaultToken, paymentMint.publicKey, treasuryPda)}`);
  console.log(`Create user token account: ${await createTokenAccount(connection, payer, userToken, paymentMint.publicKey, user.publicKey)}`);
  console.log(`Create attacker token account: ${await createTokenAccount(connection, payer, attackerToken, paymentMint.publicKey, attacker.publicKey)}`);
  console.log(`Create admin token account: ${await createTokenAccount(connection, payer, adminToken, paymentMint.publicKey, admin.publicKey)}`);
  console.log(`Create new admin token account: ${await createTokenAccount(connection, payer, newAdminToken, paymentMint.publicKey, newAdmin.publicKey)}`);
  console.log(`Create wrong vault token account: ${await createTokenAccount(connection, payer, wrongVaultToken, paymentMint.publicKey, attacker.publicKey)}`);
  console.log(`Create wrong user token account: ${await createTokenAccount(connection, payer, wrongUserToken, wrongPaymentMint.publicKey, user.publicKey)}`);
  console.log(`Mint user fixture tokens: ${await mintTo(connection, payer, paymentMint.publicKey, userToken.publicKey, payer, INITIAL_TREASURY_BALANCE + LEGIT_WITHDRAW_AMOUNT + LEGIT_WITHDRAW_AMOUNT)}`);
}

type TreasuryStateView = {
  schemaVersion: number;
  admin: PublicKey;
  vault: PublicKey;
  totalDeposited: bigint;
  bump: number;
  rawLength: number;
};

async function readTreasuryState(account = treasuryPda): Promise<TreasuryStateView> {
  const info = await connection.getAccountInfo(account, COMMITMENT);
  if (!info) throw new Error(`Treasury state missing at ${account}`);
  assert.equal(info.data.length, TREASURY_ACCOUNT_SIZE, "TreasuryState size changed");
  assert.deepEqual(info.data.subarray(0, 8), discriminator("account", "TreasuryState"), "TreasuryState discriminator changed");
  return {
    schemaVersion: info.data.readUInt8(8),
    admin: new PublicKey(info.data.subarray(9, 41)),
    vault: new PublicKey(info.data.subarray(41, 73)),
    totalDeposited: info.data.readBigUInt64LE(73),
    bump: info.data.readUInt8(81),
    rawLength: info.data.length
  };
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

async function handoffSelectedBuffer(): Promise<void> {
  const before = await loaderAuthority(connection, selectedBuffer, 1);
  assert(before.equals(proposer.publicKey), "candidate buffer must initially belong to proposer");
  console.log(`Lock ${scenario} buffer: ${await send(connection, setLoaderAuthorityInstruction(selectedBuffer, proposer.publicKey, guardPda), payer, [proposer])}`);
  const after = await loaderAuthority(connection, selectedBuffer, 1);
  assert(after.equals(guardPda), "candidate buffer was not locked to Guard PDA");
}

async function guardedUpgradeToScenario(): Promise<void> {
  const initializeGuard = anchorInstruction(gateProgram, "initialize_guard", [
    { pubkey: governance.publicKey, isSigner: true, isWritable: true },
    { pubkey: treasuryProgram, isSigner: false, isWritable: false },
    { pubkey: treasuryProgramData, isSigner: false, isWritable: false },
    { pubkey: guardPda, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
  ]);
  console.log(`Initialize Guard transaction: ${await send(connection, initializeGuard, governance)}`);
  console.log(`Transfer treasury authority to Guard: ${await transferUpgradeAuthority(connection, treasuryProgram, payer, guardPda)}`);
  await verifyGuardAuthority(connection, treasuryProgram, guardPda);
  await handoffSelectedBuffer();
  const [policy] = PublicKey.findProgramAddressSync([Buffer.from("safety-policy"), treasuryProgram.toBuffer()], gateProgram);
  const policyId = 2n;
  const minSlots = 2n;
  const invariantHash = createHash("sha256").update("AUTH-001").digest();
  console.log(`Initialize SafetyPolicy: ${await send(connection, anchorInstruction(gateProgram, "initialize_safety_policy", [
    { pubkey: governance.publicKey, isSigner: true, isWritable: true }, { pubkey: guardPda, isSigner: false, isWritable: false },
    { pubkey: treasuryProgram, isSigner: false, isWritable: false }, { pubkey: policy, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
  ], Buffer.concat([u64(policyId), Buffer.from([1, 0]), u64(minSlots), Buffer.from([1]), invariantHash, governance.publicKey.toBuffer()])), governance)}`);
  console.log("[1] SafetyPolicy created");
  const proposalNumber = 1n;
  const [proposal] = PublicKey.findProgramAddressSync([Buffer.from("upgrade-proposal"), policy.toBuffer(), u64(proposalNumber)], gateProgram);
  const [verificationGate] = PublicKey.findProgramAddressSync([Buffer.from("proposal-verification-gate"), proposal.toBuffer()], gateProgram);
  const [claim] = PublicKey.findProgramAddressSync([Buffer.from("faultline"), Buffer.from("buffer"), selectedBuffer.toBuffer()], gateProgram);
  const bufferInfo = await connection.getAccountInfo(selectedBuffer, COMMITMENT);
  assert(bufferInfo, "candidate buffer missing for canonical proposal");
  const candidateHash = createHash("sha256").update(bufferInfo.data).digest();
  console.log(`Proposal PDA: ${proposal}`);
  console.log(`Create ${scenario} proposal: ${await send(connection, anchorInstruction(gateProgram, "create_upgrade_proposal", [
    { pubkey: proposer.publicKey, isSigner: true, isWritable: true }, { pubkey: guardPda, isSigner: false, isWritable: true },
    { pubkey: policy, isSigner: false, isWritable: false }, { pubkey: treasuryProgram, isSigner: false, isWritable: false },
    { pubkey: treasuryProgramData, isSigner: false, isWritable: false }, { pubkey: selectedBuffer, isSigner: false, isWritable: false },
    { pubkey: proposal, isSigner: false, isWritable: true }, { pubkey: verificationGate, isSigner: false, isWritable: true }, { pubkey: claim, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
  ], Buffer.concat([u64(proposalNumber), candidateHash])), proposer)}`);
  console.log("[2] UpgradeProposal created in Draft");
  console.log(`Start challenge: ${await send(connection, anchorInstruction(gateProgram, "start_challenge", [
    { pubkey: proposer.publicKey, isSigner: true, isWritable: false }, { pubkey: policy, isSigner: false, isWritable: false }, { pubkey: proposal, isSigner: false, isWritable: true }
  ], u64(minSlots)), proposer)}`);
  console.log("[3] Challenge started with start/end slots");
  const lifecycleExecute = () => anchorInstruction(gateProgram, "execute_guarded_upgrade", [
    { pubkey: random.publicKey, isSigner: true, isWritable: false }, { pubkey: guardPda, isSigner: false, isWritable: false },
    { pubkey: policy, isSigner: false, isWritable: false }, { pubkey: proposal, isSigner: false, isWritable: true }, { pubkey: verificationGate, isSigner: false, isWritable: false }, { pubkey: claim, isSigner: false, isWritable: false },
    { pubkey: treasuryProgram, isSigner: false, isWritable: true }, { pubkey: treasuryProgramData, isSigner: false, isWritable: true },
    { pubkey: selectedBuffer, isSigner: false, isWritable: true }, { pubkey: governance.publicKey, isSigner: false, isWritable: true },
    { pubkey: SYSVAR_RENT, isSigner: false, isWritable: false }, { pubkey: SYSVAR_CLOCK, isSigner: false, isWritable: false }, { pubkey: LOADER_V3, isSigner: false, isWritable: false }
  ]);
  await expectFailure("Draft/ChallengeActive execution blocked", () => send(connection, lifecycleExecute(), random));
  console.log("[4] Early execution correctly rejected");
  console.log(`Temporary approve: ${await send(connection, anchorInstruction(gateProgram, "record_temporary_decision", [
    { pubkey: governance.publicKey, isSigner: true, isWritable: false }, { pubkey: policy, isSigner: false, isWritable: false }, { pubkey: proposal, isSigner: false, isWritable: true }, { pubkey: verificationGate, isSigner: false, isWritable: false }
  ], Buffer.from([2, 0, 0])), governance)}`);
  console.log("[5] Governance temporary approval recorded");
  const proposalInfo = await connection.getAccountInfo(proposal, COMMITMENT);
  assert(proposalInfo, "proposal missing");
  const challengeEnd = proposalInfo.data.readBigUInt64LE(8 + 32 + 8 + 32 + 32 + 32 + 32 + 32 + 8 + 1 + 8 + 1);
  while (BigInt(await connection.getSlot(COMMITMENT)) <= challengeEnd) {
    await send(connection, SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: random.publicKey, lamports: 1 }), payer);
  }
  console.log("[6] Challenge window completed");
  console.log(`Guarded ${scenario} upgrade: ${await send(connection, lifecycleExecute(), random)}`);
  console.log("[7] Guard PDA executed upgrade");
  const start = await connection.getSlot(COMMITMENT);
  while ((await connection.getSlot(COMMITMENT)) < start + 2) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const refresh = anchorInstruction(treasuryProgram, "refresh_version", [{ pubkey: versionPda, isSigner: false, isWritable: true }]);
  console.log(`Refresh ${scenario} behavior: ${await send(connection, refresh, payer)}`);
  console.log(`[8] Treasury reports expected ${scenario} demo version`);
  await expectFailure("Executed proposal cannot execute twice", () => send(connection, lifecycleExecute(), random));
  console.log("[9] Repeated execution correctly rejected");
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, sortValue(val)]));
  }
  return value;
}

function canonicalHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(sortValue(value))).digest("hex");
}

function resolveRef(ref: string): PublicKey {
  switch (ref) {
    case "treasury_pda":
      return treasuryPda;
    case "attacker":
      return attacker.publicKey;
    case "treasury_vault":
      return vaultToken.publicKey;
    case "payment_mint":
      return paymentMint.publicKey;
    case "attacker_token_account":
      return attackerToken.publicKey;
    case "spl_token":
      return TOKEN_PROGRAM_ID;
    default:
      throw new Error(`Unknown trace ref ${ref}`);
  }
}

function resolveSigner(alias: string): Keypair {
  if (alias === "attacker") return attacker;
  if (alias === "treasury-admin") return admin;
  if (alias === "new-admin") return newAdmin;
  throw new Error(`Unknown signer alias ${alias}`);
}

function materializeTrace(): { trace: { transactions: TraceTransaction[] }; hash: string } {
  const fixture = JSON.parse(readFileSync(join(ROOT, "fixtures", "treasury-v1.json"), "utf8"));
  const trace = JSON.parse(readFileSync(join(ROOT, "fixtures", "exploits", "auth-001-v2-authority-takeover.json"), "utf8"));
  const resolved = {
    ...trace,
    materialized_for: scenario,
    resolved_programs: {
      faultline_treasury: treasuryProgram.toBase58(),
      spl_token: TOKEN_PROGRAM_ID.toBase58()
    },
    resolved_accounts: {
      treasury_pda: treasuryPda.toBase58(),
      legitimate_admin: admin.publicKey.toBase58(),
      attacker: attacker.publicKey.toBase58(),
      payment_mint: paymentMint.publicKey.toBase58(),
      treasury_vault: vaultToken.publicKey.toBase58(),
      attacker_token_account: attackerToken.publicKey.toBase58()
    },
    fixture_sha256: canonicalHash(fixture)
  };
  mkdirSync(join(ROOT, "artifacts", "fixtures"), { recursive: true });
  writeFileSync(join(ROOT, "artifacts", "fixtures", "treasury-v1.resolved.json"), `${JSON.stringify({ ...fixture, resolved_accounts: resolved.resolved_accounts }, null, 2)}\n`);
  writeFileSync(join(ROOT, "artifacts", "fixtures", `auth-001-v2-authority-takeover.${scenario}.resolved.json`), `${JSON.stringify(resolved, null, 2)}\n`);
  return { trace, hash: canonicalHash(trace) };
}

async function replayTrace(trace: { transactions: TraceTransaction[] }, expectFirstFailure: boolean): Promise<{ firstFailure?: string }> {
  for (const tx of trace.transactions) {
    const transaction = new Transaction();
    for (const instruction of tx.instructions) {
      transaction.add({
        programId: treasuryProgram,
        keys: instruction.accounts.map((account) => ({
          pubkey: resolveRef(account.ref),
          isSigner: account.is_signer,
          isWritable: account.is_writable
        })),
        data: Buffer.from(instruction.data_base64, "base64")
      });
    }
    const signers = tx.signer_aliases.map(resolveSigner);
    try {
      const signature = await sendAndConfirmTransaction(connection, transaction, [payer, ...signers], {
        commitment: COMMITMENT,
        preflightCommitment: COMMITMENT
      });
      console.log(`Trace step ${tx.step} landed (${tx.label}): ${signature}`);
    } catch (error) {
      const logs =
        typeof error === "object" && error
          ? ((error as { transactionLogs?: string[]; logs?: string[] }).transactionLogs ??
              (error as { transactionLogs?: string[]; logs?: string[] }).logs ??
              [])
          : [];
      const decisiveLog = [...logs]
        .reverse()
        .find((line) => line.includes("AnchorError") || line.includes("Error Code") || line.includes("Program log:"));
      const detail = decisiveLog ?? (error instanceof Error ? error.message.split("\n")[0] : String(error));
      console.log(`Trace step ${tx.step} failed (${tx.label}): ${detail}`);
      if (expectFirstFailure && tx.step === 1) return { firstFailure: detail };
      throw error;
    }
  }
  if (expectFirstFailure) throw new Error("Trace unexpectedly succeeded");
  return {};
}

async function runV1BaselineTests(): Promise<void> {
  console.log(`Initialize version state: ${await send(connection, anchorInstruction(treasuryProgram, "initialize_version", [
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: versionPda, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
  ]), payer)}`);
  assert.deepEqual(await readTreasuryVersion(), { version: 1, marker: "TREASURY_V1_____" });
  console.log(`Initialize treasury: ${await send(connection, initializeTreasuryIx(), payer, [admin])}`);
  const initialState = await readTreasuryState();
  assert.equal(initialState.schemaVersion, 1, "v1 schema must be 1");
  assert(initialState.admin.equals(admin.publicKey), "v1 admin mismatch");
  assert(initialState.vault.equals(vaultToken.publicKey), "vault binding mismatch");

  console.log(`Deposit canonical fixture amount: ${await send(connection, depositIx(user.publicKey, userToken.publicKey, INITIAL_TREASURY_BALANCE), payer, [user])}`);
  assert.equal(await tokenAmount(connection, vaultToken.publicKey), INITIAL_TREASURY_BALANCE);
  assert.equal((await readTreasuryState()).totalDeposited, INITIAL_TREASURY_BALANCE);

  await expectFailure("v1 attacker direct withdraw", () => send(connection, withdrawIx(attacker.publicKey, attackerToken.publicKey, EXPLOIT_WITHDRAW_AMOUNT), payer, [attacker]));
  await expectFailure("v1 attacker cannot alter admin", () => send(connection, migrateIx(attacker.publicKey, attacker.publicKey), payer, [attacker]));
  await expectFailure("vault substitution fails", () => send(connection, withdrawIx(admin.publicKey, adminToken.publicKey, 1n, { vault: wrongVaultToken.publicKey }), payer, [admin]));
  await expectFailure("treasury state substitution fails", () => send(connection, withdrawIx(admin.publicKey, adminToken.publicKey, 1n, { treasury: versionPda }), payer, [admin]));
  await expectFailure("wrong token mint fails", () => send(connection, depositIx(user.publicKey, wrongUserToken.publicKey, 1n), payer, [user]));
  await expectFailure("wrong token program fails", () => send(connection, depositIx(user.publicKey, userToken.publicKey, 1n, paymentMint.publicKey, SystemProgram.programId), payer, [user]));

  console.log(`Legitimate v1 admin withdraw: ${await send(connection, withdrawIx(admin.publicKey, adminToken.publicKey, LEGIT_WITHDRAW_AMOUNT), payer, [admin])}`);
  assert.equal(await tokenAmount(connection, vaultToken.publicKey), INITIAL_TREASURY_BALANCE - LEGIT_WITHDRAW_AMOUNT);
  console.log(`Restore fixture balance by deposit: ${await send(connection, depositIx(user.publicKey, userToken.publicKey, LEGIT_WITHDRAW_AMOUNT), payer, [user])}`);
  assert.equal(await tokenAmount(connection, vaultToken.publicKey), INITIAL_TREASURY_BALANCE);
}

async function runScenario(): Promise<void> {
  console.log(`\nFAULTLINE MILESTONE-2 TREASURY ${scenario.toUpperCase()} DEMO`);
  console.log(`Faultline program ID: ${gateProgram}`);
  console.log(`Treasury program ID:  ${treasuryProgram}`);
  console.log(`Treasury ProgramData: ${treasuryProgramData}`);
  console.log(`Guard PDA:            ${guardPda}`);
  console.log(`Treasury PDA:         ${treasuryPda}`);
  console.log(`Payment mint:         ${paymentMint.publicKey}`);
  console.log(`Treasury vault:       ${vaultToken.publicKey}`);
  console.log(`Attacker token:       ${attackerToken.publicKey}`);
  console.log(`Candidate buffer:     ${selectedBuffer}`);

  const v1Hash = readFileSync(join(ROOT, "artifacts", "treasury", "v1", "executable.sha256"), "utf8").trim();
  const v2Hash = readFileSync(join(ROOT, "artifacts", "treasury", "v2", "executable.sha256"), "utf8").trim();
  const v3Hash = readFileSync(join(ROOT, "artifacts", "treasury", "v3", "executable.sha256"), "utf8").trim();
  assert.notEqual(v1Hash, v2Hash, "v1 and v2 ELF hashes must differ");
  assert.notEqual(v1Hash, v3Hash, "v1 and v3 ELF hashes must differ");
  assert.notEqual(v2Hash, v3Hash, "v2 and v3 ELF hashes must differ");
  console.log(`ELF hashes: v1=${v1Hash} v2=${v2Hash} v3=${v3Hash}`);

  await fundActors();
  await initializeTokenFixture();
  await runV1BaselineTests();

  const beforeUpgradeState = await readTreasuryState();
  await guardedUpgradeToScenario();
  const version = await readTreasuryVersion();
  assert.equal(version.version, scenario === "v2" ? 2 : 3);
  assert.equal((await readTreasuryState()).rawLength, beforeUpgradeState.rawLength, "TreasuryState size changed after upgrade");
  assert((await readTreasuryState()).admin.equals(admin.publicKey), "existing v1 state admin not readable after upgrade");
  assert((await readTreasuryState()).vault.equals(vaultToken.publicKey), "vault binding changed after upgrade");
  await verifyGuardAuthority(connection, treasuryProgram, guardPda);

  const { trace, hash } = materializeTrace();
  console.log(`Canonical exploit trace SHA256: ${hash}`);
  const preVault = await tokenAmount(connection, vaultToken.publicKey);
  const preAttacker = await tokenAmount(connection, attackerToken.publicKey);
  const preState = await readTreasuryState();
  assert(preState.admin.equals(admin.publicKey), "pre-state original admin mismatch");
  assert.equal(preVault, INITIAL_TREASURY_BALANCE);
  assert.equal(preAttacker, 0n);

  if (scenario === "v2") {
    await expectFailure("v2 attacker cannot initially withdraw", () => send(connection, withdrawIx(attacker.publicKey, attackerToken.publicKey, EXPLOIT_WITHDRAW_AMOUNT), payer, [attacker]));
    await replayTrace(trace, false);
    const stateAfterExploit = await readTreasuryState();
    const postVault = await tokenAmount(connection, vaultToken.publicKey);
    const postAttacker = await tokenAmount(connection, attackerToken.publicKey);
    assert(stateAfterExploit.admin.equals(attacker.publicKey), "v2 vulnerable migration did not set attacker as admin");
    assert.equal(postVault, INITIAL_TREASURY_BALANCE - EXPLOIT_WITHDRAW_AMOUNT);
    assert.equal(postAttacker, EXPLOIT_WITHDRAW_AMOUNT);
    assert(postVault < preVault, "AUTH-001 violation was not demonstrated");
    console.log(`V2 FINAL BALANCES: treasury_vault=${postVault} attacker=${postAttacker} withdrawn=${EXPLOIT_WITHDRAW_AMOUNT} AUTH-001=VIOLATED`);
  } else {
    const failure = await replayTrace(trace, true);
    assert(failure.firstFailure, "v3 trace did not fail at unauthorized migration");
    await expectFailure("v3 attacker withdraw after failed migration", () => send(connection, withdrawIx(attacker.publicKey, attackerToken.publicKey, EXPLOIT_WITHDRAW_AMOUNT), payer, [attacker]));
    const stateAfterFailure = await readTreasuryState();
    const postVault = await tokenAmount(connection, vaultToken.publicKey);
    const postAttacker = await tokenAmount(connection, attackerToken.publicKey);
    assert(stateAfterFailure.admin.equals(admin.publicKey), "v3 admin changed after failed attack");
    assert.equal(postVault, preVault, "v3 vault balance changed after failed trace");
    assert.equal(postAttacker, preAttacker, "v3 attacker balance changed after failed trace");
    console.log(`V3 SAME-TRACE FAILURE: step=1 reason="${failure.firstFailure}" treasury_vault=${postVault} attacker=${postAttacker} AUTH-001=PRESERVED`);

    console.log(`Legitimate v3 migration: ${await send(connection, migrateIx(admin.publicKey, newAdmin.publicKey), payer, [admin, newAdmin])}`);
    const migrated = await readTreasuryState();
    assert.equal(migrated.schemaVersion, 2);
    assert(migrated.admin.equals(newAdmin.publicKey), "legitimate v3 migration failed");
    console.log(`Post-migration deposit: ${await send(connection, depositIx(user.publicKey, userToken.publicKey, LEGIT_WITHDRAW_AMOUNT), payer, [user])}`);
    console.log(`New admin withdraw: ${await send(connection, withdrawIx(newAdmin.publicKey, newAdminToken.publicKey, LEGIT_WITHDRAW_AMOUNT), payer, [newAdmin])}`);
    assert.equal(await tokenAmount(connection, newAdminToken.publicKey), LEGIT_WITHDRAW_AMOUNT);
  }

  assert(treasuryProgram.equals(new PublicKey(ids["faultline-treasury-program"])), "program ID changed");
  assert((await readTreasuryState()).vault.equals(vaultToken.publicKey), "vault binding changed unexpectedly");
  if (!existsSync(join(ROOT, "policies", "invariants", "AUTH-001.json"))) {
    throw new Error("AUTH-001 policy file is missing");
  }
  console.log(`MILESTONE-2 ${scenario.toUpperCase()} ASSERTIONS PASSED`);
}

runScenario().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
