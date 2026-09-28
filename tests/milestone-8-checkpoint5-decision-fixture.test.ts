import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, Transaction } from "@solana/web3.js";
import { buildRecordTemporaryDecisionInstruction } from "./milestone-8-checkpoint5-decision-fixture.js";

test("checkpoint 5 decision fixture binds and signs the selected governance account without RPC", () => {
  const gate = Keypair.generate().publicKey;
  const governance = Keypair.generate();
  const outsider = Keypair.generate();
  const accounts = {
    gate,
    policy: Keypair.generate().publicKey,
    proposal: Keypair.generate().publicKey,
    proposalVerificationGate: Keypair.generate().publicKey,
    state: 2 as const,
    reasonCode: 0x8008
  };
  const blockhash = Keypair.generate().publicKey.toBase58();

  const unauthorizedInstruction = buildRecordTemporaryDecisionInstruction({ ...accounts, governance: outsider.publicKey });
  assert(unauthorizedInstruction.keys[0].pubkey.equals(outsider.publicKey));
  assert.equal(unauthorizedInstruction.keys[0].isSigner, true);
  const unauthorized = new Transaction({ feePayer: outsider.publicKey, recentBlockhash: blockhash }).add(unauthorizedInstruction);
  unauthorized.sign(outsider);
  assert(unauthorized.serialize().length > 0);

  const validInstruction = buildRecordTemporaryDecisionInstruction({ ...accounts, governance: governance.publicKey });
  assert(validInstruction.keys[0].pubkey.equals(governance.publicKey));
  assert.equal(validInstruction.keys[0].isSigner, true);
  const missingGovernance = new Transaction({ feePayer: outsider.publicKey, recentBlockhash: blockhash }).add(validInstruction);
  missingGovernance.sign(outsider);
  assert.throws(() => missingGovernance.serialize(), /Missing signature/);

  const valid = new Transaction({ feePayer: outsider.publicKey, recentBlockhash: blockhash }).add(validInstruction);
  valid.sign(outsider, governance);
  assert(valid.serialize().length > 0);
});
