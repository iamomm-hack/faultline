import { PublicKey } from "@solana/web3.js";

export const FAULTLINE_GATE_PROGRAM_ID = new PublicKey(
  "9PFPNC6TMNKBCVsm4RoCgVYmqTJJTwnHHuRcysosSCCe"
);
export const FAULTLINE_TREASURY_PROGRAM_ID = new PublicKey(
  "46zDmEZAYrpwi3k6FsKFf1rPWZDbZEKM21SFzMKzb1a4"
);
export const TOKENKEG_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
export const LOADER_V3_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);

export const REPLAY_RESULT_DOMAIN = Buffer.from("FAULTLINE_REPLAY_V1", "ascii");
export const MAX_SERIALIZED_TRANSACTION_BYTES = 1_232;
export const U64_MAX = (1n << 64n) - 1n;

export const GATE_ACCOUNT_MAX_VECTOR_LENGTHS: Readonly<Record<string, number>> = Object.freeze({
  "VerifierEpoch.verifiers": 8
});
