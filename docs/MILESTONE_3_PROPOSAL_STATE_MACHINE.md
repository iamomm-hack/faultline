# Milestone 3 — SafetyPolicy and UpgradeProposal state machine

## Purpose

Milestone 3 replaces Milestone 1's temporary `MinimalUpgradeProposal` route with one canonical on-chain lifecycle. `GuardConfig` remains the only PDA that can sign loader-v3 `Upgrade`; an `UpgradeProposal` is now the only state record that can authorize that CPI.

This remains a local-validator, toy-treasury proof. It does not claim that a candidate is generally secure.

## Accounts and PDA seeds

| Account | PDA seeds | Key contents |
| --- | --- | --- |
| GuardConfig | `['faultline','guard',target_program]` | target, governance, Guard bump |
| SafetyPolicy | `['safety-policy',target_program]` | immutable target/config/hash plus Active/Paused status |
| UpgradeProposal | `['upgrade-proposal',policy,proposal_id_le]` | target, ProgramData, buffer, SHA-256, windows, decision and execution fields |
| BufferClaim | `['faultline','buffer',candidate_buffer]` | one proposal binding per locked loader buffer |

`SafetyPolicy` records authority, governance authority, policy ID/version, minimum slots, future quorum configuration, and immutable invariant-set hash. `UpgradeProposal` includes every required lifecycle field plus pinned ProgramData.

Exact `SafetyPolicy` fields: `authority`, `governance_authority`, `target_program`, `policy_id`, `policy_version`, `min_challenge_slots`, `verifier_quorum_required`, `allowed_invariant_set_hash`, `status`, `created_at_slot`, and `bump`.

Exact `UpgradeProposal` fields: `policy`, `proposal_id`, `target_program`, `program_data`, `candidate_buffer`, `candidate_buffer_hash`, `proposer`, `created_at_slot`, `challenge_start_slot`, `challenge_end_slot`, `state`, `decision_authority`, `decision_slot`, `decision_reason_code`, `executed_at_slot`, and `bump`.

The candidate hash is SHA-256 over exact loader-v3 Buffer account data. It is recomputed at creation and execution. Loader buffer authority is handed to GuardConfig before creation; Gate has no write or authority-change instruction. `BufferClaim` prevents reuse.

## State and authorization

| From | Allowed transition | Caller |
| --- | --- | --- |
| Draft | ChallengeActive | proposer or configured governance |
| ChallengeActive | Approved / Rejected | governance only; temporary bridge |
| ChallengeActive | Expired | any fee-paying caller after end slot |
| Approved | Executed | any executor after end slot, through Guard CPI only |

All other transitions fail. Challenge duration and quorum must be non-zero; duration must meet policy minimum. Decisions are valid only during the active window; execution only strictly after its recorded end slot.

| Instruction | Authorized actor | Important fail-closed checks |
| --- | --- | --- |
| initialize_safety_policy | configured governance/authority | one policy PDA, nonzero duration/quorum, Guard governance match |
| set_safety_policy_status | policy governance | status only; immutable metadata remains untouched |
| create_upgrade_proposal | proposer | Active policy, exact target/ProgramData, Guard authority, locked Buffer, SHA-256 match, unique claim/PDA |
| start_challenge | proposer or governance | Draft, Active policy, minimum duration |
| record_temporary_decision | governance | ChallengeActive, Approved/Rejected only, no expiry |
| expire_proposal | any signer | ChallengeActive, strictly after end, no decision |
| execute_guarded_upgrade | any signer | Approved, strictly after end, exact policy/proposal/ProgramData/buffer/hash/loader, Guard CPI |

Events: `SafetyPolicyInitialized`, `SafetyPolicyStatusChanged`, `UpgradeProposalCreated`, `ChallengeStarted`, `TemporaryDecisionRecorded`, `ProposalExpired`, and `GuardedUpgradeExecuted` carry policy/proposal/target/buffer/actor/slot fields.

## Reproduce

```powershell
npm.cmd run demo:guard
npm.cmd run test:treasury-versions
npm.cmd run demo:proposal
```

`demo:proposal` prints policy, Draft proposal, challenge slots, early-execution rejection, temporary decision, slot progression, the real Guard loader CPI, version check, and repeated-execution rejection.

The lifecycle demonstration uses transaction-driven slot advancement, never wall-clock sleeping. The expanded negative-case matrix remains the acceptance gate for declaring this milestone complete.

## Limitations

- Governance makes temporary decisions in this milestone; this is not decentralized verification.
- There is no independent verifier quorum yet.
- There is no challenge submission/reveal yet.
- There is no deterministic generic trace replay yet.
- Passing this workflow does not prove a program is generally secure.
- Bounty settlement, indexer/API, frontend integration, and emergency bypass remain deferred.
