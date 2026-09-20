/* Milestone 6 dedicated fresh-ledger validation, Phase A, B and C assertions. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import {
  Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SYSVAR_RENT_PUBKEY,
  SystemProgram, Transaction, TransactionInstruction
} from "@solana/web3.js";
import {
  COMMITMENT, LOADER_V3, ROOT, anchorInstruction, discriminator, expectFailure,
  loadIds, loadKeypair, programDataAddress, setLoaderAuthorityInstruction
} from "../scripts/lib/solana.js";
import {
  MINT_SIZE, TOKEN_ACCOUNT_AMOUNT_OFFSET, TOKEN_ACCOUNT_SIZE, TOKEN_PROGRAM_ID,
  tokenAmount
} from "../scripts/lib/spl-token-lite.js";

type Shard = "policy-funding" | "stakes-withdrawal" | "bonds-hold" | "violation-fees" | "bond-outcomes" | "objective-slashing" | "pending-refund" | "paid-refund" | "revealed-unopened";
type PolicyParameters = {
  bounty: bigint; bond: bigint; fee: bigint; minimumStake: bigint; slash: bigint;
  maxChallenges: number; feeGrace: bigint; slashGrace: bigint; cooldown: bigint;
};

const RPC = "http://127.0.0.1:8899";
const ids = loadIds();
const payer = loadKeypair("payer");
const governance = loadKeypair("governance");
const proposer = loadKeypair("proposer");
const outsider = loadKeypair("random");
const hunter = loadKeypair("attacker");
const connection = new Connection(RPC, COMMITMENT);
const gate = new PublicKey(ids["faultline-gate-program"]);
const treasury = new PublicKey(ids["faultline-treasury-program"]);
const treasuryData = programDataAddress(treasury);
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const [guard] = PublicKey.findProgramAddressSync([Buffer.from("faultline"), Buffer.from("guard"), treasury.toBuffer()], gate);
const [policy] = PublicKey.findProgramAddressSync([Buffer.from("safety-policy"), treasury.toBuffer()], gate);
const [economicRegistry] = PublicKey.findProgramAddressSync([Buffer.from("economic-policy-registry"), policy.toBuffer()], gate);
const [verifierRegistry] = PublicKey.findProgramAddressSync([Buffer.from("verifier-registry"), policy.toBuffer()], gate);
const evidence: string[] = [];
const originalLog = console.log.bind(console);
console.log = (...values: unknown[]) => { const line = values.map(String).join(" "); evidence.push(line); originalLog(line); };

const u64 = (value: bigint) => { const out = Buffer.alloc(8); out.writeBigUInt64LE(value); return out; };
const u32 = (value: number) => { const out = Buffer.alloc(4); out.writeUInt32LE(value); return out; };
const sha256 = (...parts: Uint8Array[]) => createHash("sha256").update(Buffer.concat(parts.map(Buffer.from))).digest();
const sortedKeys = (keys: PublicKey[]) => [...keys].sort((a, b) => Buffer.compare(a.toBuffer(), b.toBuffer()));
const ataAddress = (owner: PublicKey, mint: PublicKey) => PublicKey.findProgramAddressSync(
  [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID
)[0];
const economicPolicyAddress = (configId: bigint) => PublicKey.findProgramAddressSync(
  [Buffer.from("economic-policy"), economicRegistry.toBuffer(), u64(configId)], gate
)[0];
const proposalAddress = (id: bigint) => PublicKey.findProgramAddressSync([Buffer.from("upgrade-proposal"), policy.toBuffer(), u64(id)], gate)[0];
const proposalGateAddress = (proposal: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("proposal-verification-gate"), proposal.toBuffer()], gate)[0];
const bufferClaimAddress = (buffer: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("faultline"), Buffer.from("buffer"), buffer.toBuffer()], gate)[0];
const invariantAddress = (id: bigint) => PublicKey.findProgramAddressSync([Buffer.from("invariant"), policy.toBuffer(), u64(id)], gate)[0];
const proposalEscrowAddress = (proposal: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("proposal-escrow"), proposal.toBuffer()], gate)[0];
const bountyVaultAddress = (proposal: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("bounty-vault"), proposal.toBuffer()], gate)[0];
const feeVaultAddress = (proposal: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("fee-vault"), proposal.toBuffer()], gate)[0];
const penaltyVaultAddress = (proposal: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("penalty-vault"), proposal.toBuffer()], gate)[0];
const epochAddress = (id: bigint) => PublicKey.findProgramAddressSync([Buffer.from("verifier-epoch"), verifierRegistry.toBuffer(), u64(id)], gate)[0];
const stakeAddress = (economicPolicy: PublicKey, verifier: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("verifier-stake"), economicPolicy.toBuffer(), verifier.toBuffer()], gate)[0];
const stakeVaultAddress = (economicPolicy: PublicKey, verifier: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("stake-vault"), economicPolicy.toBuffer(), verifier.toBuffer()], gate)[0];
const epochEconomicsAddress = (epoch: PublicKey, economicPolicy: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("verifier-epoch-economics"), epoch.toBuffer(), economicPolicy.toBuffer()], gate)[0];
const challengeCommitment = (proposal: PublicKey, invariant: PublicKey, who: PublicKey, trace: Buffer, salt: Buffer) => sha256(Buffer.from("FAULTLINE_CHALLENGE_V1"), proposal.toBuffer(), invariant.toBuffer(), who.toBuffer(), trace, salt);
const commitAddress = (proposal: PublicKey, who: PublicKey, commitment: Buffer) => PublicKey.findProgramAddressSync([Buffer.from("challenge-commit"), proposal.toBuffer(), who.toBuffer(), commitment], gate)[0];
const bondAddress = (commit: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("challenge-bond"), commit.toBuffer()], gate)[0];
const bondVaultAddress = (commit: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("bond-vault"), commit.toBuffer()], gate)[0];
const traceAddress = (proposal: PublicKey, trace: Buffer) => PublicKey.findProgramAddressSync([Buffer.from("trace-claim"), proposal.toBuffer(), trace], gate)[0];
const roundAddress = (trace: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("verification-round"), trace.toBuffer()], gate)[0];
const roundEconomicsAddress = (round: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("round-economics"), round.toBuffer()], gate)[0];
const attestationAddress = (round: PublicKey, verifier: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("verifier-attestation"), round.toBuffer(), verifier.toBuffer()], gate)[0];
const slashReceiptAddress = (round: PublicKey, verifier: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("verifier-slash"), round.toBuffer(), verifier.toBuffer()], gate)[0];
const replayResultAddress = (round: PublicKey, resultHash: Buffer) => PublicKey.findProgramAddressSync([Buffer.from("replay-result"), round.toBuffer(), resultHash], gate)[0];
const feeClaimAddress = (round: PublicKey, verifier: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("verifier-fee-claim"), round.toBuffer(), verifier.toBuffer()], gate)[0];
const REPLAY_DOMAIN = Buffer.from("FAULTLINE_REPLAY_V1", "ascii");

let activeAssertion = 0;
function pass(number: number, message: string, detail = ""): void {
  assert.equal(number, activeAssertion, `assertion sequencing error: active=${activeAssertion} pass=${number}`);
  console.log(`ASSERT ${number} PASS ${message}${detail ? ` ${detail}` : ""}`);
}
async function check(number: number, message: string, operation: () => Promise<void> | void): Promise<void> {
  activeAssertion = number;
  await operation();
  pass(number, message);
}
async function fails(number: number, message: string, expected: RegExp, operation: () => Promise<unknown>): Promise<void> {
  activeAssertion = number;
  await expectFailure(`${number} ${message}`, operation, expected);
  pass(number, message, `expected=${expected.source}`);
}

async function send(ix: TransactionInstruction, feePayer: Keypair, signers: Keypair[] = []): Promise<string> {
  return sendMany([ix], feePayer, signers);
}
async function sendMany(instructions: TransactionInstruction[], feePayer: Keypair, signers: Keypair[] = []): Promise<string> {
  const latest = await connection.getLatestBlockhash(COMMITMENT);
  const tx = new Transaction({ feePayer: feePayer.publicKey, recentBlockhash: latest.blockhash }).add(...instructions);
  tx.sign(feePayer, ...signers);
  // This suite uses legacy transactions only.  Measure the actual signed wire
  // representation before send; there is no ALT fallback in the local MVP.
  const exactSize = 1 + (64 * tx.signatures.length) + tx.compileMessage().serialize().length;
  assert(exactSize < 1_232, `legacy transaction exceeds 1,232 bytes: ${exactSize}`);
  const wire = tx.serialize();
  assert.equal(wire.length, exactSize, "signed transaction serialization changed unexpectedly");
  console.log(`TX_SIZE bytes=${exactSize} instructions=${instructions.length}`);
  const signature = await connection.sendRawTransaction(wire, { skipPreflight: false, preflightCommitment: COMMITMENT });
  const confirmation = await connection.confirmTransaction({ signature, ...latest }, COMMITMENT);
  if (confirmation.value.err) throw new Error(`transaction ${signature} failed: ${JSON.stringify(confirmation.value.err)}`);
  return signature;
}
async function advanceTo(target: bigint, label: string): Promise<void> {
  const deadline = Date.now() + 8 * 60_000;
  let count = 0;
  while (BigInt(await connection.getSlot(COMMITMENT)) < target) {
    if (Date.now() >= deadline) throw new Error(`${label}: slot advance deadline exceeded target=${target}`);
    await send(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: outsider.publicKey, lamports: 1 + (count % 1000) }), payer);
    count++;
  }
  console.log(`SLOT ADVANCE label=${label} target=${target} actual=${await connection.getSlot(COMMITMENT)} confirmed_transactions=${count}`);
}
async function advancePast(target: bigint, label: string): Promise<void> { await advanceTo(target + 1n, label); }

function createAtaInstruction(payerKey: PublicKey, owner: PublicKey, mint: PublicKey): TransactionInstruction {
  const ata = ataAddress(owner, mint);
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payerKey, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
    ], data: Buffer.alloc(0)
  });
}
async function createAta(payerKey: Keypair, owner: PublicKey, mint: PublicKey): Promise<PublicKey> {
  const ata = ataAddress(owner, mint);
  await send(createAtaInstruction(payerKey.publicKey, owner, mint), payerKey);
  return ata;
}
async function createMintWithFreeze(mint: Keypair, authority: PublicKey, freezeAuthority: PublicKey): Promise<void> {
  const lamports = await connection.getMinimumBalanceForRentExemption(MINT_SIZE, COMMITMENT);
  const data = Buffer.alloc(67);
  data[0] = 20; data[1] = 6; authority.toBuffer().copy(data, 2); data[34] = 1; freezeAuthority.toBuffer().copy(data, 35);
  await sendMany([
    SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey, lamports, space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
    new TransactionInstruction({ programId: TOKEN_PROGRAM_ID, keys: [{ pubkey: mint.publicKey, isSigner: false, isWritable: true }], data })
  ], payer, [mint]);
}
async function createLegacyMint(mint: Keypair, authority: PublicKey, decimals: number): Promise<void> {
  const lamports = await connection.getMinimumBalanceForRentExemption(MINT_SIZE, COMMITMENT);
  const data = Buffer.alloc(67);
  data[0] = 20; data[1] = decimals; authority.toBuffer().copy(data, 2);
  await sendMany([
    SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey, lamports, space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
    new TransactionInstruction({ programId: TOKEN_PROGRAM_ID, keys: [{ pubkey: mint.publicKey, isSigner: false, isWritable: true }], data })
  ], payer, [mint]);
}
function mintTokensInstruction(mint: PublicKey, destination: PublicKey, amount: bigint): TransactionInstruction {
  const data = Buffer.alloc(9); data[0] = 7; data.writeBigUInt64LE(amount, 1);
  return new TransactionInstruction({ programId: TOKEN_PROGRAM_ID, keys: [
    { pubkey: mint, isSigner: false, isWritable: true }, { pubkey: destination, isSigner: false, isWritable: true },
    { pubkey: payer.publicKey, isSigner: true, isWritable: false }
  ], data });
}
async function mintTokens(mint: PublicKey, destination: PublicKey, amount: bigint): Promise<string> {
  return send(mintTokensInstruction(mint, destination, amount), payer);
}
async function createUninitializedMint(mint: Keypair): Promise<void> {
  const lamports = await connection.getMinimumBalanceForRentExemption(MINT_SIZE, COMMITMENT);
  await send(SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey, lamports, space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }), payer, [mint]);
}
function tokenView(raw: Buffer) { return { mint: new PublicKey(raw.subarray(0, 32)), owner: new PublicKey(raw.subarray(32, 64)), amount: raw.readBigUInt64LE(TOKEN_ACCOUNT_AMOUNT_OFFSET), state: raw[108] }; }

async function createLoaderBuffer(seed: string, batchAuthority = false): Promise<{ key: PublicKey; hash: Buffer }> {
  const keypair = Keypair.fromSeed(sha256(Buffer.from(seed)));
  const bytes = sha256(Buffer.from(`candidate:${seed}`));
  const space = 37 + bytes.length;
  const lamports = await connection.getMinimumBalanceForRentExemption(space, COMMITMENT);
  const init = Buffer.alloc(4); init.writeUInt32LE(0);
  const write = Buffer.alloc(16 + bytes.length); write.writeUInt32LE(1, 0); write.writeUInt32LE(0, 4); write.writeBigUInt64LE(BigInt(bytes.length), 8); bytes.copy(write, 16);
  const instructions = [
    SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: keypair.publicKey, lamports, space, programId: LOADER_V3 }),
    new TransactionInstruction({ programId: LOADER_V3, keys: [{ pubkey: keypair.publicKey, isSigner: false, isWritable: true }, { pubkey: proposer.publicKey, isSigner: false, isWritable: false }], data: init }),
    new TransactionInstruction({ programId: LOADER_V3, keys: [{ pubkey: keypair.publicKey, isSigner: false, isWritable: true }, { pubkey: proposer.publicKey, isSigner: true, isWritable: false }], data: write })
  ];
  if (batchAuthority) instructions.push(setLoaderAuthorityInstruction(keypair.publicKey, proposer.publicKey, guard));
  await sendMany(instructions, payer, [keypair, proposer]);
  if (!batchAuthority) await send(setLoaderAuthorityInstruction(keypair.publicKey, proposer.publicKey, guard), payer, [proposer]);
  const info = await connection.getAccountInfo(keypair.publicKey, COMMITMENT); assert(info);
  return { key: keypair.publicKey, hash: sha256(info.data) };
}

function initializeGuard() { return anchorInstruction(gate, "initialize_guard", [
  { pubkey: governance.publicKey, isSigner: true, isWritable: true }, { pubkey: treasury, isSigner: false, isWritable: false },
  { pubkey: treasuryData, isSigner: false, isWritable: false }, { pubkey: guard, isSigner: false, isWritable: true },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
]); }
function initializeSafetyPolicy() { return anchorInstruction(gate, "initialize_safety_policy", [
  { pubkey: governance.publicKey, isSigner: true, isWritable: true }, { pubkey: guard, isSigner: false, isWritable: false },
  { pubkey: treasury, isSigner: false, isWritable: false }, { pubkey: policy, isSigner: false, isWritable: true },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
], Buffer.concat([u64(6n), Buffer.from([1, 0]), u64(4n), Buffer.from([1]), sha256(Buffer.from("AUTH-001")), governance.publicKey.toBuffer()])); }
function initializeEconomicRegistry(actor: PublicKey) { return anchorInstruction(gate, "initialize_economic_policy_registry", [
  { pubkey: actor, isSigner: true, isWritable: true }, { pubkey: policy, isSigner: false, isWritable: false },
  { pubkey: economicRegistry, isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
]); }
function encodePolicyParameters(p: PolicyParameters): Buffer { return Buffer.concat([
  u64(p.bounty), u64(p.bond), u64(p.fee), u64(p.minimumStake), u64(p.slash), Buffer.from([p.maxChallenges]),
  u64(p.feeGrace), u64(p.slashGrace), u64(p.cooldown)
]); }
function initializeEconomicPolicy(configId: bigint, mint: PublicKey, params: PolicyParameters, actor = governance.publicKey) { return anchorInstruction(gate, "initialize_economic_policy", [
  { pubkey: actor, isSigner: true, isWritable: true }, { pubkey: policy, isSigner: false, isWritable: false },
  { pubkey: economicRegistry, isSigner: false, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: false },
  { pubkey: economicPolicyAddress(configId), isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
], Buffer.concat([u64(configId), encodePolicyParameters(params)])); }
function initializeInvariant(id = 1n) { return anchorInstruction(gate, "initialize_invariant", [
  { pubkey: governance.publicKey, isSigner: true, isWritable: true }, { pubkey: policy, isSigner: false, isWritable: false },
  { pubkey: invariantAddress(id), isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
], Buffer.concat([u64(id), Buffer.from([0]), sha256(Buffer.from(`AUTH-${id}`)), sha256(Buffer.from(`spec-${id}`))])); }
function createProposal(id: bigint, buffer: PublicKey, hash: Buffer) { const proposal = proposalAddress(id); return anchorInstruction(gate, "create_upgrade_proposal", [
  { pubkey: proposer.publicKey, isSigner: true, isWritable: true }, { pubkey: guard, isSigner: false, isWritable: true },
  { pubkey: policy, isSigner: false, isWritable: false }, { pubkey: treasury, isSigner: false, isWritable: false },
  { pubkey: treasuryData, isSigner: false, isWritable: false }, { pubkey: buffer, isSigner: false, isWritable: false },
  { pubkey: proposal, isSigner: false, isWritable: true }, { pubkey: proposalGateAddress(proposal), isSigner: false, isWritable: true },
  { pubkey: bufferClaimAddress(buffer), isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
], Buffer.concat([u64(id), hash])); }
function legacyStart(id: bigint, actor = proposer.publicKey, duration = 20n) { return anchorInstruction(gate, "start_challenge", [
  { pubkey: actor, isSigner: true, isWritable: false }, { pubkey: policy, isSigner: false, isWritable: false },
  { pubkey: economicRegistry, isSigner: false, isWritable: false }, { pubkey: proposalAddress(id), isSigner: false, isWritable: true }
], u64(duration)); }
function startFunded(id: bigint, configId: bigint, duration = 24n) { const proposal = proposalAddress(id); const ep = economicPolicyAddress(configId); return anchorInstruction(gate, "start_funded_challenge", [
  { pubkey: proposer.publicKey, isSigner: true, isWritable: false }, { pubkey: policy, isSigner: false, isWritable: false },
  { pubkey: economicRegistry, isSigner: false, isWritable: false }, { pubkey: ep, isSigner: false, isWritable: false },
  { pubkey: proposal, isSigner: false, isWritable: true }, { pubkey: proposalEscrowAddress(proposal), isSigner: false, isWritable: true },
  { pubkey: configMint.get(ep.toBase58())!, isSigner: false, isWritable: false }, { pubkey: bountyVaultAddress(proposal), isSigner: false, isWritable: false },
  { pubkey: feeVaultAddress(proposal), isSigner: false, isWritable: false }, { pubkey: penaltyVaultAddress(proposal), isSigner: false, isWritable: false }
], u64(duration)); }
const configMint = new Map<string, PublicKey>();
function fundEscrow(id: bigint, configId: bigint, funder: PublicKey, funderAta: PublicKey, overrides: Partial<{ mint: PublicKey; escrow: PublicKey; bounty: PublicKey; fee: PublicKey; penalty: PublicKey }> = {}) {
  const proposal = proposalAddress(id); const ep = economicPolicyAddress(configId); const mint = overrides.mint ?? configMint.get(ep.toBase58())!;
  return anchorInstruction(gate, "fund_proposal_escrow", [
    { pubkey: funder, isSigner: true, isWritable: true }, { pubkey: policy, isSigner: false, isWritable: false },
    { pubkey: economicRegistry, isSigner: false, isWritable: false }, { pubkey: ep, isSigner: false, isWritable: false },
    { pubkey: proposal, isSigner: false, isWritable: false }, { pubkey: funderAta, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false }, { pubkey: overrides.escrow ?? proposalEscrowAddress(proposal), isSigner: false, isWritable: true },
    { pubkey: overrides.bounty ?? bountyVaultAddress(proposal), isSigner: false, isWritable: true },
    { pubkey: overrides.fee ?? feeVaultAddress(proposal), isSigner: false, isWritable: true },
    { pubkey: overrides.penalty ?? penaltyVaultAddress(proposal), isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
  ]);
}
function initializeVerifierRegistry() { return anchorInstruction(gate, "initialize_verifier_registry", [
  { pubkey: governance.publicKey, isSigner: true, isWritable: true }, { pubkey: policy, isSigner: false, isWritable: false },
  { pubkey: verifierRegistry, isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
]); }
function createEpoch(id: bigint, verifiers: PublicKey[], threshold: number) { return anchorInstruction(gate, "create_verifier_epoch", [
  { pubkey: governance.publicKey, isSigner: true, isWritable: true }, { pubkey: policy, isSigner: false, isWritable: false },
  { pubkey: verifierRegistry, isSigner: false, isWritable: true }, { pubkey: epochAddress(id), isSigner: false, isWritable: true },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
], Buffer.concat([u64(id), u32(verifiers.length), ...verifiers.map(v => v.toBuffer()), Buffer.from([threshold])])); }
function activateEpoch(id: bigint) { return anchorInstruction(gate, "activate_verifier_epoch", [
  { pubkey: governance.publicKey, isSigner: true, isWritable: false }, { pubkey: policy, isSigner: false, isWritable: false },
  { pubkey: verifierRegistry, isSigner: false, isWritable: true }, { pubkey: epochAddress(id), isSigner: false, isWritable: false }
]); }
function activateEpochEconomics(id: bigint, configId: bigint, stakes: PublicKey[]) { const epoch = epochAddress(id); const ep = economicPolicyAddress(configId); return anchorInstruction(gate, "activate_verifier_epoch_economics", [
  { pubkey: governance.publicKey, isSigner: true, isWritable: true }, { pubkey: policy, isSigner: false, isWritable: false },
  { pubkey: economicRegistry, isSigner: false, isWritable: false }, { pubkey: ep, isSigner: false, isWritable: false },
  { pubkey: verifierRegistry, isSigner: false, isWritable: false }, { pubkey: epoch, isSigner: false, isWritable: false },
  { pubkey: epochEconomicsAddress(epoch, ep), isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ...stakes.map(pubkey => ({ pubkey, isSigner: false, isWritable: false }))
]); }
function initializeStake(configId: bigint, verifier: PublicKey, verifierAta: PublicKey, amount: bigint, overrides: Partial<{ policy: PublicKey; mint: PublicKey; vault: PublicKey }> = {}) { const ep = overrides.policy ?? economicPolicyAddress(configId); return anchorInstruction(gate, "initialize_verifier_stake", [
  { pubkey: verifier, isSigner: true, isWritable: true }, { pubkey: ep, isSigner: false, isWritable: false },
  { pubkey: verifierAta, isSigner: false, isWritable: true }, { pubkey: overrides.mint ?? configMint.get(ep.toBase58())!, isSigner: false, isWritable: false },
  { pubkey: stakeAddress(ep, verifier), isSigner: false, isWritable: true }, { pubkey: overrides.vault ?? stakeVaultAddress(ep, verifier), isSigner: false, isWritable: true },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
], u64(amount)); }
function requestWithdrawal(configId: bigint, verifier: PublicKey) { const ep = economicPolicyAddress(configId); return anchorInstruction(gate, "request_verifier_stake_withdrawal", [
  { pubkey: verifier, isSigner: true, isWritable: false }, { pubkey: ep, isSigner: false, isWritable: false },
  { pubkey: stakeAddress(ep, verifier), isSigner: false, isWritable: true }
]); }
function cancelWithdrawal(configId: bigint, verifier: PublicKey) { const ep = economicPolicyAddress(configId); return anchorInstruction(gate, "cancel_verifier_stake_withdrawal", [
  { pubkey: verifier, isSigner: true, isWritable: false }, { pubkey: ep, isSigner: false, isWritable: false },
  { pubkey: stakeAddress(ep, verifier), isSigner: false, isWritable: true }
]); }
function withdrawStake(configId: bigint, verifier: PublicKey, verifierAta: PublicKey, destination = verifierAta) { const ep = economicPolicyAddress(configId); return anchorInstruction(gate, "withdraw_verifier_stake", [
  { pubkey: verifier, isSigner: true, isWritable: true }, { pubkey: ep, isSigner: false, isWritable: false },
  { pubkey: stakeAddress(ep, verifier), isSigner: false, isWritable: true }, { pubkey: destination, isSigner: false, isWritable: true },
  { pubkey: stakeVaultAddress(ep, verifier), isSigner: false, isWritable: true }, { pubkey: verifier, isSigner: false, isWritable: true },
  { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
]); }
function bondedCommit(id: bigint, configId: bigint, who: PublicKey, whoAta: PublicKey, trace: Buffer, salt: Buffer) { const proposal = proposalAddress(id); const invariant = invariantAddress(1n); const commitment = challengeCommitment(proposal, invariant, who, trace, salt); const commit = commitAddress(proposal, who, commitment); return { commitment, commit, ix: anchorInstruction(gate, "commit_bonded_challenge", [
  { pubkey: who, isSigner: true, isWritable: true }, { pubkey: policy, isSigner: false, isWritable: false },
  { pubkey: economicRegistry, isSigner: false, isWritable: false }, { pubkey: economicPolicyAddress(configId), isSigner: false, isWritable: false },
  { pubkey: proposal, isSigner: false, isWritable: false }, { pubkey: proposalEscrowAddress(proposal), isSigner: false, isWritable: true },
  { pubkey: invariant, isSigner: false, isWritable: false }, { pubkey: whoAta, isSigner: false, isWritable: true },
  { pubkey: configMint.get(economicPolicyAddress(configId).toBase58())!, isSigner: false, isWritable: false },
  { pubkey: commit, isSigner: false, isWritable: true }, { pubkey: bondAddress(commit), isSigner: false, isWritable: true },
  { pubkey: bondVaultAddress(commit), isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
], commitment) };
}
function reveal(id: bigint, who: PublicKey, commitment: Buffer, trace: Buffer, salt: Buffer) { const proposal = proposalAddress(id); const commit = commitAddress(proposal, who, commitment); return anchorInstruction(gate, "reveal_challenge", [
  { pubkey: who, isSigner: true, isWritable: true }, { pubkey: policy, isSigner: false, isWritable: false },
  { pubkey: proposal, isSigner: false, isWritable: false }, { pubkey: invariantAddress(1n), isSigner: false, isWritable: false },
  { pubkey: commit, isSigner: false, isWritable: true }, { pubkey: traceAddress(proposal, trace), isSigner: false, isWritable: true },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
], Buffer.concat([trace, salt])); }
function legacyCommit(id: bigint, who: PublicKey, commitment: Buffer) { const proposal = proposalAddress(id); return anchorInstruction(gate, "commit_challenge", [
  { pubkey: who, isSigner: true, isWritable: true }, { pubkey: policy, isSigner: false, isWritable: false },
  { pubkey: economicRegistry, isSigner: false, isWritable: false }, { pubkey: proposal, isSigner: false, isWritable: false },
  { pubkey: invariantAddress(1n), isSigner: false, isWritable: false }, { pubkey: commitAddress(proposal, who, commitment), isSigner: false, isWritable: true },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
], commitment); }
function openEconomicRound(id: bigint, configId: bigint, epochId: bigint, who: PublicKey, commitment: Buffer, trace: Buffer, stakes: PublicKey[]) { const proposal = proposalAddress(id); const traceClaim = traceAddress(proposal, trace); const round = roundAddress(traceClaim); const ep = economicPolicyAddress(configId); return { round, ix: anchorInstruction(gate, "open_economic_verification_round", [
  { pubkey: payer.publicKey, isSigner: true, isWritable: true }, { pubkey: policy, isSigner: false, isWritable: false },
  { pubkey: economicRegistry, isSigner: false, isWritable: false }, { pubkey: ep, isSigner: false, isWritable: false },
  { pubkey: proposal, isSigner: false, isWritable: false }, { pubkey: proposalEscrowAddress(proposal), isSigner: false, isWritable: true },
  { pubkey: proposalGateAddress(proposal), isSigner: false, isWritable: true }, { pubkey: invariantAddress(1n), isSigner: false, isWritable: false },
  { pubkey: commitAddress(proposal, who, commitment), isSigner: false, isWritable: false }, { pubkey: bondAddress(commitAddress(proposal, who, commitment)), isSigner: false, isWritable: false },
  { pubkey: traceClaim, isSigner: false, isWritable: false }, { pubkey: verifierRegistry, isSigner: false, isWritable: false },
  { pubkey: epochAddress(epochId), isSigner: false, isWritable: false }, { pubkey: epochEconomicsAddress(epochAddress(epochId), ep), isSigner: false, isWritable: false },
  { pubkey: round, isSigner: false, isWritable: true }, { pubkey: roundEconomicsAddress(round), isSigner: false, isWritable: true },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, ...stakes.map(pubkey => ({ pubkey, isSigner: false, isWritable: true }))
]) };
}
function legacyOpenRound(id: bigint, epochId: bigint, who: PublicKey, commitment: Buffer, trace: Buffer) { const proposal = proposalAddress(id); const traceClaim = traceAddress(proposal, trace); return anchorInstruction(gate, "open_verification_round", [
  { pubkey: payer.publicKey, isSigner: true, isWritable: true }, { pubkey: policy, isSigner: false, isWritable: false },
  { pubkey: economicRegistry, isSigner: false, isWritable: false }, { pubkey: proposal, isSigner: false, isWritable: false },
  { pubkey: proposalGateAddress(proposal), isSigner: false, isWritable: true }, { pubkey: invariantAddress(1n), isSigner: false, isWritable: false },
  { pubkey: commitAddress(proposal, who, commitment), isSigner: false, isWritable: false }, { pubkey: traceClaim, isSigner: false, isWritable: false },
  { pubkey: verifierRegistry, isSigner: false, isWritable: false }, { pubkey: epochAddress(epochId), isSigner: false, isWritable: false },
  { pubkey: roundAddress(traceClaim), isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
]); }
function closeTimedOut(id: bigint, round: PublicKey) { const proposal = proposalAddress(id); return anchorInstruction(gate, "close_unfinalized_round_economics", [
  { pubkey: payer.publicKey, isSigner: true, isWritable: false }, { pubkey: policy, isSigner: false, isWritable: false },
  { pubkey: proposal, isSigner: false, isWritable: false }, { pubkey: proposalEscrowAddress(proposal), isSigner: false, isWritable: true },
  { pubkey: proposalGateAddress(proposal), isSigner: false, isWritable: false }, { pubkey: round, isSigner: false, isWritable: false },
  { pubkey: roundEconomicsAddress(round), isSigner: false, isWritable: true }
]); }
function slashNonReveal(id: bigint, configId: bigint, epochId: bigint, round: PublicKey, verifier: PublicKey, caller: PublicKey = payer.publicKey) { const proposal = proposalAddress(id); const ep = economicPolicyAddress(configId); return anchorInstruction(gate, "slash_verifier_non_reveal", [
  { pubkey: caller, isSigner: true, isWritable: true },
  { pubkey: policy, isSigner: false, isWritable: false }, { pubkey: economicRegistry, isSigner: false, isWritable: false },
  { pubkey: ep, isSigner: false, isWritable: false }, { pubkey: proposal, isSigner: false, isWritable: false },
  { pubkey: proposalEscrowAddress(proposal), isSigner: false, isWritable: true }, { pubkey: configMint.get(ep.toBase58())!, isSigner: false, isWritable: false },
  { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, { pubkey: verifier, isSigner: false, isWritable: false },
  { pubkey: epochAddress(epochId), isSigner: false, isWritable: false }, { pubkey: round, isSigner: false, isWritable: false },
  { pubkey: roundEconomicsAddress(round), isSigner: false, isWritable: false }, { pubkey: stakeAddress(ep, verifier), isSigner: false, isWritable: true },
  { pubkey: stakeVaultAddress(ep, verifier), isSigner: false, isWritable: true }, { pubkey: penaltyVaultAddress(proposal), isSigner: false, isWritable: true },
  { pubkey: attestationAddress(round, verifier), isSigner: false, isWritable: false }, { pubkey: slashReceiptAddress(round, verifier), isSigner: false, isWritable: true },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
]); }

async function bootstrap(): Promise<void> {
  for (const actor of [governance, proposer, outsider, hunter]) {
    await send(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: actor.publicKey, lamports: 8 * LAMPORTS_PER_SOL }), payer);
  }
  await send(initializeGuard(), governance);
  await send(setLoaderAuthorityInstruction(treasuryData, payer.publicKey, guard), payer);
  await send(initializeSafetyPolicy(), governance);
  await send(initializeInvariant(), governance);
}
async function bootstrapBatched(): Promise<void> {
  await sendMany([
    ...[governance, proposer, outsider, hunter].map(actor => SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: actor.publicKey, lamports: 8 * LAMPORTS_PER_SOL })),
    initializeGuard(),
    setLoaderAuthorityInstruction(treasuryData, payer.publicKey, guard),
    initializeSafetyPolicy(),
    initializeInvariant()
  ], payer, [governance]);
}
function registryView(raw: Buffer) { return { safetyPolicy: new PublicKey(raw.subarray(8, 40)), governance: new PublicKey(raw.subarray(40, 72)), next: raw.readBigUInt64LE(72), enforcement: raw.readBigUInt64LE(80), created: raw.readBigUInt64LE(88), bump: raw[96] }; }
function policyView(raw: Buffer) { return { registry: new PublicKey(raw.subarray(8, 40)), safetyPolicy: new PublicKey(raw.subarray(40, 72)), governance: new PublicKey(raw.subarray(72, 104)), mint: new PublicKey(raw.subarray(104, 136)), tokenProgram: new PublicKey(raw.subarray(136, 168)), config: raw.readBigUInt64LE(168), decimals: raw[176], bounty: raw.readBigUInt64LE(177), bond: raw.readBigUInt64LE(185), fee: raw.readBigUInt64LE(193), minimumStake: raw.readBigUInt64LE(201), slash: raw.readBigUInt64LE(209), maxChallenges: raw[217], feeGrace: raw.readBigUInt64LE(218), slashGrace: raw.readBigUInt64LE(226), cooldown: raw.readBigUInt64LE(234), created: raw.readBigUInt64LE(242), bump: raw[250] }; }
function stakeView(raw: Buffer) {
  let offset = 184;
  const readOptionU64 = (): bigint | null => {
    const present = raw[offset++];
    if (present === 0) return null;
    assert.equal(present, 1, "invalid Option<u64> tag in VerifierStake");
    const value = raw.readBigUInt64LE(offset);
    offset += 8;
    return value;
  };
  const requested = readOptionU64();
  const available = readOptionU64();
  const totalSlashed = raw.readBigUInt64LE(offset); offset += 8;
  const status = raw[offset++];
  const bump = raw[offset];
  return { policy: new PublicKey(raw.subarray(8, 40)), verifier: new PublicKey(raw.subarray(40, 72)), vault: new PublicKey(raw.subarray(72, 104)), mint: new PublicKey(raw.subarray(104, 136)), rent: new PublicKey(raw.subarray(136, 168)), amount: raw.readBigUInt64LE(168), lock: raw.readBigUInt64LE(176), requested, available, totalSlashed, status, bump };
}
function roundEconomicsView(raw: Buffer) { return { round: new PublicKey(raw.subarray(8, 40)), escrow: new PublicKey(raw.subarray(40, 72)), epochEconomics: new PublicKey(raw.subarray(72, 104)), status: raw[104], feeDeadline: raw.readBigUInt64LE(105), slashDeadline: raw.readBigUInt64LE(113), opened: raw.readBigUInt64LE(121) }; }
async function accountData(address: PublicKey, size?: number): Promise<Buffer> { const info = await connection.getAccountInfo(address, COMMITMENT); assert(info, `missing account ${address}`); if (size !== undefined) assert.equal(info.data.length, size); return info.data; }

class Cursor {
  offset = 8;
  constructor(readonly raw: Buffer) {}
  pubkey(): PublicKey { const value = new PublicKey(this.raw.subarray(this.offset, this.offset + 32)); this.offset += 32; return value; }
  bytes32(): Buffer { const value = Buffer.from(this.raw.subarray(this.offset, this.offset + 32)); this.offset += 32; return value; }
  u64(): bigint { const value = this.raw.readBigUInt64LE(this.offset); this.offset += 8; return value; }
  u16(): number { const value = this.raw.readUInt16LE(this.offset); this.offset += 2; return value; }
  u8(): number { return this.raw[this.offset++]; }
  optionU64(): bigint | null { const tag = this.u8(); if (tag === 0) return null; assert.equal(tag, 1); return this.u64(); }
  optionU16(): number | null { const tag = this.u8(); if (tag === 0) return null; assert.equal(tag, 1); return this.u16(); }
  optionPubkey(): PublicKey | null { const tag = this.u8(); if (tag === 0) return null; assert.equal(tag, 1); return this.pubkey(); }
  optionBytes32(): Buffer | null { const tag = this.u8(); if (tag === 0) return null; assert.equal(tag, 1); return this.bytes32(); }
}
function proposalView(raw: Buffer) { const c = new Cursor(raw); return { policy: c.pubkey(), id: c.u64(), target: c.pubkey(), programData: c.pubkey(), candidate: c.pubkey(), candidateHash: c.bytes32(), proposer: c.pubkey(), created: c.u64(), start: c.optionU64(), end: c.optionU64(), state: c.u8(), authority: c.optionPubkey(), decisionSlot: c.optionU64(), reason: c.optionU16(), executed: c.optionU64(), bump: c.u8() }; }
function escrowView(raw: Buffer) { const c = new Cursor(raw); const view = { proposal: c.pubkey(), economicPolicy: c.pubkey(), funder: c.pubkey(), mint: c.pubkey(), bountyVault: c.pubkey(), feeVault: c.pubkey(), penaltyVault: c.pubkey(), bounty: c.u64(), reserve: c.u64(), maxChallenges: c.u8(), committed: c.u8(), unsettled: c.u8(), unclosed: c.u8(), bountyStatus: c.u8(), winningRound: c.optionPubkey(), winningTrace: c.optionPubkey(), funded: c.u64(), refundEligible: c.optionU64(), bountySettled: c.optionU64(), bountyPaid: c.u64(), feesClaimed: c.u64(), refundsPaid: c.u64(), bump: c.u8() }; return view; }
function commitView(raw: Buffer) { const c = new Cursor(raw); return { proposal: c.pubkey(), invariant: c.pubkey(), hunter: c.pubkey(), commitment: c.bytes32(), committed: c.u64(), earliest: c.u64(), latest: c.u64(), status: c.u8(), trace: c.optionBytes32(), revealed: c.optionU64(), bump: c.u8() }; }
function traceView(raw: Buffer) { const c = new Cursor(raw); return { proposal: c.pubkey(), invariant: c.pubkey(), commit: c.pubkey(), trace: c.bytes32(), hunter: c.pubkey(), revealed: c.u64(), bump: c.u8() }; }
function bondView(raw: Buffer) { const c = new Cursor(raw); return { commit: c.pubkey(), escrow: c.pubkey(), hunter: c.pubkey(), vault: c.pubkey(), rent: c.pubkey(), amount: c.u64(), status: c.u8(), funded: c.u64(), settled: c.optionU64(), refunded: c.u64(), forfeited: c.u64(), bump: c.u8() }; }
function gateView(raw: Buffer) { const c = new Cursor(raw); return { proposal: c.pubkey(), pending: c.u16(), confirmed: c.u8() !== 0, last: c.optionPubkey(), bump: c.u8() }; }
function roundView(raw: Buffer) { const c = new Cursor(raw); return { policy: c.pubkey(), proposal: c.pubkey(), invariant: c.pubkey(), traceClaim: c.pubkey(), trace: c.bytes32(), candidateHash: c.bytes32(), specificationHash: c.bytes32(), epoch: c.pubkey(), threshold: c.u8(), status: c.u8(), opened: c.u64(), finalized: c.optionU64(), winner: c.optionPubkey(), bump: c.u8() }; }
function replayView(raw: Buffer) { const c = new Cursor(raw); return { round: c.pubkey(), hash: c.bytes32(), verdict: c.u8(), receipt: c.bytes32(), votes: c.u8(), created: c.u64(), bump: c.u8() }; }
function attestationView(raw: Buffer) { const c = new Cursor(raw); return { round: c.pubkey(), epoch: c.pubkey(), verifier: c.pubkey(), replay: c.pubkey(), hash: c.bytes32(), slot: c.u64(), bump: c.u8() }; }
function roundEconomicsFullView(raw: Buffer) { const c = new Cursor(raw); return { round: c.pubkey(), escrow: c.pubkey(), epochEconomics: c.pubkey(), status: c.u8(), feeDeadline: c.u64(), slashDeadline: c.u64(), opened: c.u64(), closed: c.optionU64(), bump: c.u8() }; }
function feeClaimView(raw: Buffer) { const c = new Cursor(raw); return { round: c.pubkey(), verifier: c.pubkey(), attestation: c.pubkey(), escrow: c.pubkey(), amount: c.u64(), slot: c.u64(), bump: c.u8() }; }
function slashReceiptView(raw: Buffer) { const c = new Cursor(raw); return { round: c.pubkey(), stake: c.pubkey(), verifier: c.pubkey(), escrow: c.pubkey(), amount: c.u64(), slot: c.u64(), bump: c.u8() }; }

function replayResultCommitment(proposal: PublicKey, invariant: PublicKey, traceClaim: PublicKey, candidateHash: Buffer, specificationHash: Buffer, verdict: 0 | 1, receipt: Buffer): Buffer {
  return sha256(REPLAY_DOMAIN, proposal.toBuffer(), invariant.toBuffer(), traceClaim.toBuffer(), candidateHash, specificationHash, Buffer.from([verdict]), receipt);
}
function createReplay(round: PublicKey, resultHash: Buffer, verdict: 0 | 1, receipt: Buffer): TransactionInstruction { return anchorInstruction(gate, "create_replay_result", [
  { pubkey: payer.publicKey, isSigner: true, isWritable: true }, { pubkey: round, isSigner: false, isWritable: false },
  { pubkey: replayResultAddress(round, resultHash), isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
], Buffer.concat([resultHash, Buffer.from([verdict]), receipt])); }
function attest(verifier: PublicKey, id: bigint, epochId: bigint, round: PublicKey, trace: Buffer, resultHash: Buffer): TransactionInstruction { const proposal = proposalAddress(id); return anchorInstruction(gate, "submit_verifier_attestation", [
  { pubkey: verifier, isSigner: true, isWritable: true }, { pubkey: policy, isSigner: false, isWritable: false },
  { pubkey: proposal, isSigner: false, isWritable: false }, { pubkey: invariantAddress(1n), isSigner: false, isWritable: false },
  { pubkey: traceAddress(proposal, trace), isSigner: false, isWritable: false }, { pubkey: epochAddress(epochId), isSigner: false, isWritable: false },
  { pubkey: round, isSigner: false, isWritable: false }, { pubkey: replayResultAddress(round, resultHash), isSigner: false, isWritable: true },
  { pubkey: attestationAddress(round, verifier), isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
], resultHash); }
function finalizeReplay(id: bigint, round: PublicKey, resultHash: Buffer): TransactionInstruction { const proposal = proposalAddress(id); return anchorInstruction(gate, "finalize_replay_result", [
  { pubkey: outsider.publicKey, isSigner: true, isWritable: false }, { pubkey: policy, isSigner: false, isWritable: false },
  { pubkey: proposal, isSigner: false, isWritable: true }, { pubkey: proposalGateAddress(proposal), isSigner: false, isWritable: true },
  { pubkey: round, isSigner: false, isWritable: true }, { pubkey: replayResultAddress(round, resultHash), isSigner: false, isWritable: false }
]); }
function closeFinalized(id: bigint, round: PublicKey): TransactionInstruction { const proposal = proposalAddress(id); return anchorInstruction(gate, "close_finalized_round_economics", [
  { pubkey: payer.publicKey, isSigner: true, isWritable: false }, { pubkey: policy, isSigner: false, isWritable: false },
  { pubkey: proposal, isSigner: false, isWritable: false }, { pubkey: proposalEscrowAddress(proposal), isSigner: false, isWritable: true },
  { pubkey: proposalGateAddress(proposal), isSigner: false, isWritable: false }, { pubkey: round, isSigner: false, isWritable: false },
  { pubkey: roundEconomicsAddress(round), isSigner: false, isWritable: true }
]); }
function settlementBase(id: bigint, configId: bigint) { const proposal = proposalAddress(id); const ep = economicPolicyAddress(configId); return [
  { pubkey: policy, isSigner: false, isWritable: false }, { pubkey: economicRegistry, isSigner: false, isWritable: false },
  { pubkey: ep, isSigner: false, isWritable: false }, { pubkey: proposal, isSigner: false, isWritable: false },
  { pubkey: proposalEscrowAddress(proposal), isSigner: false, isWritable: true }, { pubkey: configMint.get(ep.toBase58())!, isSigner: false, isWritable: false },
  { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
]; }
function settleHold(id: bigint, configId: bigint, who: PublicKey, commitment: Buffer, trace: Buffer, destination: PublicKey): TransactionInstruction { const proposal = proposalAddress(id); const commit = commitAddress(proposal, who, commitment); const traceClaim = traceAddress(proposal, trace); const round = roundAddress(traceClaim); return anchorInstruction(gate, "settle_hold_challenge", [
  { pubkey: payer.publicKey, isSigner: true, isWritable: false }, ...settlementBase(id, configId),
  { pubkey: traceClaim, isSigner: false, isWritable: false }, { pubkey: commit, isSigner: false, isWritable: false }, { pubkey: bondAddress(commit), isSigner: false, isWritable: true },
  { pubkey: round, isSigner: false, isWritable: false }, { pubkey: roundEconomicsAddress(round), isSigner: false, isWritable: false },
  { pubkey: destination, isSigner: false, isWritable: true }, { pubkey: bondVaultAddress(commit), isSigner: false, isWritable: true },
  { pubkey: penaltyVaultAddress(proposal), isSigner: false, isWritable: true }, { pubkey: who, isSigner: false, isWritable: true }
]); }
function settleAccepted(id: bigint, configId: bigint, who: PublicKey, commitment: Buffer, trace: Buffer, destination: PublicKey, overrides: Partial<{ trace: Buffer; round: PublicKey }> = {}): TransactionInstruction { const proposal = proposalAddress(id); const commit = commitAddress(proposal, who, commitment); const suppliedTrace = overrides.trace ?? trace; const traceClaim = traceAddress(proposal, suppliedTrace); const round = overrides.round ?? roundAddress(traceClaim); return anchorInstruction(gate, "settle_accepted_challenge", [
  { pubkey: payer.publicKey, isSigner: true, isWritable: false }, ...settlementBase(id, configId), { pubkey: proposalGateAddress(proposal), isSigner: false, isWritable: false },
  { pubkey: traceClaim, isSigner: false, isWritable: false }, { pubkey: commit, isSigner: false, isWritable: false }, { pubkey: bondAddress(commit), isSigner: false, isWritable: true },
  { pubkey: round, isSigner: false, isWritable: false }, { pubkey: roundEconomicsAddress(round), isSigner: false, isWritable: false },
  { pubkey: destination, isSigner: false, isWritable: true }, { pubkey: bountyVaultAddress(proposal), isSigner: false, isWritable: true },
  { pubkey: bondVaultAddress(commit), isSigner: false, isWritable: true }, { pubkey: who, isSigner: false, isWritable: true }
]); }
function settleNonReveal(id: bigint, configId: bigint, who: PublicKey, commitment: Buffer): TransactionInstruction { const proposal = proposalAddress(id); const commit = commitAddress(proposal, who, commitment); return anchorInstruction(gate, "settle_non_reveal_challenge", [
  { pubkey: payer.publicKey, isSigner: true, isWritable: false }, ...settlementBase(id, configId), { pubkey: commit, isSigner: false, isWritable: false },
  { pubkey: bondAddress(commit), isSigner: false, isWritable: true }, { pubkey: bondVaultAddress(commit), isSigner: false, isWritable: true },
  { pubkey: penaltyVaultAddress(proposal), isSigner: false, isWritable: true }, { pubkey: who, isSigner: false, isWritable: true }
]); }
function settleRoundRefund(id: bigint, configId: bigint, who: PublicKey, commitment: Buffer, trace: Buffer, destination: PublicKey): TransactionInstruction { const proposal = proposalAddress(id); const commit = commitAddress(proposal, who, commitment); const traceClaim = traceAddress(proposal, trace); const round = roundAddress(traceClaim); return anchorInstruction(gate, "settle_timed_out_or_aborted_challenge", [
  { pubkey: payer.publicKey, isSigner: true, isWritable: false }, ...settlementBase(id, configId), { pubkey: traceClaim, isSigner: false, isWritable: false },
  { pubkey: commit, isSigner: false, isWritable: false }, { pubkey: bondAddress(commit), isSigner: false, isWritable: true }, { pubkey: round, isSigner: false, isWritable: false },
  { pubkey: roundEconomicsAddress(round), isSigner: false, isWritable: false }, { pubkey: destination, isSigner: false, isWritable: true },
  { pubkey: bondVaultAddress(commit), isSigner: false, isWritable: true }, { pubkey: who, isSigner: false, isWritable: true }
]); }
function claimFee(id: bigint, configId: bigint, epochId: bigint, round: PublicKey, resultHash: Buffer, verifier: PublicKey, destination: PublicKey): TransactionInstruction { return anchorInstruction(gate, "claim_verifier_fee", [
  { pubkey: payer.publicKey, isSigner: true, isWritable: true }, ...settlementBase(id, configId), { pubkey: verifier, isSigner: false, isWritable: false },
  { pubkey: epochAddress(epochId), isSigner: false, isWritable: false }, { pubkey: round, isSigner: false, isWritable: false },
  { pubkey: roundEconomicsAddress(round), isSigner: false, isWritable: false }, { pubkey: replayResultAddress(round, resultHash), isSigner: false, isWritable: false },
  { pubkey: attestationAddress(round, verifier), isSigner: false, isWritable: false }, { pubkey: feeClaimAddress(round, verifier), isSigner: false, isWritable: true },
  { pubkey: destination, isSigner: false, isWritable: true }, { pubkey: feeVaultAddress(proposalAddress(id)), isSigner: false, isWritable: true },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
]); }
function expireProposal(id: bigint): TransactionInstruction { return anchorInstruction(gate, "expire_proposal", [
  { pubkey: payer.publicKey, isSigner: true, isWritable: false }, { pubkey: policy, isSigner: false, isWritable: false },
  { pubkey: proposalAddress(id), isSigner: false, isWritable: true }
]); }
function recordDecision(id: bigint, state: 2 | 3, reasonCode: number): TransactionInstruction { const proposal = proposalAddress(id); const reason = Buffer.alloc(2); reason.writeUInt16LE(reasonCode); return anchorInstruction(gate, "record_temporary_decision", [
  { pubkey: governance.publicKey, isSigner: true, isWritable: false }, { pubkey: policy, isSigner: false, isWritable: false },
  { pubkey: proposal, isSigner: false, isWritable: true }, { pubkey: proposalGateAddress(proposal), isSigner: false, isWritable: false }
], Buffer.concat([Buffer.from([state]), reason])); }
function recordRejected(id: bigint): TransactionInstruction { return recordDecision(id, 3, 0x6001); }
function refundEscrow(id: bigint, configId: bigint, caller = payer.publicKey, destination?: PublicKey, rentRecipient?: PublicKey): TransactionInstruction { const proposal = proposalAddress(id); return anchorInstruction(gate, "refund_proposal_escrow", [
  { pubkey: caller, isSigner: true, isWritable: false }, ...settlementBase(id, configId),
  { pubkey: destination ?? ataAddress(proposer.publicKey, configMint.get(economicPolicyAddress(configId).toBase58())!), isSigner: false, isWritable: true },
  { pubkey: bountyVaultAddress(proposal), isSigner: false, isWritable: true }, { pubkey: feeVaultAddress(proposal), isSigner: false, isWritable: true },
  { pubkey: penaltyVaultAddress(proposal), isSigner: false, isWritable: true }, { pubkey: rentRecipient ?? proposer.publicKey, isSigner: false, isWritable: true }
]); }
function settleRevealedUnopened(id: bigint, configId: bigint, who: PublicKey, commitment: Buffer, trace: Buffer, destination: PublicKey): TransactionInstruction { const proposal = proposalAddress(id); const commit = commitAddress(proposal, who, commitment); const traceClaim = traceAddress(proposal, trace); const round = roundAddress(traceClaim); return anchorInstruction(gate, "settle_revealed_unopened_challenge", [
  { pubkey: payer.publicKey, isSigner: true, isWritable: false }, ...settlementBase(id, configId),
  { pubkey: traceClaim, isSigner: false, isWritable: false }, { pubkey: commit, isSigner: false, isWritable: false },
  { pubkey: bondAddress(commit), isSigner: false, isWritable: true }, { pubkey: round, isSigner: false, isWritable: true },
  { pubkey: roundEconomicsAddress(round), isSigner: false, isWritable: true }, { pubkey: destination, isSigner: false, isWritable: true },
  { pubkey: bondVaultAddress(commit), isSigner: false, isWritable: true }, { pubkey: who, isSigner: false, isWritable: true }
]); }
async function dust(address: PublicKey): Promise<void> { const lamports = await connection.getMinimumBalanceForRentExemption(0, COMMITMENT); await send(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: address, lamports }), payer); }

type PhaseBSetup = { registry: ReturnType<typeof registryView>; mint: Keypair; ep: PublicKey; params: PolicyParameters; verifiers: Keypair[]; verifierAtas: PublicKey[]; canonical: PublicKey[]; proposerAta: PublicKey; hunters: Keypair[]; hunterAtas: PublicKey[]; buffers: { key: PublicKey; hash: Buffer }[] };
async function setupPhaseB(name: string, verifierCount: number, threshold: number, params: PolicyParameters, bufferCount: number, stakeAmount: bigint, batched = false): Promise<PhaseBSetup> {
  await (batched ? bootstrapBatched() : bootstrap());
  await send(initializeEconomicRegistry(governance.publicKey), governance);
  const registry = registryView(await accountData(economicRegistry));
  const mint = Keypair.fromSeed(sha256(Buffer.from(`${name}-mint`)));
  await createLegacyMint(mint, payer.publicKey, 6);
  const ep = economicPolicyAddress(0n); configMint.set(ep.toBase58(), mint.publicKey);
  if (batched) await sendMany([initializeEconomicPolicy(0n, mint.publicKey, params), initializeVerifierRegistry()], governance);
  else { await send(initializeEconomicPolicy(0n, mint.publicKey, params), governance); await send(initializeVerifierRegistry(), governance); }
  const verifiers = Array.from({ length: verifierCount }, (_, i) => Keypair.fromSeed(sha256(Buffer.from(`${name}-verifier-${i}`))));
  const hunters = [hunter, ...Array.from({ length: 3 }, (_, i) => Keypair.fromSeed(sha256(Buffer.from(`${name}-hunter-${i}`))))];
  let verifierAtas: PublicKey[]; let hunterAtas: PublicKey[]; let proposerAta: PublicKey;
  if (batched) {
    await sendMany([...verifiers, ...hunters.slice(1)].map(actor => SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: actor.publicKey, lamports: 5 * LAMPORTS_PER_SOL })), payer);
    verifierAtas = verifiers.map(verifier => ataAddress(verifier.publicKey, mint.publicKey)); hunterAtas = hunters.map(value => ataAddress(value.publicKey, mint.publicKey)); proposerAta = ataAddress(proposer.publicKey, mint.publicKey);
    await sendMany([...verifiers.map(value => createAtaInstruction(payer.publicKey, value.publicKey, mint.publicKey)), ...hunters.map(value => createAtaInstruction(payer.publicKey, value.publicKey, mint.publicKey)), createAtaInstruction(payer.publicKey, proposer.publicKey, mint.publicKey)], payer);
    await sendMany([...verifierAtas.map(value => mintTokensInstruction(mint.publicKey, value, 1_000n)), ...hunterAtas.map(value => mintTokensInstruction(mint.publicKey, value, 2_000n)), mintTokensInstruction(mint.publicKey, proposerAta, 200_000n)], payer);
    await sendMany(verifiers.map((verifier, index) => initializeStake(0n, verifier.publicKey, verifierAtas[index], stakeAmount)), payer, verifiers);
    await sendMany([createEpoch(0n, verifiers.map(value => value.publicKey), threshold), activateEpoch(0n)], governance);
  } else {
    await sendMany(verifiers.map(verifier => SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: verifier.publicKey, lamports: 5 * LAMPORTS_PER_SOL })), payer);
    verifierAtas = [];
    for (const verifier of verifiers) { const ata = await createAta(payer, verifier.publicKey, mint.publicKey); verifierAtas.push(ata); await mintTokens(mint.publicKey, ata, 1_000n); await send(initializeStake(0n, verifier.publicKey, ata, stakeAmount), verifier); }
    await send(createEpoch(0n, verifiers.map(value => value.publicKey), threshold), governance); await send(activateEpoch(0n), governance);
    await sendMany(hunters.slice(1).map(value => SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: value.publicKey, lamports: 5 * LAMPORTS_PER_SOL })), payer);
    hunterAtas = [];
    for (const value of hunters) hunterAtas.push(await createAta(payer, value.publicKey, mint.publicKey));
    proposerAta = await createAta(payer, proposer.publicKey, mint.publicKey); await mintTokens(mint.publicKey, proposerAta, 200_000n);
  }
  const canonical = sortedKeys(verifiers.map(value => value.publicKey));
  await send(activateEpochEconomics(0n, 0n, canonical.map(value => stakeAddress(ep, value))), governance);
  const buffers: { key: PublicKey; hash: Buffer }[] = [];
  for (let i = 0; i < bufferCount; i++) buffers.push(await createLoaderBuffer(`${name}-buffer-${i}`, batched));
  await advanceTo(registry.enforcement, `${name}-enforcement`);
  return { registry, mint, ep, params, verifiers, verifierAtas, canonical, proposerAta, hunters, hunterAtas, buffers };
}
async function prepareFundedProposal(setup: PhaseBSetup, id: bigint, bufferIndex: number, duration: bigint, batched = false): Promise<void> { if (batched) await sendMany([createProposal(id, setup.buffers[bufferIndex].key, setup.buffers[bufferIndex].hash), fundEscrow(id, 0n, proposer.publicKey, setup.proposerAta), startFunded(id, 0n, duration)], proposer); else { await send(createProposal(id, setup.buffers[bufferIndex].key, setup.buffers[bufferIndex].hash), proposer); await send(fundEscrow(id, 0n, proposer.publicKey, setup.proposerAta), proposer); await send(startFunded(id, 0n, duration), proposer); } }
async function revealBond(id: bigint, who: Keypair, whoAta: PublicKey, trace: Buffer, salt: Buffer) { const bonded = bondedCommit(id, 0n, who.publicKey, whoAta, trace, salt); const signature = await send(bonded.ix, who); const commit = commitView(await accountData(bonded.commit, 204)); await advanceTo(commit.earliest, `reveal-${id}-${who.publicKey.toBase58().slice(0, 6)}`); const revealSignature = await send(reveal(id, who.publicKey, bonded.commitment, trace, salt), who); return { ...bonded, signature, revealSignature, trace, salt }; }

const goodParams: PolicyParameters = { bounty: 700n, bond: 100n, fee: 5n, minimumStake: 100n, slash: 20n, maxChallenges: 3, feeGrace: 10n, slashGrace: 16n, cooldown: 3n };
const stakeParams: PolicyParameters = { ...goodParams, feeGrace: 4n, slashGrace: 12n, cooldown: 1n };

async function runPolicyFunding(): Promise<void> {
  await bootstrap();
  const historicalBuffer = await createLoaderBuffer("m6-phase-a-historical");
  const historicalFundingBuffer = await createLoaderBuffer("m6-phase-a-historical-funding");
  await send(createProposal(1n, historicalBuffer.key, historicalBuffer.hash), proposer);
  await send(createProposal(99n, historicalFundingBuffer.key, historicalFundingBuffer.hash), proposer);
  await fails(1, "registry requires governance", /UnauthorizedGovernance/, () => send(initializeEconomicRegistry(outsider.publicKey), outsider));
  const registrySignature = await send(initializeEconomicRegistry(governance.publicKey), governance);
  const registryRaw = await accountData(economicRegistry, 97); const registry = registryView(registryRaw);
  await check(2, "registry size and discriminator", () => assert.deepEqual(registryRaw.subarray(0, 8), discriminator("account", "EconomicPolicyRegistry")));
  await check(3, "registry canonical fields and bump", () => { assert(registry.safetyPolicy.equals(policy)); assert(registry.governance.equals(governance.publicKey)); assert.equal(registry.bump, PublicKey.findProgramAddressSync([Buffer.from("economic-policy-registry"), policy.toBuffer()], gate)[1]); });
  await check(4, "enforcement slot is creation plus 32", () => assert.equal(registry.enforcement, registry.created + 32n));
  await check(5, "first sequential config id is zero", () => assert.equal(registry.next, 0n));

  const mint0 = Keypair.generate(); const mint1 = Keypair.generate(); const freezeMint = Keypair.generate(); const uninitializedMint = Keypair.generate();
  await createLegacyMint(mint0, payer.publicKey, 6);
  await createLegacyMint(mint1, payer.publicKey, 9);
  await createMintWithFreeze(freezeMint, payer.publicKey, payer.publicKey);
  await createUninitializedMint(uninitializedMint);
  configMint.set(economicPolicyAddress(0n).toBase58(), mint0.publicKey);
  configMint.set(economicPolicyAddress(1n).toBase58(), mint1.publicKey);
  await fails(6, "skipped config id rejected", /InvalidEconomicConfigId/, () => send(initializeEconomicPolicy(1n, mint0.publicKey, goodParams), governance));
  await fails(7, "failed policy creation does not consume config id", /ZeroBountyAmount/, () => send(initializeEconomicPolicy(0n, mint0.publicKey, { ...goodParams, bounty: 0n }), governance));
  await check(8, "counter remains zero after failures", async () => assert.equal(registryView(await accountData(economicRegistry)).next, 0n));
  const policy0Signature = await send(initializeEconomicPolicy(0n, mint0.publicKey, goodParams), governance);
  const policy0Raw = await accountData(economicPolicyAddress(0n), 251); const policy0 = policyView(policy0Raw);
  await check(9, "config zero initializes and advances atomically", async () => assert.equal(registryView(await accountData(economicRegistry)).next, 1n));
  await check(10, "historical policy bytes are immutable after config one", async () => { const snapshot = Buffer.from(policy0Raw); await send(initializeEconomicPolicy(1n, mint1.publicKey, goodParams), governance); assert.deepEqual(await accountData(economicPolicyAddress(0n)), snapshot); assert.equal(registryView(await accountData(economicRegistry)).next, 2n); });

  await check(11, "legacy Tokenkeg mint initialized without freeze authority", async () => { const info = await connection.getAccountInfo(mint0.publicKey, COMMITMENT); assert(info); assert(info.owner.equals(TOKEN_PROGRAM_ID)); assert.equal(info.data.length, 82); assert.equal(info.data[45], 1); assert.equal(info.data.readUInt32LE(46), 0); });
  await check(12, "policy snapshots mint decimals and exact Tokenkeg program", () => { assert.equal(policy0.decimals, 6); assert(policy0.tokenProgram.equals(TOKEN_PROGRAM_ID)); assert(policy0.mint.equals(mint0.publicKey)); });
  await fails(13, "system-owned mint rejected", /UnsupportedEconomicTokenProgram/, () => send(initializeEconomicPolicy(2n, outsider.publicKey, goodParams), governance));
  await fails(14, "uninitialized Tokenkeg mint rejected", /InvalidEconomicMint/, () => send(initializeEconomicPolicy(2n, uninitializedMint.publicKey, goodParams), governance));
  await fails(15, "freeze-authority mint rejected", /MintHasFreezeAuthority/, () => send(initializeEconomicPolicy(2n, freezeMint.publicKey, goodParams), governance));
  await check(16, "zero bond and dust-prone HOLD penalty rejected", async () => { await expectFailure("16 zero bond", () => send(initializeEconomicPolicy(2n, mint0.publicKey, { ...goodParams, bond: 0n }), governance), /ZeroBondAmount/); await expectFailure("16 dust-prone bond", () => send(initializeEconomicPolicy(2n, mint0.publicKey, { ...goodParams, bond: 3n }), governance), /ZeroSettlementAmount/); });
  await fails(17, "zero verifier fee rejected", /ZeroVerifierFee/, () => send(initializeEconomicPolicy(2n, mint0.publicKey, { ...goodParams, fee: 0n }), governance));
  await check(18, "zero minimum stake and excessive slash rejected", async () => { await expectFailure("18 zero minimum", () => send(initializeEconomicPolicy(2n, mint0.publicKey, { ...goodParams, minimumStake: 0n }), governance), /ZeroMinimumStake/); await expectFailure("18 slash exceeds minimum", () => send(initializeEconomicPolicy(2n, mint0.publicKey, { ...goodParams, slash: goodParams.minimumStake + 1n }), governance), /SlashExceedsMinimumStake/); });
  await fails(19, "challenge count outside one through eight rejected", /InvalidChallengeLimit/, () => send(initializeEconomicPolicy(2n, mint0.publicKey, { ...goodParams, maxChallenges: 9 }), governance));
  await check(20, "delay bounds and fee-reserve overflow reject atomically", async () => { await expectFailure("20 delay maximum", () => send(initializeEconomicPolicy(2n, mint0.publicKey, { ...goodParams, feeGrace: 216001n }), governance), /InvalidEconomicDelay/); await expectFailure("20 fee reserve overflow", () => send(initializeEconomicPolicy(2n, mint0.publicKey, { ...goodParams, fee: 0xffffffffffffffffn }), governance), /FeeReserveOverflow/); assert.equal(registryView(await accountData(economicRegistry)).next, 2n); });

  await send(initializeVerifierRegistry(), governance);
  await send(createEpoch(0n, [governance.publicKey], 1), governance);
  await send(activateEpoch(0n), governance);
  const hunterAta0 = await createAta(payer, hunter.publicKey, mint0.publicKey); await mintTokens(mint0.publicKey, hunterAta0, 10_000n);
  await check(21, "historical proposal is strictly before enforcement", async () => { const raw = await accountData(proposalAddress(1n)); assert(raw.readBigUInt64LE(208) < registry.enforcement); });
  let historicalStart = "", historicalCommit = "", historicalReveal = "", historicalRound = "";
  await check(22, "historical proposal retains legacy start, commit and round routes with registry", async () => { historicalStart = await send(legacyStart(1n, proposer.publicKey, 60n), proposer); const trace = sha256(Buffer.from("historical-economic-boundary")); const salt = sha256(Buffer.from("historical-economic-salt")); const commitment = challengeCommitment(proposalAddress(1n), invariantAddress(1n), hunter.publicKey, trace, salt); historicalCommit = await send(legacyCommit(1n, hunter.publicKey, commitment), hunter); await advanceTo(BigInt(await connection.getSlot(COMMITMENT)) + 1n, "historical-reveal-delay"); historicalReveal = await send(reveal(1n, hunter.publicKey, commitment, trace, salt), hunter); historicalRound = await send(legacyOpenRound(1n, 0n, hunter.publicKey, commitment, trace), payer); });
  const proposerAta0 = await createAta(payer, proposer.publicKey, mint0.publicKey); await mintTokens(mint0.publicKey, proposerAta0, 100_000n);
  await fails(23, "historical Draft proposal cannot be economically funded", /HistoricalProposalCannotUseEconomics/, () => send(fundEscrow(99n, 0n, proposer.publicKey, proposerAta0), proposer));
  await advanceTo(registry.enforcement, "economic-enforcement-boundary");
  const m6Buffers = await Promise.all([2, 3, 4, 5].map(i => createLoaderBuffer(`m6-phase-a-funded-${i}`)));
  for (let i = 0; i < m6Buffers.length; i++) await send(createProposal(BigInt(i + 2), m6Buffers[i].key, m6Buffers[i].hash), proposer);
  await check(24, "M6 classification is inclusive at enforcement", async () => assert((await accountData(proposalAddress(2n))).readBigUInt64LE(208) >= registry.enforcement));
  await fails(25, "M6 proposal cannot use legacy start", /M6ProposalRequiresFundedRoute/, () => send(legacyStart(2n), proposer));
  await fails(26, "M6 proposal cannot start before canonical funding", /AccountNotInitialized|not initialized/, () => send(startFunded(2n, 0n), proposer));

  const governanceAta0 = await createAta(payer, governance.publicKey, mint0.publicKey); await mintTokens(mint0.publicKey, governanceAta0, 100_000n);
  await expectFailure("29 unauthorized escrow funder", () => send(fundEscrow(2n, 0n, outsider.publicKey, ataAddress(outsider.publicKey, mint0.publicKey)), outsider), /UnauthorizedEconomicFunder/);
  const preFund = await tokenAmount(connection, proposerAta0);
  const fundingSignature = await send(fundEscrow(2n, 0n, proposer.publicKey, proposerAta0), proposer);
  await send(startFunded(2n, 0n), proposer);
  const m6Trace = sha256(Buffer.from("m6-legacy-boundary")); const m6Salt = sha256(Buffer.from("m6-legacy-boundary-salt")); const m6Commitment = challengeCommitment(proposalAddress(2n), invariantAddress(1n), hunter.publicKey, m6Trace, m6Salt);
  await fails(27, "M6 proposal cannot use legacy commit", /M6ProposalRequiresFundedRoute/, () => send(legacyCommit(2n, hunter.publicKey, m6Commitment), hunter));
  const bonded = bondedCommit(2n, 0n, hunter.publicKey, hunterAta0, m6Trace, m6Salt); await send(bonded.ix, hunter); await advanceTo(BigInt(await connection.getSlot(COMMITMENT)) + 1n, "m6-reveal-delay"); await send(reveal(2n, hunter.publicKey, bonded.commitment, m6Trace, m6Salt), hunter);
  await check(28, "M6 legacy round is rejected and finalizer and Guard ABI remain unchanged", async () => { await expectFailure("28 M6 legacy round", () => send(legacyOpenRound(2n, 0n, hunter.publicKey, bonded.commitment, m6Trace), payer), /M6ProposalRequiresFundedRoute/); const finalizer = anchorInstruction(gate, "finalize_replay_result", Array.from({ length: 6 }, () => ({ pubkey: outsider.publicKey, isSigner: false, isWritable: false }))); const execute = anchorInstruction(gate, "execute_guarded_upgrade", Array.from({ length: 13 }, () => ({ pubkey: outsider.publicKey, isSigner: false, isWritable: false }))); assert.equal(finalizer.keys.length, 6); assert.equal(execute.keys.length, 13); });

  const escrowRaw = await accountData(proposalEscrowAddress(proposalAddress(2n)), 370);
  await check(29, "funding authorization and ProposalEscrow bindings", () => { assert.deepEqual(escrowRaw.subarray(0, 8), discriminator("account", "ProposalEscrow")); assert(new PublicKey(escrowRaw.subarray(8, 40)).equals(proposalAddress(2n))); assert(new PublicKey(escrowRaw.subarray(40, 72)).equals(economicPolicyAddress(0n))); assert(new PublicKey(escrowRaw.subarray(72, 104)).equals(proposer.publicKey)); });
  await check(30, "exact bounty transfer", async () => assert.equal(await tokenAmount(connection, bountyVaultAddress(proposalAddress(2n))), goodParams.bounty));
  const feeReserve = goodParams.fee * 8n * BigInt(goodParams.maxChallenges);
  await check(31, "exact checked maximum fee reserve", async () => assert.equal(await tokenAmount(connection, feeVaultAddress(proposalAddress(2n))), feeReserve));
  await check(32, "PenaltyVault begins empty", async () => assert.equal(await tokenAmount(connection, penaltyVaultAddress(proposalAddress(2n))), 0n));
  await check(33, "funding debits exactly bounty plus reserve", async () => assert.equal(preFund - await tokenAmount(connection, proposerAta0), goodParams.bounty + feeReserve));
  await check(34, "three canonical proposal vaults are distinct genuine Tokenkeg accounts", async () => { const vaults = [bountyVaultAddress(proposalAddress(2n)), feeVaultAddress(proposalAddress(2n)), penaltyVaultAddress(proposalAddress(2n))]; assert.equal(new Set(vaults.map(String)).size, 3); for (const vault of vaults) { const info = await connection.getAccountInfo(vault, COMMITMENT); assert(info); assert(info.owner.equals(TOKEN_PROGRAM_ID)); assert.equal(info.data.length, TOKEN_ACCOUNT_SIZE); const view = tokenView(info.data); assert(view.mint.equals(mint0.publicKey)); assert(view.owner.equals(proposalEscrowAddress(proposalAddress(2n)))); assert.equal(view.state, 1); } });
  await fails(35, "duplicate ProposalEscrow funding rejected", /already in use|AccountAlreadyInitialized/, () => send(fundEscrow(2n, 0n, proposer.publicKey, proposerAta0), proposer));
  const missingAta = ataAddress(proposer.publicKey, mint1.publicKey); assert.equal(await connection.getAccountInfo(missingAta, COMMITMENT), null);
  await fails(36, "funding requires a pre-existing canonical ATA", /AccountNotInitialized|InvalidEconomicTokenAccount|NonCanonicalTokenAccount|UnsupportedEconomicTokenProgram/, () => send(fundEscrow(3n, 1n, proposer.publicKey, missingAta), proposer));
  await check(37, "failed funding creates neither ATA, escrow nor vaults", async () => { assert.equal(await connection.getAccountInfo(missingAta, COMMITMENT), null); assert.equal(await connection.getAccountInfo(proposalEscrowAddress(proposalAddress(3n)), COMMITMENT), null); assert.equal(await connection.getAccountInfo(bountyVaultAddress(proposalAddress(3n)), COMMITMENT), null); });
  const governanceFundingSignature = await send(fundEscrow(4n, 0n, governance.publicKey, governanceAta0), governance);
  await check(38, "governance funding succeeds without an admin withdrawal path", async () => { const raw = await accountData(proposalEscrowAddress(proposalAddress(4n))); assert(new PublicKey(raw.subarray(72, 104)).equals(governance.publicKey)); const source = readFileSync(`${ROOT}/programs/faultline_gate/src/lib.rs`, "utf8"); assert(!/pub fn (governance|admin)_.*withdraw.*escrow/.test(source)); });
  console.log(`SIGNATURE registry=${registrySignature} policy0=${policy0Signature} historical-start=${historicalStart} historical-commit=${historicalCommit} historical-reveal=${historicalReveal} historical-round=${historicalRound} proposal-funding=${fundingSignature} governance-funding=${governanceFundingSignature}`);
  console.log(`BALANCES funding source_before=${preFund} source_after=${await tokenAmount(connection, proposerAta0)} bounty=${await tokenAmount(connection, bountyVaultAddress(proposalAddress(2n)))} fee=${await tokenAmount(connection, feeVaultAddress(proposalAddress(2n)))} penalty=${await tokenAmount(connection, penaltyVaultAddress(proposalAddress(2n)))}`);
}

async function runStakesWithdrawal(): Promise<void> {
  await bootstrap();
  const historicalBuffer = await createLoaderBuffer("m6-phase-a-stakes-historical"); await send(createProposal(1n, historicalBuffer.key, historicalBuffer.hash), proposer);
  await send(initializeEconomicRegistry(governance.publicKey), governance); const registry = registryView(await accountData(economicRegistry));
  const mint0 = Keypair.generate(); const mint1 = Keypair.generate(); await createLegacyMint(mint0, payer.publicKey, 6); await createLegacyMint(mint1, payer.publicKey, 6);
  configMint.set(economicPolicyAddress(0n).toBase58(), mint0.publicKey); configMint.set(economicPolicyAddress(1n).toBase58(), mint1.publicKey);
  await send(initializeEconomicPolicy(0n, mint0.publicKey, stakeParams), governance); await send(initializeEconomicPolicy(1n, mint1.publicKey, stakeParams), governance);
  await send(initializeVerifierRegistry(), governance);
  const verifiers = [Keypair.fromSeed(Buffer.alloc(32, 71)), Keypair.fromSeed(Buffer.alloc(32, 72)), Keypair.fromSeed(Buffer.alloc(32, 73))];
  for (const verifier of verifiers) await send(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: verifier.publicKey, lamports: 5 * LAMPORTS_PER_SOL }), payer);
  const atas: PublicKey[] = [];
  for (const verifier of verifiers) { const ata = await createAta(payer, verifier.publicKey, mint0.publicKey); atas.push(ata); await mintTokens(mint0.publicKey, ata, 1_000n); }
  const policy1Ata = await createAta(payer, verifiers[0].publicKey, mint1.publicKey); await mintTokens(mint1.publicKey, policy1Ata, 1_000n);
  const ep0 = economicPolicyAddress(0n); const ep1 = economicPolicyAddress(1n);
  await check(39, "stake PDA is EconomicPolicy-specific", () => assert(!stakeAddress(ep0, verifiers[0].publicKey).equals(stakeAddress(ep1, verifiers[0].publicKey))));
  await check(40, "stake PDA is verifier-specific", () => assert(!stakeAddress(ep0, verifiers[0].publicKey).equals(stakeAddress(ep0, verifiers[1].publicKey))));
  const stakeSignatures: string[] = [];
  for (let i = 0; i < verifiers.length; i++) stakeSignatures.push(await send(initializeStake(0n, verifiers[i].publicKey, atas[i], 100n), verifiers[i]));
  await check(41, "verifier signer funds canonical policy stake", async () => { for (let i = 0; i < verifiers.length; i++) { const view = stakeView(await accountData(stakeAddress(ep0, verifiers[i].publicKey), 212)); assert(view.verifier.equals(verifiers[i].publicKey)); assert(view.policy.equals(ep0)); assert(view.rent.equals(verifiers[i].publicKey)); } });
  await check(42, "VerifierStake discriminator size and bumps are exact", async () => { for (const verifier of verifiers) { const raw = await accountData(stakeAddress(ep0, verifier.publicKey), 212); assert.deepEqual(raw.subarray(0, 8), discriminator("account", "VerifierStake")); assert.equal(stakeView(raw).bump, PublicKey.findProgramAddressSync([Buffer.from("verifier-stake"), ep0.toBuffer(), verifier.publicKey.toBuffer()], gate)[1]); } });
  await check(43, "StakeVault authority mint and exact balance", async () => { for (const verifier of verifiers) { const info = await connection.getAccountInfo(stakeVaultAddress(ep0, verifier.publicKey), COMMITMENT); assert(info); assert(info.owner.equals(TOKEN_PROGRAM_ID)); const view = tokenView(info.data); assert(view.owner.equals(stakeAddress(ep0, verifier.publicKey))); assert(view.mint.equals(mint0.publicKey)); assert.equal(view.amount, 100n); } });
  await fails(44, "noncanonical verifier ATA rejected", /NonCanonicalTokenAccount/, () => send(initializeStake(1n, verifiers[1].publicKey, policy1Ata, 100n), verifiers[1]));
  await fails(45, "wrong-policy stake address cannot satisfy policy", /ConstraintSeeds|WrongEconomicPolicy/, () => send(initializeStake(1n, verifiers[0].publicKey, policy1Ata, 100n, { vault: stakeVaultAddress(ep0, verifiers[0].publicKey) }), verifiers[0]));
  await fails(46, "wrong-mint stake setup rejected", /WrongPaymentMint|ConstraintAddress/, () => send(initializeStake(1n, verifiers[0].publicKey, policy1Ata, 100n, { mint: mint0.publicKey }), verifiers[0]));

  const unsorted = [verifiers[2].publicKey, verifiers[0].publicKey, verifiers[1].publicKey]; await send(createEpoch(0n, unsorted, 2), governance); await send(activateEpoch(0n), governance);
  const canonical = sortedKeys(unsorted); const epochRawBefore = Buffer.from(await accountData(epochAddress(0n)));
  await fails(47, "epoch-economics rejects missing stake", /WrongRemainingAccountCount/, () => send(activateEpochEconomics(0n, 0n, canonical.slice(0, 2).map(v => stakeAddress(ep0, v))), governance));
  await fails(48, "epoch-economics rejects duplicate or substituted stake", /WrongVerifierStake/, () => send(activateEpochEconomics(0n, 0n, [stakeAddress(ep0, canonical[0]), stakeAddress(ep0, canonical[0]), stakeAddress(ep0, canonical[2])]), governance));
  await send(requestWithdrawal(0n, verifiers[2].publicKey), verifiers[2]);
  await fails(49, "WithdrawalPending stake rejects epoch-economic activation", /StakeWithdrawalPending/, () => send(activateEpochEconomics(0n, 0n, canonical.map(v => stakeAddress(ep0, v))), governance));
  await send(cancelWithdrawal(0n, verifiers[2].publicKey), verifiers[2]);
  const epochEconomicsSignature = await send(activateEpochEconomics(0n, 0n, canonical.map(v => stakeAddress(ep0, v))), governance);
  await check(50, "sorted epoch economics binds policy and preserves VerifierEpoch bytes", async () => { const raw = await accountData(epochEconomicsAddress(epochAddress(0n), ep0), 113); assert.deepEqual(raw.subarray(0, 8), discriminator("account", "VerifierEpochEconomics")); assert(new PublicKey(raw.subarray(8, 40)).equals(epochAddress(0n))); assert(new PublicKey(raw.subarray(40, 72)).equals(ep0)); assert(new PublicKey(raw.subarray(72, 104)).equals(verifierRegistry)); assert.deepEqual(await accountData(epochAddress(0n)), epochRawBefore); for (let i = 0; i < canonical.length; i++) assert(new PublicKey(epochRawBefore.subarray(84 + i * 32, 116 + i * 32)).equals(canonical[i])); });

  await advanceTo(registry.enforcement, "stakes-enforcement-boundary");
  const proposerAta = await createAta(payer, proposer.publicKey, mint0.publicKey); const hunterAta = await createAta(payer, hunter.publicKey, mint0.publicKey);
  await mintTokens(mint0.publicKey, proposerAta, 100_000n); await mintTokens(mint0.publicKey, hunterAta, 10_000n);
  const buffers = await Promise.all([2, 3, 4].map(i => createLoaderBuffer(`m6-phase-a-stake-round-${i}`)));
  const opened: { id: bigint; commitment: Buffer; trace: Buffer; round: PublicKey; end: bigint }[] = [];
  for (let i = 0; i < 2; i++) {
    const id = BigInt(i + 2); await send(createProposal(id, buffers[i].key, buffers[i].hash), proposer); await send(fundEscrow(id, 0n, proposer.publicKey, proposerAta), proposer); await send(startFunded(id, 0n, i === 0 ? 8n : 12n), proposer);
    const trace = sha256(Buffer.from(`economic-lock-trace-${i}`)); const salt = sha256(Buffer.from(`economic-lock-salt-${i}`)); const bonded = bondedCommit(id, 0n, hunter.publicKey, hunterAta, trace, salt);
    await send(bonded.ix, hunter); await advanceTo(BigInt(await connection.getSlot(COMMITMENT)) + 1n, `reveal-delay-${i}`); await send(reveal(id, hunter.publicKey, bonded.commitment, trace, salt), hunter);
    const stakes = canonical.map(v => stakeAddress(ep0, v)); const openedRound = openEconomicRound(id, 0n, 0n, hunter.publicKey, bonded.commitment, trace, stakes); const signature = await send(openedRound.ix, payer);
    const proposalRaw = await accountData(proposalAddress(id)); opened.push({ id, commitment: bonded.commitment, trace, round: openedRound.round, end: proposalRaw.readBigUInt64LE(226) });
    console.log(`SIGNATURE economic-round-${i + 1}=${signature}`);
  }
  const roundOneEconomics = roundEconomicsView(await accountData(roundEconomicsAddress(opened[0].round), 139)); const roundTwoEconomics = roundEconomicsView(await accountData(roundEconomicsAddress(opened[1].round), 139));
  await check(51, "opening extends every assigned stake lock atomically", async () => { for (const verifier of verifiers) assert.equal(stakeView(await accountData(stakeAddress(ep0, verifier.publicKey))).lock, roundTwoEconomics.slashDeadline); });
  await check(52, "round deadlines use stored challenge end and policy grace", () => { assert.equal(roundOneEconomics.feeDeadline, opened[0].end + stakeParams.feeGrace); assert.equal(roundOneEconomics.slashDeadline, opened[0].end + stakeParams.slashGrace); assert.equal(roundTwoEconomics.slashDeadline, opened[1].end + stakeParams.slashGrace); });
  await check(53, "overlapping lock is max old versus new deadline", () => assert(roundTwoEconomics.slashDeadline > roundOneEconomics.slashDeadline));
  await check(54, "later overlapping round extends rather than replaces lock", async () => { for (const verifier of verifiers) assert.equal(stakeView(await accountData(stakeAddress(ep0, verifier.publicKey))).lock, Math.max(Number(roundOneEconomics.slashDeadline), Number(roundTwoEconomics.slashDeadline)) === Number(roundTwoEconomics.slashDeadline) ? roundTwoEconomics.slashDeadline : roundOneEconomics.slashDeadline); });
  const targetVerifier = verifiers[2]; const targetAta = atas[2]; const preWithdrawalAta = await tokenAmount(connection, targetAta);
  const requestSignature = await send(requestWithdrawal(0n, targetVerifier.publicKey), targetVerifier); const pending = stakeView(await accountData(stakeAddress(ep0, targetVerifier.publicKey)));
  await check(55, "withdrawal availability equals max(request, lock) plus cooldown", () => { assert(pending.requested !== null); assert.equal(pending.available, (pending.requested! > pending.lock ? pending.requested! : pending.lock) + stakeParams.cooldown); });

  const id4 = 4n; await send(createProposal(id4, buffers[2].key, buffers[2].hash), proposer); await send(fundEscrow(id4, 0n, proposer.publicKey, proposerAta), proposer); await send(startFunded(id4, 0n, 8n), proposer);
  const trace4 = sha256(Buffer.from("pending-withdrawal-round")); const salt4 = sha256(Buffer.from("pending-withdrawal-salt")); const bonded4 = bondedCommit(id4, 0n, hunter.publicKey, hunterAta, trace4, salt4); await send(bonded4.ix, hunter); await advanceTo(BigInt(await connection.getSlot(COMMITMENT)) + 1n, "pending-reveal-delay"); await send(reveal(id4, hunter.publicKey, bonded4.commitment, trace4, salt4), hunter);
  await fails(56, "WithdrawalPending stake cannot open a new round", /StakeWithdrawalPending/, () => send(openEconomicRound(id4, 0n, 0n, hunter.publicKey, bonded4.commitment, trace4, canonical.map(v => stakeAddress(ep0, v))).ix, payer));
  await fails(57, "early withdrawal and destination substitution fail", /WithdrawalCooldownActive|NonCanonicalTokenAccount/, () => send(withdrawStake(0n, targetVerifier.publicKey, targetAta, atas[0]), targetVerifier));
  await advancePast(opened[0].end, "first-round-timeout"); const closeSignature = await send(closeTimedOut(opened[0].id, opened[0].round), payer);
  await check(58, "earlier round closure never reduces overlapping lock", async () => assert.equal(stakeView(await accountData(stakeAddress(ep0, targetVerifier.publicKey))).lock, roundTwoEconomics.slashDeadline));
  const slashSignature = await send(slashNonReveal(opened[0].id, 0n, 0n, opened[0].round, targetVerifier.publicKey), payer); const slashed = stakeView(await accountData(stakeAddress(ep0, targetVerifier.publicKey)));
  await check(59, "WithdrawalPending stake remains objectively slashable", async () => { assert.equal(slashed.status, 1); assert.equal(slashed.amount, 80n); assert.equal(slashed.totalSlashed, 20n); assert.equal(await tokenAmount(connection, stakeVaultAddress(ep0, targetVerifier.publicKey)), 80n); assert.equal(await tokenAmount(connection, penaltyVaultAddress(proposalAddress(opened[0].id))), 20n); });
  await send(cancelWithdrawal(0n, targetVerifier.publicKey), targetVerifier);
  await send(createEpoch(1n, [targetVerifier.publicKey], 1), governance);
  let withdrawalSignature = "";
  await check(60, "under-minimum activation rolls back; checked cooldown precedes mutation; remaining stake withdraws canonically", async () => {
    const stake = stakeAddress(ep0, targetVerifier.publicKey);
    const before = Buffer.from(await accountData(stake));
    await expectFailure(
      "60 under-minimum epoch activation",
      () => send(activateEpochEconomics(1n, 0n, [stake]), governance),
      /StakeBelowMinimum/
    );
    assert.deepEqual(await accountData(stake), before);

    const source = readFileSync(`${ROOT}/programs/faultline_gate/src/lib.rs`, "utf8");
    assert(/core::cmp::max\(request_slot, slash_lock_until_slot\)[\s\S]{0,120}checked_add\(cooldown_slots\)/.test(source));
    assert(/let available = withdrawal_available_slot\([\s\S]{0,500}stake\.status = StakeStatus::WithdrawalPending/.test(source));
    assert(/withdrawal_available_slot\(u64::MAX, 0, 1\)\.is_err\(\)/.test(source));

    await send(requestWithdrawal(0n, targetVerifier.publicKey), targetVerifier);
    const finalPending = stakeView(await accountData(stake));
    assert(finalPending.available !== null);
    await advanceTo(finalPending.available!, "withdrawal-cooldown");
    withdrawalSignature = await send(withdrawStake(0n, targetVerifier.publicKey, targetAta), targetVerifier);
    assert.equal(await tokenAmount(connection, targetAta), preWithdrawalAta + 80n);
    assert.equal(await connection.getAccountInfo(stake, COMMITMENT), null);
    assert.equal(await connection.getAccountInfo(stakeVaultAddress(ep0, targetVerifier.publicKey), COMMITMENT), null);
  });
  console.log(`SIGNATURE stakes=${stakeSignatures.join(",")} epoch-economics=${epochEconomicsSignature} withdrawal-request=${requestSignature} earlier-close=${closeSignature} pending-slash=${slashSignature} withdrawal=${withdrawalSignature}`);
  console.log(`BALANCES stake_initial=100 slash=20 stake_after_slash=80 verifier_before_withdraw=${preWithdrawalAta} verifier_after_withdraw=${await tokenAmount(connection, targetAta)} penalty_after_slash=${await tokenAmount(connection, penaltyVaultAddress(proposalAddress(opened[0].id)))}`);
}

async function runBondsHold(): Promise<void> {
  const params: PolicyParameters = { bounty: 700n, bond: 100n, fee: 5n, minimumStake: 20n, slash: 20n, maxChallenges: 2, feeGrace: 2n, slashGrace: 4n, cooldown: 1n };
  const setup = await setupPhaseB("m6-phase-b-bonds", 2, 2, params, 1, 25n);
  const id = 1n; await prepareFundedProposal(setup, id, 0, 18n);
  await mintTokens(setup.mint.publicKey, setup.hunterAtas[0], 1_000n);
  await mintTokens(setup.mint.publicKey, setup.hunterAtas[1], 99n);
  await mintTokens(setup.mint.publicKey, setup.hunterAtas[2], 100n);
  const proposal = proposalAddress(id); const escrow = proposalEscrowAddress(proposal);

  const failedTrace = sha256(Buffer.from("phase-b-failed-bond")); const failedSalt = sha256(Buffer.from("phase-b-failed-salt"));
  const failedBonded = bondedCommit(id, 0n, setup.hunters[1].publicKey, setup.hunterAtas[1], failedTrace, failedSalt);
  const escrowBeforeFailure = Buffer.from(await accountData(escrow, 370));
  await expectFailure("62 failed bond transfer", () => send(failedBonded.ix, setup.hunters[1]), /insufficient funds|custom program error|InsufficientFunds/);
  await check(62, "failed bond transfer creates no accounts and changes no counters", async () => {
    assert.equal(await connection.getAccountInfo(failedBonded.commit, COMMITMENT), null); assert.equal(await connection.getAccountInfo(bondAddress(failedBonded.commit), COMMITMENT), null); assert.equal(await connection.getAccountInfo(bondVaultAddress(failedBonded.commit), COMMITMENT), null); assert.deepEqual(await accountData(escrow), escrowBeforeFailure);
  });

  const trace = sha256(Buffer.from("phase-b-hold-trace")); const salt = sha256(Buffer.from("phase-b-hold-salt")); const first = bondedCommit(id, 0n, setup.hunters[0].publicKey, setup.hunterAtas[0], trace, salt);
  const commitSignature = await send(first.ix, setup.hunters[0]);
  await check(61, "ChallengeCommit and ChallengeBond are created atomically", async () => {
    const commitRaw = await accountData(first.commit, 204); const bondRaw = await accountData(bondAddress(first.commit), 211); const commit = commitView(commitRaw); const bond = bondView(bondRaw);
    assert.deepEqual(commitRaw.subarray(0, 8), discriminator("account", "ChallengeCommit")); assert.deepEqual(bondRaw.subarray(0, 8), discriminator("account", "ChallengeBond"));
    assert(commit.proposal.equals(proposal)); assert(commit.hunter.equals(setup.hunters[0].publicKey)); assert.deepEqual(commit.commitment, first.commitment); assert.equal(commit.status, 0);
    assert(bond.commit.equals(first.commit)); assert(bond.escrow.equals(escrow)); assert(bond.hunter.equals(setup.hunters[0].publicKey)); assert(bond.vault.equals(bondVaultAddress(first.commit))); assert.equal(bond.amount, 100n); assert.equal(bond.status, 0);
    assert.equal(commit.bump, PublicKey.findProgramAddressSync([Buffer.from("challenge-commit"), proposal.toBuffer(), setup.hunters[0].publicKey.toBuffer(), first.commitment], gate)[1]); assert.equal(bond.bump, PublicKey.findProgramAddressSync([Buffer.from("challenge-bond"), first.commit.toBuffer()], gate)[1]);
    const vault = tokenView(await accountData(bondVaultAddress(first.commit), TOKEN_ACCOUNT_SIZE)); assert(vault.owner.equals(bondAddress(first.commit))); assert(vault.mint.equals(setup.mint.publicKey)); assert.equal(vault.amount, 100n);
  });
  await check(63, "successful bonded commit increments both counters once", async () => { const view = escrowView(await accountData(escrow)); assert.equal(view.committed, 1); assert.equal(view.unsettled, 1); });

  await mintTokens(setup.mint.publicKey, setup.hunterAtas[1], 1n);
  const secondTrace = sha256(Buffer.from("phase-b-second-trace")); const secondSalt = sha256(Buffer.from("phase-b-second-salt")); const second = bondedCommit(id, 0n, setup.hunters[1].publicKey, setup.hunterAtas[1], secondTrace, secondSalt); await send(second.ix, setup.hunters[1]);
  const thirdTrace = sha256(Buffer.from("phase-b-third-trace")); const thirdSalt = sha256(Buffer.from("phase-b-third-salt")); const third = bondedCommit(id, 0n, setup.hunters[2].publicKey, setup.hunterAtas[2], thirdTrace, thirdSalt);
  await expectFailure("64 challenge limit", () => send(third.ix, setup.hunters[2]), /BondedChallengeLimitReached/);
  const firstCommit = commitView(await accountData(first.commit)); await advanceTo(firstCommit.earliest, "bonds-hold-reveal"); const revealSignature = await send(reveal(id, setup.hunters[0].publicKey, first.commitment, trace, salt), setup.hunters[0]);
  await check(64, "challenge limit counts successful commits rather than reveals or rounds", async () => { const view = escrowView(await accountData(escrow)); assert.equal(view.committed, 2); assert.equal(view.unsettled, 2); assert.equal(await connection.getAccountInfo(third.commit, COMMITMENT), null); });

  await send(createEpoch(1n, setup.verifiers.map(value => value.publicKey), 2), governance);
  await send(activateEpochEconomics(1n, 0n, sortedKeys(setup.verifiers.map(value => value.publicKey)).map(value => stakeAddress(setup.ep, value))), governance);
  const stakes = setup.canonical.map(value => stakeAddress(setup.ep, value)); const opening = openEconomicRound(id, 0n, 0n, setup.hunters[0].publicKey, first.commitment, trace, stakes);
  const wrongEconomics = openEconomicRound(id, 0n, 0n, setup.hunters[0].publicKey, first.commitment, trace, stakes); wrongEconomics.ix.keys[13].pubkey = epochEconomicsAddress(epochAddress(1n), setup.ep);
  await fails(66, "economic round requires exact epoch-policy economics", /ConstraintSeeds|WrongVerifierEpochEconomics/, () => send(wrongEconomics.ix, payer));
  const locksBefore = await Promise.all(stakes.map(value => accountData(value))); const escrowBeforeRound = Buffer.from(await accountData(escrow)); const gateBeforeRound = Buffer.from(await accountData(proposalGateAddress(proposal)));
  const invalidStakes = [stakes[0], stakes[0]]; const atomicFailure = openEconomicRound(id, 0n, 0n, setup.hunters[0].publicKey, first.commitment, trace, invalidStakes);
  await expectFailure("67 atomic round lock failure", () => send(atomicFailure.ix, payer), /WrongVerifierStake/);
  await check(67, "round creation and all stake-lock extensions are atomic", async () => { assert.equal(await connection.getAccountInfo(opening.round, COMMITMENT), null); assert.equal(await connection.getAccountInfo(roundEconomicsAddress(opening.round), COMMITMENT), null); assert.deepEqual(await accountData(escrow), escrowBeforeRound); assert.deepEqual(await accountData(proposalGateAddress(proposal)), gateBeforeRound); for (let i = 0; i < stakes.length; i++) assert.deepEqual(await accountData(stakes[i]), locksBefore[i]); });
  const roundSignature = await send(opening.ix, payer);
  await check(68, "successful round opening increments unclosed_rounds once", async () => { const view = escrowView(await accountData(escrow)); assert.equal(view.unclosed, 1); assert.equal(gateView(await accountData(proposalGateAddress(proposal))).pending, 1); const econ = roundEconomicsFullView(await accountData(roundEconomicsAddress(opening.round), 139)); assert.equal(econ.status, 0); assert(econ.round.equals(opening.round)); assert(econ.escrow.equals(escrow)); for (const stake of stakes) assert.equal(stakeView(await accountData(stake)).lock, econ.slashDeadline); });
  const preDuplicateEscrow = Buffer.from(await accountData(escrow));
  await fails(65, "one ChallengeCommit cannot create multiple economic rounds", /already in use|AccountAlreadyInitialized/, () => send(opening.ix, payer));
  await fails(69, "duplicate RoundEconomicState creation fails", /already in use|AccountAlreadyInitialized/, () => send(opening.ix, payer));
  assert.deepEqual(await accountData(escrow), preDuplicateEscrow);

  const receipt = sha256(Buffer.from("phase-b-hold-receipt")); const resultHash = replayResultCommitment(proposal, invariantAddress(1n), traceAddress(proposal, trace), setup.buffers[0].hash, sha256(Buffer.from("spec-1")), 0, receipt);
  await send(createReplay(opening.round, resultHash, 0, receipt), payer);
  for (const verifier of setup.verifiers) await send(attest(verifier.publicKey, id, 0n, opening.round, trace, resultHash), verifier);
  const econBeforeFinalize = Buffer.from(await accountData(roundEconomicsAddress(opening.round))); const escrowBeforeFinalize = Buffer.from(await accountData(escrow));
  const finalizationSignature = await send(finalizeReplay(id, opening.round, resultHash), outsider);
  await check(70, "finalize_replay_result uses six accounts and no economic settlement accounts", async () => { assert.equal(finalizeReplay(id, opening.round, resultHash).keys.length, 6); assert.deepEqual(await accountData(roundEconomicsAddress(opening.round)), econBeforeFinalize); assert.deepEqual(await accountData(escrow), escrowBeforeFinalize); const replay = replayView(await accountData(replayResultAddress(opening.round, resultHash), 115)); assert.equal(replay.votes, 2); assert.equal(replay.verdict, 0); });
  await check(73, "HOLD finalization leaves proposal ChallengeActive", async () => { const p = proposalView(await accountData(proposal)); const round = roundView(await accountData(opening.round, 317)); assert.equal(p.state, 1); assert.equal(round.status, 1); assert(round.winner?.equals(replayResultAddress(opening.round, resultHash))); });
  const closeSignature = await send(closeFinalized(id, opening.round), payer);
  await check(71, "economic close decrements unclosed_rounds exactly once", async () => { const view = escrowView(await accountData(escrow)); const econ = roundEconomicsFullView(await accountData(roundEconomicsAddress(opening.round))); assert.equal(view.unclosed, 0); assert.equal(econ.status, 1); assert(econ.closed !== null); });
  await check(74, "HOLD economic close closes only its matching round", async () => { const econ = roundEconomicsFullView(await accountData(roundEconomicsAddress(opening.round))); assert(econ.round.equals(opening.round)); assert(econ.escrow.equals(escrow)); assert.equal(escrowView(await accountData(escrow)).winningRound, null); });
  const closedEscrow = Buffer.from(await accountData(escrow));
  await fails(72, "duplicate economic close fails without underflow", /RoundEconomicsAlreadyClosed/, () => send(closeFinalized(id, opening.round), payer)); assert.deepEqual(await accountData(escrow), closedEscrow);

  const bountyBefore = await tokenAmount(connection, bountyVaultAddress(proposal)); const penaltyBefore = await tokenAmount(connection, penaltyVaultAddress(proposal)); const hunterBefore = await tokenAmount(connection, setup.hunterAtas[0]); const hunterLamportsBefore = await connection.getBalance(setup.hunters[0].publicKey, COMMITMENT); const bondVaultInfo = await connection.getAccountInfo(bondVaultAddress(first.commit), COMMITMENT); assert(bondVaultInfo);
  const holdSettlementSignature = await send(settleHold(id, 0n, setup.hunters[0].publicKey, first.commitment, trace, setup.hunterAtas[0]), payer);
  await check(75, "HOLD settlement forfeits floor bond times 2500 over 10000", async () => { const bond = bondView(await accountData(bondAddress(first.commit), 211)); assert.equal(bond.status, 2); assert.equal(bond.refunded, 75n); assert.equal(bond.forfeited, 25n); assert.equal(await tokenAmount(connection, penaltyVaultAddress(proposal)), penaltyBefore + 25n); assert.equal(await tokenAmount(connection, setup.hunterAtas[0]), hunterBefore + 75n); assert.equal(await connection.getAccountInfo(bondVaultAddress(first.commit), COMMITMENT), null); assert.equal(await connection.getBalance(setup.hunters[0].publicKey, COMMITMENT), hunterLamportsBefore + bondVaultInfo.lamports); assert.equal(escrowView(await accountData(escrow)).unsettled, 1); });
  await check(76, "HOLD settlement leaves BountyVault unchanged", async () => assert.equal(await tokenAmount(connection, bountyVaultAddress(proposal)), bountyBefore));
  console.log(`SIGNATURE bonded-commit=${commitSignature} reveal=${revealSignature} round-opening=${roundSignature} hold-finalization=${finalizationSignature} hold-close=${closeSignature} hold-settlement=${holdSettlementSignature}`);
  console.log(`BALANCES hold hunter_before=${hunterBefore} hunter_after=${await tokenAmount(connection, setup.hunterAtas[0])} bond_before=100 bond_after=closed penalty_before=${penaltyBefore} penalty_after=${await tokenAmount(connection, penaltyVaultAddress(proposal))} bounty_before=${bountyBefore} bounty_after=${await tokenAmount(connection, bountyVaultAddress(proposal))}`);
}

async function runViolationFees(): Promise<void> {
  const params: PolicyParameters = { bounty: 700n, bond: 100n, fee: 5n, minimumStake: 20n, slash: 20n, maxChallenges: 2, feeGrace: 1n, slashGrace: 4n, cooldown: 1n };
  const setup = await setupPhaseB("m6-phase-b-violation-fees", 3, 2, params, 1, 25n, true);
  const id = 1n; await prepareFundedProposal(setup, id, 0, 14n, true);
  const proposal = proposalAddress(id); const escrow = proposalEscrowAddress(proposal);
  const metadata = proposalView(await accountData(proposal));
  const trace = sha256(Buffer.from("m6-vf-winning-trace")); const salt = sha256(Buffer.from("m6-vf-winning-salt"));
  const bonded = await revealBond(id, setup.hunters[0], setup.hunterAtas[0], trace, salt);
  const opening = openEconomicRound(id, 0n, 0n, setup.hunters[0].publicKey, bonded.commitment, trace, setup.canonical.map(v => stakeAddress(setup.ep, v)));
  const roundSignature = await send(opening.ix, payer);
  const receipt = sha256(Buffer.from("m6-vf-violation-receipt"));
  const resultHash = replayResultCommitment(proposal, invariantAddress(1n), traceAddress(proposal, trace), setup.buffers[0].hash, sha256(Buffer.from("spec-1")), 1, receipt);
  const minorityReceipt = sha256(Buffer.from("m6-vf-minority-receipt"));
  const minorityHash = replayResultCommitment(proposal, invariantAddress(1n), traceAddress(proposal, trace), setup.buffers[0].hash, sha256(Buffer.from("spec-1")), 0, minorityReceipt);
  await sendMany([createReplay(opening.round, resultHash, 1, receipt), createReplay(opening.round, minorityHash, 0, minorityReceipt)], payer);
  await sendMany([attest(setup.verifiers[0].publicKey, id, 0n, opening.round, trace, resultHash), attest(setup.verifiers[1].publicKey, id, 0n, opening.round, trace, resultHash)], payer, setup.verifiers.slice(0, 2));
  await send(attest(setup.verifiers[2].publicKey, id, 0n, opening.round, trace, minorityHash), setup.verifiers[2]);
  const finalizationSignature = await send(finalizeReplay(id, opening.round, resultHash), outsider);
  await check(77, "VIOLATION automatically rejects with reason 0x5001", async () => { const p = proposalView(await accountData(proposal)); const g = gateView(await accountData(proposalGateAddress(proposal))); assert.equal(p.state, 3); assert.equal(p.reason, 0x5001); assert(g.confirmed); assert(g.last?.equals(opening.round)); });
  await fails(84, "post-finalization attestation is impossible", /RoundNotOpen/, () => send(attest(outsider.publicKey, id, 0n, opening.round, trace, resultHash), outsider));
  const closeSignature = await send(closeFinalized(id, opening.round), payer);
  await check(78, "accepted settlement requires last_violation_round", async () => { const g = gateView(await accountData(proposalGateAddress(proposal))); const e = escrowView(await accountData(escrow)); assert(g.last?.equals(opening.round)); assert(e.winningRound?.equals(opening.round)); assert(e.winningTrace?.equals(traceAddress(proposal, trace))); });
  await check(79, "winning trace hunter bond and destination substitution fail", async () => {
    await expectFailure("79 destination", () => send(settleAccepted(id, 0n, setup.hunters[0].publicKey, bonded.commitment, trace, setup.hunterAtas[1]), payer), /NonCanonicalTokenAccount/);
    await expectFailure("79 trace", () => send(settleAccepted(id, 0n, setup.hunters[0].publicKey, bonded.commitment, sha256(Buffer.from("wrong-trace")), setup.hunterAtas[0]), payer), /WrongTraceBinding|AccountNotInitialized|Constraint/);
    await expectFailure("79 hunter", () => send(settleAccepted(id, 0n, setup.hunters[1].publicKey, bonded.commitment, trace, setup.hunterAtas[1]), payer), /WrongChallengeBond|Constraint|AccountNotInitialized/);
  });
  const hunterBefore = await tokenAmount(connection, setup.hunterAtas[0]); const bountyBefore = await tokenAmount(connection, bountyVaultAddress(proposal)); const bondBefore = await tokenAmount(connection, bondVaultAddress(bonded.commit));
  const settlementSignature = await send(settleAccepted(id, 0n, setup.hunters[0].publicKey, bonded.commitment, trace, setup.hunterAtas[0]), payer);
  await check(80, "canonical hunter receives exact bounty plus full bond", async () => { assert.equal(await tokenAmount(connection, setup.hunterAtas[0]), hunterBefore + params.bounty + params.bond); assert.equal(bountyBefore, params.bounty); assert.equal(bondBefore, params.bond); assert.equal(await tokenAmount(connection, bountyVaultAddress(proposal)), 0n); assert.equal(bondView(await accountData(bondAddress(bonded.commit))).status, 1); });
  await fails(81, "bounty and bond settlement cannot repeat", /BondNotPending|BountyAlreadySettled/, () => send(settleAccepted(id, 0n, setup.hunters[0].publicKey, bonded.commitment, trace, setup.hunterAtas[0]), payer));
  await check(82, "candidate and timing metadata remain unchanged", async () => { const after = proposalView(await accountData(proposal)); for (const field of ["policy", "target", "programData", "candidate", "proposer"] as const) assert(after[field].equals(metadata[field])); assert.deepEqual(after.candidateHash, metadata.candidateHash); assert.equal(after.created, metadata.created); assert.equal(after.start, metadata.start); assert.equal(after.end, metadata.end); });
  const feeVault = feeVaultAddress(proposal); const feeBefore = await tokenAmount(connection, feeVault); const bountyAfter = await tokenAmount(connection, bountyVaultAddress(proposal));
  const claim0 = await send(claimFee(id, 0n, 0n, opening.round, resultHash, setup.verifiers[0].publicKey, setup.verifierAtas[0]), payer);
  await check(83, "every matching pre-finalization attestation can claim one fixed fee", async () => { const claim = feeClaimView(await accountData(feeClaimAddress(opening.round, setup.verifiers[0].publicKey))); assert.equal(claim.amount, params.fee); assert(claim.attestation.equals(attestationAddress(opening.round, setup.verifiers[0].publicKey))); });
  await check(85, "minority mismatching attestation receives no fee and is not slashable", async () => { await expectFailure("85 mismatching fee", () => send(claimFee(id, 0n, 0n, opening.round, resultHash, setup.verifiers[2].publicKey, setup.verifierAtas[2]), payer), /WrongAttestationBinding/); await expectFailure("85 finalized slash", () => send(slashNonReveal(id, 0n, 0n, opening.round, setup.verifiers[2].publicKey), payer), /RoundNotSlashable/); });
  await fails(86, "duplicate verifier fee claim fails", /VerifierFeeAlreadyClaimed/, () => send(claimFee(id, 0n, 0n, opening.round, resultHash, setup.verifiers[0].publicKey, setup.verifierAtas[0]), payer));
  await check(87, "aggregate fees remain within fee_reserve_amount", async () => { const e = escrowView(await accountData(escrow)); assert(e.feesClaimed <= e.reserve); assert.equal(e.feesClaimed, params.fee); });
  await check(88, "fee claim never decreases BountyVault", async () => { assert.equal(await tokenAmount(connection, feeVault), feeBefore - params.fee); assert.equal(await tokenAmount(connection, bountyVaultAddress(proposal)), bountyAfter); });
  const economics = roundEconomicsFullView(await accountData(roundEconomicsAddress(opening.round)));
  await advanceTo(economics.feeDeadline - 1n, "violation-fees-deadline-minus-one");
  const claimAtDeadline = await send(claimFee(id, 0n, 0n, opening.round, resultHash, setup.verifiers[1].publicKey, setup.verifierAtas[1]), payer);
  await check(89, "claim at exact fee deadline succeeds", async () => assert.equal(feeClaimView(await accountData(feeClaimAddress(opening.round, setup.verifiers[1].publicKey))).slot, economics.feeDeadline));
  await advancePast(economics.feeDeadline, "violation-fees-after-deadline");
  await fails(90, "claim after fee deadline fails", /FeeClaimDeadlinePassed/, () => send(claimFee(id, 0n, 0n, opening.round, resultHash, setup.verifiers[1].publicKey, setup.verifierAtas[1]), payer));
  await check(91, "unclaimed fees remain reserved for original funder refund", async () => { const e = escrowView(await accountData(escrow)); assert.equal(await tokenAmount(connection, feeVault), e.reserve - e.feesClaimed); assert(e.funder.equals(proposer.publicKey)); });
  console.log(`SIGNATURE violation-bond=${bonded.signature} violation-round=${roundSignature} finalization=${finalizationSignature} close=${closeSignature} settlement=${settlementSignature} fee-claims=${claim0},${claimAtDeadline}`);
  console.log(`BALANCES hunter_before=${hunterBefore} hunter_after=${await tokenAmount(connection, setup.hunterAtas[0])} bounty_before=${bountyBefore} bounty_after=${await tokenAmount(connection, bountyVaultAddress(proposal))} fee_before=${feeBefore} fee_after=${await tokenAmount(connection, feeVault)}`);
}

async function runBondOutcomes(): Promise<void> {
  const params: PolicyParameters = { bounty: 700n, bond: 100n, fee: 5n, minimumStake: 20n, slash: 20n, maxChallenges: 2, feeGrace: 1n, slashGrace: 1n, cooldown: 1n };
  const setup = await setupPhaseB("m6-phase-b-bond-outcomes", 2, 2, params, 2, 25n, true);
  const timeoutId = 1n; const violationId = 2n;
  await prepareFundedProposal(setup, timeoutId, 0, 10n, true);
  await prepareFundedProposal(setup, violationId, 1, 14n, true);
  const timeoutProposal = proposalAddress(timeoutId); const violationProposal = proposalAddress(violationId);
  const timeoutTrace = sha256(Buffer.from("m6-bo-timeout")); const timeoutSalt = sha256(Buffer.from("m6-bo-timeout-salt"));
  const nonTrace = sha256(Buffer.from("m6-bo-nonreveal")); const nonSalt = sha256(Buffer.from("m6-bo-nonreveal-salt"));
  const timed = bondedCommit(timeoutId, 0n, setup.hunters[0].publicKey, setup.hunterAtas[0], timeoutTrace, timeoutSalt);
  const non = bondedCommit(timeoutId, 0n, setup.hunters[1].publicKey, setup.hunterAtas[1], nonTrace, nonSalt);
  await sendMany([timed.ix, non.ix], payer, setup.hunters.slice(0, 2));
  await advanceTo(commitView(await accountData(timed.commit)).earliest, "bond-outcomes-timeout-reveal");
  await send(reveal(timeoutId, setup.hunters[0].publicKey, timed.commitment, timeoutTrace, timeoutSalt), setup.hunters[0]);
  const timeoutOpen = openEconomicRound(timeoutId, 0n, 0n, setup.hunters[0].publicKey, timed.commitment, timeoutTrace, setup.canonical.map(v => stakeAddress(setup.ep, v)));
  await send(timeoutOpen.ix, payer);
  const winnerTrace = sha256(Buffer.from("m6-bo-winner")); const winnerSalt = sha256(Buffer.from("m6-bo-winner-salt"));
  const siblingTrace = sha256(Buffer.from("m6-bo-sibling")); const siblingSalt = sha256(Buffer.from("m6-bo-sibling-salt"));
  const winner = bondedCommit(violationId, 0n, setup.hunters[0].publicKey, setup.hunterAtas[0], winnerTrace, winnerSalt);
  const sibling = bondedCommit(violationId, 0n, setup.hunters[1].publicKey, setup.hunterAtas[1], siblingTrace, siblingSalt);
  await sendMany([winner.ix, sibling.ix], payer, setup.hunters.slice(0, 2));
  await advanceTo(commitView(await accountData(winner.commit)).earliest, "bond-outcomes-violation-reveal");
  await sendMany([reveal(violationId, setup.hunters[0].publicKey, winner.commitment, winnerTrace, winnerSalt), reveal(violationId, setup.hunters[1].publicKey, sibling.commitment, siblingTrace, siblingSalt)], payer, setup.hunters.slice(0, 2));
  const winnerOpen = openEconomicRound(violationId, 0n, 0n, setup.hunters[0].publicKey, winner.commitment, winnerTrace, setup.canonical.map(v => stakeAddress(setup.ep, v)));
  const siblingOpen = openEconomicRound(violationId, 0n, 0n, setup.hunters[1].publicKey, sibling.commitment, siblingTrace, setup.canonical.map(v => stakeAddress(setup.ep, v)));
  await sendMany([winnerOpen.ix, siblingOpen.ix], payer);
  const receipt = sha256(Buffer.from("m6-bo-violation")); const hash = replayResultCommitment(violationProposal, invariantAddress(1n), traceAddress(violationProposal, winnerTrace), setup.buffers[1].hash, sha256(Buffer.from("spec-1")), 1, receipt);
  await send(createReplay(winnerOpen.round, hash, 1, receipt), payer);
  await sendMany([attest(setup.verifiers[0].publicKey, violationId, 0n, winnerOpen.round, winnerTrace, hash), attest(setup.verifiers[1].publicKey, violationId, 0n, winnerOpen.round, winnerTrace, hash)], payer, setup.verifiers);
  await send(finalizeReplay(violationId, winnerOpen.round, hash), outsider);
  const timeoutEnd = proposalView(await accountData(timeoutProposal)).end!; await advancePast(timeoutEnd, "bond-outcomes-timeout-end");
  await send(closeTimedOut(timeoutId, timeoutOpen.round), payer);
  const timeoutHunterBefore = await tokenAmount(connection, setup.hunterAtas[0]); const timeoutRefund = await send(settleRoundRefund(timeoutId, 0n, setup.hunters[0].publicKey, timed.commitment, timeoutTrace, setup.hunterAtas[0]), payer);
  await check(93, "verifier-caused timeout returns 100 percent bond", async () => { const b = bondView(await accountData(bondAddress(timed.commit))); assert.equal(b.status, 4); assert.equal(b.refunded, params.bond); assert.equal(await tokenAmount(connection, setup.hunterAtas[0]), timeoutHunterBefore + params.bond); });
  const nonView = commitView(await accountData(non.commit)); await advancePast(nonView.latest, "bond-outcomes-non-reveal"); const penalty = penaltyVaultAddress(timeoutProposal); const penaltyBefore = await tokenAmount(connection, penalty); const nonBefore = await tokenAmount(connection, setup.hunterAtas[1]); const nonSettlement = await send(settleNonReveal(timeoutId, 0n, setup.hunters[1].publicKey, non.commitment), payer);
  await check(92, "hunter non-reveal forfeits 100 percent bond", async () => { const b = bondView(await accountData(bondAddress(non.commit))); assert.equal(b.status, 3); assert.equal(b.forfeited, params.bond); assert.equal(await tokenAmount(connection, penalty), penaltyBefore + params.bond); assert.equal(await tokenAmount(connection, setup.hunterAtas[1]), nonBefore); });
  const violationEnd = proposalView(await accountData(violationProposal)).end!; await advancePast(violationEnd, "bond-outcomes-sibling-abort"); const siblingBefore = await tokenAmount(connection, setup.hunterAtas[1]); await send(closeTimedOut(violationId, siblingOpen.round), payer); const siblingRefund = await send(settleRoundRefund(violationId, 0n, setup.hunters[1].publicKey, sibling.commitment, siblingTrace, setup.hunterAtas[1]), payer);
  await check(94, "canonical VIOLATION sibling is Aborted and fully refunded", async () => { assert.equal(roundEconomicsFullView(await accountData(roundEconomicsAddress(siblingOpen.round))).status, 4); assert.equal(bondView(await accountData(bondAddress(sibling.commit))).status, 5); assert.equal(await tokenAmount(connection, setup.hunterAtas[1]), siblingBefore + params.bond); await expectFailure("94 aborted slash", () => send(slashNonReveal(violationId, 0n, 0n, siblingOpen.round, setup.verifiers[1].publicKey), payer), /RoundNotSlashable/); });
  console.log(`SIGNATURE timeout-refund=${timeoutRefund} non-reveal=${nonSettlement} sibling-refund=${siblingRefund}`);
}

async function runObjectiveSlashing(): Promise<void> {
  const params: PolicyParameters = { bounty: 700n, bond: 100n, fee: 5n, minimumStake: 20n, slash: 20n, maxChallenges: 2, feeGrace: 1n, slashGrace: 5n, cooldown: 1n };
  const setup = await setupPhaseB("m6-phase-b-objective", 3, 2, params, 1, 25n, true);
  const id = 1n; await prepareFundedProposal(setup, id, 0, 10n, true);
  const proposal = proposalAddress(id); const penalty = penaltyVaultAddress(proposal); const bounty = bountyVaultAddress(proposal);
  const traceA = sha256(Buffer.from("m6-os-a")); const saltA = sha256(Buffer.from("m6-os-a-salt"));
  const traceB = sha256(Buffer.from("m6-os-b")); const saltB = sha256(Buffer.from("m6-os-b-salt"));
  const a = bondedCommit(id, 0n, setup.hunters[0].publicKey, setup.hunterAtas[0], traceA, saltA);
  const b = bondedCommit(id, 0n, setup.hunters[1].publicKey, setup.hunterAtas[1], traceB, saltB);
  await sendMany([a.ix, b.ix], payer, setup.hunters.slice(0, 2));
  await advanceTo(commitView(await accountData(a.commit)).earliest, "objective-reveal-window");
  await sendMany([reveal(id, setup.hunters[0].publicKey, a.commitment, traceA, saltA), reveal(id, setup.hunters[1].publicKey, b.commitment, traceB, saltB)], payer, setup.hunters.slice(0, 2));
  const openA = openEconomicRound(id, 0n, 0n, setup.hunters[0].publicKey, a.commitment, traceA, setup.canonical.map(v => stakeAddress(setup.ep, v)));
  const openB = openEconomicRound(id, 0n, 0n, setup.hunters[1].publicKey, b.commitment, traceB, setup.canonical.map(v => stakeAddress(setup.ep, v)));
  await sendMany([openA.ix, openB.ix], payer);
  const stake1 = stakeAddress(setup.ep, setup.verifiers[1].publicKey); const stakeBefore = Buffer.from(await accountData(stake1)); const penaltyBefore = await tokenAmount(connection, penalty);
  await expectFailure("97 early slash", () => send(slashNonReveal(id, 0n, 0n, openA.round, setup.verifiers[1].publicKey), payer), /SlashWindowNotOpen/);
  await check(97, "slash at or before challenge end fails atomically", async () => { assert.deepEqual(await accountData(stake1), stakeBefore); assert.equal(await tokenAmount(connection, penalty), penaltyBefore); });
  // Rent-exempt, zero-data System-owned canonical PDAs exercise the same
  // allocation/assignment boundary without this validator's literal-1-lamport limitation.
  await dust(attestationAddress(openA.round, setup.verifiers[0].publicKey));
  await dust(slashReceiptAddress(openA.round, setup.verifiers[1].publicKey));
  await dust(slashReceiptAddress(openB.round, setup.verifiers[1].publicKey));
  const receipt = sha256(Buffer.from("m6-os-attestation")); const result = replayResultCommitment(proposal, invariantAddress(1n), traceAddress(proposal, traceA), setup.buffers[0].hash, sha256(Buffer.from("spec-1")), 0, receipt);
  await sendMany([createReplay(openA.round, result, 0, receipt), attest(setup.verifiers[0].publicKey, id, 0n, openA.round, traceA, result)], payer, [setup.verifiers[0]]);
  const end = proposalView(await accountData(proposal)).end!; await advancePast(end, "objective-timeout-window");
  await sendMany([closeTimedOut(id, openA.round), closeTimedOut(id, openB.round)], payer);
  const economics = roundEconomicsFullView(await accountData(roundEconomicsAddress(openB.round)));
  const wrong = slashNonReveal(id, 0n, 0n, openB.round, setup.verifiers[1].publicKey); wrong.keys[14].pubkey = bounty;
  await expectFailure("102 wrong penalty destination", () => send(wrong, payer), /ConstraintSeeds|WrongVault/);
  let governanceAttestationBarrierProved = false;
  await check(96, "valid attestation prevents slash", async () => {
    await expectFailure("96 and 104 governance valid-attestation slash", () => send(slashNonReveal(id, 0n, 0n, openA.round, setup.verifiers[0].publicKey, governance.publicKey), governance), /VerifierAttestationExists/);
    governanceAttestationBarrierProved = true;
  });
  await check(104, "governance cannot classify valid disagreement slashable", () => assert(governanceAttestationBarrierProved));
  await advanceTo(economics.slashDeadline - 2n, "objective-slash-deadline-minus-two");
  const slashOne = await send(slashNonReveal(id, 0n, 0n, openA.round, setup.verifiers[1].publicKey), payer);
  const slashTwo = await send(slashNonReveal(id, 0n, 0n, openB.round, setup.verifiers[1].publicKey), payer);
  await check(95, "timed-out assigned verifier without attestation is slashable", async () => assert.equal(slashReceiptView(await accountData(slashReceiptAddress(openA.round, setup.verifiers[1].publicKey))).amount, 20n));
  await check(98, "second slash lands exactly at slash deadline", async () => assert.equal(slashReceiptView(await accountData(slashReceiptAddress(openB.round, setup.verifiers[1].publicKey))).slot, economics.slashDeadline));
  await fails(100, "duplicate slash receipt fails", /VerifierAlreadySlashed|ZeroSettlementAmount/, () => send(slashNonReveal(id, 0n, 0n, openB.round, setup.verifiers[1].publicKey), payer));
  await check(101, "second slash is capped at remaining five stake", async () => { const second = slashReceiptView(await accountData(slashReceiptAddress(openB.round, setup.verifiers[1].publicKey))); const stake = stakeView(await accountData(stake1)); assert.equal(second.amount, 5n); assert.equal(stake.amount, 0n); assert.equal(stake.totalSlashed, 25n); });
  await check(102, "all slash tokens reach only canonical PenaltyVault", async () => { assert.equal(await tokenAmount(connection, penalty), penaltyBefore + 25n); assert.equal(await tokenAmount(connection, bounty), params.bounty); });
  await check(103, "prefunded zero-data System attestation and receipts initialize", async () => { for (const [address, name] of [[attestationAddress(openA.round, setup.verifiers[0].publicKey), "VerifierAttestation"], [slashReceiptAddress(openA.round, setup.verifiers[1].publicKey), "VerifierSlashReceipt"], [slashReceiptAddress(openB.round, setup.verifiers[1].publicKey), "VerifierSlashReceipt"]] as const) { const info = await connection.getAccountInfo(address, COMMITMENT); assert(info?.owner.equals(gate)); assert.deepEqual(info!.data.subarray(0, 8), discriminator("account", name)); } });
  await advancePast(economics.slashDeadline, "objective-after-deadline");
  await fails(99, "unattested verifier slash after deadline fails", /SlashClaimDeadlinePassed/, () => send(slashNonReveal(id, 0n, 0n, openB.round, setup.verifiers[2].publicKey), payer));
  console.log(`SIGNATURE objective-rounds=${slashOne},${slashTwo} penalty_before=${penaltyBefore} penalty_after=${await tokenAmount(connection, penalty)}`);
}

async function runPendingRefund(): Promise<void> {
  const params: PolicyParameters = { bounty: 700n, bond: 100n, fee: 5n, minimumStake: 20n, slash: 20n, maxChallenges: 2, feeGrace: 2n, slashGrace: 2n, cooldown: 1n };
  const setup = await setupPhaseB("m6-phase-c-pending-refund", 1, 1, params, 2, 25n, true);
  const pendingId = 1n; const nonterminalId = 2n;
  await prepareFundedProposal(setup, pendingId, 0, 12n, true);
  const pendingProposal = proposalAddress(pendingId); const pendingEscrow = proposalEscrowAddress(pendingProposal);
  await sendMany([createProposal(nonterminalId, setup.buffers[1].key, setup.buffers[1].hash), fundEscrow(nonterminalId, 0n, proposer.publicKey, setup.proposerAta)], proposer);
  await check(105, "Draft, ChallengeActive, and Approved proposals are nonterminal and cannot refund proposal escrow", async () => {
    await expectFailure("105 ChallengeActive", () => send(refundEscrow(pendingId, 0n), payer), /ProposalNotTerminal/);
    await expectFailure("105 Draft", () => send(refundEscrow(nonterminalId, 0n), payer), /ProposalNotTerminal/);
    await send(startFunded(nonterminalId, 0n, 12n), proposer); await send(recordDecision(nonterminalId, 2, 0x6002), governance);
    assert.equal(proposalView(await accountData(proposalAddress(nonterminalId))).state, 2);
    await expectFailure("105 Approved", () => send(refundEscrow(nonterminalId, 0n), payer), /ProposalNotTerminal/);
  });
  const pendingEnd = proposalView(await accountData(pendingProposal)).end!;
  await advancePast(pendingEnd, "phase-c-pending-expiry");
  const expirySignature = await send(expireProposal(pendingId), payer);
  const pendingRefundSlot = escrowView(await accountData(pendingEscrow)).refundEligible!;
  await advanceTo(pendingRefundSlot, "phase-c-refund-exact-deadline");
  assert.equal(BigInt(await connection.getSlot(COMMITMENT)), pendingRefundSlot, "refund boundary fixture missed exact slot");
  await fails(106, "refund at refund_eligible_slot is rejected; eligibility begins strictly after that slot", /RefundDeadlineNotReached/, () => send(refundEscrow(pendingId, 0n), payer));
  await advancePast(pendingRefundSlot, "phase-c-refund-after-deadline");

  const outsiderAta = await createAta(payer, outsider.publicKey, setup.mint.publicKey);
  const pendingBeforeSubstitution = Buffer.from(await accountData(pendingEscrow));
  const pendingVaultBalances = await Promise.all([bountyVaultAddress(pendingProposal), feeVaultAddress(pendingProposal), penaltyVaultAddress(pendingProposal)].map(v => tokenAmount(connection, v)));
  await check(107, "substituting the funder ATA or rent recipient is rejected atomically without changing escrow or vault balances", async () => {
    await expectFailure("107 destination substitution", () => send(refundEscrow(pendingId, 0n, payer.publicKey, outsiderAta), payer), /NonCanonicalTokenAccount/);
    await expectFailure("107 rent substitution", () => send(refundEscrow(pendingId, 0n, payer.publicKey, setup.proposerAta, outsider.publicKey), payer), /WrongRentRecipient/);
    assert.deepEqual(await accountData(pendingEscrow), pendingBeforeSubstitution);
    assert.deepEqual(await Promise.all([bountyVaultAddress(pendingProposal), feeVaultAddress(pendingProposal), penaltyVaultAddress(pendingProposal)].map(v => tokenAmount(connection, v))), pendingVaultBalances);
  });
  await sendMany([
    mintTokensInstruction(setup.mint.publicKey, bountyVaultAddress(pendingProposal), 7n),
    mintTokensInstruction(setup.mint.publicKey, feeVaultAddress(pendingProposal), 11n),
    mintTokensInstruction(setup.mint.publicKey, penaltyVaultAddress(pendingProposal), 13n)
  ], payer);
  const pendingVaults = [bountyVaultAddress(pendingProposal), feeVaultAddress(pendingProposal), penaltyVaultAddress(pendingProposal)];
  const actualPendingBalances = await Promise.all(pendingVaults.map(v => tokenAmount(connection, v)));
  const expectedPendingRefund = actualPendingBalances.reduce((sum, value) => sum + value, 0n);
  const pendingTokenBefore = await tokenAmount(connection, setup.proposerAta);
  const pendingRentBefore = await connection.getBalance(proposer.publicKey, COMMITMENT);
  const pendingVaultRent = (await Promise.all(pendingVaults.map(v => connection.getAccountInfo(v, COMMITMENT)))).reduce((sum, info) => sum + (info?.lamports ?? 0), 0);
  const pendingRefundSignature = await send(refundEscrow(pendingId, 0n, governance.publicKey), governance);
  await check(108, "permissionless refund transfers every actual proposal-vault token only to the original funder ATA", async () => assert.equal(await tokenAmount(connection, setup.proposerAta), pendingTokenBefore + expectedPendingRefund));
  await check(109, "Pending bounty becomes RefundedToFunder with exact refunds_paid and a retained escrow receipt", async () => { const view = escrowView(await accountData(pendingEscrow, 370)); assert.equal(view.bountyStatus, 2); assert.equal(view.refundsPaid, expectedPendingRefund); assert(view.funder.equals(proposer.publicKey)); });
  await check(110, "all proposal vaults close and exact lamport rent returns only to the recorded funder", async () => { for (const vault of pendingVaults) assert.equal(await connection.getAccountInfo(vault, COMMITMENT), null); assert.equal(await connection.getBalance(proposer.publicKey, COMMITMENT), pendingRentBefore + pendingVaultRent); });
  await fails(111, "final escrow refund cannot repeat after all proposal vaults close", /AccountNotInitialized|not initialized|EscrowAlreadyRefunded/, () => send(refundEscrow(pendingId, 0n), payer));
  console.log(`SIGNATURE refund-expiry=${expirySignature} pending-refund=${pendingRefundSignature}`);
  console.log(`BALANCES pending_vaults=${actualPendingBalances.join(",")} pending_refund=${expectedPendingRefund}`);
}

async function runPaidRefund(): Promise<void> {
  const params: PolicyParameters = { bounty: 700n, bond: 100n, fee: 5n, minimumStake: 20n, slash: 20n, maxChallenges: 1, feeGrace: 1n, slashGrace: 1n, cooldown: 1n };
  const setup = await setupPhaseB("m6-phase-c-paid-refund", 2, 2, params, 1, 25n, true);
  const violationId = 1n; await prepareFundedProposal(setup, violationId, 0, 12n, true);
  const violationProposal = proposalAddress(violationId); const trace = sha256(Buffer.from("m6-phase-c-paid-refund-violation")); const salt = sha256(Buffer.from("m6-phase-c-paid-refund-violation-salt"));
  const bonded = await revealBond(violationId, setup.hunters[0], setup.hunterAtas[0], trace, salt);
  const opening = openEconomicRound(violationId, 0n, 0n, setup.hunters[0].publicKey, bonded.commitment, trace, setup.canonical.map(v => stakeAddress(setup.ep, v)));
  const roundSignature = await send(opening.ix, payer); const receipt = sha256(Buffer.from("m6-phase-c-paid-refund-result"));
  const resultHash = replayResultCommitment(violationProposal, invariantAddress(1n), traceAddress(violationProposal, trace), setup.buffers[0].hash, sha256(Buffer.from("spec-1")), 1, receipt);
  await send(createReplay(opening.round, resultHash, 1, receipt), payer);
  await sendMany(setup.verifiers.map(v => attest(v.publicKey, violationId, 0n, opening.round, trace, resultHash)), payer, setup.verifiers);
  const finalizeSignature = await send(finalizeReplay(violationId, opening.round, resultHash), outsider);
  const violationEnd = proposalView(await accountData(violationProposal)).end!; await advancePast(violationEnd + 1n, "phase-c-paid-refund-deadline");
  const violationEscrow = proposalEscrowAddress(violationProposal); const violationRefundSlot = escrowView(await accountData(violationEscrow)).refundEligible!;
  assert(BigInt(await connection.getSlot(COMMITMENT)) > violationRefundSlot);
  const liabilitySnapshot = Buffer.from(await accountData(violationEscrow)); const violationBountyBeforeLiability = await tokenAmount(connection, bountyVaultAddress(violationProposal));
  await check(112, "outstanding bond or round liabilities block refund and rejection rolls back escrow and vault changes", async () => {
    const before = escrowView(liabilitySnapshot); assert.equal(before.unsettled, 1); assert.equal(before.unclosed, 1);
    await expectFailure("112 outstanding liabilities", () => send(refundEscrow(violationId, 0n), payer), /UnsettledBondLiability|UnclosedRoundLiability/);
    assert.deepEqual(await accountData(violationEscrow), liabilitySnapshot);
    assert.equal(await tokenAmount(connection, bountyVaultAddress(violationProposal)), violationBountyBeforeLiability);
  });
  const closeSignature = await send(closeFinalized(violationId, opening.round), payer);
  const acceptedSignature = await send(settleAccepted(violationId, 0n, setup.hunters[0].publicKey, bonded.commitment, trace, setup.hunterAtas[0]), payer);
  await sendMany([
    mintTokensInstruction(setup.mint.publicKey, bountyVaultAddress(violationProposal), 17n),
    mintTokensInstruction(setup.mint.publicKey, feeVaultAddress(violationProposal), 19n),
    mintTokensInstruction(setup.mint.publicKey, penaltyVaultAddress(violationProposal), 23n)
  ], payer);
  const paidVaults = [bountyVaultAddress(violationProposal), feeVaultAddress(violationProposal), penaltyVaultAddress(violationProposal)];
  const paidBalances = await Promise.all(paidVaults.map(v => tokenAmount(connection, v))); const expectedPaidRefund = paidBalances.reduce((sum, value) => sum + value, 0n);
  const paidTokenBefore = await tokenAmount(connection, setup.proposerAta);
  const paidRefundSignature = await send(refundEscrow(violationId, 0n, outsider.publicKey), outsider);
  await check(113, "PaidToHunter remains unchanged while residual bounty, fee, and penalty balances refund only to the funder", async () => { const view = escrowView(await accountData(violationEscrow, 370)); assert.equal(view.bountyStatus, 1); assert.equal(view.bountyPaid, params.bounty); assert.equal(view.refundsPaid, expectedPaidRefund); assert.equal(await tokenAmount(connection, setup.proposerAta), paidTokenBefore + expectedPaidRefund); for (const vault of paidVaults) assert.equal(await connection.getAccountInfo(vault, COMMITMENT), null); });
  console.log(`SIGNATURE violation-round=${roundSignature} violation-finalize=${finalizeSignature} violation-close=${closeSignature} accepted=${acceptedSignature} paid-residual-refund=${paidRefundSignature}`);
  console.log(`BALANCES paid_residual_vaults=${paidBalances.join(",")} paid_residual_refund=${expectedPaidRefund}`);
}

async function runRevealedUnopened(): Promise<void> {
  const params: PolicyParameters = { bounty: 700n, bond: 100n, fee: 5n, minimumStake: 20n, slash: 20n, maxChallenges: 3, feeGrace: 1n, slashGrace: 1n, cooldown: 1n };
  const setup = await setupPhaseB("m6-phase-c-unopened", 1, 1, params, 3, 25n, true);
  const afterEndId = 1n; const terminalId = 2n; const openedId = 3n;
  await prepareFundedProposal(setup, afterEndId, 0, 16n, true);
  await prepareFundedProposal(setup, terminalId, 1, 32n, true);
  await prepareFundedProposal(setup, openedId, 2, 32n, true);
  const traceA = sha256(Buffer.from("m6-phase-c-unopened-after-end")); const saltA = sha256(Buffer.from("m6-phase-c-unopened-after-end-salt"));
  const traceB = sha256(Buffer.from("m6-phase-c-unopened-terminal")); const saltB = sha256(Buffer.from("m6-phase-c-unopened-terminal-salt"));
  const traceC = sha256(Buffer.from("m6-phase-c-unopened-round")); const saltC = sha256(Buffer.from("m6-phase-c-unopened-round-salt"));
  const a = bondedCommit(afterEndId, 0n, setup.hunters[0].publicKey, setup.hunterAtas[0], traceA, saltA);
  const b = bondedCommit(terminalId, 0n, setup.hunters[1].publicKey, setup.hunterAtas[1], traceB, saltB);
  const c = bondedCommit(openedId, 0n, setup.hunters[2].publicKey, setup.hunterAtas[2], traceC, saltC);
  await send(a.ix, setup.hunters[0]); await send(b.ix, setup.hunters[1]); await send(c.ix, setup.hunters[2]);
  const revealSlot = [a, b, c].map(value => value.commit).map(async address => commitView(await accountData(address)).earliest);
  await advanceTo((await Promise.all(revealSlot)).reduce((left, right) => left > right ? left : right), "phase-c-unopened-reveal");
  await send(reveal(afterEndId, setup.hunters[0].publicKey, a.commitment, traceA, saltA), setup.hunters[0]);
  await send(reveal(terminalId, setup.hunters[1].publicKey, b.commitment, traceB, saltB), setup.hunters[1]);
  await send(reveal(openedId, setup.hunters[2].publicKey, c.commitment, traceC, saltC), setup.hunters[2]);
  const opened = openEconomicRound(openedId, 0n, 0n, setup.hunters[2].publicKey, c.commitment, traceC, setup.canonical.map(v => stakeAddress(setup.ep, v)));
  const openedSignature = await send(opened.ix, payer);

  await fails(114, "early revealed-unopened settlement is rejected", /RevealedUnopenedNotEligible/, () => send(settleRevealedUnopened(afterEndId, 0n, setup.hunters[0].publicKey, a.commitment, traceA, setup.hunterAtas[0]), payer));
  await fails(115, "settlement is rejected when the canonical VerificationRound or RoundEconomicState exists", /RoundAlreadyExists/, () => send(settleRevealedUnopened(openedId, 0n, setup.hunters[2].publicKey, c.commitment, traceC, setup.hunterAtas[2]), payer));
  const afterEndProposal = proposalAddress(afterEndId); const afterEndEscrow = proposalEscrowAddress(afterEndProposal); const afterEnd = proposalView(await accountData(afterEndProposal)).end!;
  await advancePast(afterEnd, "phase-c-unopened-after-end");
  const wrongDestinationSnapshot = Buffer.from(await accountData(afterEndEscrow));
  let destinationSubstitutionProved = false;
  await expectFailure("118 wrong hunter ATA", () => send(settleRevealedUnopened(afterEndId, 0n, setup.hunters[0].publicKey, a.commitment, traceA, setup.hunterAtas[1]), payer), /NonCanonicalTokenAccount/);
  assert.deepEqual(await accountData(afterEndEscrow), wrongDestinationSnapshot); assert.equal(bondView(await accountData(bondAddress(a.commit))).status, 0); destinationSubstitutionProved = true;
  const aTokenBefore = await tokenAmount(connection, setup.hunterAtas[0]); const aRentBefore = await connection.getBalance(setup.hunters[0].publicKey, COMMITMENT); const aVaultInfo = await connection.getAccountInfo(bondVaultAddress(a.commit), COMMITMENT); assert(aVaultInfo);
  const aSettlement = await send(settleRevealedUnopened(afterEndId, 0n, setup.hunters[0].publicKey, a.commitment, traceA, setup.hunterAtas[0]), payer);
  await check(116, "a revealed unopened challenge receives a full refund after challenge end", async () => { const bond = bondView(await accountData(bondAddress(a.commit), 211)); assert.equal(bond.status, 6); assert.equal(bond.refunded, params.bond); assert.equal(bond.forfeited, 0n); assert.equal(await tokenAmount(connection, setup.hunterAtas[0]), aTokenBefore + params.bond); assert.equal(await connection.getBalance(setup.hunters[0].publicKey, COMMITMENT), aRentBefore + aVaultInfo.lamports); });

  const terminalProposal = proposalAddress(terminalId); const terminalEnd = proposalView(await accountData(terminalProposal)).end!; assert(BigInt(await connection.getSlot(COMMITMENT)) <= terminalEnd);
  const rejectionSignature = await send(recordRejected(terminalId), governance);
  const bTokenBefore = await tokenAmount(connection, setup.hunterAtas[1]); const bSettlement = await send(settleRevealedUnopened(terminalId, 0n, setup.hunters[1].publicKey, b.commitment, traceB, setup.hunterAtas[1]), payer);
  await check(117, "a revealed unopened challenge receives a full refund after unrelated terminal rejection", async () => { assert.equal(proposalView(await accountData(terminalProposal)).state, 3); assert(BigInt(await connection.getSlot(COMMITMENT)) <= terminalEnd); const bond = bondView(await accountData(bondAddress(b.commit))); assert.equal(bond.status, 6); assert.equal(bond.refunded, params.bond); assert.equal(await tokenAmount(connection, setup.hunterAtas[1]), bTokenBefore + params.bond); });
  await check(118, "hunter destination substitution is rejected", () => assert(destinationSubstitutionProved));
  await fails(119, "duplicate revealed-unopened settlement is rejected", /BondNotPending|AccountNotInitialized|not initialized/, () => send(settleRevealedUnopened(afterEndId, 0n, setup.hunters[0].publicKey, a.commitment, traceA, setup.hunterAtas[0]), payer));
  await check(120, "unsettled_bonds decrements exactly once without changing unrelated counters or vaults", async () => {
    for (const [id, bonded, trace] of [[afterEndId, a, traceA], [terminalId, b, traceB]] as const) {
      const escrow = escrowView(await accountData(proposalEscrowAddress(proposalAddress(id)))); assert.equal(escrow.committed, 1); assert.equal(escrow.unsettled, 0); assert.equal(escrow.unclosed, 0);
      assert((await connection.getAccountInfo(bonded.commit, COMMITMENT))?.owner.equals(gate)); assert((await connection.getAccountInfo(traceAddress(proposalAddress(id), trace), COMMITMENT))?.owner.equals(gate)); assert.equal(await connection.getAccountInfo(bondVaultAddress(bonded.commit), COMMITMENT), null);
      assert.equal(await tokenAmount(connection, bountyVaultAddress(proposalAddress(id))), params.bounty); assert.equal(await tokenAmount(connection, feeVaultAddress(proposalAddress(id))), params.fee * 8n * BigInt(params.maxChallenges)); assert.equal(await tokenAmount(connection, penaltyVaultAddress(proposalAddress(id))), 0n);
    }
    await expectFailure("120 terminal bond blocks future round", () => send(openEconomicRound(afterEndId, 0n, 0n, setup.hunters[0].publicKey, a.commitment, traceA, setup.canonical.map(v => stakeAddress(setup.ep, v))).ix, payer), /BondNotPending/);
    assert.equal(await connection.getAccountInfo(roundAddress(traceAddress(afterEndProposal, traceA)), COMMITMENT), null); assert.equal(await connection.getAccountInfo(roundEconomicsAddress(roundAddress(traceAddress(afterEndProposal, traceA))), COMMITMENT), null);
  });
  console.log(`SIGNATURE unopened-round=${openedSignature} after-end=${aSettlement} terminal-rejection=${rejectionSignature} terminal-refund=${bSettlement}`);
}

async function main(): Promise<void> {
  const index = process.argv.indexOf("--shard"); const shard = process.argv[index + 1] as Shard | undefined;
  if (!shard || !["policy-funding", "stakes-withdrawal", "bonds-hold", "violation-fees", "bond-outcomes", "objective-slashing", "pending-refund", "paid-refund", "revealed-unopened"].includes(shard)) throw new Error("expected a supported economic-settlement shard");
  if (process.env.FAULTLINE_ECONOMIC_SHARD !== shard) throw new Error("runner shard environment does not match requested shard");
  if (!process.env.FAULTLINE_ECONOMIC_GENESIS || await connection.getGenesisHash() !== process.env.FAULTLINE_ECONOMIC_GENESIS) throw new Error("refusing validator not owned by the Milestone 6 runner");
  try {
    if (shard === "policy-funding") await runPolicyFunding();
    else if (shard === "stakes-withdrawal") await runStakesWithdrawal();
    else if (shard === "bonds-hold") await runBondsHold();
    else if (shard === "violation-fees") await runViolationFees();
    else if (shard === "bond-outcomes") await runBondOutcomes();
    else if (shard === "objective-slashing") await runObjectiveSlashing();
    else if (shard === "pending-refund") await runPendingRefund();
    else if (shard === "paid-refund") await runPaidRefund();
    else await runRevealedUnopened();
    const phase = shard === "policy-funding" || shard === "stakes-withdrawal" ? "A" : shard === "pending-refund" || shard === "paid-refund" || shard === "revealed-unopened" ? "C" : "B";
    console.log(`MILESTONE-6 PHASE-${phase} SHARD ${shard} PASSED`);
  } catch (error) {
    console.error(`FIRST REAL FAILURE shard=${shard} assertion=${activeAssertion || "setup"}`);
    throw error;
  } finally {
    appendFileSync(`${ROOT}/.localnet/economic-settlement-${shard}-evidence.log`, `${evidence.join("\n")}\n`);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
