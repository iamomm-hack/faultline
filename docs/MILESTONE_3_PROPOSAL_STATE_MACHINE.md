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
npm.cmd run test:proposal-state-machine
```

`demo:proposal` prints policy, Draft proposal, challenge slots, early-execution rejection, temporary decision, slot progression, the real Guard loader CPI, version check, and repeated-execution rejection.

The lifecycle demonstration uses transaction-driven slot advancement, never wall-clock sleeping. The expanded negative-case matrix remains the acceptance gate for declaring this milestone complete.

## Localnet acceptance proof

The dedicated runner creates independent `.localnet/proposal-policy`, `.localnet/proposal-terminal`, and `.localnet/proposal-authority` ledgers. For each shard it records one validator PID, deploys an immutable Gate and upgradeable treasury v1 through the proven post-genesis loader-v3 flow, runs one assertion group, and stops only that owned validator in `finally`.

Solana 1.18.10 on Windows attempts a slot-100 snapshot using an unavailable symlink privilege. The supported `--ticks-per-slot 1024` setting keeps each deterministic shard below that boundary while preserving genuine transactions and slot-driven challenge progression. The passing run completed policy at slot 26, terminal at slot 37, and authority at slot 32.

| Shard | Assertions | Proven behavior |
| --- | --- | --- |
| policy | 1–14 | Policy initialization and uniqueness; governance status authorization; paused submission; Guard/target seed binding; exact candidate hash; unlocked-buffer rejection and rollback; duplicate proposal; minimum window; Draft execution rejection; challenge and decision authorization; early execution rejection |
| terminal | 15–23 | Late-decision and early-expiry rejection; Expired and Rejected terminal states; one real Guard loader-v3 upgrade; treasury v2 behavior; retained execution metadata; all repeated Executed transitions rejected |
| authority | 24–39 | Direct-loader rejection; Guard and buffer locking; BufferClaim reuse; missing claim (29a); initialized foreign candidate plus claim substitution (29b); immutable commitment; policy/proposal/target/ProgramData/loader/buffer/Guard substitution; real guarded execution |

Candidate integrity is enforced by SHA-256 over exact loader-v3 Buffer account data, transfer of buffer authority to the Guard before proposal creation, and a `BufferClaim` that binds one buffer to one proposal. Execution rechecks the stored buffer address and hash before the Guard PDA signs the loader-v3 CPI.

Confirmed failed on-chain transactions:

- Assertion 24, original deployer: `4atp15X8waRUFnaYhGo1MUwq39xvbkBhb4A5unrFs7fLpNTvU1NA4zk8sEi9WogfmykRMZaGAjFp9SC8Uo2dHTqZ` — `IncorrectAuthority`.
- Assertion 25, random wallet: `TBcuGp14VkQ4LdfyWC15V5gTq9eVYVGpcuFqpx6mvDrRkL9q2LduWsWnLbR35ui1DkCVAAfirqFzPMaan65Sj5h` — `IncorrectAuthority`.
- Assertion 27, previous buffer authority write: `iN7363QacjMFxHWKUFzzhL4EFGe9Ri1FhGdp1Gvi13fbhkdjxvjP2HXEaPDH38WywQvsrx2a4SpVwdjThgvaKau` — `IncorrectAuthority`.

Successful guarded upgrades:

- Terminal shard: `2PUy55yfnzAHHG5HQbK2BZbAHaRnuV98G9AXw7GdrNugc9tdSSKpRfgqEH89kPjs7faSjsa76ii7gQxWTAPvcbR1`.
- Authority shard: `2Dj6zb4biNYm14sZTheXuzvpZD6GotibfdaLtzS5naY1oqPu5dBicKKrPzUJpUJBX5zjJTsSkmFzWrt6R5PFxBnv`.

Both guarded paths used the genuine loader-v3 ProgramData and Guard-PDA CPI. Treasury reported version 2 after execution.

## Limitations

- Governance makes temporary decisions in this milestone; this is not decentralized verification.
- Permissionless challenge submission/reveal remains a future milestone.
- Independent deterministic replay and verifier quorum remain future milestones.
- Bounty settlement remains a future milestone.
- Passing this workflow does not prove a program is generally secure.
- Indexer/API, frontend integration, and emergency bypass remain deferred.
