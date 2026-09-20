# Milestone 7 Checkpoint 1 assertion mapping

Checkpoint 1 claims only frozen assertions 1–4. Assertions 5–28 require later trace normalization, VM execution, evaluator, receipt-production, signing, worker, or coordinator checkpoints.

| Frozen assertion | Named test evidence |
| --- | --- |
| 1. Canonical serialization is stable across object insertion order. | `assertion_1_canonical_serialization_is_stable` |
| 2. Duplicate keys, unknown fields, floats, malformed UTF-8, and malformed digests are rejected. | All `assertion_2_*` tests, including canonical syntax, recursive closed schemas, encodings, ordering, deterministic fixture bindings, 53 builtin runtime errors, receipt/worker conditional fields, dependency pins, and Tokenkeg provenance. |
| 3. A one-byte bound input change changes its manifest or job hash. | `assertion_3_bound_changes_change_hashes` |
| 4. All four manifest schemas validate their required fields and declared versions. | `assertion_4_all_manifest_schemas_validate`; both build variants share `faultline.build.v1`, alongside runner, fixture, and invariant. |

Supplemental format-only evidence is provided by `checkpoint_1_trace_job_receipt_and_worker_vectors_validate`, `checkpoint_1_milestone_5_vector_is_unchanged`, and `checkpoint_1_generator_matches_golden_report`. Receipt and unsigned-worker vectors are schema/hash fixtures, not VM execution evidence.
