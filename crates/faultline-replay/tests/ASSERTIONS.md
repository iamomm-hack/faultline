# Milestone 7 assertion ledger

This is the complete focused assertion ledger. Each frozen assertion appears exactly once and maps only to tests that execute the claimed behavior. Format-only vectors remain supplemental schema and hash evidence; they are not runtime replay evidence.

| Frozen assertion | Named behavior-executing test evidence |
| --- | --- |
| 1. Canonical serialization is stable across object insertion order. | `assertion_1_canonical_serialization_is_stable` |
| 2. Duplicate keys, unknown fields, floats, malformed UTF-8, and malformed digests are rejected. | All `assertion_2_*` tests in `tests/formats.rs` |
| 3. A one-byte bound input change changes its manifest or job hash. | `assertion_3_bound_changes_change_hashes` |
| 4. All four manifest schemas validate their required fields and declared versions. | `assertion_4_all_manifest_schemas_validate` |
| 5. The existing canonical `faultline.trace.v1` fixture parses successfully. | `assertion_05_canonical_trace_parses` |
| 6. Duplicate aliases, unknown references, disallowed programs, invalid base64, and over-limit traces are rejected. | `assertion_06_invalid_trace_inputs_fail_closed` |
| 7. Normalization produces an explicit, stable instruction/account sequence. | `assertion_07_normalization_is_explicit_stable_and_idempotent` |
| 8. Expected-result metadata does not affect normalized replay input or evaluator output. | `assertion_08_expected_metadata_is_not_execution_input` |
| 9. AUTH-001 captures the original administrator from pre-state. | `assertion_09_original_administrator_is_captured_from_pre_state` |
| 10. The canonical v2 replay returns `Violated` with the frozen violation code. | `assertion_10_v2_is_deterministically_violated` |
| 11. The same normalized trace against v3 returns `Preserved`. | `assertion_11_v3_is_deterministically_preserved` |
| 12. The v3 failed unauthorized migration leaves protected balances unchanged. | `assertion_12_v3_failed_migration_preserves_protected_balances` |
| 13. Invalid or digest-mismatched evidence returns `InvalidEvidence`. | `assertion_13_digest_mismatched_evidence_is_invalid` |
| 14. Unsupported program/runtime requirements return `UnsupportedEnvironment`. | `assertion_14_unsupported_program_requirement_is_unsupported_environment` |
| 15. Crash, memory-limit termination, and internal worker failure return `RunnerFault`. | `assertion_15_crash_is_runner_fault`; `assertion_15_panic_is_runner_fault`; `assertion_15_memory_limit_is_runner_fault`; `assertion_15_internal_worker_failure_is_executed_and_is_runner_fault` |
| 16. Wall-clock expiration returns `RunnerFault` with the timeout code. | `assertion_16_wall_expiration_is_timeout_runner_fault` |
| 17. The receipt binds every required input hash, runtime version, transaction result, state hash, log digest, classification, and code. | `assertion_17_receipt_binds_runtime_inputs_and_nested_digests` |
| 18. Identical runs produce identical receipt bytes and hashes. | `assertion_18_fresh_runs_are_byte_identical` |
| 19. Verifier identity changes worker output but not receipt bytes or receipt hash. | `assertion_19_identity_changes_output_not_receipt_and_signatures_fail_closed` |
| 20. Preserved maps exactly to Milestone 5 verdict byte `0`. | `assertion_20_preserved_maps_to_hold_zero` |
| 21. Violated maps exactly to Milestone 5 verdict byte `1`. | `assertion_21_violated_maps_to_violation_one` |
| 22. The Milestone 5 replay-result commitment matches its frozen Rust/TypeScript vector. | `assertion_22_milestone5_commitment_vector_is_unchanged` |
| 23. InvalidEvidence, UnsupportedEnvironment, and RunnerFault produce no result commitment or attestation intent. | `assertion_23_ineligible_results_have_no_commitment_or_intent` |
| 24. Three distinct worker processes and verifier identities independently produce the same v2 receipt and commitment. | `assertion_24_real_three_worker_v2_consensus` |
| 25. Three distinct worker processes and verifier identities independently produce the same v3 receipt and commitment. | `assertion_25_real_three_worker_v3_consensus` |
| 26. Any worker disagreement produces no aggregate attestation intents. | `assertion_26_disagreement_and_duplicates_emit_no_attestations` |
| 27. Worker output substitution, replay, wrong job hash, or wrong verifier signature is rejected. | `assertion_16_and_27_substitution_replay_and_wrong_signature_are_rejected` |
| 28. The focused suite leaves no worker process running and makes no production Solana source change. | `assertion_28_real_v2_v3_production_workers_leave_no_owned_residue`, plus the closeout runner's post-shard orphan, run-directory, handle-telemetry, and `programs/**` diff audits |

Supplemental format evidence is provided by `checkpoint_1_trace_job_receipt_and_worker_vectors_validate`, `checkpoint_1_milestone_5_vector_is_unchanged`, and `checkpoint_1_generator_matches_golden_report`. Supplemental worker-isolation evidence covers all frame-header failures, closed canonical envelopes, path rejection, signing-frame validation, deterministic test identities and nonces, failure precedence, separately bounded CPU/output/active-process/malformed-output cases, cleanup obstruction, handle closure, and zero automatic retries.
