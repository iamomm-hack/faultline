import { createHash } from "node:crypto";
import { REPLAY_RESULT_DOMAIN } from "./constants.js";
import { fail } from "./errors.js";
import { hash32, publicKey, type PublicKeyInput } from "./validation.js";

export enum ReplayVerdict {
  InvariantHolds = 0,
  InvariantViolated = 1
}

export interface ReplayResultCommitmentInput {
  proposal: PublicKeyInput;
  invariant: PublicKeyInput;
  traceClaim: PublicKeyInput;
  candidateBufferHash: Uint8Array;
  invariantSpecificationHash: Uint8Array;
  verdict: ReplayVerdict;
  replayReceiptHash: Uint8Array;
}

export function replayResultPreimage(input: ReplayResultCommitmentInput): Buffer {
  if (input.verdict !== ReplayVerdict.InvariantHolds && input.verdict !== ReplayVerdict.InvariantViolated) {
    fail("INVALID_ENUM", "Replay verdict must be HOLD or VIOLATION");
  }
  const preimage = Buffer.concat([
    REPLAY_RESULT_DOMAIN,
    publicKey(input.proposal, "proposal").toBuffer(),
    publicKey(input.invariant, "invariant").toBuffer(),
    publicKey(input.traceClaim, "trace claim").toBuffer(),
    hash32(input.candidateBufferHash, "candidate buffer hash"),
    hash32(input.invariantSpecificationHash, "invariant specification hash"),
    Buffer.from([input.verdict]),
    hash32(input.replayReceiptHash, "replay receipt hash")
  ]);
  if (preimage.length !== 212) fail("INVALID_INPUT", "Replay result preimage has the wrong length");
  return preimage;
}

export function replayResultCommitment(input: ReplayResultCommitmentInput): Buffer {
  return createHash("sha256").update(replayResultPreimage(input)).digest();
}
