import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { Keypair, PublicKey } from "@solana/web3.js";
import { canonicalJson } from "../packages/faultline-sdk/src/index.js";
import { bindCheckpoint3ReplayJob } from "./milestone-8-checkpoint3-fixture.js";

const root = resolve(".");
const executable = join(root, "crates", "faultline-replay", "target", "debug", "faultline.exe");
const sha256 = (value: Uint8Array | string) => createHash("sha256").update(value).digest();
const u64 = (value: bigint) => { const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(value); return bytes; };

test("checkpoint 5 v3 request rebinds the canonical build manifest before production worker execution", () => {
  const localnet = join(root, ".localnet");
  mkdirSync(localnet, { recursive: true });
  const owned = mkdtempSync(join(localnet, "m8-c5-worker-test-"));
  try {
    const verifier = Keypair.generate();
    const keyPath = join(owned, "operator-0.json");
    const secret = [...verifier.secretKey];
    writeFileSync(keyPath, JSON.stringify(secret));
    secret.fill(0);

    const ids = JSON.parse(readFileSync(join(localnet, "ids.json"), "utf8")) as Record<string, string>;
    const gate = new PublicKey(ids["faultline-gate-program"]);
    const treasury = new PublicKey(ids["faultline-treasury-program"]);
    const [policy] = PublicKey.findProgramAddressSync([Buffer.from("safety-policy"), treasury.toBuffer()], gate);
    const [proposal] = PublicKey.findProgramAddressSync([Buffer.from("upgrade-proposal"), policy.toBuffer(), u64(1n)], gate);
    const [invariant] = PublicKey.findProgramAddressSync([Buffer.from("invariant"), policy.toBuffer(), u64(1n)], gate);
    const vectors = JSON.parse(readFileSync(join(root, "manifests", "checkpoint-1-vectors.json"), "utf8"));
    const trace = Buffer.from(String(vectors.replay_jobs[0].trace_hash), "hex");
    const [traceClaim] = PublicKey.findProgramAddressSync([Buffer.from("trace-claim"), proposal.toBuffer(), trace], gate);
    const [round] = PublicKey.findProgramAddressSync([Buffer.from("verification-round"), traceClaim.toBuffer()], gate);
    const candidateHash = sha256(readFileSync(join(root, "artifacts", "treasury", "v3", "faultline_treasury.so"))).toString("hex");
    const specificationHash = sha256(readFileSync(join(root, "policies", "invariants", "AUTH-001.json"))).toString("hex");
    const binding = {
      verificationRound: round.toBase58(), proposal: proposal.toBase58(), invariantAccount: invariant.toBase58(),
      traceClaim: traceClaim.toBase58(), candidateExecutableSha256: candidateHash, invariantSpecificationHash: specificationHash
    };
    const inputPaths = {
      candidate_build_manifest: "manifests/treasury-v3-build.json",
      runner_manifest: "manifests/treasury-runner.json",
      fixture_manifest: "manifests/treasury-v1-fixture.json",
      invariant_manifest: "manifests/auth-001-invariant.json",
      trace: "fixtures/exploits/auth-001-v2-authority-takeover.json",
      candidate_executable: "artifacts/treasury/v3/faultline_treasury.so"
    };
    const request = (template: Record<string, unknown>) => ({
      schema: "faultline.worker-request.v1",
      canonicalization: "faultline.canonical-json.v1",
      coordinator_nonce: sha256("m8-c5-v3-nonce-0").toString("hex"),
      worker_ordinal: 0,
      expected_verifier_pubkey: verifier.publicKey.toBase58(),
      replay_job: bindCheckpoint3ReplayJob(template, binding),
      input_paths: inputPaths
    });
    const run = (name: string, value: ReturnType<typeof request>) => {
      const requestPath = join(owned, `${name}-request.json`);
      const outputPath = join(owned, `${name}-output.json`);
      writeFileSync(requestPath, canonicalJson(value));
      const result = spawnSync(executable, [
        "verifier", "run", "--repository", root, "--request", requestPath, "--keypair", keyPath,
        "--epoch-member", verifier.publicKey.toBase58(), "--stake-identity", verifier.publicKey.toBase58(),
        "--worker-signer", verifier.publicKey.toBase58(), "--attestation-signer", verifier.publicKey.toBase58(),
        "--output", outputPath, "--demo-owned-run", owned
      ], { cwd: root, encoding: "utf8", timeout: 120_000 });
      return { result, outputPath };
    };

    const bad = request(vectors.replay_jobs[0]);
    assert.equal(bad.replay_job.build_manifest_hash, vectors.hashes.build_v2_manifest_hash);
    assert.notEqual(bad.replay_job.build_manifest_hash, vectors.hashes.build_v3_manifest_hash);
    const rejected = run("v2-template-v3-inputs", bad);
    assert.equal(rejected.result.status, 20);
    assert.equal(rejected.result.stderr.trim(), "INVALID_INPUT: worker execution failed");
    assert(!existsSync(rejected.outputPath));

    const good = request(vectors.replay_jobs[1]);
    assert.equal(good.replay_job.build_manifest_hash, vectors.hashes.build_v3_manifest_hash);
    assert.equal(good.replay_job.candidate_buffer_hash, candidateHash);
    assert.equal(good.replay_job.candidate_executable_sha256, candidateHash);
    const accepted = run("v3-template-v3-inputs", good);
    assert.equal(accepted.result.status, 0, accepted.result.stderr);
    const signed = JSON.parse(readFileSync(accepted.outputPath, "utf8"));
    assert.equal(signed.output.classification, "Preserved");
    assert.equal(signed.output.worker_ordinal, 0);
    assert.equal(signed.output.coordinator_nonce, good.coordinator_nonce);
    assert.equal(signed.output.verifier_pubkey, verifier.publicKey.toBase58());

    const publicOutput = `${rejected.result.stdout}${rejected.result.stderr}${accepted.result.stdout}${accepted.result.stderr}`;
    assert(!publicOutput.includes(JSON.stringify([...verifier.secretKey])));
    assert(!publicOutput.includes(root));
    assert(!publicOutput.includes(owned));
  } finally {
    rmSync(owned, { recursive: true, force: true });
    assert(!existsSync(owned));
  }
});
