import { PublicKey } from "@solana/web3.js";
import { fail } from "./errors.js";
import { canonicalHashHex, exactObject, safeInteger, unsignedDecimal } from "./validation.js";

export type ReplayClassification =
  | "Preserved" | "Violated" | "InvalidEvidence" | "UnsupportedEnvironment"
  | "RunnerFault" | "WorkerDisagreement";

export interface StableRuntimeError {
  instruction_index: number;
  kind: "custom" | "builtin";
  code: number | string;
}
export interface ReplayTransactionResult {
  index: number;
  status: "success" | "error";
  error: StableRuntimeError | null;
  compute_units: number;
  return_data_sha256: string | null;
  logs_sha256: string;
}
export interface StateHash { selector_id: string; sha256: string }
export interface ReplayReceipt {
  schema: "faultline.replay-receipt.v1";
  canonicalization: "faultline.canonical-json.v1";
  replay_job_hash: string;
  build_manifest_hash: string;
  runner_manifest_hash: string;
  fixture_manifest_hash: string;
  invariant_manifest_hash: string;
  trace_hash: string;
  candidate_executable_sha256: string;
  engine: "litesvm";
  engine_version: "0.1.0";
  engine_source_commit: "5cda1d2dcfae16714a6ff808b58f0c087b21bd42";
  solana_runtime: "1.18.22";
  feature_set: "litesvm-0.1.0-all-enabled";
  transactions: ReplayTransactionResult[];
  pre_state_hashes: StateHash[];
  post_state_hashes: StateHash[];
  normalized_logs_sha256: string;
  classification: "Preserved" | "Violated";
  result_code: 0 | 1;
  total_compute_units: string;
}
export interface AttestationIntent {
  verification_round: string;
  proposal: string;
  invariant_account: string;
  trace_claim: string;
  verifier_pubkey: string;
  verdict_u8: 0 | 1;
  receipt_hash: string;
  replay_result_commitment: string;
}
export interface WorkerOutput {
  schema: "faultline.worker-output.v1";
  canonicalization: "faultline.canonical-json.v1";
  coordinator_nonce: string;
  worker_ordinal: 0 | 1 | 2;
  verifier_pubkey: string;
  replay_job_hash: string;
  classification: ReplayClassification;
  result_code: number;
  receipt_hash?: string;
  verdict_u8?: 0 | 1;
  replay_result_commitment?: string;
  attestation_intent?: AttestationIntent;
  process_peak_memory_bytes: string;
  elapsed_milliseconds: string;
}
export interface SignedWorkerOutput {
  schema: "faultline.signed-worker-output.v1";
  canonicalization: "faultline.canonical-json.v1";
  output: WorkerOutput;
  signature_algorithm: "solana-ed25519-sha256-v1";
  signer_pubkey: string;
  signature: string;
}

const BUILTIN_ERRORS = new Set([
  "GenericError", "InvalidArgument", "InvalidInstructionData", "InvalidAccountData",
  "AccountDataTooSmall", "InsufficientFunds", "IncorrectProgramId", "MissingRequiredSignature",
  "AccountAlreadyInitialized", "UninitializedAccount", "UnbalancedInstruction", "ModifiedProgramId",
  "ExternalAccountLamportSpend", "ExternalAccountDataModified", "ReadonlyLamportChange",
  "ReadonlyDataModified", "DuplicateAccountIndex", "ExecutableModified", "RentEpochModified",
  "NotEnoughAccountKeys", "AccountDataSizeChanged", "AccountNotExecutable", "AccountBorrowFailed",
  "AccountBorrowOutstanding", "DuplicateAccountOutOfSync", "InvalidError", "ExecutableDataModified",
  "ExecutableLamportChange", "ExecutableAccountNotRentExempt", "UnsupportedProgramId", "CallDepth",
  "MissingAccount", "ReentrancyNotAllowed", "MaxSeedLengthExceeded", "InvalidSeeds", "InvalidRealloc",
  "ComputationalBudgetExceeded", "PrivilegeEscalation", "ProgramEnvironmentSetupFailure",
  "ProgramFailedToComplete", "ProgramFailedToCompile", "Immutable", "IncorrectAuthority", "BorshIoError",
  "AccountNotRentExempt", "InvalidAccountOwner", "ArithmeticOverflow", "UnsupportedSysvar", "IllegalOwner",
  "MaxAccountsDataAllocationsExceeded", "MaxAccountsExceeded", "MaxInstructionTraceLengthExceeded",
  "BuiltinProgramsMustConsumeComputeUnits"
]);

function canonicalPublicKey(value: unknown, label: string): string {
  if (typeof value !== "string") fail("SCHEMA_INVALID", `${label} must be a public key`);
  try {
    const parsed = new PublicKey(value);
    if (parsed.toBase58() !== value) fail("SCHEMA_INVALID", `${label} is not canonical`);
    return value;
  } catch { fail("SCHEMA_INVALID", `${label} is malformed`); }
}

function exactString(value: unknown, expected: string, label: string): void {
  if (value !== expected) fail("SCHEMA_INVALID", `${label} is incompatible`);
}

function runtimeError(value: unknown, label: string): StableRuntimeError {
  const record = exactObject(value, ["instruction_index", "kind", "code"], label);
  const index = safeInteger(record.instruction_index, 65_535, `${label}.instruction_index`);
  if (record.kind === "custom") {
    return { instruction_index: index, kind: "custom", code: safeInteger(record.code, 0xffff_ffff, `${label}.code`) };
  }
  if (record.kind !== "builtin" || typeof record.code !== "string" || !BUILTIN_ERRORS.has(record.code)) {
    fail("SCHEMA_INVALID", `${label} has an invalid runtime error`);
  }
  return { instruction_index: index, kind: "builtin", code: record.code };
}

function transaction(value: unknown, expectedIndex: number): ReplayTransactionResult {
  const label = `receipt.transactions[${expectedIndex}]`;
  const record = exactObject(value, ["index", "status", "error", "compute_units", "return_data_sha256", "logs_sha256"], label);
  const index = safeInteger(record.index, 65_535, `${label}.index`);
  if (index !== expectedIndex) fail("SCHEMA_INVALID", `${label}.index is not sequential`);
  if (record.status !== "success" && record.status !== "error") fail("SCHEMA_INVALID", `${label}.status is invalid`);
  const error = record.error === null ? null : runtimeError(record.error, `${label}.error`);
  if ((record.status === "success") !== (error === null)) fail("SCHEMA_INVALID", `${label} status/error mismatch`);
  const returnHash = record.return_data_sha256 === null ? null : canonicalHashHex(record.return_data_sha256, `${label}.return_data_sha256`);
  return {
    index,
    status: record.status,
    error,
    compute_units: safeInteger(record.compute_units, 1_400_000, `${label}.compute_units`),
    return_data_sha256: returnHash,
    logs_sha256: canonicalHashHex(record.logs_sha256, `${label}.logs_sha256`)
  };
}

function stateHashes(value: unknown, label: string): StateHash[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) fail("SCHEMA_INVALID", `${label} is invalid`);
  let previous = "";
  const seen = new Set<string>();
  return value.map((entry, index) => {
    const record = exactObject(entry, ["selector_id", "sha256"], `${label}[${index}]`);
    if (typeof record.selector_id !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(record.selector_id)) {
      fail("SCHEMA_INVALID", `${label}[${index}].selector_id is invalid`);
    }
    if (record.selector_id <= previous || seen.has(record.selector_id)) fail("SCHEMA_INVALID", `${label} is not unique and sorted`);
    previous = record.selector_id; seen.add(record.selector_id);
    return { selector_id: record.selector_id, sha256: canonicalHashHex(record.sha256, `${label}[${index}].sha256`) };
  });
}

export function validateReplayReceipt(value: unknown): ReplayReceipt {
  const keys = [
    "schema", "canonicalization", "replay_job_hash", "build_manifest_hash", "runner_manifest_hash",
    "fixture_manifest_hash", "invariant_manifest_hash", "trace_hash", "candidate_executable_sha256",
    "engine", "engine_version", "engine_source_commit", "solana_runtime", "feature_set", "transactions",
    "pre_state_hashes", "post_state_hashes", "normalized_logs_sha256", "classification", "result_code",
    "total_compute_units"
  ];
  const record = exactObject(value, keys, "receipt");
  exactString(record.schema, "faultline.replay-receipt.v1", "receipt.schema");
  exactString(record.canonicalization, "faultline.canonical-json.v1", "receipt.canonicalization");
  exactString(record.engine, "litesvm", "receipt.engine");
  exactString(record.engine_version, "0.1.0", "receipt.engine_version");
  exactString(record.engine_source_commit, "5cda1d2dcfae16714a6ff808b58f0c087b21bd42", "receipt.engine_source_commit");
  exactString(record.solana_runtime, "1.18.22", "receipt.solana_runtime");
  exactString(record.feature_set, "litesvm-0.1.0-all-enabled", "receipt.feature_set");
  if (!Array.isArray(record.transactions) || record.transactions.length === 0 || record.transactions.length > 32) {
    fail("SCHEMA_INVALID", "receipt.transactions is invalid");
  }
  if (!((record.classification === "Preserved" && record.result_code === 0) ||
    (record.classification === "Violated" && record.result_code === 1))) {
    fail("SCHEMA_INVALID", "receipt classification/result code mismatch");
  }
  return {
    schema: "faultline.replay-receipt.v1", canonicalization: "faultline.canonical-json.v1",
    replay_job_hash: canonicalHashHex(record.replay_job_hash, "receipt.replay_job_hash"),
    build_manifest_hash: canonicalHashHex(record.build_manifest_hash, "receipt.build_manifest_hash"),
    runner_manifest_hash: canonicalHashHex(record.runner_manifest_hash, "receipt.runner_manifest_hash"),
    fixture_manifest_hash: canonicalHashHex(record.fixture_manifest_hash, "receipt.fixture_manifest_hash"),
    invariant_manifest_hash: canonicalHashHex(record.invariant_manifest_hash, "receipt.invariant_manifest_hash"),
    trace_hash: canonicalHashHex(record.trace_hash, "receipt.trace_hash"),
    candidate_executable_sha256: canonicalHashHex(record.candidate_executable_sha256, "receipt.candidate_executable_sha256"),
    engine: "litesvm", engine_version: "0.1.0", engine_source_commit: "5cda1d2dcfae16714a6ff808b58f0c087b21bd42",
    solana_runtime: "1.18.22", feature_set: "litesvm-0.1.0-all-enabled",
    transactions: record.transactions.map(transaction),
    pre_state_hashes: stateHashes(record.pre_state_hashes, "receipt.pre_state_hashes"),
    post_state_hashes: stateHashes(record.post_state_hashes, "receipt.post_state_hashes"),
    normalized_logs_sha256: canonicalHashHex(record.normalized_logs_sha256, "receipt.normalized_logs_sha256"),
    classification: record.classification, result_code: record.result_code,
    total_compute_units: unsignedDecimal(record.total_compute_units, "receipt.total_compute_units")
  };
}

export function validateAttestationIntent(value: unknown): AttestationIntent {
  const record = exactObject(value, ["verification_round", "proposal", "invariant_account", "trace_claim", "verifier_pubkey", "verdict_u8", "receipt_hash", "replay_result_commitment"], "attestation_intent");
  const verdict = safeInteger(record.verdict_u8, 1, "attestation_intent.verdict_u8") as 0 | 1;
  return {
    verification_round: canonicalPublicKey(record.verification_round, "attestation_intent.verification_round"),
    proposal: canonicalPublicKey(record.proposal, "attestation_intent.proposal"),
    invariant_account: canonicalPublicKey(record.invariant_account, "attestation_intent.invariant_account"),
    trace_claim: canonicalPublicKey(record.trace_claim, "attestation_intent.trace_claim"),
    verifier_pubkey: canonicalPublicKey(record.verifier_pubkey, "attestation_intent.verifier_pubkey"),
    verdict_u8: verdict,
    receipt_hash: canonicalHashHex(record.receipt_hash, "attestation_intent.receipt_hash"),
    replay_result_commitment: canonicalHashHex(record.replay_result_commitment, "attestation_intent.replay_result_commitment")
  };
}

export function validateWorkerOutput(value: unknown): WorkerOutput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("SCHEMA_INVALID", "worker output must be an object");
  const source = value as Record<string, unknown>;
  const eligible = source.classification === "Preserved" || source.classification === "Violated";
  const base = ["schema", "canonicalization", "coordinator_nonce", "worker_ordinal", "verifier_pubkey", "replay_job_hash", "classification", "result_code", "process_peak_memory_bytes", "elapsed_milliseconds"];
  const record = exactObject(value, eligible ? [...base, "receipt_hash", "verdict_u8", "replay_result_commitment", "attestation_intent"] : base, "worker output");
  exactString(record.schema, "faultline.worker-output.v1", "worker.schema");
  exactString(record.canonicalization, "faultline.canonical-json.v1", "worker.canonicalization");
  const ordinal = safeInteger(record.worker_ordinal, 2, "worker.worker_ordinal") as 0 | 1 | 2;
  const classification = record.classification as ReplayClassification;
  const resultCode = safeInteger(record.result_code, 0xffff_ffff, "worker.result_code");
  const expectedVerdict = classification === "Preserved" && resultCode === 0 ? 0 : classification === "Violated" && resultCode === 1 ? 1 : undefined;
  const validIneligible =
    (classification === "InvalidEvidence" && resultCode >= 0x0001_0001 && resultCode <= 0x0001_0009) ||
    (classification === "UnsupportedEnvironment" && resultCode >= 0x0002_0001 && resultCode <= 0x0002_0005) ||
    (classification === "RunnerFault" && resultCode >= 0x0003_0001 && resultCode <= 0x0003_0007);
  if (expectedVerdict === undefined && !validIneligible) fail("SCHEMA_INVALID", "worker classification/result code mismatch");
  const common = {
    schema: "faultline.worker-output.v1" as const, canonicalization: "faultline.canonical-json.v1" as const,
    coordinator_nonce: canonicalHashHex(record.coordinator_nonce, "worker.coordinator_nonce"),
    worker_ordinal: ordinal,
    verifier_pubkey: canonicalPublicKey(record.verifier_pubkey, "worker.verifier_pubkey"),
    replay_job_hash: canonicalHashHex(record.replay_job_hash, "worker.replay_job_hash"),
    classification, result_code: resultCode,
    process_peak_memory_bytes: unsignedDecimal(record.process_peak_memory_bytes, "worker.process_peak_memory_bytes"),
    elapsed_milliseconds: unsignedDecimal(record.elapsed_milliseconds, "worker.elapsed_milliseconds")
  };
  if (expectedVerdict === undefined) return common;
  const intent = validateAttestationIntent(record.attestation_intent);
  const receipt = canonicalHashHex(record.receipt_hash, "worker.receipt_hash");
  const commitment = canonicalHashHex(record.replay_result_commitment, "worker.replay_result_commitment");
  if (record.verdict_u8 !== expectedVerdict || intent.verifier_pubkey !== common.verifier_pubkey ||
    intent.verdict_u8 !== expectedVerdict || intent.receipt_hash !== receipt || intent.replay_result_commitment !== commitment) {
    fail("SCHEMA_INVALID", "worker attestation binding mismatch");
  }
  return { ...common, receipt_hash: receipt, verdict_u8: expectedVerdict, replay_result_commitment: commitment, attestation_intent: intent };
}

export function validateSignedWorkerOutput(value: unknown): SignedWorkerOutput {
  const record = exactObject(value, ["schema", "canonicalization", "output", "signature_algorithm", "signer_pubkey", "signature"], "signed worker output");
  exactString(record.schema, "faultline.signed-worker-output.v1", "signed worker.schema");
  exactString(record.canonicalization, "faultline.canonical-json.v1", "signed worker.canonicalization");
  exactString(record.signature_algorithm, "solana-ed25519-sha256-v1", "signed worker.signature_algorithm");
  const output = validateWorkerOutput(record.output);
  const signer = canonicalPublicKey(record.signer_pubkey, "signed worker.signer_pubkey");
  if (signer !== output.verifier_pubkey) fail("SCHEMA_INVALID", "signed worker signer binding mismatch");
  if (typeof record.signature !== "string") fail("SCHEMA_INVALID", "signed worker signature is malformed");
  let signature: Uint8Array;
  try { signature = decodeBase58(record.signature); }
  catch { fail("SCHEMA_INVALID", "signed worker signature is malformed"); }
  if (signature.length !== 64 || encodeBase58(signature) !== record.signature) fail("SCHEMA_INVALID", "signed worker signature is noncanonical");
  return { schema: "faultline.signed-worker-output.v1", canonicalization: "faultline.canonical-json.v1", output,
    signature_algorithm: "solana-ed25519-sha256-v1", signer_pubkey: signer, signature: record.signature };
}

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function decodeBase58(value: string): Uint8Array {
  if (!value.length) throw new Error("empty");
  let number = 0n;
  for (const character of value) {
    const digit = BASE58_ALPHABET.indexOf(character);
    if (digit < 0) throw new Error("base58");
    number = number * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (number > 0n) { bytes.push(Number(number & 0xffn)); number >>= 8n; }
  for (const character of value) { if (character === "1") bytes.push(0); else break; }
  return Uint8Array.from(bytes.reverse());
}
function encodeBase58(value: Uint8Array): string {
  let number = 0n;
  for (const byte of value) number = (number << 8n) | BigInt(byte);
  let encoded = "";
  while (number > 0n) { encoded = BASE58_ALPHABET[Number(number % 58n)] + encoded; number /= 58n; }
  for (const byte of value) { if (byte === 0) encoded = `1${encoded}`; else break; }
  return encoded || "1";
}
