import { FAULTLINE_GATE_IDL, FAULTLINE_TREASURY_IDL } from "@faultline/idl";
import type { AnchorIdl } from "./idl.js";

export interface ProtocolError {
  readonly program: "faultline_gate" | "faultline_treasury";
  readonly code: number;
  readonly name: string;
  readonly message: string;
}

function errorMap(program: ProtocolError["program"], idl: AnchorIdl): ReadonlyMap<number, ProtocolError> {
  return new Map((idl.errors ?? []).map((error) => [error.code, Object.freeze({ program, code: error.code, name: error.name, message: error.msg ?? error.name })]));
}
const GATE_ERRORS = errorMap("faultline_gate", FAULTLINE_GATE_IDL as unknown as AnchorIdl);
const TREASURY_ERRORS = errorMap("faultline_treasury", FAULTLINE_TREASURY_IDL as unknown as AnchorIdl);

export function decodeProtocolError(program: ProtocolError["program"], code: number): ProtocolError | undefined {
  if (!Number.isSafeInteger(code) || code < 0) return undefined;
  return (program === "faultline_gate" ? GATE_ERRORS : TREASURY_ERRORS).get(code);
}
