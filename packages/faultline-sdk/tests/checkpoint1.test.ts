import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { FAULTLINE_GATE_IDL, FAULTLINE_IDL_PROVENANCE } from "@faultline/idl";
import * as sdk from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const gateIdl = FAULTLINE_GATE_IDL as unknown as sdk.FaultlineIdl;
const hash = (...parts: Uint8Array[]) => createHash("sha256").update(Buffer.concat(parts.map(Buffer.from))).digest();
const key = (value: number) => new PublicKey(Buffer.alloc(32, value));
const le64 = (value: bigint) => { const out = Buffer.alloc(8); out.writeBigUInt64LE(value); return out; };
const disc = (namespace: string, name: string) => hash(Buffer.from(`${namespace}:${name}`)).subarray(0, 8);
const expectCode = (code: sdk.FaultlineSdkErrorCode, fn: () => unknown) =>
  assert.throws(fn, (error: unknown) => error instanceof sdk.FaultlineSdkError && error.code === code);

test("m8_c1_idl_generation_is_reproducible", { timeout: 300_000 }, () => {
  const command = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/generate-milestone-8-idl.ps1", "-Check"], {
    cwd: root, env: process.env, encoding: "utf8", timeout: 295_000,
  });
  assert.equal(command.status, 0, `${command.stdout}\n${command.stderr}`);
  for (const [name, relative] of [["faultline_gate", "packages/faultline-idl/idl/faultline_gate.json"], ["faultline_treasury", "packages/faultline-idl/idl/faultline_treasury.json"]] as const) {
    const bytes = readFileSync(join(root, relative));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), FAULTLINE_IDL_PROVENANCE.programs[name].sha256);
  }
  assert.equal(FAULTLINE_IDL_PROVENANCE.source_commit, "efb47101f55180bc19009cb1a38e8d50475b014c");
});

test("m8_c1_idl_matches_program_surface", () => {
  for (const instruction of gateIdl.instructions) {
    assert.deepEqual(instruction.discriminator, [...disc("global", instruction.name)]);
  }
  for (const account of gateIdl.accounts ?? []) {
    assert.deepEqual(account.discriminator, [...disc("account", account.name)]);
  }
  const canonical = ["create_verifier_epoch", "activate_verifier_epoch", "initialize_verifier_stake", "activate_verifier_epoch_economics", "open_economic_verification_round", "create_replay_result", "submit_verifier_attestation", "finalize_replay_result", "close_finalized_round_economics", "settle_accepted_challenge", "settle_hold_challenge", "claim_verifier_fee", "refund_proposal_escrow", "record_temporary_decision", "execute_guarded_upgrade"];
  const surface = canonical.map((name) => JSON.stringify(gateIdl.instructions.find((item) => item.name === name))).join("\n");
  assert.equal(createHash("sha256").update(surface).digest("hex"), "2a44c318ec0a4adc45d520dcaebe57b5179a1c6080a86d487e3c66b12689ac20");
  const errors = (gateIdl.errors ?? []).map((error) => `${error.code}:${error.name}:${error.msg}`).join("\n");
  assert.equal(createHash("sha256").update(errors).digest("hex"), "62b1ab9b99d1701372b48475a197443da14a9a1372636835c030e37ec6d3df0d");
  const sizes: Readonly<Record<string, number>> = { VerifierRegistry: 122, VerifierEpoch: 414, ProposalVerificationGate: 77, VerificationRound: 317, ReplayResult: 115, VerifierAttestation: 177, VerifierStake: 212, VerifierEpochEconomics: 113, RoundEconomicState: 139, VerifierFeeClaim: 153 };
  for (const [name, size] of Object.entries(sizes)) assert.equal(sdk.accountSize(gateIdl, name), size);
  const source = readFileSync(join(root, "programs/faultline_gate/src/lib.rs"), "utf8");
  for (const name of canonical) assert.match(source, new RegExp(`pub fn ${name}\\b`));
  const mutated = structuredClone(FAULTLINE_GATE_IDL) as unknown as sdk.FaultlineIdl;
  mutated.metadata.spec = "9.9.9";
  expectCode("INVALID_IDL", () => sdk.buildIdlInstruction({ idl: mutated, name: "finalize_replay_result", programId: sdk.FAULTLINE_GATE_PROGRAM_ID, accounts: {}, args: {} }));
});

test("m8_c1_sdk_pda_parity", () => {
  const policy = key(1), proposal = key(2), invariant = key(3), trace = key(4), registry = key(5), round = key(6), verifier = key(7), economic = key(8), commit = key(9), target = key(10);
  const h = Buffer.alloc(32, 11), id = 0x0102030405060708n;
  const cases: Array<[readonly [PublicKey, number], Uint8Array[]]> = [
    [sdk.deriveGuard(target), [Buffer.from("faultline"), Buffer.from("guard"), target.toBuffer()]],
    [sdk.deriveBufferClaim(target), [Buffer.from("faultline"), Buffer.from("buffer"), target.toBuffer()]],
    [sdk.deriveSafetyPolicy(target), [Buffer.from("safety-policy"), target.toBuffer()]],
    [sdk.deriveUpgradeProposal(policy, id), [Buffer.from("upgrade-proposal"), policy.toBuffer(), le64(id)]],
    [sdk.deriveInvariantDefinition(policy, id), [Buffer.from("invariant"), policy.toBuffer(), le64(id)]],
    [sdk.deriveChallengeCommit(proposal, verifier, h), [Buffer.from("challenge-commit"), proposal.toBuffer(), verifier.toBuffer(), h]],
    [sdk.deriveTraceClaim(proposal, h), [Buffer.from("trace-claim"), proposal.toBuffer(), h]],
    [sdk.deriveVerifierRegistry(policy), [Buffer.from("verifier-registry"), policy.toBuffer()]],
    [sdk.deriveVerifierEpoch(registry, id), [Buffer.from("verifier-epoch"), registry.toBuffer(), le64(id)]],
    [sdk.deriveProposalVerificationGate(proposal), [Buffer.from("proposal-verification-gate"), proposal.toBuffer()]],
    [sdk.deriveVerificationRound(trace), [Buffer.from("verification-round"), trace.toBuffer()]],
    [sdk.deriveReplayResult(round, h), [Buffer.from("replay-result"), round.toBuffer(), h]],
    [sdk.deriveVerifierAttestation(round, verifier), [Buffer.from("verifier-attestation"), round.toBuffer(), verifier.toBuffer()]],
    [sdk.deriveEconomicPolicyRegistry(policy), [Buffer.from("economic-policy-registry"), policy.toBuffer()]],
    [sdk.deriveEconomicPolicy(registry, id), [Buffer.from("economic-policy"), registry.toBuffer(), le64(id)]],
    [sdk.deriveProposalEscrow(proposal), [Buffer.from("proposal-escrow"), proposal.toBuffer()]],
    [sdk.deriveBountyVault(proposal), [Buffer.from("bounty-vault"), proposal.toBuffer()]],
    [sdk.deriveFeeVault(proposal), [Buffer.from("fee-vault"), proposal.toBuffer()]],
    [sdk.derivePenaltyVault(proposal), [Buffer.from("penalty-vault"), proposal.toBuffer()]],
    [sdk.deriveChallengeBond(commit), [Buffer.from("challenge-bond"), commit.toBuffer()]],
    [sdk.deriveBondVault(commit), [Buffer.from("bond-vault"), commit.toBuffer()]],
    [sdk.deriveVerifierStake(economic, verifier), [Buffer.from("verifier-stake"), economic.toBuffer(), verifier.toBuffer()]],
    [sdk.deriveStakeVault(economic, verifier), [Buffer.from("stake-vault"), economic.toBuffer(), verifier.toBuffer()]],
    [sdk.deriveVerifierEpochEconomics(registry, economic), [Buffer.from("verifier-epoch-economics"), registry.toBuffer(), economic.toBuffer()]],
    [sdk.deriveRoundEconomicState(round), [Buffer.from("round-economics"), round.toBuffer()]],
    [sdk.deriveVerifierFeeClaim(round, verifier), [Buffer.from("verifier-fee-claim"), round.toBuffer(), verifier.toBuffer()]],
    [sdk.deriveVerifierSlashReceipt(round, verifier), [Buffer.from("verifier-slash"), round.toBuffer(), verifier.toBuffer()]],
  ];
  for (const [actual, seeds] of cases) assert.deepEqual(actual, PublicKey.findProgramAddressSync(seeds.map(Buffer.from), sdk.FAULTLINE_GATE_PROGRAM_ID));
  expectCode("INVALID_INPUT", () => sdk.deriveVerifierEpoch(registry, 1n << 64n));
  assert.equal(invariant.toBytes().length, 32);
});

test("m8_c1_closed_account_decoding", () => {
  const definition = gateIdl.accounts!.find((item) => item.name === "ReplayResult")!;
  const address = key(20);
  const data = Buffer.concat([Buffer.from(definition.discriminator), key(21).toBuffer(), Buffer.alloc(32, 22), Buffer.from([1]), Buffer.alloc(32, 23), Buffer.from([3]), le64(9n), Buffer.from([255])]);
  assert.equal(data.length, 115);
  const encoded = { address, owner: sdk.FAULTLINE_GATE_PROGRAM_ID, data };
  const decoded = sdk.decodeReplayResult(encoded, address);
  assert.equal(decoded.created_at_slot, 9n);
  assert.deepEqual(decoded.verdict, { kind: "InvariantViolated" });
  expectCode("INVALID_ACCOUNT_OWNER", () => sdk.decodeReplayResult({ ...encoded, owner: key(24) }));
  expectCode("INVALID_PDA", () => sdk.decodeReplayResult(encoded, key(25)));
  expectCode("INVALID_DISCRIMINATOR", () => sdk.decodeReplayResult({ ...encoded, data: Buffer.from(data).fill(0, 0, 1) }));
  expectCode("INVALID_ACCOUNT_DATA", () => sdk.decodeReplayResult({ ...encoded, data: data.subarray(0, -1) }));
  expectCode("INVALID_ACCOUNT_DATA", () => sdk.decodeReplayResult({ ...encoded, data: Buffer.concat([data, Buffer.from([0])]) }));
  const invalidEnum = Buffer.from(data); invalidEnum[72] = 2;
  expectCode("INVALID_ENUM", () => sdk.decodeReplayResult({ ...encoded, data: invalidEnum }));
});

test("m8_c1_replay_commitment_parity", () => {
  const input = { proposal: key(1), invariant: key(2), traceClaim: key(3), candidateBufferHash: Buffer.alloc(32, 4), invariantSpecificationHash: Buffer.alloc(32, 5), verdict: sdk.ReplayVerdict.InvariantViolated, replayReceiptHash: Buffer.alloc(32, 6) };
  assert.equal(sdk.replayResultPreimage(input).length, 212);
  assert.equal(sdk.replayResultCommitment(input).toString("hex"), "b7eb266542e099bd41398d8b78d6d571b57844356bfe7c6f5539a73e00046921");
  assert.deepEqual(sdk.replayResultCommitment(input), sdk.replayResultCommitment(input));
  expectCode("INVALID_INPUT", () => sdk.replayResultCommitment({ ...input, replayReceiptHash: Buffer.alloc(31) }));
});

test("m8_c1_replay_schema_parity", () => {
  const vectors = JSON.parse(readFileSync(join(root, "manifests/checkpoint-1-vectors.json"), "utf8"));
  for (let index = 0; index < 2; index++) {
    const receipt = sdk.validateReplayReceipt(vectors.receipts[index]);
    const output = sdk.validateWorkerOutput(vectors.unsigned_worker_outputs[index]);
    assert.equal(output.classification, receipt.classification);
    const signed = sdk.validateSignedWorkerOutput({ schema: "faultline.signed-worker-output.v1", canonicalization: "faultline.canonical-json.v1", output: vectors.unsigned_worker_outputs[index], signature_algorithm: "solana-ed25519-sha256-v1", signer_pubkey: output.verifier_pubkey, signature: "1".repeat(64) });
    assert.equal(signed.output.worker_ordinal, output.worker_ordinal);
  }
  const extra = structuredClone(vectors.receipts[0]); extra.unexpected = true;
  expectCode("SCHEMA_INVALID", () => sdk.validateReplayReceipt(extra));
  const substituted = structuredClone(vectors.unsigned_worker_outputs[0]); substituted.attestation_intent.receipt_hash = "00".repeat(32);
  expectCode("SCHEMA_INVALID", () => sdk.validateWorkerOutput(substituted));
});

function directAccounts(names: readonly string[]): Record<string, PublicKey> {
  return Object.fromEntries(names.map((name, index) => [name, name === "system_program" ? SystemProgram.programId : key(40 + index)]));
}

test("m8_c1_attestation_instruction_parity", () => {
  const resultHash = Buffer.alloc(32, 50), receiptHash = Buffer.alloc(32, 51);
  const createNames = ["payer", "verification_round", "replay_result", "system_program"];
  const create = sdk.buildCreateReplayResultInstruction(directAccounts(createNames), { result_hash: resultHash, verdict: { kind: "InvariantViolated" }, replay_receipt_hash: receiptHash });
  assert.deepEqual(create.data, Buffer.concat([disc("global", "create_replay_result"), resultHash, Buffer.from([1]), receiptHash]));
  assert.deepEqual(create.keys.map((meta) => [meta.isSigner, meta.isWritable]), [[true, true], [false, false], [false, true], [false, false]]);
  assert.equal(create.bindingSummary.instructionName, "create_replay_result");
  assert.equal(create.bindingSummary.accounts.length, 4);
  const submitNames = ["verifier", "policy", "proposal", "invariant", "trace_claim", "verifier_epoch", "verification_round", "replay_result", "verifier_attestation", "system_program"];
  const submit = sdk.buildSubmitVerifierAttestationInstruction(directAccounts(submitNames), { result_hash: resultHash });
  assert.deepEqual(submit.data, Buffer.concat([disc("global", "submit_verifier_attestation"), resultHash]));
  assert.deepEqual(submit.keys.map((meta) => [meta.isSigner, meta.isWritable]), [[true, true], [false, false], [false, false], [false, false], [false, false], [false, false], [false, false], [false, true], [false, true], [false, false]]);
  const finalizeNames = ["caller", "policy", "proposal", "proposal_verification_gate", "verification_round", "replay_result"];
  const finalize = sdk.buildFinalizeReplayResultInstruction(directAccounts(finalizeNames));
  assert.deepEqual(finalize.data, disc("global", "finalize_replay_result"));
  assert.deepEqual(finalize.keys.map((meta) => [meta.isSigner, meta.isWritable]), [[true, false], [false, false], [false, true], [false, true], [false, true], [false, false]]);
  expectCode("INVALID_PROGRAM_ID", () => sdk.buildIdlInstruction({ idl: gateIdl, name: "finalize_replay_result", programId: key(60), accounts: directAccounts(finalizeNames), args: {} }));
  expectCode("INVALID_INPUT", () => sdk.buildCreateReplayResultInstruction(directAccounts(createNames), { result_hash: Buffer.alloc(31), verdict: { kind: "InvariantViolated" }, replay_receipt_hash: receiptHash }));
});

function flatten(accounts: sdk.IdlInstructionAccount[], prefix = ""): Array<sdk.IdlInstructionAccount & { path: string }> {
  return accounts.flatMap((account) => {
    const path = prefix ? `${prefix}.${account.name}` : account.name;
    return account.accounts ? flatten(account.accounts, path) : [{ ...account, path }];
  });
}
function sampleArgs(instruction: sdk.IdlInstruction): Record<string, unknown> {
  return Object.fromEntries(instruction.args.map((arg) => {
    const type = arg.type;
    if (type === "u64") return [arg.name, 7n];
    if (type === "u8" || type === "u16") return [arg.name, 1];
    if (typeof type === "object" && "vec" in type) return [arg.name, [key(91)]];
    if (typeof type === "object" && "defined" in type) return [arg.name, { kind: gateIdl.types!.find((item) => item.name === type.defined.name)!.type.kind === "enum" ? "Draft" : "" }];
    throw new Error(`unsupported test argument ${arg.name}`);
  }));
}

test("m8_c1_economic_and_upgrade_builder_parity", () => {
  const builders = new Map<string, (accounts: sdk.InstructionAccounts, args?: sdk.InstructionArguments) => sdk.BuiltInstruction>([
    ["create_verifier_epoch", sdk.buildCreateVerifierEpochInstruction], ["activate_verifier_epoch", sdk.buildActivateVerifierEpochInstruction],
    ["initialize_verifier_stake", sdk.buildInitializeVerifierStakeInstruction], ["activate_verifier_epoch_economics", sdk.buildActivateVerifierEpochEconomicsInstruction],
    ["open_economic_verification_round", sdk.buildOpenEconomicVerificationRoundInstruction], ["close_finalized_round_economics", sdk.buildCloseFinalizedRoundEconomicsInstruction],
    ["settle_accepted_challenge", sdk.buildSettleAcceptedChallengeInstruction], ["settle_hold_challenge", sdk.buildSettleHoldChallengeInstruction],
    ["claim_verifier_fee", sdk.buildClaimVerifierFeeInstruction], ["refund_proposal_escrow", sdk.buildRefundProposalEscrowInstruction],
    ["record_temporary_decision", sdk.buildRecordTemporaryDecisionInstruction], ["execute_guarded_upgrade", sdk.buildExecuteGuardedUpgradeInstruction],
  ]);
  let next = 100;
  for (const [name, builder] of builders) {
    const definition = gateIdl.instructions.find((item) => item.name === name)!;
    const leaves = flatten(definition.accounts);
    const accounts = Object.fromEntries(leaves.map((account) => [account.path, account.address ? new PublicKey(account.address) : key(next++ % 255 || 1)]));
    const built = builder(accounts, sampleArgs(definition));
    assert.deepEqual(built.data.subarray(0, 8), disc("global", name));
    assert.deepEqual(built.keys.map((meta) => [meta.pubkey.toBase58(), meta.isSigner, meta.isWritable]), leaves.map((account) => [(accounts[account.path] as PublicKey).toBase58(), account.signer === true, account.writable === true]));
  }
  const stake = gateIdl.instructions.find((item) => item.name === "initialize_verifier_stake")!;
  const stakeLeaves = flatten(stake.accounts);
  const stakeAccounts = Object.fromEntries(stakeLeaves.map((account, index) => [account.path, account.address ? new PublicKey(account.address) : key(150 + index)]));
  expectCode("INVALID_INPUT", () => sdk.buildInitializeVerifierStakeInstruction(stakeAccounts, { amount: Number.MAX_SAFE_INTEGER + 1 }));
});

test("m8_c1_builders_have_no_ambient_authority", () => {
  const source = ["instructions.ts", "idl.ts", "transactions.ts"].map((name) => readFileSync(join(root, "packages/faultline-sdk/src", name), "utf8")).join("\n");
  for (const forbidden of [/\bKeypair\b/, /\bConnection\b/, /sendTransaction/, /sendAndConfirm/, /process\.env/, /homedir\(/, /readFile/]) assert.doesNotMatch(source, forbidden);
  const accounts = directAccounts(["caller", "policy", "proposal", "proposal_verification_gate", "verification_round", "replay_result"]);
  const one = sdk.buildFinalizeReplayResultInstruction(accounts), two = sdk.buildFinalizeReplayResultInstruction(accounts);
  assert.deepEqual(one.data, two.data); assert.deepEqual(one.keys, two.keys);
});

test("m8_c1_transaction_size_is_bounded", () => {
  const payer = key(201), blockhash = key(202).toBase58();
  const small = new TransactionInstruction({ programId: key(203), keys: [], data: Buffer.alloc(1) });
  const transaction = sdk.buildUnsignedLegacyTransaction({ feePayer: payer, recentBlockhash: blockhash, instructions: [small] });
  assert.equal(transaction.signatures.every((entry) => entry.signature === null), true);
  assert.deepEqual(transaction.bindingSummary, { feePayer: payer.toBase58(), recentBlockhash: blockhash, instructionCount: 1, serializedSizeBytes: transaction.bindingSummary.serializedSizeBytes, usesAddressLookupTables: false });
  const huge = new TransactionInstruction({ programId: key(203), keys: [], data: Buffer.alloc(1_200) });
  expectCode("TRANSACTION_TOO_LARGE", () => sdk.buildUnsignedLegacyTransaction({ feePayer: payer, recentBlockhash: blockhash, instructions: [huge] }));
  expectCode("UNSUPPORTED_TRANSACTION", () => sdk.buildUnsignedLegacyTransaction({ feePayer: payer, recentBlockhash: blockhash, instructions: [small], addressLookupTables: [{}] }));
});

test("m8_c1_rpc_boundary_is_explicit", () => {
  const boundary = sdk.validateRpcBoundary({ endpoint: "http://127.0.0.1:8899", genesisHash: key(210).toBase58(), commitment: "finalized", timeoutMilliseconds: 30_000 });
  sdk.assertRpcGenesis(boundary, boundary.genesisHash);
  assert.deepEqual(sdk.buildAccountReadRequest(boundary, key(212), "account-1").body.params, [key(212).toBase58(), { encoding: "base64", commitment: "finalized" }]);
  assert.deepEqual(sdk.parseJsonRpcSuccess({ jsonrpc: "2.0", id: 1, result: { slot: 1 } }).result, { slot: 1 });
  expectCode("RPC_CONFIG_INVALID", () => sdk.validateRpcBoundary({ ...boundary, endpoint: "file:///secret" }));
  expectCode("RPC_CONFIG_INVALID", () => sdk.validateRpcBoundary({ ...boundary, timeoutMilliseconds: 30_001 }));
  expectCode("RPC_GENESIS_MISMATCH", () => sdk.assertRpcGenesis(boundary, key(211).toBase58()));
  expectCode("RPC_RESPONSE_INVALID", () => sdk.parseJsonRpcSuccess({ jsonrpc: "2.0", id: 1, result: true, extra: true }));
});

test("m8_c1_sdk_errors_are_closed", () => {
  assert.equal(new Set(sdk.FAULTLINE_SDK_ERROR_CODES).size, sdk.FAULTLINE_SDK_ERROR_CODES.length);
  const secret = "DO_NOT_DISCLOSE_" + "x".repeat(300);
  let observed: sdk.FaultlineSdkError | undefined;
  try { sdk.buildGateInstruction(secret, {}, {}); } catch (error) { observed = sdk.asSdkError(error); }
  assert.equal(observed?.code, "INVALID_INSTRUCTION");
  assert.equal(observed?.message.includes(secret), false);
  assert.ok((observed?.message.length ?? 1000) <= 192);
  assert.deepEqual(sdk.decodeProtocolError("faultline_gate", 6000), { program: "faultline_gate", code: 6000, name: "ArithmeticOverflow", message: "Arithmetic overflow" });
  assert.equal(sdk.decodeProtocolError("faultline_gate", 9999), undefined);
});
