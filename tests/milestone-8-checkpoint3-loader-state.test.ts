import assert from "node:assert/strict";
import { test } from "node:test";
import { PublicKey } from "@solana/web3.js";
import {
  LOADER_V3_PROGRAM_ID,
  decodeLockedLoaderV3Buffer,
} from "../packages/faultline-sdk/src/index.js";

const guard = new PublicKey(Buffer.alloc(32, 0x47));
const uploader = new PublicKey(Buffer.alloc(32, 0x55));
const other = new PublicKey(Buffer.alloc(32, 0x33));
const payload = Buffer.from("canonical-faultline-loader-v3-payload", "utf8");

function loaderBuffer(authority: PublicKey | null, variant = 1, optionTag?: number): Buffer {
  const data = Buffer.alloc(37 + payload.length);
  data.writeUInt32LE(variant, 0);
  data[4] = optionTag ?? (authority ? 1 : 0);
  if (authority) authority.toBuffer().copy(data, 5);
  payload.copy(data, 37);
  return data;
}

test("accepts exactly the post-handoff Buffer with Some(Guard PDA)", () => {
  const state = decodeLockedLoaderV3Buffer({ owner: LOADER_V3_PROGRAM_ID, data: loaderBuffer(guard) }, guard);
  assert.equal(state.variant, "Buffer");
  assert(state.authority.equals(guard));
  assert.equal(state.metadataLength, 37);
  assert.deepEqual(state.payload, payload);
});

test("rejects wrong owner", () => {
  assert.throws(() => decodeLockedLoaderV3Buffer({ owner: other, data: loaderBuffer(guard) }, guard), /not owned by loader-v3/);
});

test("rejects short canonical metadata", () => {
  assert.throws(() => decodeLockedLoaderV3Buffer({ owner: LOADER_V3_PROGRAM_ID, data: Buffer.alloc(36) }, guard), /metadata is truncated/);
});

test("rejects every non-Buffer loader-v3 variant", () => {
  for (const variant of [0, 2, 3]) {
    assert.throws(() => decodeLockedLoaderV3Buffer({ owner: LOADER_V3_PROGRAM_ID, data: loaderBuffer(guard, variant) }, guard), /not a Buffer/);
  }
});

test("rejects malformed authority option tags", () => {
  for (const tag of [2, 0xff]) {
    assert.throws(() => decodeLockedLoaderV3Buffer({ owner: LOADER_V3_PROGRAM_ID, data: loaderBuffer(guard, 1, tag) }, guard), /authority option is malformed/);
  }
});

test("rejects Buffer authority None because loader Upgrade cannot consume it", () => {
  assert.throws(() => decodeLockedLoaderV3Buffer({ owner: LOADER_V3_PROGRAM_ID, data: loaderBuffer(null) }, guard), /immutable and cannot be upgraded/);
});

test("rejects the original uploader and every other externally mutable authority", () => {
  for (const authority of [uploader, other]) {
    assert.throws(() => decodeLockedLoaderV3Buffer({ owner: LOADER_V3_PROGRAM_ID, data: loaderBuffer(authority) }, guard), /buffer authority binding mismatch/);
  }
});

test("reads the canonical one-byte Option tag without consuming authority bytes", () => {
  const nonzeroPrefixAuthority = new PublicKey(Buffer.from([0xa1, 0xb2, 0xc3, ...Buffer.alloc(29, 0x44)]));
  const state = decodeLockedLoaderV3Buffer({ owner: LOADER_V3_PROGRAM_ID, data: loaderBuffer(nonzeroPrefixAuthority) }, nonzeroPrefixAuthority);
  assert(state.authority.equals(nonzeroPrefixAuthority));
  assert.notEqual(loaderBuffer(nonzeroPrefixAuthority).readUInt32LE(4), 1, "the prior four-byte Option-tag read must reject this otherwise-valid header");
});
