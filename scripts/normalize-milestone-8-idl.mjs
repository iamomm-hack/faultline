import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const BASELINE_COMMIT = "efb47101f55180bc19009cb1a38e8d50475b014c";
const GATE_PROGRAM_ID = "9PFPNC6TMNKBCVsm4RoCgVYmqTJJTwnHHuRcysosSCCe";
const TREASURY_PROGRAM_ID = "46zDmEZAYrpwi3k6FsKFf1rPWZDbZEKM21SFzMKzb1a4";

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) throw new Error(`Missing ${name}.`);
  return process.argv[index + 1];
}

async function canonicalize(path, expectedAddress) {
  const parsed = JSON.parse(await readFile(path, "utf8"));
  if (parsed.address !== expectedAddress) throw new Error(`Generated IDL at ${path} has the wrong program ID.`);
  if (parsed.metadata?.spec !== "0.1.0") throw new Error(`Generated IDL at ${path} has the wrong schema version.`);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const destination = argument("--destination");
const gate = await canonicalize(argument("--gate"), GATE_PROGRAM_ID);
const treasury = await canonicalize(argument("--treasury"), TREASURY_PROGRAM_ID);
const provenance = `${JSON.stringify({
  schema: "faultline.public-idl-provenance.v1",
  source_commit: BASELINE_COMMIT,
  generator: "anchor-cli 0.30.1",
  rust_toolchain: "rustc 1.89.0",
  generator_compatibility_patch: "strip Anchor 0.30.1 obsolete procmacro2_semver_exempt RUSTFLAGS for locked proc-macro2 1.0.106",
  formatting: "JSON.parse plus JSON.stringify(value, null, 2) plus LF",
  programs: {
    faultline_gate: { program_id: GATE_PROGRAM_ID, sha256: sha256(gate) },
    faultline_treasury: { program_id: TREASURY_PROGRAM_ID, sha256: sha256(treasury) },
  },
}, null, 2)}\n`;

const outputs = [
  [join(destination, "idl", "faultline_gate.json"), gate],
  [join(destination, "idl", "faultline_treasury.json"), treasury],
  [join(destination, "provenance.json"), provenance],
];

if (process.argv.includes("--check")) {
  for (const [path, expected] of outputs) {
    const actual = await readFile(path, "utf8");
    if (actual !== expected) throw new Error(`${path} is not reproducible from authoritative source.`);
  }
} else {
  await mkdir(join(destination, "idl"), { recursive: true });
  for (const [path, contents] of outputs) await writeFile(path, contents, "utf8");
}
