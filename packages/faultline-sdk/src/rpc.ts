import { type PublicKey } from "@solana/web3.js";
import { fail } from "./errors.js";
import { publicKey } from "./validation.js";

export type FinalityCommitment = "confirmed" | "finalized";
export interface RpcBoundary { readonly endpoint: string; readonly genesisHash: string; readonly commitment: FinalityCommitment; readonly timeoutMilliseconds: number; }
export interface JsonRpcSuccess<T> { readonly jsonrpc: "2.0"; readonly id: string | number; readonly result: T; }

export function validateRpcBoundary(value: RpcBoundary): Readonly<RpcBoundary> {
  let endpoint: URL;
  try { endpoint = new URL(value.endpoint); }
  catch { fail("RPC_CONFIG_INVALID", "RPC endpoint must be an absolute URL"); }
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") fail("RPC_CONFIG_INVALID", "RPC endpoint must use http or https");
  if (value.commitment !== "confirmed" && value.commitment !== "finalized") fail("RPC_CONFIG_INVALID", "RPC commitment must be confirmed or finalized");
  if (!Number.isSafeInteger(value.timeoutMilliseconds) || value.timeoutMilliseconds < 1 || value.timeoutMilliseconds > 30_000) fail("RPC_CONFIG_INVALID", "RPC timeout must be between 1 and 30000 milliseconds");
  publicKey(value.genesisHash, "genesis hash");
  return Object.freeze({ endpoint: endpoint.toString(), genesisHash: value.genesisHash, commitment: value.commitment, timeoutMilliseconds: value.timeoutMilliseconds });
}

export interface RpcRequest<T extends readonly unknown[]> { readonly endpoint: string; readonly timeoutMilliseconds: number; readonly body: Readonly<{ jsonrpc: "2.0"; id: string | number; method: string; params: T }>; }
export function buildAccountReadRequest(boundary: RpcBoundary, address: unknown, id: string | number): RpcRequest<readonly [string, Readonly<{ encoding: "base64"; commitment: FinalityCommitment }>]> {
  const checked = validateRpcBoundary(boundary);
  if (typeof id !== "string" && !Number.isSafeInteger(id)) fail("RPC_CONFIG_INVALID", "RPC request id is invalid");
  return Object.freeze({ endpoint: checked.endpoint, timeoutMilliseconds: checked.timeoutMilliseconds, body: Object.freeze({ jsonrpc: "2.0" as const, id, method: "getAccountInfo", params: Object.freeze([publicKey(address, "account address").toBase58(), Object.freeze({ encoding: "base64" as const, commitment: checked.commitment })] as const) }) });
}

export function assertRpcGenesis(boundary: RpcBoundary, observed: unknown): void {
  const configured = validateRpcBoundary(boundary);
  if (typeof observed !== "string" || observed !== configured.genesisHash) fail("RPC_GENESIS_MISMATCH", "RPC genesis hash does not match configuration");
}

export function parseJsonRpcSuccess<T>(value: unknown): JsonRpcSuccess<T> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("RPC_RESPONSE_INVALID", "RPC response must be an object");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "id,jsonrpc,result" || record.jsonrpc !== "2.0") fail("RPC_RESPONSE_INVALID", "RPC response shape is invalid");
  if (typeof record.id !== "string" && typeof record.id !== "number") fail("RPC_RESPONSE_INVALID", "RPC response id is invalid");
  return record as unknown as JsonRpcSuccess<T>;
}

export interface OwnedAccountResponse { readonly owner: PublicKey; readonly data: Uint8Array; }
export function validateOwnedAccountResponse(owner: unknown, data: unknown): OwnedAccountResponse {
  if (!(data instanceof Uint8Array)) fail("RPC_RESPONSE_INVALID", "RPC account data must be decoded bytes");
  return Object.freeze({ owner: publicKey(owner, "account owner"), data });
}
