export interface Checkpoint3ReplayJobBinding {
  readonly verificationRound: string;
  readonly proposal: string;
  readonly invariantAccount: string;
  readonly traceClaim: string;
  readonly candidateExecutableSha256: string;
  readonly invariantSpecificationHash: string;
}

function requireHex32(value: string, label: string): string {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`${label} must be canonical lowercase hex32`);
  return value;
}

export function bindCheckpoint3ReplayJob(
  template: Readonly<Record<string, unknown>>,
  binding: Checkpoint3ReplayJobBinding
): Record<string, unknown> {
  const candidateHash = requireHex32(binding.candidateExecutableSha256, "candidate executable hash");
  return {
    ...structuredClone(template),
    verification_round: binding.verificationRound,
    proposal: binding.proposal,
    invariant_account: binding.invariantAccount,
    trace_claim: binding.traceClaim,
    candidate_buffer_hash: candidateHash,
    candidate_executable_sha256: candidateHash,
    invariant_specification_hash: requireHex32(binding.invariantSpecificationHash, "invariant specification hash")
  };
}
