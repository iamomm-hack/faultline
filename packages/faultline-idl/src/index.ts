import faultlineGate from "../idl/faultline_gate.json" with { type: "json" };
import faultlineTreasury from "../idl/faultline_treasury.json" with { type: "json" };
import provenance from "../provenance.json" with { type: "json" };

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export const FAULTLINE_GATE_IDL = deepFreeze(faultlineGate);
export const FAULTLINE_TREASURY_IDL = deepFreeze(faultlineTreasury);
export const FAULTLINE_IDL_PROVENANCE = deepFreeze(provenance);

export type FaultlineGateIdl = typeof faultlineGate;
export type FaultlineTreasuryIdl = typeof faultlineTreasury;
