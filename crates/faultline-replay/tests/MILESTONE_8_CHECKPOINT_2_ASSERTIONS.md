# Milestone 8 Checkpoint 2 assertion ledger

This focused ledger owns only frozen Milestone 8 assertions 13-25. Each assertion appears once and maps to one primary behavior-executing test. The real-worker fixture launches the canonical production worker through the Windows Job Object coordinator and dedicated inherited signing-key pipe; it is not a constructed success response.

| Frozen assertion | Primary test |
| --- | --- |
| 13. One public key is consistently enforced as epoch member, stake identity, worker signer, and direct-attestation signer. | `m8_c2_identity_is_consistent_across_layers` |
| 14. A keypair whose derived public key differs from the requested verifier is rejected before worker launch or transaction construction. | `m8_c2_wrong_keypair_is_rejected` |
| 15. Swapping two otherwise valid operator keys or signed outputs is rejected as identity substitution. | `m8_c2_mismatched_operator_identity_is_rejected` |
| 16. A production operator invocation loads at most one explicit keypair and the aggregation path accepts no private-key input. | `m8_c2_production_never_custodies_three_keys` |
| 17. Key seed/content never appears in arguments, environment, stdout, stderr, errors, telemetry, or evidence. | `m8_c2_key_secret_is_not_disclosed` |
| 18. Unsafe, tracked, non-regular, reparse-point, malformed, or public/private-mismatched keypair files fail closed. | `m8_c2_unsafe_key_files_are_rejected` |
| 19. Mutable seed buffers are cleared best-effort and key objects are dropped after their last required signature. | `m8_c2_key_lifetime_is_bounded` |
| 20. Real Milestone 7 worker-output signatures are verified before consensus or intent use. | `m8_c2_worker_signature_is_authenticated` |
| 21. Altered payloads, signatures, identities, ordinals, or signing algorithms are rejected. | `m8_c2_altered_worker_output_is_rejected` |
| 22. Replaying an output under another coordinator nonce, ordinal, job, or launch is rejected. | `m8_c2_nonce_and_launch_replay_is_rejected` |
| 23. Exactly three distinct authenticated outputs with an identical frozen projection are required; no successful subset is selected. | `m8_c2_consensus_requires_exact_unanimous_three` |
| 24. Any mixed classification, receipt, verdict, commitment, projection, or eligibility fails with no plan or intent. | `m8_c2_disagreement_emits_no_plan` |
| 25. Demo keys are OS-CSPRNG-generated, confined to the owned run, excluded from sanitized evidence, and deleted on cleanup. | `m8_c2_demo_keys_are_ephemeral` |

Supporting tests `checkpoint2_exit_classes_are_closed_and_stable` and `checkpoint2_production_source_boundary_audit` validate the frozen process-exit table and forbidden production call-site boundary without claiming an additional assertion.
