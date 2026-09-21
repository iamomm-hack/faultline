export const FAULTLINE_SDK_ERROR_CODES = Object.freeze([
  "INVALID_INPUT", "INVALID_PROGRAM_ID", "INVALID_PDA", "INVALID_ACCOUNT_OWNER",
  "INVALID_ACCOUNT_DATA", "INVALID_DISCRIMINATOR", "INVALID_ENUM", "INVALID_IDL",
  "INVALID_INSTRUCTION", "TRANSACTION_TOO_LARGE", "UNSUPPORTED_TRANSACTION",
  "RPC_CONFIG_INVALID", "RPC_GENESIS_MISMATCH", "RPC_RESPONSE_INVALID", "SCHEMA_INVALID",
] as const);
export type FaultlineSdkErrorCode = (typeof FAULTLINE_SDK_ERROR_CODES)[number];

export class FaultlineSdkError extends Error {
  readonly code: FaultlineSdkErrorCode;

  constructor(code: FaultlineSdkErrorCode, message: string) {
    super(message.replace(/[\r\n\0]/g, " ").slice(0, 192));
    this.name = "FaultlineSdkError";
    this.code = code;
  }
}

export function fail(code: FaultlineSdkErrorCode, message: string): never {
  throw new FaultlineSdkError(code, message);
}

export function asSdkError(error: unknown): FaultlineSdkError {
  if (error instanceof FaultlineSdkError) return error;
  return new FaultlineSdkError("INVALID_INPUT", "Invalid public input");
}
