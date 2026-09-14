import { Connection, PublicKey } from "@solana/web3.js";
import { loaderAuthority, programDataAddress } from "./lib/solana.js";

export async function verifyGuardAuthority(
  connection: Connection,
  targetProgram: PublicKey,
  guardPda: PublicKey
): Promise<PublicKey> {
  const programData = programDataAddress(targetProgram);
  const actual = await loaderAuthority(connection, programData, 3);
  if (!actual.equals(guardPda)) {
    throw new Error(`ProgramData authority mismatch: expected ${guardPda}, got ${actual}`);
  }
  return programData;
}

