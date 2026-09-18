# Milestone 4 — Executable invariant registry and permissionless commit/reveal

## Result and scope

Milestone 4 adds immutable invariant definitions and permissionless, hunter-bound challenge commitments to the canonical Milestone 3 `SafetyPolicy` and `UpgradeProposal` lifecycle. A successful reveal records provenance; it does not decide whether a trace is valid, change the proposal, reject an upgrade, or pay a hunter.

The trust path contains no LLM or subjective judge. Commitment verification is deterministic SHA-256 over a fixed byte layout.

This is a local-validator proof over a toy treasury. It proves challenge provenance and resistance to simple reveal front-running. It does not prove the candidate program secure.

## Threat model

The milestone addresses:

- governance rewriting an invariant after publication;
- a non-governance signer registering or disabling policy invariants;
- commitment replay across proposals, invariants, or hunters;
- a different hunter copying a revealed preimage;
- reveal before the minimum delay or after the bounded deadline;
- duplicate claims for the same trace on one proposal;
- account substitution across policies and proposals;
- challenge actions mutating proposal artifact commitments or reaching the Guard signer.

The invariant specification and trace remain content-addressed off-chain artifacts. On-chain hashes are integrity commitments, not proof that an evaluator or trace is correct.

## Accounts and sizes

Sizes include the 8-byte Anchor discriminator.

### `InvariantDefinition` — 164 bytes

| Field | Type |
| --- | --- |
| `safety_policy` | `Pubkey` |
| `invariant_id` | `u64` |
| `invariant_kind` | `InvariantKind` |
| `name_hash` | `[u8; 32]` |
| `specification_hash` | `[u8; 32]` |
| `enabled` | `bool` |
| `created_by` | `Pubkey` |
| `created_at_slot` | `u64` |
| `disabled_at_slot` | `Option<u64>` |
| `bump` | `u8` |

Supported kinds are `Authorization`, `AssetConservation`, `BalancePreservation`, `Solvency`, and `PrivilegeBoundary`. Identity, kind, hashes, creator, and policy are immutable. Governance may change only `enabled` and `disabled_at_slot`.

PDA:

```text
["invariant", safety_policy, invariant_id.to_le_bytes()]
```

### `ChallengeCommit` — 204 bytes

| Field | Type |
| --- | --- |
| `proposal` | `Pubkey` |
| `invariant` | `Pubkey` |
| `hunter` | `Pubkey` |
| `commitment_hash` | `[u8; 32]` |
| `committed_at_slot` | `u64` |
| `earliest_reveal_slot` | `u64` |
| `latest_reveal_slot` | `u64` |
| `status` | `Committed | Revealed` |
| `revealed_trace_hash` | `Option<[u8; 32]>` |
| `revealed_at_slot` | `Option<u64>` |
| `bump` | `u8` |

PDA:

```text
["challenge-commit", proposal, hunter, commitment_hash]
```

Proposal, invariant, hunter, commitment, and timing fields never change. Reveal changes only status and the two reveal-result fields.

### `TraceClaim` — 177 bytes

| Field | Type |
| --- | --- |
| `proposal` | `Pubkey` |
| `invariant` | `Pubkey` |
| `challenge_commit` | `Pubkey` |
| `trace_hash` | `[u8; 32]` |
| `hunter` | `Pubkey` |
| `revealed_at_slot` | `u64` |
| `bump` | `u8` |

PDA:

```text
["trace-claim", proposal, trace_hash]
```

The PDA gives one first-revealer record per `(proposal, trace_hash)`. There is no close, rewrite, or transfer instruction.

## Commitment encoding

The preimage is exactly 182 bytes:

```text
ASCII("FAULTLINE_CHALLENGE_V1")  // 22 bytes
|| proposal_pubkey                // raw 32 bytes
|| invariant_pubkey               // raw 32 bytes
|| hunter_pubkey                  // raw 32 bytes
|| trace_hash                     // 32 bytes
|| salt                           // exactly 32 bytes
```

No JSON, length prefix, Base58 text, URL, or variable-length user data is included. Rust uses Solana `hashv`; TypeScript concatenates the same raw byte slices and uses SHA-256.

Shared vector:

```text
proposal    = 0x01 repeated 32 times
invariant   = 0x02 repeated 32 times
hunter      = 0x03 repeated 32 times
trace_hash  = 0x04 repeated 32 times
salt        = 0x05 repeated 32 times
SHA-256     = 2dcc933f3307286860900dcdf1225659b4fcfcc4dcad16d659c907f20c4174f0
```

## Instructions and authorization

| Instruction | Signer | Key enforcement |
| --- | --- | --- |
| `initialize_invariant` | policy governance | canonical policy/invariant PDAs; non-zero name and specification hashes; starts enabled |
| `set_invariant_enabled` | policy governance | exact policy ownership; changes only enabled state and disable slot; repeated state rejected |
| `commit_challenge` | any hunter | hunter signature; Active policy; ChallengeActive proposal; same-policy enabled invariant; non-zero commitment; active window and reveal time remaining |
| `reveal_challenge` | original hunter | exact stored proposal/invariant/hunter; Committed state; reveal bounds; canonical commitment; unique trace claim |

Re-enabling is explicit and tested: governance may set a disabled invariant back to enabled, which clears `disabled_at_slot`. The historical definition and any challenge records are not changed.

Events are `InvariantInitialized`, `InvariantStatusChanged`, `ChallengeCommitted`, and `ChallengeRevealed`.

## Timing and state rules

For a commitment at slot `C` and proposal end `E`:

```text
earliest_reveal_slot = C + 1
latest_reveal_slot   = min(C + 8, E)
```

Arithmetic is checked. A commit fails if `C` is outside the active proposal window or `C + 1 > E`. Reveal accepts the inclusive range:

```text
earliest_reveal_slot <= current_slot <= latest_reveal_slot
```

All protocol timing tests advance slots with transactions. Wall-clock sleeps are not used to satisfy state transitions.

## Guard and candidate isolation

Milestone 4 adds no upgrade route. `execute_guarded_upgrade` remains the only instruction that calls loader-v3 `Upgrade` with `invoke_signed` and the Guard PDA seeds.

Commit and reveal accounts are orthogonal to the loader path. Neither instruction receives writable `UpgradeProposal`, `BufferClaim`, candidate Buffer, ProgramData, target Program, nor Guard accounts. Assertion 34 verifies failed attempts preserve candidate address/hash; assertion 35 verifies successful reveal leaves the proposal `ChallengeActive`, undecided, and unexecuted.

The existing Buffer authority handoff, candidate SHA-256 binding, `BufferClaim` single-use protection, ProgramData authority validation, and loader account checks remain unchanged.

## Dedicated localnet proof

Command:

```powershell
npm.cmd run test:challenge-commit-reveal
```

The runner refuses an occupied port 8899, creates a fresh `.localnet/challenge-commit-reveal` ledger, records one child PID, deploys the immutable Gate and upgradeable treasury after genesis, and stops only that child in `finally`.

Installed Solana 1.18.10 does not expose `--full-snapshot-interval-slots`, `--incremental-snapshot-interval-slots`, or a snapshot-generation disable flag in `solana-test-validator --help`; both interval arguments are rejected as unknown. Windows snapshot creation around slot 100 requires unavailable symlink privileges. The runner therefore uses `--ticks-per-slot 1024`, and the passing run finished at slot 67.

The executable candidate is a genuine loader-v3 Buffer containing the exact treasury v2 ELF. The harness uploads it with bounded batches of loader `Write` transactions, collectively confirms each batch, and verifies the resulting bytes before authority handoff.

Passing upload evidence:

```text
transactions=351
elapsed_ms=192964
start_slot=28
end_slot=40
```

### Assertions 1–36

| # | Result |
| --- | --- |
| 1 | Governance initialized the expected invariant PDA and fields. |
| 2 | Duplicate invariant ID rejected (`AccountAlreadyInitialized`/account already in use). |
| 3 | Non-governance initialization rejected (`UnauthorizedGovernance`). |
| 4 | Zero name hash rejected (`ZeroNameHash`). |
| 5 | Zero specification hash rejected (`ZeroSpecificationHash`). |
| 6 | Non-governance disable rejected (`UnauthorizedGovernance`). |
| 7 | Governance disable succeeded. |
| 8 | Disabled invariant commit rejected (`InvariantDisabled`). |
| 9 | Governance re-enable succeeded without changing immutable hashes. |
| 10 | Draft proposal commit rejected (`ChallengeNotActive`). |
| 11 | Paused policy commit rejected (`PolicyPaused`). |
| 12 | Random permissionless hunter committed during `ChallengeActive`. |
| 13 | Commitment owner, PDA, identities, hash, and timing fields matched. |
| 14 | Duplicate commitment rejected (account already in use). |
| 15 | Wrong-policy invariant rejected (`ConstraintSeeds`). |
| 16 | Wrong proposal/policy binding rejected (`ConstraintSeeds`). |
| 17 | Commit without one reveal slot remaining rejected (`InsufficientRevealWindow`). |
| 18 | Same-slot reveal rejected (`RevealTooEarly`). |
| 19 | Different hunter reveal rejected (`UnauthorizedHunter`). |
| 20 | Wrong salt rejected (`CommitmentMismatch`). |
| 21 | Wrong trace hash rejected (`CommitmentMismatch`). |
| 22 | Wrong same-policy invariant rejected (`WrongChallengeInvariant`). |
| 23 | Wrong proposal account rejected (`ConstraintSeeds`). |
| 24 | Valid reveal succeeded. |
| 25 | `ChallengeCommit` stored exact trace hash and reveal slot. |
| 26 | `TraceClaim` stored first-revealer provenance. |
| 27 | Second reveal of one commitment rejected (`ChallengeAlreadyRevealed`). |
| 28 | Same trace claimed through another commitment rejected (`TraceAlreadyClaimed`). |
| 29 | Reveal after latest slot rejected (`RevealWindowEnded`). |
| 30 | Commit after proposal end rejected (`ChallengeWindowEnded`). |
| 31 | Rejected proposal commit rejected (`ChallengeNotActive`). |
| 32 | Expired proposal commit rejected (`ChallengeNotActive`). |
| 33 | Executed proposal commit rejected (`ChallengeNotActive`). |
| 34 | Failed commit/reveal attempts left proposal and candidate metadata unchanged. |
| 35 | Successful reveal left proposal ChallengeActive and did not decide or execute it. |
| 36 | Rust and TypeScript commitment helpers matched the shared vector. |

Evidence signatures:

| Action | Signature |
| --- | --- |
| Permissionless commit | `3pvM5iCKHpHkZneFYxEk8Pobs9BasjxDWrQevtVWRC2txkYA95yhpWpCTPDVZeQxALfFVTXTuTGBkYTNEdmLnyko` |
| Valid reveal | `AFKx7LLgtD3H7TQWt5uy1EpSx1XBbgrS1uAsJuk56ihbFtCCjaq3HZ5g1AiXYaYXMpxJ2D5NninTuqv7BXr2vvX` |
| Guarded loader-v3 upgrade | `2VinpEbQncamU4xbd9W6chBRbMrFnPanBU745Yzcft7qeV4J2Yk1hP4AHbNzj98T1XzHKVzYw7HMFwV6uk4guygh` |

## Current limitations

- No verifier quorum exists yet.
- No deterministic trace replay verdict is recorded or trusted.
- A reveal does not automatically reject or approve a proposal.
- No bounty escrow, payout, bond, or settlement exists.
- No verifier or hunter slashing exists.
- No indexer, API, or frontend integration is included.
- Governance's Milestone 3 temporary decision bridge still determines approval/rejection.
- Passing this workflow proves provenance and commitment integrity, not general program security.
