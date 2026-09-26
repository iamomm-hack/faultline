import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { submitDirectAttestation, validateAttestationPlan, type AttestationPlan, type DirectAttestationAddresses, type DirectAttestationPreflight, type WorkerRequestBinding } from "./attestation.js";
import { asSdkError, fail } from "./errors.js";

function options(argv: readonly string[]): Map<string, string[]> {
  if (argv.length % 2 !== 0) throw new Error("options must be name/value pairs");
  const result = new Map<string, string[]>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]; if (!name.startsWith("--")) throw new Error("invalid option");
    result.set(name.slice(2), [...(result.get(name.slice(2)) ?? []), argv[index + 1]]);
  }
  return result;
}
function one(values: Map<string, string[]>, name: string): string {
  const found = values.get(name); if (!found || found.length !== 1 || found[0] === "") throw new Error(`missing --${name}`); return found[0];
}
function key(values: Map<string, string[]>, name: string): PublicKey { return new PublicKey(one(values, name)); }
function json(path: string): unknown { return JSON.parse(readFileSync(path, "utf8")); }

function loadOneKeypair(path: string, demoOwnedRun?: string): Keypair {
  const stat = lstatSync(path); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("unsafe keypair file");
  const canonical = realpathSync(path); const repository = realpathSync(process.cwd());
  if (demoOwnedRun) {
    const owned = realpathSync(demoOwnedRun); const rel = relative(owned, canonical); if (rel.startsWith("..") || resolve(owned, rel) !== canonical) throw new Error("demo key escapes owned run");
  } else {
    const rel = relative(repository, canonical); if (!rel.startsWith("..")) throw new Error("production keypair must not be repository-contained");
  }
  const bytes = JSON.parse(readFileSync(canonical, "utf8"));
  if (!Array.isArray(bytes) || bytes.length !== 64 || bytes.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) throw new Error("malformed keypair file");
  const material = Uint8Array.from(bytes);
  try {
    const keypair = Keypair.fromSeed(material.subarray(0, 32));
    if (!Buffer.from(keypair.secretKey).equals(Buffer.from(material))) fail("INVALID_INPUT", "keypair public key does not match its private seed");
    return keypair;
  } finally { material.fill(0); bytes.fill(0); }
}

export interface ParsedAttestationSubmitCliInput {
  readonly endpoint: string;
  readonly expectedGenesisHash: string;
  readonly commitment: "confirmed" | "finalized";
  readonly rpcDeadlineMilliseconds: number;
  readonly confirmationDeadlineMilliseconds: number;
  readonly keypair: Keypair;
  readonly plan: AttestationPlan;
  readonly requests: readonly WorkerRequestBinding[];
  readonly preflight: DirectAttestationPreflight;
}

export function parseAttestationSubmitCliInput(argv: readonly string[]): ParsedAttestationSubmitCliInput {
  if (argv[0] !== "attestation" || argv[1] !== "submit") throw new Error("unsupported command");
  const values = options(argv.slice(2));
  const allowed = new Set(["rpc-url", "expected-genesis-hash", "commitment", "rpc-deadline-ms", "confirmation-deadline-ms", "keypair", "demo-owned-run", "plan", "request", "raw-executable", "build-manifest", "policy", "proposal", "invariant", "trace-claim", "verifier-registry", "verifier-epoch", "verification-round", "economic-policy", "verifier-epoch-economics", "round-economics", "verifier-stake", "candidate-buffer"]);
  if ([...values.keys()].some((name) => !allowed.has(name))) throw new Error("unsupported option");
  const requestPaths = values.get("request"); if (!requestPaths || requestPaths.length !== 3) throw new Error("exactly three --request inputs are required");
  const requests = requestPaths.map((path) => json(path) as WorkerRequestBinding);
  const plan = validateAttestationPlan(json(one(values, "plan")), requests);
  const keypair = loadOneKeypair(one(values, "keypair"), values.get("demo-owned-run")?.[0]);
  const addresses: DirectAttestationAddresses = {
    policy: key(values, "policy"), proposal: key(values, "proposal"), invariant: key(values, "invariant"), traceClaim: key(values, "trace-claim"), verifierRegistry: key(values, "verifier-registry"), verifierEpoch: key(values, "verifier-epoch"), verificationRound: key(values, "verification-round"), economicPolicy: key(values, "economic-policy"), verifierEpochEconomics: key(values, "verifier-epoch-economics"), roundEconomics: key(values, "round-economics"), verifierStake: key(values, "verifier-stake"), candidateBuffer: key(values, "candidate-buffer"),
  };
  const manifest = json(one(values, "build-manifest")) as Record<string, unknown>;
  const rpcDeadline = Number(one(values, "rpc-deadline-ms")); const confirmationDeadline = Number(one(values, "confirmation-deadline-ms"));
  if (!Number.isSafeInteger(rpcDeadline) || rpcDeadline < 1 || rpcDeadline > 30_000 || !Number.isSafeInteger(confirmationDeadline) || confirmationDeadline < 1 || confirmationDeadline > 90_000) throw new Error("invalid deadline");
  const commitment = one(values, "commitment"); if (commitment !== "confirmed" && commitment !== "finalized") throw new Error("invalid commitment");
  const endpoint = one(values, "rpc-url"); const expectedGenesisHash = one(values, "expected-genesis-hash");
  const preflight = { plan, requests, signer: keypair.publicKey, addresses, rawExecutable: readFileSync(one(values, "raw-executable")), manifestExecutableSha256: String(manifest.executable_sha256) };
  return Object.freeze({ endpoint, expectedGenesisHash, commitment, rpcDeadlineMilliseconds: rpcDeadline, confirmationDeadlineMilliseconds: confirmationDeadline, keypair, plan, requests: Object.freeze(requests), preflight });
}

export async function runAttestationSubmitCli(argv: readonly string[]): Promise<unknown> {
  const parsed = parseAttestationSubmitCliInput(argv);
  const connection = new Connection(parsed.endpoint, parsed.commitment);
  const result = await submitDirectAttestation(connection, { endpoint: parsed.endpoint, genesisHash: parsed.expectedGenesisHash, commitment: parsed.commitment, timeoutMilliseconds: parsed.rpcDeadlineMilliseconds }, parsed.keypair, parsed.preflight, parsed.confirmationDeadlineMilliseconds);
  return { status: "ok", command: "attestation submit", result: { verifier: parsed.keypair.publicKey.toBase58(), transaction_signature: result.signature, confirmation_slot: result.slot, result_hash: result.evidence.resultHash, receipt_hash: result.evidence.receiptHash, executable_sha256: result.evidence.executableSha256, automatic_retries: 0 } };
}

async function main(): Promise<void> {
  try { process.stdout.write(`${JSON.stringify(await runAttestationSubmitCli(process.argv.slice(2)))}\n`); }
  catch (error) { const safe = asSdkError(error); process.stderr.write(`${safe.code}: ${safe.message}\n`); process.exitCode = 20; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
