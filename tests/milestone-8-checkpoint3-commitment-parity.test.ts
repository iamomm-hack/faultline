import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  FAULTLINE_GATE_PROGRAM_ID,
  FAULTLINE_TREASURY_PROGRAM_ID,
  ReplayVerdict,
  buildCreateReplayResultInstruction,
  canonicalJson,
  deriveReplayResult,
  replayResultCommitment,
  replayResultPreimage,
  validateAttestationPlan
} from "../packages/faultline-sdk/src/index.js";
import { bindCheckpoint3ReplayJob } from "./milestone-8-checkpoint3-fixture.js";

const sha256 = (...parts: Uint8Array[]) => createHash("sha256").update(Buffer.concat(parts.map(Buffer.from))).digest();
const u64 = (value: bigint) => { const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(value); return bytes; };
const hex32 = (value: unknown, label: string) => {
  assert.equal(typeof value, "string", `${label} type`);
  assert.match(value as string, /^[0-9a-f]{64}$/, `${label} encoding`);
  return Buffer.from(value as string, "hex");
};

test("m8_c3_fixture_gate_commitment_and_instruction_parity", () => {
  const vectors = JSON.parse(readFileSync("manifests/checkpoint-1-vectors.json", "utf8"));
  const template = vectors.replay_jobs[0] as Record<string, unknown>;
  const gate = FAULTLINE_GATE_PROGRAM_ID;
  const treasury = FAULTLINE_TREASURY_PROGRAM_ID;
  const [policy] = PublicKey.findProgramAddressSync([Buffer.from("safety-policy"), treasury.toBuffer()], gate);
  const [proposal] = PublicKey.findProgramAddressSync([Buffer.from("upgrade-proposal"), policy.toBuffer(), u64(1n)], gate);
  const [invariant] = PublicKey.findProgramAddressSync([Buffer.from("invariant"), policy.toBuffer(), u64(1n)], gate);
  const trace = hex32(template.trace_hash, "trace hash");
  const [traceClaim] = PublicKey.findProgramAddressSync([Buffer.from("trace-claim"), proposal.toBuffer(), trace], gate);
  const [round] = PublicKey.findProgramAddressSync([Buffer.from("verification-round"), traceClaim.toBuffer()], gate);
  const executableHash = sha256(readFileSync("artifacts/treasury/v2/faultline_treasury.so"));
  const specificationHash = sha256(readFileSync("policies/invariants/AUTH-001.json"));
  const vectorSpecificationHash = hex32(template.invariant_specification_hash, "vector specification hash");
  const legacyFixtureSpecificationHash = sha256(Buffer.from("spec-1"));
  assert.deepEqual(vectorSpecificationHash, specificationHash, "Milestone 7 must bind the authoritative invariant bytes");
  assert.notDeepEqual(legacyFixtureSpecificationHash, specificationHash, "the old fixture placeholder must not be reused");

  const job = bindCheckpoint3ReplayJob(template, {
    verificationRound: round.toBase58(),
    proposal: proposal.toBase58(),
    invariantAccount: invariant.toBase58(),
    traceClaim: traceClaim.toBase58(),
    candidateExecutableSha256: executableHash.toString("hex"),
    invariantSpecificationHash: specificationHash.toString("hex")
  });
  assert.deepEqual(hex32(job.invariant_specification_hash, "bound specification hash"), specificationHash);

  const receiptHash = hex32(vectors.unsigned_worker_outputs[0].receipt_hash, "receipt hash");
  const verdict = ReplayVerdict.InvariantHolds;
  // Independent reconstruction of programs/faultline_gate/src/lib.rs::replay_result_commitment.
  const gatePreimage = Buffer.concat([
    Buffer.from("FAULTLINE_REPLAY_V1", "ascii"),
    proposal.toBuffer(),
    invariant.toBuffer(),
    traceClaim.toBuffer(),
    hex32(job.candidate_buffer_hash, "candidate buffer hash"),
    hex32(job.invariant_specification_hash, "invariant specification hash"),
    Buffer.from([verdict]),
    receiptHash
  ]);
  assert.equal(gatePreimage.length, 212);
  const gateCommitment = sha256(gatePreimage);
  const sdkInput = {
    proposal,
    invariant,
    traceClaim,
    candidateBufferHash: hex32(job.candidate_buffer_hash, "candidate buffer hash"),
    invariantSpecificationHash: hex32(job.invariant_specification_hash, "invariant specification hash"),
    verdict,
    replayReceiptHash: receiptHash
  };
  assert.deepEqual(replayResultPreimage(sdkInput), gatePreimage);
  assert.deepEqual(replayResultCommitment(sdkInput), gateCommitment);

  const [replayResult] = deriveReplayResult(round, gateCommitment);
  const instruction = buildCreateReplayResultInstruction({
    payer: new PublicKey(Buffer.alloc(32, 9)),
    verification_round: round,
    replay_result: replayResult,
    system_program: SystemProgram.programId
  }, {
    result_hash: gateCommitment,
    verdict: { kind: "InvariantHolds" },
    replay_receipt_hash: receiptHash
  });
  assert.equal(instruction.data.length, 73);
  assert.deepEqual(instruction.data.subarray(0, 8), sha256(Buffer.from("global:create_replay_result")).subarray(0, 8));
  assert.deepEqual(instruction.data.subarray(8, 40), gateCommitment);
  assert.equal(instruction.data[40], verdict);
  assert.deepEqual(instruction.data.subarray(41, 73), receiptHash);

  const root = process.cwd();
  const owned = `${root}/.localnet/m8-c3-offline-parity-${process.pid}`;
  const executable = `${root}/crates/faultline-replay/target/debug/faultline.exe`;
  mkdirSync(owned, { recursive: false });
  try {
    const requestPaths: string[] = [];
    const outputPaths: string[] = [];
    const requests: Record<string, unknown>[] = [];
    for (let ordinal = 0; ordinal < 3; ordinal++) {
      const verifier = Keypair.fromSeed(sha256(Buffer.from(`m8-c3-offline-verifier-${ordinal}`)));
      const keyPath = `${owned}/operator-${ordinal}.json`;
      const keyBytes = [...verifier.secretKey]; writeFileSync(keyPath, JSON.stringify(keyBytes)); keyBytes.fill(0);
      const request = {
        schema: "faultline.worker-request.v1", canonicalization: "faultline.canonical-json.v1",
        coordinator_nonce: sha256(Buffer.from(`m8-c3-offline-nonce-${ordinal}`)).toString("hex"), worker_ordinal: ordinal,
        expected_verifier_pubkey: verifier.publicKey.toBase58(), replay_job: job,
        input_paths: { candidate_build_manifest: "manifests/treasury-v2-build.json", runner_manifest: "manifests/treasury-runner.json", fixture_manifest: "manifests/treasury-v1-fixture.json", invariant_manifest: "manifests/auth-001-invariant.json", trace: "fixtures/exploits/auth-001-v2-authority-takeover.json", candidate_executable: "artifacts/treasury/v2/faultline_treasury.so" }
      };
      const requestPath = `${owned}/request-${ordinal}.json`;
      const outputPath = `${owned}/output-${ordinal}.json`;
      writeFileSync(requestPath, canonicalJson(request));
      execFileSync(executable, ["verifier", "run", "--repository", root, "--request", requestPath, "--keypair", keyPath, "--epoch-member", verifier.publicKey.toBase58(), "--stake-identity", verifier.publicKey.toBase58(), "--worker-signer", verifier.publicKey.toBase58(), "--attestation-signer", verifier.publicKey.toBase58(), "--output", outputPath, "--demo-owned-run", owned], { cwd: root, stdio: "pipe", timeout: 120_000 });
      requestPaths.push(requestPath); outputPaths.push(outputPath); requests.push(request);
    }
    const planPath = `${owned}/plan.json`;
    const expectedGenesis = new PublicKey(Buffer.alloc(32, 7)).toBase58();
    const verifierEpoch = new PublicKey(Buffer.alloc(32, 8)).toBase58();
    execFileSync(executable, ["quorum", "verify", ...requestPaths.flatMap(value => ["--request", value]), ...outputPaths.flatMap(value => ["--signed-output", value]), "--gate-program-id", gate.toBase58(), "--expected-genesis-hash", expectedGenesis, "--verifier-epoch", verifierEpoch, "--plan-output", planPath], { cwd: root, stdio: "pipe", timeout: 120_000 });
    const plan = validateAttestationPlan(JSON.parse(readFileSync(planPath, "utf8")), requests as never[]);
    const planReceipt = Buffer.from(plan.replay_receipt_hash, "hex");
    const planPreimage = Buffer.concat([Buffer.from("FAULTLINE_REPLAY_V1", "ascii"), proposal.toBuffer(), invariant.toBuffer(), traceClaim.toBuffer(), executableHash, specificationHash, Buffer.from([plan.verdict_u8]), planReceipt]);
    const planCommitment = sha256(planPreimage);
    assert.deepEqual(Buffer.from(plan.result_hash, "hex"), planCommitment);
    assert.equal(new Set(plan.signed_worker_outputs.map(value => value.output.replay_result_commitment)).size, 1);
    assert.equal(plan.signed_worker_outputs[0].output.replay_result_commitment, plan.result_hash);

    const planInstruction = buildCreateReplayResultInstruction({ payer: new PublicKey(Buffer.alloc(32, 9)), verification_round: round, replay_result: deriveReplayResult(round, planCommitment)[0], system_program: SystemProgram.programId }, { result_hash: planCommitment, verdict: { kind: plan.verdict_u8 === 0 ? "InvariantHolds" : "InvariantViolated" }, replay_receipt_hash: planReceipt });
  assert.deepEqual(planInstruction.data.subarray(8, 40), planCommitment);
  assert.equal(planInstruction.data[40], plan.verdict_u8);
  assert.deepEqual(planInstruction.data.subarray(41), planReceipt);

    // The later equivocation and epoch-rotation fixture results must use the
    // same snapshotted invariant hash as Gate, never the legacy "spec-1" text.
    const alternateReceipt = sha256(Buffer.from("m8-c3-alternate-receipt"));
    const alternatePreimage = Buffer.concat([
      Buffer.from("FAULTLINE_REPLAY_V1", "ascii"), proposal.toBuffer(), invariant.toBuffer(),
      traceClaim.toBuffer(), executableHash, specificationHash,
      Buffer.from([plan.verdict_u8]), alternateReceipt
    ]);
    const alternateCommitment = sha256(alternatePreimage);
    assert.notDeepEqual(
      alternateCommitment,
      sha256(Buffer.concat([
        alternatePreimage.subarray(0, 147), legacyFixtureSpecificationHash,
        alternatePreimage.subarray(179)
      ])),
      "legacy textual specification hash must change the Gate commitment"
    );

    const secondProposal = PublicKey.findProgramAddressSync(
      [Buffer.from("upgrade-proposal"), policy.toBuffer(), u64(2n)], gate
    )[0];
    const secondTrace = sha256(Buffer.from("m8-c3-rotation-trace"));
    const secondTraceClaim = PublicKey.findProgramAddressSync(
      [Buffer.from("trace-claim"), secondProposal.toBuffer(), secondTrace], gate
    )[0];
    const rotationReceipt = sha256(Buffer.from("m8-c3-new-epoch-receipt"));
    const rotationPreimage = Buffer.concat([
      Buffer.from("FAULTLINE_REPLAY_V1", "ascii"), secondProposal.toBuffer(), invariant.toBuffer(),
      secondTraceClaim.toBuffer(), executableHash, specificationHash, Buffer.from([0]), rotationReceipt
    ]);
    assert.equal(alternatePreimage.length, 212);
    assert.equal(rotationPreimage.length, 212);
    assert.deepEqual(
      replayResultCommitment({
        proposal: secondProposal, invariant, traceClaim: secondTraceClaim,
        candidateBufferHash: executableHash, invariantSpecificationHash: specificationHash,
        verdict: ReplayVerdict.InvariantHolds, replayReceiptHash: rotationReceipt
      }),
      sha256(rotationPreimage)
    );
    console.log(JSON.stringify({ worker_receipt_hex: plan.replay_receipt_hash, worker_plan_commitment_hex: plan.result_hash, worker_verdict_hex: plan.verdict_u8.toString(16).padStart(2, "0"), worker_count: plan.signed_worker_outputs.length, instruction_data_hex: planInstruction.data.toString("hex") }));
  } finally {
    rmSync(owned, { recursive: true, force: true });
  }

  console.log(JSON.stringify({
    domain_hex: gatePreimage.subarray(0, 19).toString("hex"),
    proposal_hex: proposal.toBuffer().toString("hex"),
    invariant_hex: invariant.toBuffer().toString("hex"),
    trace_claim_hex: traceClaim.toBuffer().toString("hex"),
    candidate_executable_hex: executableHash.toString("hex"),
    invariant_specification_hex: specificationHash.toString("hex"),
    legacy_fixture_specification_hex: legacyFixtureSpecificationHash.toString("hex"),
    verdict_hex: verdict.toString(16).padStart(2, "0"),
    receipt_hex: receiptHash.toString("hex"),
    commitment_hex: gateCommitment.toString("hex"),
    instruction_data_hex: instruction.data.toString("hex")
  }));
});
