import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  loaderAuthority,
  programDataAddress,
  send,
  setLoaderAuthorityInstruction
} from "./lib/solana.js";

export async function transferUpgradeAuthority(
  connection: Connection,
  targetProgram: PublicKey,
  currentAuthority: Keypair,
  guardPda: PublicKey,
  feePayer: Keypair = currentAuthority
): Promise<string> {
  const programData = programDataAddress(targetProgram);
  const before = await loaderAuthority(connection, programData, 3);
  if (!before.equals(currentAuthority.publicKey)) {
    throw new Error(`Refusing transfer: expected current authority ${currentAuthority.publicKey}, got ${before}`);
  }
  const signature = await send(
    connection,
    setLoaderAuthorityInstruction(programData, currentAuthority.publicKey, guardPda),
    feePayer,
    feePayer === currentAuthority ? [] : [currentAuthority]
  );
  const after = await loaderAuthority(connection, programData, 3);
  if (!after.equals(guardPda)) throw new Error(`Authority transfer verification failed: got ${after}`);
  return signature;
}

