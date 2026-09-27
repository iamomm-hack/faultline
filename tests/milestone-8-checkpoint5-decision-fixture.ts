import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { anchorInstruction } from "../scripts/lib/solana.js";

export function buildRecordTemporaryDecisionInstruction(input: {
  gate: PublicKey;
  governance: PublicKey;
  policy: PublicKey;
  proposal: PublicKey;
  proposalVerificationGate: PublicKey;
  state: 2 | 3;
  reasonCode: number;
}): TransactionInstruction {
  const reason = Buffer.alloc(2);
  reason.writeUInt16LE(input.reasonCode);
  return anchorInstruction(input.gate, "record_temporary_decision", [
    { pubkey: input.governance, isSigner: true, isWritable: false },
    { pubkey: input.policy, isSigner: false, isWritable: false },
    { pubkey: input.proposal, isSigner: false, isWritable: true },
    { pubkey: input.proposalVerificationGate, isSigner: false, isWritable: false }
  ], Buffer.concat([Buffer.from([input.state]), reason]));
}
