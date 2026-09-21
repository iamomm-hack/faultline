import { PublicKey, SystemProgram, TransactionInstruction, type AccountMeta } from "@solana/web3.js";
import { createHash } from "node:crypto";
import { FAULTLINE_IDL_PROVENANCE } from "@faultline/idl";
import { GATE_ACCOUNT_MAX_VECTOR_LENGTHS } from "./constants.js";
import { fail } from "./errors.js";
import { exactObject, publicKey, type PublicKeyInput, u64 } from "./validation.js";

export type IdlPrimitive =
  | "bool" | "u8" | "i8" | "u16" | "i16" | "u32" | "i32"
  | "u64" | "i64" | "u128" | "i128" | "f32" | "f64" | "bytes" | "string" | "pubkey";
export type IdlType = IdlPrimitive | { option: IdlType } | { vec: IdlType } |
  { array: [IdlType, number] } | { defined: { name: string } };
export interface IdlField { name: string; type: IdlType }
export interface IdlTypeDefinition {
  name: string;
  type: { kind: "struct"; fields: IdlField[] } | {
    kind: "enum";
    variants: Array<{ name: string; fields?: IdlType[] | IdlField[] }>;
  };
}
export interface IdlInstructionAccount {
  name: string;
  writable?: boolean;
  signer?: boolean;
  address?: string;
  accounts?: IdlInstructionAccount[];
}
export interface IdlInstruction {
  name: string;
  discriminator: number[];
  accounts: IdlInstructionAccount[];
  args: IdlField[];
}
export interface FaultlineIdl {
  address: string;
  metadata: { name: string; version: string; spec: string; description?: string };
  instructions: IdlInstruction[];
  accounts?: Array<{ name: string; discriminator: number[] }>;
  types?: IdlTypeDefinition[];
  errors?: Array<{ code: number; name: string; msg?: string }>;
}
export type AnchorIdl = FaultlineIdl;

function assertIdlIntegrity(idl: FaultlineIdl): void {
  if (idl.metadata.spec !== "0.1.0") fail("INVALID_IDL", "IDL schema version is incompatible");
  const expected = idl.address === FAULTLINE_IDL_PROVENANCE.programs.faultline_gate.program_id
    ? FAULTLINE_IDL_PROVENANCE.programs.faultline_gate.sha256
    : idl.address === FAULTLINE_IDL_PROVENANCE.programs.faultline_treasury.program_id
      ? FAULTLINE_IDL_PROVENANCE.programs.faultline_treasury.sha256
      : undefined;
  if (!expected) fail("INVALID_PROGRAM_ID", "IDL program ID is not a Faultline program");
  const actual = createHash("sha256").update(`${JSON.stringify(idl, null, 2)}\n`).digest("hex");
  if (actual !== expected) fail("INVALID_IDL", "IDL bytes do not match packaged provenance");
}

export interface EncodedAccount {
  address: PublicKeyInput;
  owner: PublicKeyInput;
  data: Uint8Array;
}

export type DecodedValue = boolean | number | bigint | string | PublicKey | Buffer |
  null | DecodedValue[] | { readonly [key: string]: DecodedValue };

class Cursor {
  offset = 0;
  readonly data: Buffer;

  constructor(data: Uint8Array) { this.data = Buffer.from(data); }
  read(length: number, label: string): Buffer {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.data.length) {
      fail("INVALID_ACCOUNT_DATA", `${label} is truncated`);
    }
    const value = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }
}

const integerWidth = (type: string): number | undefined => ({
  u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4,
  u64: 8, i64: 8, u128: 16, i128: 16, f32: 4, f64: 8
} as Record<string, number>)[type];

function typeDefinition(idl: FaultlineIdl, name: string): IdlTypeDefinition {
  const definition = idl.types?.find((candidate) => candidate.name === name);
  if (!definition) fail("INVALID_IDL", `IDL type ${name} is missing`);
  return definition;
}

function decodeInteger(cursor: Cursor, type: string, label: string): number | bigint {
  const width = integerWidth(type);
  if (!width) fail("INVALID_IDL", `Unsupported integer type ${type}`);
  const bytes = cursor.read(width, label);
  switch (type) {
    case "u8": return bytes.readUInt8();
    case "i8": return bytes.readInt8();
    case "u16": return bytes.readUInt16LE();
    case "i16": return bytes.readInt16LE();
    case "u32": return bytes.readUInt32LE();
    case "i32": return bytes.readInt32LE();
    case "u64": return bytes.readBigUInt64LE();
    case "i64": return bytes.readBigInt64LE();
    case "u128": return bytes.readBigUInt64LE(0) | (bytes.readBigUInt64LE(8) << 64n);
    case "i128": {
      const unsigned = bytes.readBigUInt64LE(0) | (bytes.readBigUInt64LE(8) << 64n);
      return unsigned >= (1n << 127n) ? unsigned - (1n << 128n) : unsigned;
    }
    case "f32": return bytes.readFloatLE();
    case "f64": return bytes.readDoubleLE();
    default: fail("INVALID_IDL", `Unsupported integer type ${type}`);
  }
}

function decodeType(idl: FaultlineIdl, type: IdlType, cursor: Cursor, path: string): DecodedValue {
  if (typeof type === "string") {
    if (integerWidth(type)) return decodeInteger(cursor, type, path);
    if (type === "bool") {
      const value = cursor.read(1, path)[0];
      if (value !== 0 && value !== 1) fail("INVALID_ACCOUNT_DATA", `${path} has an invalid bool`);
      return value === 1;
    }
    if (type === "pubkey") return new PublicKey(cursor.read(32, path));
    if (type === "bytes" || type === "string") {
      const length = cursor.read(4, path).readUInt32LE();
      const value = cursor.read(length, path);
      if (type === "bytes") return Buffer.from(value);
      try { return new TextDecoder("utf-8", { fatal: true }).decode(value); }
      catch { fail("INVALID_ACCOUNT_DATA", `${path} is not UTF-8`); }
    }
    fail("INVALID_IDL", `Unsupported IDL primitive ${type}`);
  }
  if ("option" in type) {
    const tag = cursor.read(1, path)[0];
    if (tag === 0) return null;
    if (tag !== 1) fail("INVALID_ACCOUNT_DATA", `${path} has an invalid option tag`);
    return decodeType(idl, type.option, cursor, path);
  }
  if ("vec" in type) {
    const length = cursor.read(4, path).readUInt32LE();
    const bound = GATE_ACCOUNT_MAX_VECTOR_LENGTHS[path];
    if (bound === undefined || length > bound) fail("INVALID_ACCOUNT_DATA", `${path} has an invalid vector length`);
    return Array.from({ length }, (_, index) => decodeType(idl, type.vec, cursor, `${path}[${index}]`));
  }
  if ("array" in type) {
    const [element, length] = type.array;
    if (!Number.isSafeInteger(length) || length < 0) fail("INVALID_IDL", `${path} has an invalid array length`);
    if (element === "u8") return Buffer.from(cursor.read(length, path));
    return Array.from({ length }, (_, index) => decodeType(idl, element, cursor, `${path}[${index}]`));
  }
  return decodeDefined(idl, type.defined.name, cursor, path);
}

function decodeDefined(idl: FaultlineIdl, name: string, cursor: Cursor, path: string): DecodedValue {
  const definition = typeDefinition(idl, name);
  if (definition.type.kind === "struct") {
    const result: Record<string, DecodedValue> = {};
    for (const field of definition.type.fields) {
      result[field.name] = decodeType(idl, field.type, cursor, `${path}.${field.name}`);
    }
    return Object.freeze(result);
  }
  const variantIndex = cursor.read(1, path)[0];
  const variant = definition.type.variants[variantIndex];
  if (!variant) fail("INVALID_ENUM", `${path} has an invalid enum value`);
  if (!variant.fields) return Object.freeze({ kind: variant.name });
  const named = variant.fields.length > 0 && !Array.isArray((variant.fields as IdlField[])[0]?.type) &&
    typeof (variant.fields as IdlField[])[0] === "object" && "name" in (variant.fields as IdlField[])[0];
  if (named) {
    const fields: Record<string, DecodedValue> = {};
    for (const field of variant.fields as IdlField[]) {
      fields[field.name] = decodeType(idl, field.type, cursor, `${path}.${variant.name}.${field.name}`);
    }
    return Object.freeze({ kind: variant.name, fields: Object.freeze(fields) });
  }
  return Object.freeze({
    kind: variant.name,
    fields: (variant.fields as IdlType[]).map((field, index) =>
      decodeType(idl, field, cursor, `${path}.${variant.name}[${index}]`))
  });
}

function maxSpan(idl: FaultlineIdl, type: IdlType, path: string): number {
  if (typeof type === "string") {
    const width = integerWidth(type);
    if (width) return width;
    if (type === "bool") return 1;
    if (type === "pubkey") return 32;
    fail("INVALID_IDL", `Unbounded type ${type} is not valid in ${path}`);
  }
  if ("option" in type) return 1 + maxSpan(idl, type.option, path);
  if ("vec" in type) {
    const length = GATE_ACCOUNT_MAX_VECTOR_LENGTHS[path];
    if (length === undefined) fail("INVALID_IDL", `Missing vector bound for ${path}`);
    return 4 + length * maxSpan(idl, type.vec, `${path}[]`);
  }
  if ("array" in type) return type.array[1] * maxSpan(idl, type.array[0], `${path}[]`);
  const definition = typeDefinition(idl, type.defined.name);
  if (definition.type.kind === "struct") {
    return definition.type.fields.reduce((size, field) => size + maxSpan(idl, field.type, `${path}.${field.name}`), 0);
  }
  return 1 + Math.max(0, ...definition.type.variants.map((variant) => {
    if (!variant.fields) return 0;
    return variant.fields.reduce((size, field) => {
      const fieldType = typeof field === "object" && "type" in field ? field.type : field as IdlType;
      return size + maxSpan(idl, fieldType, `${path}.${variant.name}`);
    }, 0);
  }));
}

export function accountSize(idl: FaultlineIdl, accountName: string): number {
  assertIdlIntegrity(idl);
  if (!idl.accounts?.some((account) => account.name === accountName)) {
    fail("INVALID_IDL", "Requested IDL account is missing");
  }
  return 8 + maxSpan(idl, { defined: { name: accountName } }, accountName);
}

export function decodeAccount(
  idl: FaultlineIdl,
  accountName: string,
  account: EncodedAccount,
  expectedAddress?: PublicKeyInput
): Readonly<Record<string, DecodedValue>> {
  assertIdlIntegrity(idl);
  const programId = publicKey(idl.address, "IDL program ID");
  const owner = publicKey(account.owner, "account owner");
  if (!owner.equals(programId)) fail("INVALID_ACCOUNT_OWNER", `${accountName} has the wrong owner`);
  const address = publicKey(account.address, "account address");
  if (expectedAddress && !address.equals(publicKey(expectedAddress, "expected account address"))) {
    fail("INVALID_PDA", `${accountName} has the wrong PDA`);
  }
  const data = Buffer.from(account.data);
  const expectedSize = accountSize(idl, accountName);
  if (data.length !== expectedSize) fail("INVALID_ACCOUNT_DATA", `${accountName} has the wrong size`);
  const accountDefinition = idl.accounts?.find((candidate) => candidate.name === accountName);
  const discriminator = Buffer.from(accountDefinition?.discriminator ?? []);
  if (discriminator.length !== 8 || !data.subarray(0, 8).equals(discriminator)) {
    fail("INVALID_DISCRIMINATOR", `${accountName} has the wrong discriminator`);
  }
  const cursor = new Cursor(data);
  cursor.offset = 8;
  const decoded = decodeDefined(idl, accountName, cursor, accountName);
  if (decoded === null || Array.isArray(decoded) || Buffer.isBuffer(decoded) || typeof decoded !== "object") {
    fail("INVALID_IDL", `${accountName} is not a struct`);
  }
  if (data.subarray(cursor.offset).some((byte) => byte !== 0)) {
    fail("INVALID_ACCOUNT_DATA", `${accountName} has nonzero trailing account padding`);
  }
  return decoded as Readonly<Record<string, DecodedValue>>;
}

function encodeInteger(type: string, value: unknown, label: string): Buffer {
  const width = integerWidth(type);
  if (!width) fail("INVALID_IDL", `Unsupported integer type ${type}`);
  const out = Buffer.alloc(width);
  if (type.startsWith("u")) {
    const bits = BigInt(width * 8);
    const parsed = typeof value === "bigint" ? value :
      typeof value === "number" && Number.isSafeInteger(value) ? BigInt(value) : fail("INVALID_INPUT", `${label} must be an exact integer`);
    if (parsed < 0n || parsed >= (1n << bits)) fail("INVALID_INPUT", `${label} is out of range`);
    if (width <= 4) out.writeUIntLE(Number(parsed), 0, width);
    else if (width === 8) out.writeBigUInt64LE(parsed);
    else { out.writeBigUInt64LE(parsed & ((1n << 64n) - 1n), 0); out.writeBigUInt64LE(parsed >> 64n, 8); }
    return out;
  }
  fail("INVALID_IDL", `Instruction encoding does not support ${type}`);
}

function encodeType(idl: FaultlineIdl, type: IdlType, value: unknown, path: string): Buffer {
  if (typeof type === "string") {
    if (integerWidth(type)) return encodeInteger(type, value, path);
    if (type === "bool") {
      if (typeof value !== "boolean") fail("INVALID_INPUT", `${path} must be boolean`);
      return Buffer.from([value ? 1 : 0]);
    }
    if (type === "pubkey") return publicKey(value as PublicKeyInput, path).toBuffer();
    if (type === "bytes" || type === "string") {
      const bytes = type === "string" && typeof value === "string" ? Buffer.from(value, "utf8") :
        value instanceof Uint8Array ? Buffer.from(value) : fail("INVALID_INPUT", `${path} has the wrong type`);
      const length = Buffer.alloc(4); length.writeUInt32LE(bytes.length);
      return Buffer.concat([length, bytes]);
    }
    fail("INVALID_IDL", `Unsupported IDL primitive ${type}`);
  }
  if ("option" in type) return value === null || value === undefined ? Buffer.from([0]) :
    Buffer.concat([Buffer.from([1]), encodeType(idl, type.option, value, path)]);
  if ("vec" in type) {
    if (!Array.isArray(value)) fail("INVALID_INPUT", `${path} must be an array`);
    const length = Buffer.alloc(4); length.writeUInt32LE(value.length);
    return Buffer.concat([length, ...value.map((entry, index) => encodeType(idl, type.vec, entry, `${path}[${index}]`))]);
  }
  if ("array" in type) {
    const [element, length] = type.array;
    if (element === "u8" && value instanceof Uint8Array) {
      if (value.length !== length) fail("INVALID_INPUT", `${path} has the wrong length`);
      return Buffer.from(value);
    }
    if (!Array.isArray(value) || value.length !== length) fail("INVALID_INPUT", `${path} has the wrong length`);
    return Buffer.concat(value.map((entry, index) => encodeType(idl, element, entry, `${path}[${index}]`)));
  }
  const definition = typeDefinition(idl, type.defined.name);
  if (definition.type.kind === "struct") {
    const record = exactObject(value, definition.type.fields.map((field) => field.name), path);
    return Buffer.concat(definition.type.fields.map((field) => encodeType(idl, field.type, record[field.name], `${path}.${field.name}`)));
  }
  const record = value as Record<string, unknown>;
  if (!record || typeof record !== "object" || typeof record.kind !== "string") fail("INVALID_INPUT", `${path} must be an enum`);
  const index = definition.type.variants.findIndex((variant) => variant.name === record.kind);
  if (index < 0) fail("INVALID_ENUM", `${path} has an invalid enum value`);
  const variant = definition.type.variants[index];
  if (variant.fields) fail("INVALID_IDL", `Enum payload encoding is not implemented for ${path}`);
  return Buffer.from([index]);
}

interface FlatAccount extends IdlInstructionAccount { path: string }
function flattenAccounts(accounts: IdlInstructionAccount[], prefix = ""): FlatAccount[] {
  return accounts.flatMap((account) => {
    const path = prefix ? `${prefix}.${account.name}` : account.name;
    return account.accounts ? flattenAccounts(account.accounts, path) : [{ ...account, path }];
  });
}

export interface BuildIdlInstructionInput {
  idl: FaultlineIdl;
  name: string;
  programId: PublicKeyInput;
  accounts: Readonly<Record<string, PublicKeyInput>>;
  args: Readonly<Record<string, unknown>>;
}

export interface InstructionBindingSummary {
  readonly programId: string;
  readonly instructionName: string;
  readonly accounts: readonly Readonly<{ path: string; publicKey: string; isSigner: boolean; isWritable: boolean }>[];
  readonly dataSha256: string;
}
export type BuiltInstruction = TransactionInstruction & { readonly bindingSummary: InstructionBindingSummary };

export function buildIdlInstruction(input: BuildIdlInstructionInput): BuiltInstruction {
  assertIdlIntegrity(input.idl);
  const idlProgram = publicKey(input.idl.address, "IDL program ID");
  const suppliedProgram = publicKey(input.programId, "instruction program ID");
  if (!suppliedProgram.equals(idlProgram)) fail("INVALID_PROGRAM_ID", "Instruction program ID does not match IDL");
  const instruction = input.idl.instructions.find((candidate) => candidate.name === input.name);
  if (!instruction) fail("INVALID_INSTRUCTION", "Unknown instruction");
  const flat = flattenAccounts(instruction.accounts);
  exactObject(input.accounts, flat.map((account) => account.path), `${input.name}.accounts`);
  exactObject(input.args, instruction.args.map((arg) => arg.name), `${input.name}.args`);
  const keys: AccountMeta[] = flat.map((account) => {
    const pubkey = publicKey(input.accounts[account.path], `${input.name}.${account.path}`);
    if (account.address && !pubkey.equals(publicKey(account.address, `${account.path} fixed address`))) {
      fail("INVALID_INSTRUCTION", `${account.path} does not match its fixed address`);
    }
    return { pubkey, isSigner: account.signer === true, isWritable: account.writable === true };
  });
  const discriminator = Buffer.from(instruction.discriminator);
  if (discriminator.length !== 8) fail("INVALID_IDL", `${input.name} has an invalid discriminator`);
  const args = instruction.args.map((arg) => encodeType(input.idl, arg.type, input.args[arg.name], `${input.name}.${arg.name}`));
  const data = Buffer.concat([discriminator, ...args]);
  const built = new TransactionInstruction({ programId: suppliedProgram, keys, data }) as BuiltInstruction;
  const accounts = Object.freeze(flat.map((account, index) => Object.freeze({
    path: account.path,
    publicKey: keys[index].pubkey.toBase58(),
    isSigner: keys[index].isSigner,
    isWritable: keys[index].isWritable,
  })));
  Object.defineProperty(built, "bindingSummary", { enumerable: true, writable: false, configurable: false, value: Object.freeze({
    programId: suppliedProgram.toBase58(), instructionName: input.name, accounts,
    dataSha256: createHash("sha256").update(data).digest("hex"),
  }) });
  return built;
}

export function systemProgram(): PublicKey { return SystemProgram.programId; }
