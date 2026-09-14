import type { DemoSnapshot, Policy, ProposalDetail, TokenAmount } from "./types";

export const amount = (units: string): TokenAmount => ({ baseUnits: units, decimals: 6, symbol: "fUSDC" });
export const HASHES = {
  v1: "41f2c6718a01934fb0b2ac755e41b99abc6ad10fe781c928fad0c6a4a02491a7",
  v2: "ba6fcafe5d8f77e053f456dd2b802741c37e1f762a62abc9e9b42b6f4de0e207",
  v3: "0d942a9ba82fd1a83d23a312cb32e978f83bdeaa41ca813ba488403965783acf",
};
export const TARGET = "FLTrsy8QrPyD8oUaHx7jMY1gxVcsYL2KQxY6pT4d9Lne";
export const GUARD = "Guard4kS3b8hfA5q2VryP6d7Nw9mUc1XeLoZtJ2iFgCa";
export const POLICY: Policy = { id: "policy-auth-001", version: "1.0.0", quorum: { required: 2, total: 3 }, challengeDurationSeconds: 90, challengerBond: amount("10000000") };
const artifact = (candidate: "v2" | "v3", label: string, suffix: string) => ({ label, hash: `${candidate === "v2" ? "a7" : "c3"}${suffix.padEnd(62, candidate === "v2" ? "2" : "3")}` });
export function proposal(candidate: "v2" | "v3"): ProposalDetail {
  return {
    id: `proposal-${candidate}`, candidateVersion: candidate, currentVersion: candidate === "v2" ? "v1" : "v1",
    state: "draft", bounty: amount("100000000"), targetProgram: TARGET, guardPda: GUARD,
    candidateBuffer: candidate === "v2" ? "BufV2oY7mP4KqN8hUa2xE5sW9cDf3Rj6Lt1ZiGbQeAk" : "BufV3pL8nQ5KrM2hWc7xE1sY9dFa4Tj6Lu3ZiGbRoVek",
    sourceCommit: candidate === "v2" ? "7c2f91a8d4b60e3f1129ec8d641fec2634b10ee2" : "b19d4c70e16a82f328735cb3d2c99ee5095e8d4a",
    artifacts: [
      { label: "Executable", hash: HASHES[candidate] },
      artifact(candidate, "Build manifest", "b1"), artifact(candidate, "Fixture manifest", "f1"),
      artifact(candidate, "Runner manifest", "d9"), artifact(candidate, "Invariant bundle", "01"),
    ], policy: POLICY,
    invariants: [{ id: "AUTH-001", title: "Unauthorized treasury outflow", statement: "A non-admin signer must never reduce the tracked treasury token balance.", status: "untested", evaluator: "auth-outflow@1.0.0" }],
  };
}
export const STEPS = [
  ["Create vulnerable v2 proposal", "Bind the candidate buffer, build, fixture, runner, and AUTH-001 commitments."],
  ["Fund 100 fUSDC bounty", "Lock the bounty before the counterexample window can open."],
  ["Open challenge window", "The candidate is now open for counterexamples."],
  ["Commit counterexample", "The hunter posts a salted commitment without exposing the trace."],
  ["Reveal evidence", "Reveal the bounded transaction trace and verify its commitment."],
  ["Assign verifier quorum", "Three allowlisted MVP workers receive the pinned replay assignment."],
  ["Verifier A reproduces", "Worker A reproduces the AUTH-001 violation."],
  ["Verifier B reproduces", "Worker B independently reaches the same result class."],
  ["Quorum reached", "Two of three workers reproduced the declared invariant violation."],
  ["Reject v2 and settle", "The proposal is irreversibly rejected and the hunter receives 100 fUSDC."],
  ["Attempt guarded execution", "The Guard refuses the rejected candidate with UPGRADE_REJECTED."],
  ["Create patched v3 proposal", "Bind the patched candidate and the same executable invariant."],
  ["Fund and open v3", "A new 100 fUSDC bounty is escrowed and the window opens."],
  ["Replay the same trace", "All three workers test the exact counterexample against v3."],
  ["Verifier A preserves", "AUTH-001 is preserved for this replayed trace."],
  ["Verifier B preserves", "A second independent replay reports preserved."],
  ["Verifier C preserves", "All assigned workers report preserved for this trace."],
  ["Complete challenge window", "The window ends with no accepted counterexample."],
  ["Approve v3", "The proposal becomes eligible for guarded execution."],
  ["Execute through Guard PDA", "The approved buffer is activated and the deployed version becomes v3."],
] as const;
export function initialSnapshot(): DemoSnapshot {
  return { step: 0, stepTitle: STEPS[0][0], stepDescription: STEPS[0][1], deployedVersion: "v1", deployedHash: HASHES.v1, treasuryBalance: amount("500000000"), hunterBalance: amount("20000000"), proposals: [], events: [{ id: "evt-0", at: 1700000000000, title: "Faultline Treasury v1 deployed", detail: "Guard PDA is the configured upgrade authority.", tone: "info" }], complete: false };
}
