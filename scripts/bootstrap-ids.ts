import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@solana/web3.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stateDir = join(root, ".localnet");
mkdirSync(stateDir, { recursive: true });

const names = [
  "payer",
  "governance",
  "proposer",
  "random",
  "treasury-admin",
  "attacker",
  "user",
  "new-admin",
  "payment-mint",
  "wrong-payment-mint",
  "treasury-vault-token",
  "user-token",
  "attacker-token",
  "admin-token",
  "new-admin-token",
  "wrong-vault-token",
  "wrong-user-token",
  "faultline-gate-program",
  "faultline-treasury-program",
  "candidate-approved",
  "candidate-rejected",
  "candidate-spare",
  "candidate-v2",
  "candidate-v3"
] as const;

type KeyName = (typeof names)[number];
const keys = {} as Record<KeyName, Keypair>;
for (const name of names) {
  const path = join(stateDir, `${name}.json`);
  const keypair = existsSync(path)
    ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))))
    : Keypair.generate();
  if (!existsSync(path)) {
    writeFileSync(path, `${JSON.stringify(Array.from(keypair.secretKey))}\n`, { mode: 0o600 });
  }
  keys[name] = keypair;
}

const ids = Object.fromEntries(names.map((name) => [name, keys[name].publicKey.toBase58()]));
writeFileSync(join(stateDir, "ids.json"), `${JSON.stringify(ids, null, 2)}\n`);

function replaceDeclareId(relativePath: string, programId: string): void {
  const path = join(root, relativePath);
  const source = readFileSync(path, "utf8");
  const next = source.replace(/declare_id!\("[1-9A-HJ-NP-Za-km-z]+"\);/, `declare_id!("${programId}");`);
  if (next === source && !source.includes(`declare_id!("${programId}");`)) {
    throw new Error(`Could not synchronize declare_id in ${relativePath}`);
  }
  writeFileSync(path, next);
}

replaceDeclareId("programs/faultline_gate/src/lib.rs", ids["faultline-gate-program"]);
replaceDeclareId("programs/faultline_treasury/src/lib.rs", ids["faultline-treasury-program"]);

const anchorPath = join(root, "Anchor.toml");
let anchor = readFileSync(anchorPath, "utf8");
anchor = anchor.replace(/faultline_gate = "[^"]+"/, `faultline_gate = "${ids["faultline-gate-program"]}"`);
anchor = anchor.replace(/faultline_treasury = "[^"]+"/, `faultline_treasury = "${ids["faultline-treasury-program"]}"`);
writeFileSync(anchorPath, anchor);

const fingerprint = createHash("sha256")
  .update(ids["faultline-gate-program"])
  .update(ids["faultline-treasury-program"])
  .digest("hex");
console.log(`Synchronized local program IDs (fingerprint ${fingerprint.slice(0, 16)})`);
console.log(`Faultline gate: ${ids["faultline-gate-program"]}`);
console.log(`Treasury:       ${ids["faultline-treasury-program"]}`);
