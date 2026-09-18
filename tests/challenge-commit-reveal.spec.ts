/* Standalone Milestone-4 localnet integration proof. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction
} from "@solana/web3.js";
import {
  COMMITMENT,
  LOADER_V3,
  ROOT,
  SYSVAR_CLOCK,
  SYSVAR_RENT,
  anchorInstruction,
  expectFailure,
  loadIds,
  loadKeypair,
  loaderWriteInstruction,
  programDataAddress,
  setLoaderAuthorityInstruction
} from "../scripts/lib/solana.js";
import { transferUpgradeAuthority } from "../scripts/transfer-upgrade-authority.js";

const RPC = "http://127.0.0.1:8899";
const DOMAIN = Buffer.from("FAULTLINE_CHALLENGE_V1", "ascii");
const EXPECTED_VECTOR = "2dcc933f3307286860900dcdf1225659b4fcfcc4dcad16d659c907f20c4174f0";
const ids = loadIds();
const payer = loadKeypair("payer");
const governance = loadKeypair("governance");
const proposer = loadKeypair("proposer");
const hunter = loadKeypair("random");
const otherHunter = loadKeypair("attacker");
const gate = new PublicKey(ids["faultline-gate-program"]);
const treasury = new PublicKey(ids["faultline-treasury-program"]);
const programData = programDataAddress(treasury);
const gateProgramData = programDataAddress(gate);
const connection = new Connection(RPC, COMMITMENT);
const [guard] = PublicKey.findProgramAddressSync(
  [Buffer.from("faultline"), Buffer.from("guard"), treasury.toBuffer()],
  gate
);
const [policy] = PublicKey.findProgramAddressSync(
  [Buffer.from("safety-policy"), treasury.toBuffer()],
  gate
);
const economicRegistryAddress = (safetyPolicy: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("economic-policy-registry"), safetyPolicy.toBuffer()],
    gate
  )[0];
const economicRegistry = economicRegistryAddress(policy);
const [secondaryGuard] = PublicKey.findProgramAddressSync(
  [Buffer.from("faultline"), Buffer.from("guard"), gate.toBuffer()],
  gate
);
const [secondaryPolicy] = PublicKey.findProgramAddressSync(
  [Buffer.from("safety-policy"), gate.toBuffer()],
  gate
);
const [version] = PublicKey.findProgramAddressSync([Buffer.from("version")], treasury);
const evidence: string[] = [];
const originalLog = console.log.bind(console);
console.log = (...values: unknown[]) => {
  const line = values.map(String).join(" ");
  evidence.push(line);
  originalLog(line);
};

const u64 = (value: bigint): Buffer => {
  const encoded = Buffer.alloc(8);
  encoded.writeBigUInt64LE(value);
  return encoded;
};
const sha256 = (...parts: Uint8Array[]): Buffer =>
  createHash("sha256").update(Buffer.concat(parts.map(part => Buffer.from(part)))).digest();

export function challengeCommitment(
  proposal: PublicKey,
  invariant: PublicKey,
  submitter: PublicKey,
  traceHash: Buffer,
  salt: Buffer
): Buffer {
  assert.equal(traceHash.length, 32);
  assert.equal(salt.length, 32);
  return sha256(DOMAIN, proposal.toBuffer(), invariant.toBuffer(), submitter.toBuffer(), traceHash, salt);
}

async function sendInstructions(
  instructions: TransactionInstruction[],
  feePayer: Keypair,
  signers: Keypair[] = []
): Promise<string> {
  const latest = await connection.getLatestBlockhash(COMMITMENT);
  const transaction = new Transaction({
    feePayer: feePayer.publicKey,
    recentBlockhash: latest.blockhash
  }).add(...instructions);
  transaction.sign(feePayer, ...signers);
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    preflightCommitment: COMMITMENT
  });
  const deadline = Date.now() + 90_000;
  let observed: Awaited<ReturnType<Connection["getSignatureStatuses"]>>["value"][number] = null;
  while (Date.now() < deadline) {
    observed = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    if (observed?.err) throw new Error(`transaction ${signature} failed: ${JSON.stringify(observed.err)}`);
    const status = observed?.confirmationStatus;
    if (status === "confirmed" || status === "finalized") return signature;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(
    `confirmation timeout signature=${signature} status=${JSON.stringify(observed)} slot=${await connection.getSlot(COMMITMENT)}`
  );
}

async function send(ix: TransactionInstruction, feePayer: Keypair, signers: Keypair[] = []): Promise<string> {
  return sendInstructions([ix], feePayer, signers);
}

async function initializeLoaderBuffer(buffer: Keypair, capacity: number): Promise<void> {
  const space = 37 + capacity;
  const lamports = await connection.getMinimumBalanceForRentExemption(space, COMMITMENT);
  const initializeData = Buffer.alloc(4);
  initializeData.writeUInt32LE(0, 0); // UpgradeableLoaderInstruction::InitializeBuffer
  const initialize = new TransactionInstruction({
    programId: LOADER_V3,
    keys: [
      { pubkey: buffer.publicKey, isSigner: false, isWritable: true },
      { pubkey: proposer.publicKey, isSigner: false, isWritable: false }
    ],
    data: initializeData
  });
  await sendInstructions(
    [
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: buffer.publicKey,
        lamports,
        space,
        programId: LOADER_V3
      }),
      initialize
    ],
    payer,
    [buffer]
  );
}

async function writeLoaderBuffer(buffer: PublicKey, bytes: Buffer): Promise<number> {
  const chunkSize = 800;
  let transactionCount = 0;
  for (let batchStart = 0; batchStart < bytes.length; batchStart += chunkSize * 32) {
    const latest = await connection.getLatestBlockhash(COMMITMENT);
    const transactions: Transaction[] = [];
    for (let offset = batchStart; offset < Math.min(bytes.length, batchStart + chunkSize * 32); offset += chunkSize) {
      const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize));
      const instruction = loaderWriteInstruction(buffer, proposer.publicKey, chunk);
      instruction.data.writeUInt32LE(offset, 4);
      const transaction = new Transaction({ feePayer: payer.publicKey, recentBlockhash: latest.blockhash }).add(instruction);
      transaction.sign(payer, proposer);
      transactions.push(transaction);
    }
    const signatures: string[] = [];
    for (const [index, transaction] of transactions.entries()) {
      try {
        signatures.push(await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: true }));
      } catch (error) {
        throw new Error(`loader write was not accepted at byte ${batchStart + index * chunkSize}: ${String(error)}`);
      }
    }
    transactionCount += signatures.length;
    const deadline = Date.now() + 90_000;
    const complete = new Set<string>();
    while (Date.now() < deadline && complete.size < signatures.length) {
      const statuses = (await connection.getSignatureStatuses(signatures, { searchTransactionHistory: true })).value;
      for (const [index, status] of statuses.entries()) {
        if (status?.err) {
          const landed = await connection.getTransaction(signatures[index], {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0
          });
          throw new Error(
            `loader write ${signatures[index]} failed: ${JSON.stringify(status.err)} logs=${JSON.stringify(landed?.meta?.logMessages ?? [])}`
          );
        }
        if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
          complete.add(signatures[index]);
        }
      }
      if (complete.size < signatures.length) await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (complete.size !== signatures.length) {
      const pending = signatures.filter(signature => !complete.has(signature));
      throw new Error(`loader write confirmation timeout: ${complete.size}/${signatures.length}; pending=${pending.join(",")}`);
    }
  }
  return transactionCount;
}

async function createLoaderBuffer(buffer: Keypair, bytes: Buffer): Promise<number> {
  await initializeLoaderBuffer(buffer, bytes.length);
  return writeLoaderBuffer(buffer.publicKey, bytes);
}

async function fails(label: string, expected: RegExp, operation: () => Promise<unknown>): Promise<void> {
  await expectFailure(label, operation, expected);
  console.log(`PASS ${label}: expected=${expected.source}`);
}

function proposalAddress(id: bigint, policyAddress = policy): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("upgrade-proposal"), policyAddress.toBuffer(), u64(id)],
    gate
  )[0];
}
function verificationGateAddress(proposal: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("proposal-verification-gate"), proposal.toBuffer()],
    gate
  )[0];
}
function bufferClaimAddress(buffer: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("faultline"), Buffer.from("buffer"), buffer.toBuffer()],
    gate
  )[0];
}
function invariantAddress(id: bigint, policyAddress = policy): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("invariant"), policyAddress.toBuffer(), u64(id)],
    gate
  )[0];
}
function commitAddress(
  proposal: PublicKey,
  submitter: PublicKey,
  commitmentHash: Buffer
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("challenge-commit"), proposal.toBuffer(), submitter.toBuffer(), commitmentHash],
    gate
  )[0];
}
function traceClaimAddress(proposal: PublicKey, traceHash: Buffer): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("trace-claim"), proposal.toBuffer(), traceHash],
    gate
  )[0];
}

function initializePolicy(
  target: PublicKey,
  guardAddress: PublicKey,
  policyAddress: PublicKey,
  policyId: bigint
): TransactionInstruction {
  return anchorInstruction(
    gate,
    "initialize_safety_policy",
    [
      { pubkey: governance.publicKey, isSigner: true, isWritable: true },
      { pubkey: guardAddress, isSigner: false, isWritable: false },
      { pubkey: target, isSigner: false, isWritable: false },
      { pubkey: policyAddress, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
    ],
    Buffer.concat([
      u64(policyId),
      Buffer.from([1, 0]),
      u64(4n),
      Buffer.from([1]),
      sha256(Buffer.from("AUTH-001")),
      governance.publicKey.toBuffer()
    ])
  );
}

function setPolicyStatus(paused: boolean): TransactionInstruction {
  return anchorInstruction(
    gate,
    "set_safety_policy_status",
    [
      { pubkey: governance.publicKey, isSigner: true, isWritable: false },
      { pubkey: policy, isSigner: false, isWritable: true }
    ],
    Buffer.from([paused ? 1 : 0])
  );
}

function initializeInvariant(
  id: bigint,
  actor: PublicKey,
  nameHash: Buffer,
  specificationHash: Buffer,
  policyAddress = policy
): TransactionInstruction {
  return anchorInstruction(
    gate,
    "initialize_invariant",
    [
      { pubkey: actor, isSigner: true, isWritable: true },
      { pubkey: policyAddress, isSigner: false, isWritable: false },
      { pubkey: invariantAddress(id, policyAddress), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
    ],
    Buffer.concat([u64(id), Buffer.from([0]), nameHash, specificationHash])
  );
}

function setInvariantEnabled(id: bigint, actor: PublicKey, enabled: boolean): TransactionInstruction {
  return anchorInstruction(
    gate,
    "set_invariant_enabled",
    [
      { pubkey: actor, isSigner: true, isWritable: false },
      { pubkey: policy, isSigner: false, isWritable: false },
      { pubkey: invariantAddress(id), isSigner: false, isWritable: true }
    ],
    Buffer.from([enabled ? 1 : 0])
  );
}

function createProposal(id: bigint, buffer: PublicKey, bufferHash: Buffer): TransactionInstruction {
  return anchorInstruction(
    gate,
    "create_upgrade_proposal",
    [
      { pubkey: proposer.publicKey, isSigner: true, isWritable: true },
      { pubkey: guard, isSigner: false, isWritable: true },
      { pubkey: policy, isSigner: false, isWritable: false },
      { pubkey: treasury, isSigner: false, isWritable: false },
      { pubkey: programData, isSigner: false, isWritable: false },
      { pubkey: buffer, isSigner: false, isWritable: false },
      { pubkey: proposalAddress(id), isSigner: false, isWritable: true },
      { pubkey: verificationGateAddress(proposalAddress(id)), isSigner: false, isWritable: true },
      { pubkey: bufferClaimAddress(buffer), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
    ],
    Buffer.concat([u64(id), bufferHash])
  );
}

function startChallenge(id: bigint, duration: bigint): TransactionInstruction {
  return anchorInstruction(
    gate,
    "start_challenge",
    [
      { pubkey: proposer.publicKey, isSigner: true, isWritable: false },
      { pubkey: policy, isSigner: false, isWritable: false },
      { pubkey: economicRegistry, isSigner: false, isWritable: false },
      { pubkey: proposalAddress(id), isSigner: false, isWritable: true },
      { pubkey: verificationGateAddress(proposalAddress(id)), isSigner: false, isWritable: false }
    ],
    u64(duration)
  );
}

function temporaryDecision(id: bigint, state: 2 | 3): TransactionInstruction {
  return anchorInstruction(
    gate,
    "record_temporary_decision",
    [
      { pubkey: governance.publicKey, isSigner: true, isWritable: false },
      { pubkey: policy, isSigner: false, isWritable: false },
      { pubkey: proposalAddress(id), isSigner: false, isWritable: true },
      { pubkey: verificationGateAddress(proposalAddress(id)), isSigner: false, isWritable: false }
    ],
    Buffer.from([state, 0, 0])
  );
}

function expireProposal(id: bigint): TransactionInstruction {
  return anchorInstruction(gate, "expire_proposal", [
    { pubkey: payer.publicKey, isSigner: true, isWritable: false },
    { pubkey: policy, isSigner: false, isWritable: false },
    { pubkey: proposalAddress(id), isSigner: false, isWritable: true }
  ]);
}

function executeProposal(id: bigint, buffer: PublicKey): TransactionInstruction {
  return anchorInstruction(gate, "execute_guarded_upgrade", [
    { pubkey: payer.publicKey, isSigner: true, isWritable: false },
    { pubkey: guard, isSigner: false, isWritable: false },
    { pubkey: policy, isSigner: false, isWritable: false },
    { pubkey: proposalAddress(id), isSigner: false, isWritable: true },
    { pubkey: verificationGateAddress(proposalAddress(id)), isSigner: false, isWritable: false },
    { pubkey: bufferClaimAddress(buffer), isSigner: false, isWritable: false },
    { pubkey: treasury, isSigner: false, isWritable: true },
    { pubkey: programData, isSigner: false, isWritable: true },
    { pubkey: buffer, isSigner: false, isWritable: true },
    { pubkey: governance.publicKey, isSigner: false, isWritable: true },
    { pubkey: SYSVAR_RENT, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_CLOCK, isSigner: false, isWritable: false },
    { pubkey: LOADER_V3, isSigner: false, isWritable: false }
  ]);
}

type CommitOverrides = Partial<{
  policy: PublicKey;
  proposal: PublicKey;
  invariant: PublicKey;
  hunter: PublicKey;
}>;
function commitChallenge(
  proposal: PublicKey,
  invariant: PublicKey,
  submitter: PublicKey,
  commitmentHash: Buffer,
  overrides: CommitOverrides = {}
): TransactionInstruction {
  const actualProposal = overrides.proposal ?? proposal;
  const actualHunter = overrides.hunter ?? submitter;
  const actualPolicy = overrides.policy ?? policy;
  return anchorInstruction(
    gate,
    "commit_challenge",
    [
      { pubkey: actualHunter, isSigner: true, isWritable: true },
      { pubkey: actualPolicy, isSigner: false, isWritable: false },
      { pubkey: economicRegistryAddress(actualPolicy), isSigner: false, isWritable: false },
      { pubkey: actualProposal, isSigner: false, isWritable: false },
      { pubkey: overrides.invariant ?? invariant, isSigner: false, isWritable: false },
      {
        pubkey: commitAddress(actualProposal, actualHunter, commitmentHash),
        isSigner: false,
        isWritable: true
      },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
    ],
    commitmentHash
  );
}

type RevealOverrides = Partial<{
  policy: PublicKey;
  proposal: PublicKey;
  invariant: PublicKey;
  hunter: PublicKey;
}>;
function revealChallenge(
  committedProposal: PublicKey,
  committedInvariant: PublicKey,
  committedHunter: PublicKey,
  commitmentHash: Buffer,
  traceHash: Buffer,
  salt: Buffer,
  overrides: RevealOverrides = {}
): TransactionInstruction {
  const suppliedProposal = overrides.proposal ?? committedProposal;
  const suppliedHunter = overrides.hunter ?? committedHunter;
  return anchorInstruction(
    gate,
    "reveal_challenge",
    [
      { pubkey: suppliedHunter, isSigner: true, isWritable: true },
      { pubkey: overrides.policy ?? policy, isSigner: false, isWritable: false },
      { pubkey: suppliedProposal, isSigner: false, isWritable: false },
      { pubkey: overrides.invariant ?? committedInvariant, isSigner: false, isWritable: false },
      {
        pubkey: commitAddress(committedProposal, committedHunter, commitmentHash),
        isSigner: false,
        isWritable: true
      },
      { pubkey: traceClaimAddress(suppliedProposal, traceHash), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
    ],
    Buffer.concat([traceHash, salt])
  );
}

function decodeInvariant(raw: Buffer) {
  return {
    policy: new PublicKey(raw.subarray(8, 40)),
    id: raw.readBigUInt64LE(40),
    kind: raw[48],
    nameHash: Buffer.from(raw.subarray(49, 81)),
    specificationHash: Buffer.from(raw.subarray(81, 113)),
    enabled: raw[113] === 1,
    createdBy: new PublicKey(raw.subarray(114, 146)),
    createdAt: raw.readBigUInt64LE(146),
    disabledAt: raw[154] === 1 ? raw.readBigUInt64LE(155) : null,
    bump: raw[163]
  };
}
function decodeCommit(raw: Buffer) {
  return {
    proposal: new PublicKey(raw.subarray(8, 40)),
    invariant: new PublicKey(raw.subarray(40, 72)),
    hunter: new PublicKey(raw.subarray(72, 104)),
    commitmentHash: Buffer.from(raw.subarray(104, 136)),
    committedAt: raw.readBigUInt64LE(136),
    earliest: raw.readBigUInt64LE(144),
    latest: raw.readBigUInt64LE(152),
    status: raw[160],
    traceHash: raw[161] === 1 ? Buffer.from(raw.subarray(162, 194)) : null,
    revealedAt: raw[194] === 1 ? raw.readBigUInt64LE(195) : null,
    bump: raw[203]
  };
}
function decodeTraceClaim(raw: Buffer) {
  return {
    proposal: new PublicKey(raw.subarray(8, 40)),
    invariant: new PublicKey(raw.subarray(40, 72)),
    challengeCommit: new PublicKey(raw.subarray(72, 104)),
    traceHash: Buffer.from(raw.subarray(104, 136)),
    hunter: new PublicKey(raw.subarray(136, 168)),
    revealedAt: raw.readBigUInt64LE(168),
    bump: raw[176]
  };
}
function proposalSnapshot(raw: Buffer) {
  return {
    candidate: new PublicKey(raw.subarray(112, 144)),
    candidateHash: Buffer.from(raw.subarray(144, 176)),
    state: raw[234],
    decisionAuthorityOption: raw[235],
    executedAtOption: raw[280]
  };
}
async function proposalEnd(id: bigint): Promise<bigint> {
  const info = await connection.getAccountInfo(proposalAddress(id), COMMITMENT);
  assert(info);
  return info.data.readBigUInt64LE(226);
}
async function advanceTo(slot: bigint): Promise<void> {
  while (BigInt(await connection.getSlot(COMMITMENT)) < slot) {
    await send(
      SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: otherHunter.publicKey, lamports: 1 }),
      payer
    );
  }
}
async function advancePast(slot: bigint): Promise<void> {
  while (BigInt(await connection.getSlot(COMMITMENT)) <= slot) {
    await send(
      SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: otherHunter.publicKey, lamports: 1 }),
      payer
    );
  }
}

async function main(): Promise<void> {
  if (
    !process.env.FAULTLINE_CHALLENGE_GENESIS ||
    (await connection.getGenesisHash()) !== process.env.FAULTLINE_CHALLENGE_GENESIS
  ) {
    throw new Error("refusing a validator not started by the dedicated Milestone-4 runner");
  }
  try {
    for (const actor of [governance.publicKey, proposer.publicKey, hunter.publicKey, otherHunter.publicKey]) {
      await send(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: actor,
          lamports: 10 * LAMPORTS_PER_SOL
        }),
        payer
      );
    }

    const placeholderBytes = Buffer.from("FAULTLINE_M4_NON_EXECUTABLE_BUFFER_FIXTURE");
    const bufferKeypairs = Array.from({ length: 5 }, (_, index) =>
      Keypair.fromSeed(sha256(Buffer.from(`faultline-m4-buffer-${index}`)))
    );
    for (const keypair of bufferKeypairs.slice(0, 4)) {
      await createLoaderBuffer(keypair, placeholderBytes);
    }
    const executableBytes = readFileSync(`${ROOT}/artifacts/treasury/v2/faultline_treasury.so`);
    const uploadStartSlot = await connection.getSlot(COMMITMENT);
    const uploadStartedAt = Date.now();
    const uploadTransactionCount = await createLoaderBuffer(bufferKeypairs[4], executableBytes);
    const uploadEndSlot = await connection.getSlot(COMMITMENT);
    console.log(
      `Treasury v2 buffer upload: transactions=${uploadTransactionCount} elapsed_ms=${Date.now() - uploadStartedAt} start_slot=${uploadStartSlot} end_slot=${uploadEndSlot}`
    );
    const executableInfo = await connection.getAccountInfo(bufferKeypairs[4].publicKey, COMMITMENT);
    assert(executableInfo);
    assert.deepEqual(executableInfo.data.subarray(37), executableBytes);
    const buffers = bufferKeypairs.map(keypair => keypair.publicKey);

    await send(
      anchorInstruction(
        treasury,
        "initialize_version",
        [
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: version, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
        ]
      ),
      payer
    );
    await send(
      anchorInstruction(gate, "initialize_guard", [
        { pubkey: governance.publicKey, isSigner: true, isWritable: true },
        { pubkey: treasury, isSigner: false, isWritable: false },
        { pubkey: programData, isSigner: false, isWritable: false },
        { pubkey: guard, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
      ]),
      governance
    );
    await send(
      anchorInstruction(gate, "initialize_guard", [
        { pubkey: governance.publicKey, isSigner: true, isWritable: true },
        { pubkey: gate, isSigner: false, isWritable: false },
        { pubkey: gateProgramData, isSigner: false, isWritable: false },
        { pubkey: secondaryGuard, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
      ]),
      governance
    );
    await transferUpgradeAuthority(connection, treasury, payer, guard);
    for (const buffer of buffers) {
      await send(setLoaderAuthorityInstruction(buffer, proposer.publicKey, guard), payer, [proposer]);
    }
    const bufferHashes = await Promise.all(
      buffers.map(async buffer => sha256((await connection.getAccountInfo(buffer, COMMITMENT))!.data))
    );
    await send(initializePolicy(treasury, guard, policy, 4n), governance);
    await send(initializePolicy(gate, secondaryGuard, secondaryPolicy, 404n), governance);

    const nameHash = sha256(Buffer.from("AUTH-001"));
    const specificationHash = sha256(readFileSync(`${ROOT}/policies/invariants/AUTH-001.json`));
    const invariant = invariantAddress(1n);
    const secondaryInvariant = invariantAddress(1n, secondaryPolicy);
    const alternateInvariant = invariantAddress(5n);

    const invariantInitSignature = await send(
      initializeInvariant(1n, governance.publicKey, nameHash, specificationHash),
      governance
    );
    const invariantInfo = await connection.getAccountInfo(invariant, COMMITMENT);
    assert(invariantInfo);
    assert(invariantInfo.owner.equals(gate));
    const initialized = decodeInvariant(invariantInfo.data);
    assert(initialized.policy.equals(policy));
    assert.equal(initialized.id, 1n);
    assert.equal(initialized.kind, 0);
    assert.deepEqual(initialized.nameHash, nameHash);
    assert.deepEqual(initialized.specificationHash, specificationHash);
    assert.equal(initialized.enabled, true);
    assert(initialized.createdBy.equals(governance.publicKey));
    assert.equal(initialized.disabledAt, null);
    console.log(`PASS 1 invariant initialized: ${invariantInitSignature} PDA=${invariant}`);

    await fails("2 duplicate invariant ID", /already in use|AccountAlreadyInitialized/, () =>
      send(initializeInvariant(1n, governance.publicKey, nameHash, specificationHash), governance)
    );
    await fails("3 non-governance invariant initialization", /UnauthorizedGovernance/, () =>
      send(initializeInvariant(2n, hunter.publicKey, nameHash, specificationHash), hunter)
    );
    await fails("4 zero name hash", /ZeroNameHash/, () =>
      send(initializeInvariant(3n, governance.publicKey, Buffer.alloc(32), specificationHash), governance)
    );
    await fails("5 zero specification hash", /ZeroSpecificationHash/, () =>
      send(initializeInvariant(4n, governance.publicKey, nameHash, Buffer.alloc(32)), governance)
    );
    await send(initializeInvariant(5n, governance.publicKey, sha256(Buffer.from("ALT")), sha256(Buffer.from("ALT-SPEC"))), governance);
    await send(initializeInvariant(1n, governance.publicKey, nameHash, specificationHash, secondaryPolicy), governance);

    // Main active proposal remains ChallengeActive throughout provenance assertions.
    await send(createProposal(1n, buffers[0], bufferHashes[0]), proposer);
    for (const safetyPolicy of [policy, secondaryPolicy]) {
      await send(
        anchorInstruction(gate, "initialize_economic_policy_registry", [
          { pubkey: governance.publicKey, isSigner: true, isWritable: true },
          { pubkey: safetyPolicy, isSigner: false, isWritable: false },
          { pubkey: economicRegistryAddress(safetyPolicy), isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
        ]),
        governance
      );
    }
    await send(startChallenge(1n, 60n), proposer);
    const mainProposal = proposalAddress(1n);

    await fails("6 non-governance invariant disable", /UnauthorizedGovernance/, () =>
      send(setInvariantEnabled(1n, hunter.publicKey, false), hunter)
    );
    await send(setInvariantEnabled(1n, governance.publicKey, false), governance);
    let updatedInvariant = decodeInvariant((await connection.getAccountInfo(invariant, COMMITMENT))!.data);
    assert.equal(updatedInvariant.enabled, false);
    assert(updatedInvariant.disabledAt !== null);
    console.log("PASS 7 governance disabled invariant");

    const disabledTrace = sha256(Buffer.from("disabled-trace"));
    const disabledSalt = sha256(Buffer.from("disabled-salt"));
    const disabledCommitment = challengeCommitment(mainProposal, invariant, hunter.publicKey, disabledTrace, disabledSalt);
    await fails("8 disabled invariant rejects commitment", /InvariantDisabled/, () =>
      send(commitChallenge(mainProposal, invariant, hunter.publicKey, disabledCommitment), hunter)
    );
    await send(setInvariantEnabled(1n, governance.publicKey, true), governance);
    updatedInvariant = decodeInvariant((await connection.getAccountInfo(invariant, COMMITMENT))!.data);
    assert.equal(updatedInvariant.enabled, true);
    assert.equal(updatedInvariant.disabledAt, null);
    assert.deepEqual(updatedInvariant.nameHash, nameHash);
    assert.deepEqual(updatedInvariant.specificationHash, specificationHash);
    console.log("PASS 9 governance re-enabled invariant; immutable hashes retained");

    // Draft proposal uses an independent locked buffer.
    await send(createProposal(2n, buffers[1], bufferHashes[1]), proposer);
    const draftProposal = proposalAddress(2n);
    const draftTrace = sha256(Buffer.from("draft-trace"));
    const draftSalt = sha256(Buffer.from("draft-salt"));
    const draftCommitment = challengeCommitment(draftProposal, invariant, hunter.publicKey, draftTrace, draftSalt);
    await fails("10 Draft proposal rejects challenge commitment", /ChallengeNotActive/, () =>
      send(commitChallenge(draftProposal, invariant, hunter.publicKey, draftCommitment), hunter)
    );

    await send(setPolicyStatus(true), governance);
    const pausedTrace = sha256(Buffer.from("paused-trace"));
    const pausedSalt = sha256(Buffer.from("paused-salt"));
    const pausedCommitment = challengeCommitment(mainProposal, invariant, hunter.publicKey, pausedTrace, pausedSalt);
    await fails("11 paused policy rejects challenge commitment", /PolicyPaused/, () =>
      send(commitChallenge(mainProposal, invariant, hunter.publicKey, pausedCommitment), hunter)
    );
    await send(setPolicyStatus(false), governance);

    const traceHash = sha256(Buffer.from("canonical-m4-trace"));
    const salt = sha256(Buffer.from("canonical-m4-salt"));
    const commitmentHash = challengeCommitment(mainProposal, invariant, hunter.publicKey, traceHash, salt);
    const challengeCommit = commitAddress(mainProposal, hunter.publicKey, commitmentHash);
    const commitSignature = await send(
      commitChallenge(mainProposal, invariant, hunter.publicKey, commitmentHash),
      hunter
    );
    console.log(`PASS 12 permissionless hunter commitment: ${commitSignature}`);
    const commitInfo = await connection.getAccountInfo(challengeCommit, COMMITMENT);
    assert(commitInfo);
    assert(commitInfo.owner.equals(gate));
    const committed = decodeCommit(commitInfo.data);
    assert(committed.proposal.equals(mainProposal));
    assert(committed.invariant.equals(invariant));
    assert(committed.hunter.equals(hunter.publicKey));
    assert.deepEqual(committed.commitmentHash, commitmentHash);
    assert.equal(committed.status, 0);
    assert.equal(committed.earliest, committed.committedAt + 1n);
    assert(committed.latest >= committed.earliest);
    assert(committed.latest <= (await proposalEnd(1n)));
    console.log(`PASS 13 commitment fields: PDA=${challengeCommit} earliest=${committed.earliest} latest=${committed.latest}`);
    await fails("14 duplicate commitment", /already in use|AccountAlreadyInitialized/, () =>
      send(commitChallenge(mainProposal, invariant, hunter.publicKey, commitmentHash), hunter)
    );

    const wrongPolicyCommitment = challengeCommitment(mainProposal, secondaryInvariant, hunter.publicKey, traceHash, salt);
    await fails("15 wrong-policy invariant", /ConstraintSeeds/, () =>
      send(commitChallenge(mainProposal, secondaryInvariant, hunter.publicKey, wrongPolicyCommitment), hunter)
    );
    const wrongBindingTrace = sha256(Buffer.from("wrong-proposal-policy-binding"));
    const wrongBindingCommitment = challengeCommitment(
      mainProposal,
      invariant,
      hunter.publicKey,
      wrongBindingTrace,
      salt
    );
    await fails("16 wrong proposal-policy binding", /ConstraintSeeds/, () =>
      send(
        commitChallenge(mainProposal, invariant, hunter.publicKey, wrongBindingCommitment, {
          policy: secondaryPolicy
        }),
        hunter
      )
    );

    // A short independent window proves the exact end-slot boundaries.
    await send(startChallenge(2n, 4n), proposer);
    const closeProposal = draftProposal;
    const closeEnd = await proposalEnd(2n);
    await advanceTo(closeEnd);
    const closeTrace = sha256(Buffer.from("close-trace"));
    const closeSalt = sha256(Buffer.from("close-salt"));
    const closeCommitment = challengeCommitment(closeProposal, invariant, hunter.publicKey, closeTrace, closeSalt);
    await fails("17 commit too close to challenge end", /InsufficientRevealWindow/, () =>
      send(commitChallenge(closeProposal, invariant, hunter.publicKey, closeCommitment), hunter)
    );

    // Commit and reveal in one transaction guarantees the same Clock slot.
    const earlyTrace = sha256(Buffer.from("early-trace"));
    const earlySalt = sha256(Buffer.from("early-salt"));
    const earlyCommitment = challengeCommitment(mainProposal, invariant, otherHunter.publicKey, earlyTrace, earlySalt);
    await fails("18 reveal before earliest slot", /RevealTooEarly/, () =>
      sendInstructions(
        [
          commitChallenge(mainProposal, invariant, otherHunter.publicKey, earlyCommitment),
          revealChallenge(mainProposal, invariant, otherHunter.publicKey, earlyCommitment, earlyTrace, earlySalt)
        ],
        otherHunter
      )
    );
    assert.equal(await connection.getAccountInfo(commitAddress(mainProposal, otherHunter.publicKey, earlyCommitment)), null);

    await advanceTo(committed.earliest);
    await fails("19 reveal by different hunter", /UnauthorizedHunter/, () =>
      send(
        revealChallenge(mainProposal, invariant, hunter.publicKey, commitmentHash, traceHash, salt, {
          hunter: otherHunter.publicKey
        }),
        otherHunter
      )
    );
    await fails("20 wrong salt", /CommitmentMismatch/, () =>
      send(revealChallenge(mainProposal, invariant, hunter.publicKey, commitmentHash, traceHash, Buffer.alloc(32, 7)), hunter)
    );
    await fails("21 wrong trace hash", /CommitmentMismatch/, () =>
      send(revealChallenge(mainProposal, invariant, hunter.publicKey, commitmentHash, Buffer.alloc(32, 8), salt), hunter)
    );
    await fails("22 wrong invariant account", /WrongChallengeInvariant/, () =>
      send(
        revealChallenge(mainProposal, invariant, hunter.publicKey, commitmentHash, traceHash, salt, {
          invariant: alternateInvariant
        }),
        hunter
      )
    );
    await fails("23 wrong proposal account", /ConstraintSeeds/, () =>
      send(
        revealChallenge(mainProposal, invariant, hunter.publicKey, commitmentHash, traceHash, salt, {
          proposal: draftProposal
        }),
        hunter
      )
    );

    const mainBeforeReveal = proposalSnapshot((await connection.getAccountInfo(mainProposal, COMMITMENT))!.data);
    const revealSignature = await send(
      revealChallenge(mainProposal, invariant, hunter.publicKey, commitmentHash, traceHash, salt),
      hunter
    );
    console.log(`PASS 24 valid reveal: ${revealSignature}`);
    const revealed = decodeCommit((await connection.getAccountInfo(challengeCommit, COMMITMENT))!.data);
    assert.equal(revealed.status, 1);
    assert.deepEqual(revealed.traceHash, traceHash);
    assert(revealed.revealedAt !== null);
    console.log(`PASS 25 ChallengeCommit stores trace and reveal slot=${revealed.revealedAt}`);
    const traceClaim = traceClaimAddress(mainProposal, traceHash);
    const claimInfo = await connection.getAccountInfo(traceClaim, COMMITMENT);
    assert(claimInfo);
    assert(claimInfo.owner.equals(gate));
    const claim = decodeTraceClaim(claimInfo.data);
    assert(claim.proposal.equals(mainProposal));
    assert(claim.invariant.equals(invariant));
    assert(claim.challengeCommit.equals(challengeCommit));
    assert.deepEqual(claim.traceHash, traceHash);
    assert(claim.hunter.equals(hunter.publicKey));
    assert.equal(claim.revealedAt, revealed.revealedAt);
    console.log(`PASS 26 TraceClaim first-revealer provenance: PDA=${traceClaim}`);
    await fails("27 second reveal of same commitment", /ChallengeAlreadyRevealed/, () =>
      send(revealChallenge(mainProposal, invariant, hunter.publicKey, commitmentHash, traceHash, salt), hunter)
    );

    const duplicateSalt = sha256(Buffer.from("duplicate-trace-new-salt"));
    const duplicateCommitment = challengeCommitment(mainProposal, invariant, otherHunter.publicKey, traceHash, duplicateSalt);
    await send(commitChallenge(mainProposal, invariant, otherHunter.publicKey, duplicateCommitment), otherHunter);
    const duplicateCommitAccount = commitAddress(mainProposal, otherHunter.publicKey, duplicateCommitment);
    const duplicateCommitState = decodeCommit((await connection.getAccountInfo(duplicateCommitAccount, COMMITMENT))!.data);
    await advanceTo(duplicateCommitState.earliest);
    await fails("28 same trace claimed again for proposal", /TraceAlreadyClaimed/, () =>
      send(revealChallenge(mainProposal, invariant, otherHunter.publicKey, duplicateCommitment, traceHash, duplicateSalt), otherHunter)
    );
    assert.equal(decodeCommit((await connection.getAccountInfo(duplicateCommitAccount, COMMITMENT))!.data).status, 0);

    const lateTrace = sha256(Buffer.from("late-trace"));
    const lateSalt = sha256(Buffer.from("late-salt"));
    const lateCommitment = challengeCommitment(mainProposal, invariant, otherHunter.publicKey, lateTrace, lateSalt);
    await send(commitChallenge(mainProposal, invariant, otherHunter.publicKey, lateCommitment), otherHunter);
    const lateCommitAccount = commitAddress(mainProposal, otherHunter.publicKey, lateCommitment);
    const lateState = decodeCommit((await connection.getAccountInfo(lateCommitAccount, COMMITMENT))!.data);
    await advancePast(lateState.latest);
    await fails("29 reveal after latest slot", /RevealWindowEnded/, () =>
      send(revealChallenge(mainProposal, invariant, otherHunter.publicKey, lateCommitment, lateTrace, lateSalt), otherHunter)
    );

    await advancePast(closeEnd);
    await fails("30 commit after proposal challenge window", /ChallengeWindowEnded/, () =>
      send(commitChallenge(closeProposal, invariant, hunter.publicKey, closeCommitment), hunter)
    );

    await send(createProposal(3n, buffers[2], bufferHashes[2]), proposer);
    await send(startChallenge(3n, 20n), proposer);
    await send(temporaryDecision(3n, 3), governance);
    const rejectedProposal = proposalAddress(3n);
    const terminalTrace = sha256(Buffer.from("terminal-trace"));
    const terminalSalt = sha256(Buffer.from("terminal-salt"));
    await fails("31 Rejected proposal rejects commitment", /ChallengeNotActive/, () =>
      send(
        commitChallenge(
          rejectedProposal,
          invariant,
          hunter.publicKey,
          challengeCommitment(rejectedProposal, invariant, hunter.publicKey, terminalTrace, terminalSalt)
        ),
        hunter
      )
    );

    await send(createProposal(4n, buffers[3], bufferHashes[3]), proposer);
    await send(startChallenge(4n, 4n), proposer);
    await advancePast(await proposalEnd(4n));
    await send(expireProposal(4n), payer);
    const expiredProposal = proposalAddress(4n);
    await fails("32 Expired proposal rejects commitment", /ChallengeNotActive/, () =>
      send(
        commitChallenge(
          expiredProposal,
          invariant,
          hunter.publicKey,
          challengeCommitment(expiredProposal, invariant, hunter.publicKey, terminalTrace, terminalSalt)
        ),
        hunter
      )
    );

    await send(createProposal(5n, buffers[4], bufferHashes[4]), proposer);
    await send(startChallenge(5n, 4n), proposer);
    await send(temporaryDecision(5n, 2), governance);
    await advancePast(await proposalEnd(5n));
    const guardedUpgradeSignature = await send(executeProposal(5n, buffers[4]), payer);
    const executedProposal = proposalAddress(5n);
    await fails("33 Executed proposal rejects commitment", /ChallengeNotActive/, () =>
      send(
        commitChallenge(
          executedProposal,
          invariant,
          hunter.publicKey,
          challengeCommitment(executedProposal, invariant, hunter.publicKey, terminalTrace, terminalSalt)
        ),
        hunter
      )
    );

    const mainAfterReveal = proposalSnapshot((await connection.getAccountInfo(mainProposal, COMMITMENT))!.data);
    assert(mainAfterReveal.candidate.equals(mainBeforeReveal.candidate));
    assert.deepEqual(mainAfterReveal.candidateHash, mainBeforeReveal.candidateHash);
    assert.equal(mainAfterReveal.state, mainBeforeReveal.state);
    console.log("PASS 34 failed commit/reveal attempts preserved proposal and candidate metadata");
    assert.equal(mainAfterReveal.state, 1);
    assert.equal(mainAfterReveal.decisionAuthorityOption, 0);
    assert.equal(mainAfterReveal.executedAtOption, 0);
    console.log("PASS 35 successful reveal leaves proposal ChallengeActive and undecided/unexecuted");

    const vector = challengeCommitment(
      new PublicKey(Buffer.alloc(32, 1)),
      new PublicKey(Buffer.alloc(32, 2)),
      new PublicKey(Buffer.alloc(32, 3)),
      Buffer.alloc(32, 4),
      Buffer.alloc(32, 5)
    ).toString("hex");
    assert.equal(vector, EXPECTED_VECTOR);
    console.log(`PASS 36 Rust/TypeScript commitment vector: ${vector}`);

    console.log(`Invariant PDA: ${invariant}`);
    console.log(`ChallengeCommit PDA: ${challengeCommit}`);
    console.log(`TraceClaim PDA: ${traceClaim}`);
    console.log(`Commit signature: ${commitSignature}`);
    console.log(`Reveal signature: ${revealSignature}`);
    console.log(`Guarded upgrade signature: ${guardedUpgradeSignature}`);
    console.log("MILESTONE-4 COMMIT-REVEAL ASSERTIONS 1-36 PASSED");
  } finally {
    appendFileSync(
      `${ROOT}/.localnet/challenge-commit-reveal-evidence.log`,
      `${evidence.join("\n")}\n`
    );
  }
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
