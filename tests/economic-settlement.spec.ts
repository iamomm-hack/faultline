/* Milestone 6 dedicated fresh-ledger validation, Phase A assertions 1-60. */
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

type Shard = "policy-funding" | "stakes-withdrawal";
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
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: COMMITMENT });
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

async function createAta(payerKey: Keypair, owner: PublicKey, mint: PublicKey): Promise<PublicKey> {
  const ata = ataAddress(owner, mint);
  const ix = new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payerKey.publicKey, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
    ], data: Buffer.alloc(0)
  });
  await send(ix, payerKey);
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
async function mintTokens(mint: PublicKey, destination: PublicKey, amount: bigint): Promise<string> {
  const data = Buffer.alloc(9); data[0] = 7; data.writeBigUInt64LE(amount, 1);
  return send(new TransactionInstruction({ programId: TOKEN_PROGRAM_ID, keys: [
    { pubkey: mint, isSigner: false, isWritable: true }, { pubkey: destination, isSigner: false, isWritable: true },
    { pubkey: payer.publicKey, isSigner: true, isWritable: false }
  ], data }), payer);
}
async function createUninitializedMint(mint: Keypair): Promise<void> {
  const lamports = await connection.getMinimumBalanceForRentExemption(MINT_SIZE, COMMITMENT);
  await send(SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey, lamports, space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }), payer, [mint]);
}
function tokenView(raw: Buffer) { return { mint: new PublicKey(raw.subarray(0, 32)), owner: new PublicKey(raw.subarray(32, 64)), amount: raw.readBigUInt64LE(TOKEN_ACCOUNT_AMOUNT_OFFSET), state: raw[108] }; }

async function createLoaderBuffer(seed: string): Promise<{ key: PublicKey; hash: Buffer }> {
  const keypair = Keypair.fromSeed(sha256(Buffer.from(seed)));
  const bytes = sha256(Buffer.from(`candidate:${seed}`));
  const space = 37 + bytes.length;
  const lamports = await connection.getMinimumBalanceForRentExemption(space, COMMITMENT);
  const init = Buffer.alloc(4); init.writeUInt32LE(0);
  const write = Buffer.alloc(16 + bytes.length); write.writeUInt32LE(1, 0); write.writeUInt32LE(0, 4); write.writeBigUInt64LE(BigInt(bytes.length), 8); bytes.copy(write, 16);
  await sendMany([
    SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: keypair.publicKey, lamports, space, programId: LOADER_V3 }),
    new TransactionInstruction({ programId: LOADER_V3, keys: [{ pubkey: keypair.publicKey, isSigner: false, isWritable: true }, { pubkey: proposer.publicKey, isSigner: false, isWritable: false }], data: init }),
    new TransactionInstruction({ programId: LOADER_V3, keys: [{ pubkey: keypair.publicKey, isSigner: false, isWritable: true }, { pubkey: proposer.publicKey, isSigner: true, isWritable: false }], data: write })
  ], payer, [keypair, proposer]);
  await send(setLoaderAuthorityInstruction(keypair.publicKey, proposer.publicKey, guard), payer, [proposer]);
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
function slashNonReveal(id: bigint, configId: bigint, epochId: bigint, round: PublicKey, verifier: PublicKey) { const proposal = proposalAddress(id); const ep = economicPolicyAddress(configId); return anchorInstruction(gate, "slash_verifier_non_reveal", [
  { pubkey: payer.publicKey, isSigner: true, isWritable: true },
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

async function main(): Promise<void> {
  const index = process.argv.indexOf("--shard"); const shard = process.argv[index + 1] as Shard | undefined;
  if (shard !== "policy-funding" && shard !== "stakes-withdrawal") throw new Error("expected --shard policy-funding|stakes-withdrawal");
  if (process.env.FAULTLINE_ECONOMIC_SHARD !== shard) throw new Error("runner shard environment does not match requested shard");
  if (!process.env.FAULTLINE_ECONOMIC_GENESIS || await connection.getGenesisHash() !== process.env.FAULTLINE_ECONOMIC_GENESIS) throw new Error("refusing validator not owned by the Milestone 6 runner");
  try {
    if (shard === "policy-funding") await runPolicyFunding(); else await runStakesWithdrawal();
    console.log(`MILESTONE-6 PHASE-A SHARD ${shard} PASSED`);
  } catch (error) {
    console.error(`FIRST REAL FAILURE shard=${shard} assertion=${activeAssertion || "setup"}`);
    throw error;
  } finally {
    appendFileSync(`${ROOT}/.localnet/economic-settlement-${shard}-evidence.log`, `${evidence.join("\n")}\n`);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
