import { Connection, Keypair, PublicKey, SYSVAR_RENT_PUBKEY, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { COMMITMENT } from "./solana.js";

export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const MINT_SIZE = 82;
export const TOKEN_ACCOUNT_SIZE = 165;
export const TOKEN_ACCOUNT_AMOUNT_OFFSET = 64;

function u64(value: bigint): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(value);
  return buffer;
}

export async function createMint(
  connection: Connection,
  payer: Keypair,
  mint: Keypair,
  mintAuthority: PublicKey,
  decimals: number
): Promise<string> {
  const lamports = await connection.getMinimumBalanceForRentExemption(MINT_SIZE, COMMITMENT);
  const data = Buffer.alloc(67);
  data[0] = 0;
  data[1] = decimals;
  data.writeUInt32LE(1, 2);
  mintAuthority.toBuffer().copy(data, 6);
  data.writeUInt32LE(0, 38);
  const tx = new Transaction()
    .add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mint.publicKey,
        lamports,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID
      })
    )
    .add({
      programId: TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: mint.publicKey, isSigner: false, isWritable: true },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false }
      ],
      data
    });
  return sendAndConfirmTransaction(connection, tx, [payer, mint], { commitment: COMMITMENT });
}

export async function createTokenAccount(
  connection: Connection,
  payer: Keypair,
  account: Keypair,
  mint: PublicKey,
  owner: PublicKey
): Promise<string> {
  const lamports = await connection.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SIZE, COMMITMENT);
  const tx = new Transaction()
    .add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: account.publicKey,
        lamports,
        space: TOKEN_ACCOUNT_SIZE,
        programId: TOKEN_PROGRAM_ID
      })
    )
    .add({
      programId: TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: account.publicKey, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: owner, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false }
      ],
      data: Buffer.from([1])
    });
  return sendAndConfirmTransaction(connection, tx, [payer, account], { commitment: COMMITMENT });
}

export async function mintTo(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  destination: PublicKey,
  authority: Keypair,
  amount: bigint
): Promise<string> {
  const tx = new Transaction().add({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: false }
    ],
    data: Buffer.concat([Buffer.from([7]), u64(amount)])
  });
  return sendAndConfirmTransaction(connection, tx, [payer, authority], { commitment: COMMITMENT });
}

export async function tokenAmount(connection: Connection, tokenAccount: PublicKey): Promise<bigint> {
  const info = await connection.getAccountInfo(tokenAccount, COMMITMENT);
  if (!info) throw new Error(`Missing token account ${tokenAccount.toBase58()}`);
  if (!info.owner.equals(TOKEN_PROGRAM_ID)) throw new Error(`${tokenAccount.toBase58()} is not a Tokenkeg account`);
  return info.data.readBigUInt64LE(TOKEN_ACCOUNT_AMOUNT_OFFSET);
}
