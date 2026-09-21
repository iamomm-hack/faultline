# Milestone 7 assertion mapping

Checkpoint 1 claims only frozen assertions 1–4. Assertions 5–28 require later trace normalization, VM execution, evaluator, receipt-production, signing, worker, or coordinator checkpoints.

| Frozen assertion | Named test evidence |
| --- | --- |
| 1. Canonical serialization is stable across object insertion order. | `assertion_1_canonical_serialization_is_stable` |
| 2. Duplicate keys, unknown fields, floats, malformed UTF-8, and malformed digests are rejected. | All `assertion_2_*` tests, including canonical syntax, recursive closed schemas, encodings, ordering, deterministic fixture bindings, 53 builtin runtime errors, receipt/worker conditional fields, dependency pins, and Tokenkeg provenance. |
| 3. A one-byte bound input change changes its manifest or job hash. | `assertion_3_bound_changes_change_hashes` |
| 4. All four manifest schemas validate their required fields and declared versions. | `assertion_4_all_manifest_schemas_validate`; both build variants share `faultline.build.v1`, alongside runner, fixture, and invariant. |

Supplemental format-only evidence is provided by `checkpoint_1_trace_job_receipt_and_worker_vectors_validate`, `checkpoint_1_milestone_5_vector_is_unchanged`, and `checkpoint_1_generator_matches_golden_report`. Receipt and unsigned-worker vectors are schema/hash fixtures, not VM execution evidence.

## Checkpoint 4

Checkpoint 4 implements only frozen assertions 13–16 and 24–27. Assertion 28 remains deferred to Checkpoint 5.

| Frozen assertion | Named test evidence |
| --- | --- |
| 13. Invalid or digest-mismatched evidence returns `InvalidEvidence`. | `assertion_13_digest_mismatched_evidence_is_invalid` |
| 14. Unsupported program/runtime requirements return `UnsupportedEnvironment`. | `assertion_14_unsupported_program_requirement_is_unsupported_environment` |
| 15. Crash, memory-limit termination, and internal worker failure return `RunnerFault`. | `assertion_15_crash_memory_output_and_active_process_limits_are_runner_faults`; `assertion_15_internal_worker_failure_is_runner_fault_without_evidence` |
| 16. Wall-clock expiration returns `RunnerFault` with the timeout code. | `assertion_16_wall_and_cpu_expiration_are_timeout_runner_faults` |
| 24. Three distinct worker processes and verifier identities independently produce the same v2 receipt and commitment. | `assertion_24_real_three_worker_v2_consensus` |
| 25. Three distinct worker processes and verifier identities independently produce the same v3 receipt and commitment. | `assertion_25_real_three_worker_v3_consensus` |
| 26. Any worker disagreement produces no aggregate attestation intents. | `assertion_26_disagreement_and_duplicates_emit_no_attestations` |
| 27. Worker output substitution, replay, wrong job hash, or wrong verifier signature is rejected. | `assertion_16_and_27_substitution_replay_and_wrong_signature_are_rejected` |

Supplemental Checkpoint 4 evidence covers the exact frame header and all header failures, closed canonical envelopes, forbidden path forms, malformed signing frames, frozen deterministic identities/nonces, failure precedence, bounded malformed/partial/trailing process output, and the no-retry launch count.
