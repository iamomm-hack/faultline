import { Message, Transaction, type PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { MAX_SERIALIZED_TRANSACTION_BYTES } from "./constants.js";
import { fail } from "./errors.js";

export interface UnsignedLegacyTransactionInput {
  readonly feePayer: PublicKey;
  readonly recentBlockhash: string;
  readonly instructions: readonly TransactionInstruction[];
  readonly addressLookupTables?: readonly unknown[];
}
export interface TransactionBindingSummary {
  readonly feePayer: string;
  readonly recentBlockhash: string;
  readonly instructionCount: number;
  readonly serializedSizeBytes: number;
  readonly usesAddressLookupTables: false;
}
export type BuiltUnsignedLegacyTransaction = Transaction & { readonly bindingSummary: TransactionBindingSummary };

export function buildUnsignedLegacyTransaction(input: UnsignedLegacyTransactionInput): BuiltUnsignedLegacyTransaction {
  if (input.addressLookupTables !== undefined && input.addressLookupTables.length !== 0) {
    fail("UNSUPPORTED_TRANSACTION", "address lookup tables are forbidden");
  }
  if (input.instructions.length === 0) fail("INVALID_INPUT", "at least one instruction is required");
  const transaction = new Transaction({ feePayer: input.feePayer, recentBlockhash: input.recentBlockhash }) as BuiltUnsignedLegacyTransaction;
  transaction.add(...input.instructions);
  const serializedSizeBytes = assertLegacyTransactionSize(transaction.compileMessage());
  Object.defineProperty(transaction, "bindingSummary", { enumerable: true, writable: false, configurable: false, value: Object.freeze({
    feePayer: input.feePayer.toBase58(), recentBlockhash: input.recentBlockhash,
    instructionCount: input.instructions.length, serializedSizeBytes, usesAddressLookupTables: false as const,
  }) });
  return transaction;
}

export function assertLegacyTransactionSize(message: Message): number {
  const requiredSignatures = message.header.numRequiredSignatures;
  const total = compactU16Length(requiredSignatures) + requiredSignatures * 64 + message.serialize().length;
  if (total > MAX_SERIALIZED_TRANSACTION_BYTES) {
    fail("TRANSACTION_TOO_LARGE", `legacy transaction exceeds ${MAX_SERIALIZED_TRANSACTION_BYTES} bytes`);
  }
  return total;
}

function compactU16Length(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff) fail("INVALID_INPUT", "invalid signature count");
  return value < 0x80 ? 1 : value < 0x4000 ? 2 : 3;
}
