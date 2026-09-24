import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  AccountMeta,
  Commitment,
  Connection,
  Keypair,
  PublicKey,
  SendTransactionError,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction
} from "@solana/web3.js";

export const ROOT = resolve(import.meta.dirname, "..", "..");
export const RPC_URL = process.env.FAULTLINE_RPC_URL ?? "http://127.0.0.1:8899";
export const LOADER_V3 = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
export const LOADER_V3_BUFFER_METADATA_SIZE = 37;
export const SYSVAR_RENT = new PublicKey("SysvarRent111111111111111111111111111111111");
export const SYSVAR_CLOCK = new PublicKey("SysvarC1ock11111111111111111111111111111111");
export const COMMITMENT: Commitment = "confirmed";

export type LocalIds = Record<string, string>;

export function loadIds(): LocalIds {
  return JSON.parse(readFileSync(join(ROOT, ".localnet", "ids.json"), "utf8"));
}

export function loadKeypair(name: string): Keypair {
  const bytes = JSON.parse(readFileSync(join(ROOT, ".localnet", `${name}.json`), "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

export function discriminator(namespace: "global" | "account", name: string): Buffer {
  return createHash("sha256").update(`${namespace}:${name}`).digest().subarray(0, 8);
}

export function anchorInstruction(
  programId: PublicKey,
  name: string,
  keys: AccountMeta[],
  args: Buffer = Buffer.alloc(0)
): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys,
    data: Buffer.concat([discriminator("global", name), args])
  });
}

export async function send(
  connection: Connection,
  instruction: TransactionInstruction,
  feePayer: Keypair,
  signers: Keypair[] = []
): Promise<string> {
  return sendAndConfirmTransaction(connection, new Transaction().add(instruction), [feePayer, ...signers], {
    commitment: COMMITMENT,
    preflightCommitment: COMMITMENT
  });
}

export async function sendExpectingOnchainFailure(
  connection: Connection,
  instruction: TransactionInstruction,
  feePayer: Keypair,
  label: string,
  expectedEvidence: RegExp,
  signers: Keypair[] = []
): Promise<string> {
  const latest = await connection.getLatestBlockhash(COMMITMENT);
  const transaction = new Transaction({
    feePayer: feePayer.publicKey,
    recentBlockhash: latest.blockhash
  }).add(instruction);
  transaction.sign(feePayer, ...signers);
  const signature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: true });
  const confirmation = await connection.confirmTransaction(
    { signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
    COMMITMENT
  );
  if (!confirmation.value.err) throw new Error(`Expected onchain failure did not occur: ${label}`);
  const result = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0
  });
  const logs = result?.meta?.logMessages ?? [];
  const evidence = logs.join("\n");
  if (!expectedEvidence.test(evidence)) {
    throw new Error(`Onchain failure for ${label} did not contain ${expectedEvidence}:\n${evidence}`);
  }
  const decisiveLog = [...logs].reverse().find((line) => line.includes("authority")) ?? String(confirmation.value.err);
  console.log(`EXPECTED ONCHAIN FAILURE [${label}] ${signature}: ${decisiveLog}`);
  return signature;
}

export async function expectFailure(
  label: string,
  operation: () => Promise<unknown>,
  expectedEvidence?: RegExp
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    const logs = error instanceof SendTransactionError ? (error.logs ?? []) : [];
    const detail =
      error instanceof SendTransactionError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    const completeEvidence = [detail, ...logs].join("\n");
    if (expectedEvidence && !expectedEvidence.test(completeEvidence)) {
      throw new Error(`Failure for ${label} did not contain ${expectedEvidence}:\n${completeEvidence}`);
    }
    const decisiveLog = [...logs]
      .reverse()
      .find((line) => line.includes("authority") || line.includes("AnchorError") || line.includes("Program log:"));
    console.log(`EXPECTED FAILURE [${label}]: ${decisiveLog ?? detail.split("\n")[0]}`);
    return;
  }
  throw new Error(`Expected failure did not occur: ${label}`);
}

export function programDataAddress(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([programId.toBuffer()], LOADER_V3)[0];
}

export async function loaderAuthority(
  connection: Connection,
  account: PublicKey,
  expectedVariant: 1 | 3
): Promise<PublicKey> {
  const authority = await loaderAuthorityOptional(connection, account, expectedVariant);
  if (!authority) throw new Error(`${account.toBase58()} has no authority`);
  return authority;
}

export async function loaderAuthorityOptional(
  connection: Connection,
  account: PublicKey,
  expectedVariant: 1 | 3
): Promise<PublicKey | null> {
  const info = await connection.getAccountInfo(account, COMMITMENT);
  if (!info) throw new Error(`Missing loader account ${account.toBase58()}`);
  if (!info.owner.equals(LOADER_V3)) throw new Error(`${account.toBase58()} is not owned by loader-v3`);
  const variant = info.data.readUInt32LE(0);
  if (variant !== expectedVariant) throw new Error(`Unexpected loader state ${variant} for ${account.toBase58()}`);
  const optionOffset = variant === 1 ? 4 : 12;
  if (info.data[optionOffset] === 0) return null;
  if (info.data[optionOffset] !== 1) throw new Error(`${account.toBase58()} has an invalid authority option`);
  return new PublicKey(info.data.subarray(optionOffset + 1, optionOffset + 33));
}

export function loaderBufferPayload(info: { owner: PublicKey; data: Buffer }): Buffer {
  if (!info.owner.equals(LOADER_V3)) throw new Error("candidate buffer is not owned by loader-v3");
  if (info.data.length < LOADER_V3_BUFFER_METADATA_SIZE) throw new Error("candidate buffer metadata is truncated");
  if (info.data.readUInt32LE(0) !== 1) throw new Error("candidate loader state is not Buffer");
  return info.data.subarray(LOADER_V3_BUFFER_METADATA_SIZE);
}

export function loaderBufferExecutableHash(info: { owner: PublicKey; data: Buffer }): Buffer {
  return createHash("sha256").update(loaderBufferPayload(info)).digest();
}

export function setLoaderAuthorityInstruction(
  account: PublicKey,
  currentAuthority: PublicKey,
  newAuthority: PublicKey
): TransactionInstruction {
  const data = Buffer.alloc(4);
  data.writeUInt32LE(4, 0); // UpgradeableLoaderInstruction::SetAuthority
  return new TransactionInstruction({
    programId: LOADER_V3,
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: currentAuthority, isSigner: true, isWritable: false },
      { pubkey: newAuthority, isSigner: false, isWritable: false }
    ],
    data
  });
}

export function loaderUpgradeInstruction(
  targetProgram: PublicKey,
  buffer: PublicKey,
  authority: PublicKey,
  spill: PublicKey
): TransactionInstruction {
  const data = Buffer.alloc(4);
  data.writeUInt32LE(3, 0); // UpgradeableLoaderInstruction::Upgrade
  return new TransactionInstruction({
    programId: LOADER_V3,
    keys: [
      { pubkey: programDataAddress(targetProgram), isSigner: false, isWritable: true },
      { pubkey: targetProgram, isSigner: false, isWritable: true },
      { pubkey: buffer, isSigner: false, isWritable: true },
      { pubkey: spill, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_RENT, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK, isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: true, isWritable: false }
    ],
    data
  });
}

export function loaderWriteInstruction(
  buffer: PublicKey,
  authority: PublicKey,
  bytes: Buffer
): TransactionInstruction {
  const data = Buffer.alloc(16 + bytes.length);
  data.writeUInt32LE(1, 0); // UpgradeableLoaderInstruction::Write
  data.writeUInt32LE(0, 4); // offset
  data.writeBigUInt64LE(BigInt(bytes.length), 8); // bincode Vec length
  bytes.copy(data, 16);
  return new TransactionInstruction({
    programId: LOADER_V3,
    keys: [
      { pubkey: buffer, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false }
    ],
    data
  });
}
