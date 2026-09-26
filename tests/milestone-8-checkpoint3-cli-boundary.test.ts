import assert from "node:assert/strict";
import { createHash, createPrivateKey, sign } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  FAULTLINE_GATE_PROGRAM_ID,
  canonicalJson,
  parseAttestationSubmitCliInput,
  type AttestationIntent,
  type SignedWorkerOutput,
} from "../packages/faultline-sdk/src/index.js";

const sha256 = (...parts: Uint8Array[]) => createHash("sha256").update(Buffer.concat(parts.map(Buffer.from))).digest();
const WORKER_DOMAIN = Buffer.from("FAULTLINE_WORKER_OUTPUT_V1", "ascii");
const JOB_DOMAIN = Buffer.from("FAULTLINE_REPLAY_JOB_V1", "ascii");

function digest(domain: Buffer, value: unknown): Buffer {
  const bytes = canonicalJson(value); const length = Buffer.alloc(8); length.writeBigUInt64BE(BigInt(bytes.length));
  return sha256(domain, Buffer.from([0]), length, bytes);
}

function base58(value: Uint8Array): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = 0n; for (const byte of value) number = (number << 8n) | BigInt(byte);
  let encoded = ""; while (number > 0n) { encoded = alphabet[Number(number % 58n)] + encoded; number /= 58n; }
  for (const byte of value) { if (byte === 0) encoded = `1${encoded}`; else break; }
  return encoded || "1";
}

function signOutput(keypair: Keypair, output: SignedWorkerOutput["output"]): string {
  const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(keypair.secretKey.subarray(0, 32))]);
  return base58(sign(null, digest(WORKER_DOMAIN, output), createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" })));
}

test("legacy key-loader aliasing reproduces the pre-submission signature rejection", () => {
  const source = Keypair.fromSeed(sha256(Buffer.from("m8-c3-cli-legacy-alias")));
  const temporary = Uint8Array.from(source.secretKey);
  const aliased = Keypair.fromSecretKey(temporary);
  temporary.fill(0);
  const blockhash = new PublicKey(Buffer.alloc(32, 0x31)).toBase58();
  const destination = new PublicKey(Buffer.alloc(32, 0x32));
  const transaction = new Transaction({ feePayer: aliased.publicKey, recentBlockhash: blockhash }).add(SystemProgram.transfer({ fromPubkey: aliased.publicKey, toPubkey: destination, lamports: 1 }));
  transaction.sign(aliased);
  assert.throws(() => transaction.serialize(), /Invalid signature for public key/, "zeroing the aliased temporary must reproduce the preserved pre-submission failure");
});

test("real CLI parser preserves the canonical Checkpoint 3 public input and signer", () => {
  const root = process.cwd(); const owned = `${root}/.localnet/m8-c3-cli-boundary-${process.pid}`;
  mkdirSync(owned, { recursive: false });
  try {
    const keys = [0, 1, 2].map((ordinal) => Keypair.fromSeed(sha256(Buffer.from(`m8-c3-cli-verifier-${ordinal}`))));
    const round = new PublicKey(Buffer.alloc(32, 0x11)); const epoch = new PublicKey(Buffer.alloc(32, 0x12));
    const proposal = new PublicKey(Buffer.alloc(32, 0x13)); const invariant = new PublicKey(Buffer.alloc(32, 0x14)); const trace = new PublicKey(Buffer.alloc(32, 0x15));
    const receiptHash = sha256(Buffer.from("m8-c3-cli-receipt")).toString("hex"); const resultHash = sha256(Buffer.from("m8-c3-cli-result")).toString("hex");
    const replayJob = { verification_round: round.toBase58(), proposal: proposal.toBase58(), invariant_account: invariant.toBase58(), trace_claim: trace.toBase58(), candidate_buffer_hash: "21".repeat(32), candidate_executable_sha256: "21".repeat(32), invariant_specification_hash: "22".repeat(32) };
    const replayJobHash = digest(JOB_DOMAIN, replayJob).toString("hex");
    const requests = keys.map((keypair, ordinal) => ({ coordinator_nonce: sha256(Buffer.from(`m8-c3-cli-nonce-${ordinal}`)).toString("hex"), worker_ordinal: ordinal, expected_verifier_pubkey: keypair.publicKey.toBase58(), replay_job: replayJob }));
    const intents: AttestationIntent[] = keys.map((keypair) => ({ verification_round: round.toBase58(), proposal: proposal.toBase58(), invariant_account: invariant.toBase58(), trace_claim: trace.toBase58(), verifier_pubkey: keypair.publicKey.toBase58(), verdict_u8: 0, receipt_hash: receiptHash, replay_result_commitment: resultHash }));
    const outputs: SignedWorkerOutput[] = keys.map((keypair, ordinal) => {
      const output: SignedWorkerOutput["output"] = { schema: "faultline.worker-output.v1", canonicalization: "faultline.canonical-json.v1", coordinator_nonce: requests[ordinal].coordinator_nonce, worker_ordinal: ordinal as 0 | 1 | 2, verifier_pubkey: keypair.publicKey.toBase58(), replay_job_hash: replayJobHash, classification: "Preserved", result_code: 0, receipt_hash: receiptHash, verdict_u8: 0, replay_result_commitment: resultHash, attestation_intent: intents[ordinal], process_peak_memory_bytes: "1", elapsed_milliseconds: "1" };
      return { schema: "faultline.signed-worker-output.v1", canonicalization: "faultline.canonical-json.v1", output, signature_algorithm: "solana-ed25519-sha256-v1", signer_pubkey: keypair.publicKey.toBase58(), signature: signOutput(keypair, output) };
    });
    const genesis = new PublicKey(Buffer.alloc(32, 0x16)).toBase58();
    const plan = { schema: "faultline.attestation-plan.v1", canonicalization: "faultline.canonical-json.v1", gate_program_id: FAULTLINE_GATE_PROGRAM_ID.toBase58(), expected_genesis_hash: genesis, verification_round: round.toBase58(), verifier_epoch: epoch.toBase58(), replay_job_hash: replayJobHash, replay_receipt_hash: receiptHash, result_hash: resultHash, verdict_u8: 0, signed_worker_outputs: outputs, attestation_intents: intents };
    const requestPaths = requests.map((request, ordinal) => { const path = `${owned}/request-${ordinal}.json`; writeFileSync(path, canonicalJson(request)); return path; });
    const planPath = `${owned}/plan.json`; writeFileSync(planPath, canonicalJson(plan));
    const keyPath = `${owned}/operator.json`; writeFileSync(keyPath, JSON.stringify([...keys[0].secretKey]));
    const manifestPath = `${owned}/manifest.json`; writeFileSync(manifestPath, JSON.stringify({ executable_sha256: "21".repeat(32) }));
    const address = (byte: number) => new PublicKey(Buffer.alloc(32, byte)).toBase58();
    const argv = ["attestation", "submit", "--rpc-url", "http://127.0.0.1:8899", "--expected-genesis-hash", genesis, "--commitment", "confirmed", "--rpc-deadline-ms", "30000", "--confirmation-deadline-ms", "90000", "--demo-owned-run", owned, "--plan", planPath, ...requestPaths.flatMap((value) => ["--request", value]), "--raw-executable", "artifacts/treasury/v2/faultline_treasury.so", "--build-manifest", manifestPath, "--policy", address(0x23), "--proposal", proposal.toBase58(), "--invariant", invariant.toBase58(), "--trace-claim", trace.toBase58(), "--verifier-registry", address(0x24), "--verifier-epoch", epoch.toBase58(), "--verification-round", round.toBase58(), "--economic-policy", address(0x25), "--verifier-epoch-economics", address(0x26), "--round-economics", address(0x27), "--candidate-buffer", address(0x28), "--keypair", keyPath, "--verifier-stake", address(0x29)];
    const parsed = parseAttestationSubmitCliInput(argv);
    assert.deepEqual(parsed.requests, requests);
    assert.deepEqual(canonicalJson(parsed.plan), canonicalJson(plan));
    for (let ordinal = 0; ordinal < 3; ordinal++) assert.deepEqual(canonicalJson(parsed.requests[ordinal]), readFileSync(requestPaths[ordinal]));
    assert(parsed.keypair.publicKey.equals(keys[0].publicKey));
    assert.deepEqual(Buffer.from(parsed.keypair.secretKey.subarray(32)), keys[0].publicKey.toBuffer(), "retained secret must still bind the parsed signer public key");
    const transaction = new Transaction({ feePayer: parsed.keypair.publicKey, recentBlockhash: address(0x2a) }).add(SystemProgram.transfer({ fromPubkey: parsed.keypair.publicKey, toPubkey: new PublicKey(address(0x2b)), lamports: 1 }));
    transaction.sign(parsed.keypair); assert.doesNotThrow(() => transaction.serialize(), "the CLI-retained signer must produce a signature valid for its public key");
    const publicSummary = JSON.stringify({ endpoint: parsed.endpoint, genesis: parsed.expectedGenesisHash, commitment: parsed.commitment, signer: parsed.preflight.signer.toBase58(), proposal: parsed.preflight.addresses.proposal.toBase58(), result_hash: parsed.plan.result_hash });
    assert(!publicSummary.includes(root)); assert(!publicSummary.includes(owned)); assert(!publicSummary.includes(String(keys[0].secretKey[0]))); assert(!publicSummary.includes("secret"));

    const mutated = [...keys[0].secretKey]; mutated[32] ^= 1; writeFileSync(keyPath, JSON.stringify(mutated)); mutated.fill(0);
    assert.throws(() => parseAttestationSubmitCliInput(argv), /keypair public key does not match its private seed/);
  } finally { rmSync(owned, { recursive: true, force: true }); }
});
