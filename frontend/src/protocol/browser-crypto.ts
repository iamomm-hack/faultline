import { sha256 } from '@noble/hashes/sha2';
import { Buffer } from 'buffer';
/** Only the SHA-256 API used by the committed SDK. No protocol serialization here. */
export function createHash(algorithm: string) {
  if (algorithm !== 'sha256')
    throw new Error('Unsupported SDK digest algorithm');
  const hash = sha256.create();
  const api = {
    update(value: string | Uint8Array) {
      hash.update(
        typeof value === 'string' ? new TextEncoder().encode(value) : value,
      );
      return api;
    },
    digest(encoding?: 'hex') {
      const value = Buffer.from(hash.digest());
      return encoding ? value.toString(encoding) : value;
    },
  };
  return api;
}
