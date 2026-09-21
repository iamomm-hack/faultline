import { PublicKey } from "@solana/web3.js";
import { U64_MAX } from "./constants.js";
import { fail } from "./errors.js";

export type PublicKeyInput = PublicKey | string;

export function publicKey(value: unknown, label = "public key"): PublicKey {
  if (value instanceof PublicKey) return value;
  if (typeof value !== "string") fail("INVALID_INPUT", `${label} must be a public key`);
  try {
    const parsed = new PublicKey(value);
    if (parsed.toBase58() !== value) fail("INVALID_INPUT", `${label} is not canonical`);
    return parsed;
  } catch {
    fail("INVALID_INPUT", `${label} is malformed`);
  }
}

export function fixedBytes(value: Uint8Array, length: number, label: string): Buffer {
  if (!(value instanceof Uint8Array) || value.byteLength !== length) {
    fail("INVALID_INPUT", `${label} must contain exactly ${length} bytes`);
  }
  return Buffer.from(value);
}

export function hash32(value: Uint8Array, label = "hash"): Buffer {
  return fixedBytes(value, 32, label);
}

export function u64(value: bigint, label = "u64"): bigint {
  if (typeof value !== "bigint" || value < 0n || value > U64_MAX) {
    fail("INVALID_INPUT", `${label} must be an unsigned 64-bit bigint`);
  }
  return value;
}

export function u64le(value: bigint, label = "u64"): Buffer {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(u64(value, label));
  return bytes;
}

export function exactObject(
  value: unknown,
  keys: readonly string[],
  label: string
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("SCHEMA_INVALID", `${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("SCHEMA_INVALID", `${label} has an invalid field set`);
  }
  return record;
}

export function canonicalHashHex(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    fail("SCHEMA_INVALID", `${label} must be 32-byte lowercase hexadecimal`);
  }
  return value;
}

export function unsignedDecimal(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    fail("SCHEMA_INVALID", `${label} must be a canonical unsigned decimal string`);
  }
  const parsed = BigInt(value);
  if (parsed > U64_MAX) fail("SCHEMA_INVALID", `${label} exceeds u64`);
  return value;
}

export function safeInteger(value: unknown, maximum: number, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maximum) {
    fail("SCHEMA_INVALID", `${label} must be a bounded JSON integer`);
  }
  return value;
}
