# Milestone 5 - Deterministic Replay Verifier Quorum

## Closeout status and scope

Milestone 5 binds a revealed Milestone 4 `TraceClaim` to a deterministic replay receipt and requires a configured verifier quorum to agree on one exact result hash. It adds verifier-set governance, immutable epoch snapshots, one canonical replay round per trace claim, distinct-verifier attestations, per-result quorum counting, and permissionless finalization. A valid `InvariantViolated` quorum automatically rejects the proposal. An `InvariantHolds` (HOLD) quorum only clears the pending verification round and never approves the proposal.

This closeout covers current HEAD `b4fd9264ed20c6be5cdb69bbe7e66c005ef2819d`. The dedicated fresh-ledger suite was not rerun during closeout; its preserved successful output is recorded below.

### Threat model

The protocol protects against non-members voting, one member voting twice or equivocating in a round, votes for different result hashes being combined, result/receipt substitution, cross-policy/proposal/invariant/trace/round/epoch substitution, approval or execution while verification is pending, and execution after a confirmed violation.

The verifier set is governance-selected. The on-chain program validates identity, bindings, hash commitments, uniqueness, quorum, timing, and state transitions; it does not execute arbitrary SVM bytecode or prove that verifier software replayed honestly. Safety therefore depends on at least the configured threshold following the deterministic replay procedure.

## Constants, bounded fields, and timing

- Replay domain: ASCII `FAULTLINE_REPLAY_V1` (19 bytes).
- Verifier-set domain: ASCII `FAULTLINE_VERIFIER_SET_V1` (25 bytes).
- Maximum verifier count: 8. `VerifierEpoch.verifiers` is `#[max_len(8)]`.
- Threshold: `u8`, non-zero, and no greater than the stored verifier count.
- Result vote count: `u8`; at most one vote per epoch member can be recorded and an epoch has at most 8 members.
- Proposal pending-round count: `u16` with checked increment/decrement.
- Automatic violation reason code: `0x5001`.
- A verification round may open only if `open_slot + 2 <= challenge_end_slot`.
- Attestation and finalization require `slot <= challenge_end_slot` (the end slot is inclusive).
- Replay-result account creation has no separate clock check, but requires an open round; no vote or finalization can be accepted after the window.
- Existing Milestone 4 timing is unchanged: minimum reveal delay is 1 slot, maximum reveal horizon is 8 slots, challenge commit/reveal must remain inside the proposal challenge window, governance decision is allowed through the inclusive end slot, and execution remains strictly after it (`slot > challenge_end_slot`).

All hashes and public keys below are fixed 32-byte fields. The only variable-length field is the bounded verifier vector.

## Account schemas, discriminators, sizes, and PDA derivations

Sizes include the 8-byte Anchor account discriminator. PDA integer seeds use unsigned little-endian encoding. Anchor `Option<T>` reserves a one-byte tag plus the full `T` width.

| Account | Discriminator (hex) | Exact size | PDA seeds |
| --- | --- | ---: | --- |
| `VerifierRegistry` | `15dba88733b65881` | 122 | `["verifier-registry", safety_policy]` |
| `VerifierEpoch` | `091fba1b24474c22` | 414 | `["verifier-epoch", verifier_registry, epoch_id_le_u64]` |
| `ProposalVerificationGate` | `3b8cc3e5de6b64b0` | 77 | `["proposal-verification-gate", upgrade_proposal]` |
| `VerificationRound` | `90b269b783a0c501` | 317 | `["verification-round", trace_claim]` |
| `ReplayResult` | `b3b2d9f72f76facd` | 115 | `["replay-result", verification_round, result_hash]` |
| `VerifierAttestation` | `afd20849ce87d7c6` | 177 | `["verifier-attestation", verification_round, verifier]` |

The discriminators are the first eight bytes of SHA-256(`account:<RustTypeName>`).

### `VerifierRegistry` - 122 bytes

`8 discriminator + 32 safety_policy + 32 governance + 33 active_epoch: Option<Pubkey> + 8 next_epoch_id + 8 created_at_slot + 1 bump`.

There is one registry per SafetyPolicy. Initialization stores the policy's configured governance. Epoch creation must use exactly `next_epoch_id`; successful creation increments it with checked arithmetic. Activation changes only `active_epoch`.

### `VerifierEpoch` - 414 bytes

`8 discriminator + 32 verifier_registry + 32 safety_policy + 8 epoch_id + 260 verifiers: Vec<Pubkey>[max 8] + 1 threshold + 32 verifier_set_hash + 32 creator + 8 created_at_slot + 1 bump`.

The vector allocation is `4-byte length + 8 * 32-byte Pubkey`. Creation requires 1-8 unique keys and `1 <= threshold <= verifier_count`. Keys are sorted by raw public-key bytes before storage and hashing. There is no epoch mutation instruction; later activation leaves historical epochs and already-open rounds unchanged.

The verifier-set hash is:

```text
SHA-256(
  ASCII("FAULTLINE_VERIFIER_SET_V1") ||
  safety_policy_pubkey ||
  epoch_id_le_u64 ||
  verifier_count_u8 ||
  threshold_u8 ||
  sorted_verifier_pubkeys
)
```

### `ProposalVerificationGate` - 77 bytes

`8 discriminator + 32 proposal + 2 pending_rounds + 1 confirmed_violation + 33 last_violation_round: Option<Pubkey> + 1 bump`.

It is initialized atomically with each proposal. Opening a round increments `pending_rounds`; finalizing it decrements the counter. A finalized violation permanently sets `confirmed_violation` and `last_violation_round`; no instruction clears them.

### `VerificationRound` - 317 bytes

`8 discriminator + 32 policy + 32 proposal + 32 invariant + 32 trace_claim + 32 trace_hash + 32 candidate_buffer_hash + 32 invariant_specification_hash + 32 verifier_epoch + 1 threshold + 1 status + 8 opened_slot + 9 finalized_slot: Option<u64> + 33 winning_replay_result: Option<Pubkey> + 1 bump`.

Status encoding is `0 = Open`, `1 = InvariantHolds`, `2 = InvariantViolated`. The round snapshots the proposal candidate hash, invariant specification hash, trace hash, epoch, and threshold. The canonical PDA allows one round per trace claim.

### `ReplayResult` - 115 bytes

`8 discriminator + 32 verification_round + 32 result_hash + 1 verdict + 32 replay_receipt_hash + 1 vote_count + 8 created_at_slot + 1 bump`.

Verdict encoding is `0 = InvariantHolds` and `1 = InvariantViolated`. Each result hash has a distinct PDA and counter, so conflicting outcomes cannot pool votes.

### `VerifierAttestation` - 177 bytes

`8 discriminator + 32 verification_round + 32 verifier_epoch + 32 verifier + 32 replay_result + 32 result_hash + 8 attested_slot + 1 bump`.

The PDA uses the round and verifier, deliberately excluding the result. A verifier's second vote in the same round therefore reaches the same account and is rejected whether it repeats the first result or attempts equivocation.

## Instruction authorization matrix

| Instruction | Required signer / authority | Principal checks and effect |
| --- | --- | --- |
| `initialize_verifier_registry` | SafetyPolicy governance | Canonical policy and registry; duplicate initialization rejected. |
| `create_verifier_epoch` | SafetyPolicy governance, also equal to registry governance | Sequential epoch ID; 1-8 unique verifiers; valid threshold; immutable sorted snapshot and hash. |
| `activate_verifier_epoch` | SafetyPolicy governance, also equal to registry governance | Epoch must belong to the registry and policy; updates active epoch pointer. |
| `open_verification_round` | Any paying signer | Active policy; `ChallengeActive` proposal; canonical revealed commit/claim; current active epoch; at least two slots remain. |
| `create_replay_result` | Any paying signer | Round must be open; on-chain recomputation must equal supplied result hash. |
| `submit_verifier_attestation` | Verifier signer paying for its attestation | Verifier must be in the round's immutable epoch; proposal and round open; exact result binding; no prior vote; within challenge window. |
| `finalize_replay_result` | Any signer | Proposal and round open; selected result count meets the round threshold; within challenge window. HOLD closes only the round. VIOLATION also rejects the proposal. |

Existing governance remains the only authority for temporary approval/rejection. Approval additionally requires zero pending rounds and no confirmed violation. Existing `execute_guarded_upgrade` remains the sole Faultline instruction that signs the loader-v3 Upgrade with the Guard PDA, and it independently enforces the same verification gate before all prior proposal, time, ProgramData, buffer authority, BufferClaim, candidate-hash, and loader checks.

## Replay result encoding and hash binding

The exact replay-result preimage is 212 bytes:

```text
ASCII("FAULTLINE_REPLAY_V1")  // 19 bytes
|| proposal_pubkey             // 32 raw bytes
|| invariant_pubkey            // 32 raw bytes
|| trace_claim_pubkey          // 32 raw bytes
|| candidate_buffer_hash       // 32 bytes
|| invariant_specification_hash// 32 bytes
|| verdict_u8                  // 0 HOLD, 1 VIOLATION
|| replay_receipt_hash         // 32 bytes
```

`result_hash = SHA-256(preimage)`. There is no JSON, Base58 text, variable-length value, or length prefix in the preimage. `create_replay_result` recomputes it on chain, and every attestation recomputes it again from the immutable round snapshot and replay-result fields.

The stable Rust/TypeScript vector uses proposal bytes `0x01`, invariant `0x02`, trace claim `0x03`, candidate hash `0x04`, specification hash `0x05`, VIOLATION byte `0x01`, and receipt hash `0x06`, each repeated to its stated width. Its result is `b7eb266542e099bd41398d8b78d6d571b57844356bfe7c6f5539a73e00046921`.

The integration fixture uses `SHA-256("FAULTLINE_FIXTURE_SAFE_RECEIPT_V1")` for HOLD and `SHA-256("FAULTLINE_FIXTURE_AUTH_001_VIOLATION_V1")` for the AUTH-001 violation receipt.

## Quorum and proposal behavior

- Verifier identity comes from the signer and membership in the round's stored epoch.
- Exactly one attestation PDA exists per `(verification_round, verifier)`.
- `vote_count` belongs to one exact replay-result account. Only matching result hashes count together.
- Finalization requires `vote_count >= round.threshold`; finalization is permissionless.
- HOLD sets round status to `InvariantHolds`, records the winner/finalization slot, and decrements the pending counter. It does not decide, approve, reject, or execute the proposal.
- VIOLATION performs the same round finalization, permanently marks the proposal verification gate, and sets the proposal to `Rejected` with decision authority equal to the Faultline Gate program ID, decision slot equal to the finalization slot, and reason code `0x5001`.
- A round cannot be finalized twice. Rejected, expired, executed, or draft proposals cannot open a round.

The proposal's candidate address and candidate buffer hash are never mutated by verifier instructions. The round copies the committed candidate hash rather than accepting a replacement. InvariantDefinition and TraceClaim accounts are read-only throughout verification. Milestone 4 challenge/reveal commitments, canonical TraceClaim uniqueness, and BufferClaim single use remain enforced.

## Exact Milestone 5 custom errors

Anchor custom errors start at 6000 in declaration order. The Milestone 5-specific errors are:

| Code | Name | Exact message |
| ---: | --- | --- |
| 6001 | `ConfirmedInvariantViolation` | A confirmed invariant violation permanently blocks this proposal |
| 6002 | `CounterOverflow` | Verification counter overflow |
| 6003 | `CounterUnderflow` | Verification counter underflow |
| 6004 | `DuplicateVerifier` | Verifier appears more than once in the epoch |
| 6005 | `EmptyVerifierSet` | Verifier set must not be empty |
| 6006 | `InvalidThreshold` | Verifier threshold is invalid |
| 6007 | `NoActiveVerifierEpoch` | No active verifier epoch is configured |
| 6008 | `QuorumNotReached` | Replay result has not reached quorum |
| 6009 | `ReplayResultMismatch` | Replay result commitment does not match its bound inputs |
| 6010 | `RoundAlreadyExists` | A verification round already exists for this trace claim |
| 6011 | `RoundNotOpen` | Verification round is not open |
| 6012 | `TooManyVerifiers` | Verifier set exceeds the protocol maximum |
| 6013 | `UnauthorizedVerifier` | Signer is not a member of the round's verifier epoch |
| 6014 | `VerifierAlreadyAttested` | Verifier already attested in this round |
| 6015 | `VerificationPending` | A verification round is still pending |
| 6016 | `VerificationWindowEnded` | The verification window has ended or too little time remains |
| 6017 | `ChallengeNotRevealed` | Challenge commitment has not been revealed |
| 6018 | `WrongInvariantBinding` | Account belongs to another invariant |
| 6019 | `WrongPolicyBinding` | Account belongs to another policy |
| 6020 | `WrongProposalBinding` | Account belongs to another proposal |
| 6021 | `WrongRoundBinding` | Replay result belongs to another verification round |
| 6022 | `WrongResultBinding` | Replay result binding is incorrect |
| 6023 | `WrongTraceBinding` | Trace account binding is incorrect |
| 6024 | `WrongVerifierEpoch` | Verifier epoch binding is incorrect |

`ArithmeticOverflow` remains code 6000. Governance authorization uses `UnauthorizedGovernance` code 6050 with message `Only configured governance may perform this action`. Canonical account creation or substitution may be rejected earlier by Anchor's exact framework errors, including `AccountNotInitialized` (3012), `ConstraintSeeds` (2006), or already-in-use/account-initialization failure; the suite accepts those only where the account constraint necessarily precedes the custom handler check.

## Assertions 1-55 and produced evidence

The preserved fresh-ledger run ended with `ALL MILESTONE-5 VERIFIER QUORUM ASSERTIONS 1-55 PASSED` at slot 88. Its coverage was:

| Assertion | Verified behavior |
| ---: | --- |
| 1 | Registry initializes at its canonical PDA. |
| 2 | Duplicate registry initialization is rejected. |
| 3 | Non-governance registry initialization is rejected. |
| 4 | Empty verifier set is rejected. |
| 5 | Zero threshold is rejected. |
| 6 | Threshold above verifier count is rejected. |
| 7 | Duplicate verifier is rejected. |
| 8 | Non-governance epoch creation is rejected. |
| 9 | Epoch fields, canonical ordering, and verifier-set hash match. |
| 10 | Non-governance activation is rejected. |
| 11 | Governance activation succeeds. |
| 12 | Historical epoch remains immutable after later activation. |
| 13 | A valid revealed trace opens the canonical round. |
| 14 | A duplicate round is rejected. |
| 15 | An unrevealed/nonexistent claim cannot open a round. |
| 16 | A foreign TraceClaim is rejected. |
| 17 | A wrong proposal binding is rejected. |
| 18 | A wrong invariant binding is rejected. |
| 19 | A non-active/wrong verifier epoch is rejected for a new round. |
| 20 | Candidate and invariant-specification snapshots cannot be substituted. |
| 21 | Draft, rejected, expired, and executed proposals cannot open rounds. |
| 22 | Opening increments the pending-round counter exactly once. |
| 23 | Governance approval is blocked while a round is pending. |
| 24 | Guard execution is blocked while a round is pending. |
| 25 | Non-member attestation is rejected. |
| 26 | A valid member attestation succeeds. |
| 27 | Attestation fields match the round, epoch, verifier, result, and hash. |
| 28 | Duplicate voting is rejected. |
| 29 | Equivocation to a different result is rejected. |
| 30 | Wrong receipt/result hash is rejected. |
| 31 | Epoch substitution during attestation is rejected. |
| 32 | Split conflicting results do not combine vote counts. |
| 33 | Finalization before threshold is rejected. |
| 34 | Two matching HOLD attestations reach the 2-of-3 quorum. |
| 35 | HOLD finalization is permissionless. |
| 36 | HOLD finalization returns the pending counter to zero. |
| 37 | HOLD leaves the proposal `ChallengeActive`, undecided, and unexecuted. |
| 38 | Governance approval becomes possible only after pending verification clears. |
| 39 | Approved proposal still cannot execute before the challenge window ends. |
| 40 | The real Guard loader-v3 upgrade succeeds after the window. |
| 41 | Two matching VIOLATION attestations reach quorum. |
| 42 | VIOLATION finalization is permissionless and automatically rejects. |
| 43 | Automatic rejection records the Gate authority, slot, and reason `0x5001`. |
| 44 | Pending returns to zero and the violation flag/round are permanently recorded. |
| 45 | Governance cannot approve the rejected proposal. |
| 46 | The Guard cannot execute a confirmed violation. |
| 47 | Re-finalization is rejected. |
| 48 | HOLD never auto-approves a proposal. |
| 49 | Candidate address/hash remain unchanged throughout verification. |
| 50 | InvariantDefinition and TraceClaim remain immutable. |
| 51 | An old-epoch round remains valid after a newer epoch activates. |
| 52 | New rounds bind only to the newly active epoch. |
| 53 | Rust and TypeScript replay-result vectors match. |
| 54 | Direct loader-v3 bypass remains rejected by incorrect authority. |
| 55 | BufferClaim remains single-use. |

The suite used real transaction simulation/on-chain logs for expected failures; client-side construction errors did not count as passing rejection evidence.

### Captured successful transaction signatures

These are the exact signatures printed by the suite and preserved in `.localnet/verifier-quorum-evidence.log`; no deployment signature was printed by the captured CLI JSON, so none is invented here.

| Action | Signature |
| --- | --- |
| HOLD attestation 1 | `44wJsACgyK1DJpNPCWDSbUZhgd4gZ2ZJrcxorBv1nhaMiwUWkrXkzeP7vEVfb8fw5XvNsYuTi8NuGBtCeF3g2L7j` |
| HOLD attestation 2 | `gmFC4grcUTPHMQ2A8xuetubH14esFYuJFpvtdQeT3iHwRyCfxQpUXFcU1tfD9t2p2Qv7wGRsKtEW6JG1GRd6ZbJ` |
| HOLD finalization | `2qr7B9oebjQvYWXyV8h9Zy8DQeRuXTFqDs8fT3ymnpUgeoTcbMZmZgfMG7nQWGhmmG7wkmNxHBWkb36i4LFaEbmk` |
| VIOLATION attestation 1 | `2nViEWZTd8ZMUFSPNf7cSbQykJrkoc4fn8BWJhrhHTN4EvS5Mo3kZ69SCFWQkpMu2hU6QEVZCXzMTiY5tiBX6YEM` |
| VIOLATION attestation 2 | `33AYb26Z4N3XFnx54pEbY5hhqQ6RrJxDFb1YUzr6k11ThP5N1En59GfreXNYCEsS5xvaxLYU7UpQ6i4QB7o8JL14` |
| VIOLATION finalization | `yFFnEpdaijtpSavGNchVZkqhV5w5mpa7qS2kcqpbEEvfP8m65hs13b5vNaMyM3Y1MZUb15jdErh341BvC7fvVnw` |
| Guarded Treasury v2 upgrade | `2vhEUjTHecsna6tqgu3XfCqCBkgaZz9rj1CHiaAeT1JnJFqRh5k18xxWCs1jhsXt7moQjm2oqKpMcCTRA41hBYQZ` |

## Fresh-ledger runner and measured timings

`scripts/run-verifier-quorum-tests.ps1` refuses to attach when TCP port 8899 is occupied. It resolves the ledger to `.localnet/verifier-quorum`, verifies that its parent is exactly `.localnet`, rejects a reparse-point ledger before deletion, creates a fresh ledger, launches a hidden validator with `--reset --rpc-port 8899 --faucet-port 9900 --ticks-per-slot 1024 --log`, records the owned PID, and passes the run's genesis hash to the TypeScript suite so the suite refuses a different validator.

Deployments and the TypeScript process run as owned, redirected child processes with explicit deadlines, 30-second heartbeat diagnostics, validator-slot reporting, and stdout/stderr/validator-log tails on failure. The executable Treasury v2 loader buffer uses bounded 800-byte writes, 32-wide batches, a 720-second upload deadline, and progress output. The runner's `finally` stops only the validator PID it started and clears the genesis environment variable.

Measured successful run:

| Stage | Time |
| --- | ---: |
| Validator readiness | 1.590 s |
| Faultline Gate deployment | 192.627 s |
| Gate finalization | 15.939 s |
| Treasury v1 deployment | 96.634 s |
| TypeScript verifier-quorum suite | 1,620.491 s |
| Executable Treasury v2 buffer upload | 351 transactions, 280,168 bytes, 192.317 s |

The suite completed at slot 88. Evidence records cleanup of owned validator PID 8224. The post-run closeout check confirmed port 8899 was free.

### Windows Solana 1.18.10 snapshot limitation

On Windows, Solana 1.18.10 local-validator snapshot creation depends on filesystem link behavior that is not reliable for this long-running suite. The runner uses `--ticks-per-slot 1024` so the finite test completes before the snapshot boundary and does not rely on snapshot creation. This is a local test-harness constraint, not an on-chain timing parameter.

## Remaining product limitations

- Governance selects verifier membership and threshold; there is no permissionless admission or on-chain proof of independence.
- There is no staking, slashing, bounty/escrow, token-economic Sybil resistance, or verifier liveness mechanism.
- Receipts are represented by a 32-byte hash. The full replay transcript, input availability, and replay engine are off chain.
- The program does not provide generalized SVM emulation, ZK proof verification, or proof of arbitrary-program correctness.
- A compromised threshold can attest to a false result. A missing threshold can leave a round pending until the proposal expires.
- Expiry after the challenge window remains permissionless even if a round is pending; historical round/result/attestation accounts remain queryable, but an expired proposal cannot be revived.
- HOLD means only that the configured quorum agreed on the bound HOLD receipt. It deliberately does not approve the proposal.
- This milestone adds no frontend or indexer/RPC product surface.

## Closeout verification commands

The formal closeout runs, without rerunning the already-passed verifier-quorum suite:

```powershell
cargo fmt --all -- --check
cargo test --workspace --all-targets --locked
npm.cmd run typecheck
npm.cmd run build:programs
npm.cmd run test:challenge-commit-reveal
npm.cmd run test:proposal-state-machine
npm.cmd run test:treasury-versions
git diff --check
git status --short
git diff --stat
```

Each frozen regression runner owns a fresh isolated ledger, refuses an occupied port 8899, and cleans up only its owned validator process.

### Recorded closeout results

- `cargo fmt --all -- --check`: passed.
- `cargo test --workspace --all-targets --locked`: passed, 5 tests total (Gate 4, Treasury 1).
- `npm.cmd run typecheck`: passed after the closeout documentation and legacy test-account correction.
- `npm.cmd run build:programs`: passed. The first sandboxed attempt could not create Solana 1.18.10's rustup link under the user profile; the unchanged command passed with the required profile access and created no repository shim.
- Faultline Gate SHA-256: `03b455a8130b30876ffecd3d076fec8f636f9c05be1269f7f2e20a85752c3ec2`.
- Treasury v1 SHA-256: `88869cecff32a3bc24bfa3e1ab2bd40a32852b93f6638d9028f7eff1d5eac34f`.
- Treasury v2 SHA-256: `82bf0adc96092daeae5758715ba1e05d7c9b272b03b8588e62ec3858ef4b4f6a`.
- Treasury v3 SHA-256: `8ef2ad4bd0b7bf799ebe82ce17984b8ec80d55b47bd5ea5b9ec6aa304010fffa`.
- Treasury v1/v2/v3 hashes are pairwise distinct.
- Milestone 4 frozen regression: assertions 1-36 passed at slot 70 after adding the required `ProposalVerificationGate` account to its existing temporary-decision transaction helper. No assertion or production semantic changed.
- Milestone 3 frozen regression: policy, terminal, and authority shards passed; assertions 1-39 passed. Final shard slots were 28, 39, and 36 respectively.
- Treasury regressions: v2 reproduced AUTH-001 (`treasury_vault=900000000`, `attacker=100000000`, `withdrawn=100000000`); v3 rejected the same trace (`treasury_vault=1000000000`, `attacker=0`) and its legitimate migration/deposit/new-admin-withdraw checks passed.
- All regression runners used fresh scenario-specific ledgers and stopped their owned validator PIDs. Final port 8899 check was free.
