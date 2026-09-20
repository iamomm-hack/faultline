# Milestone 6 Frozen Economic Specification

## Status and scope

This document freezes the Milestone 6 design before its three implementation passes. Milestone 6 adds deterministic bounty, challenger-bond, verifier-stake, verifier-fee, objective-slash, and refund accounting to the existing Milestones 1-5 protocol. It does not add another proposal verdict, loader route, permissionless verifier-admission mechanism, protocol token, subjective governance slash, admin withdrawal, frontend, indexer, API, CLI, or Milestone 7 feature.

Pass 1 implements only the economic foundation: account schemas, constants, immutable sequential policies, legacy Tokenkeg validation, policy-specific stake lifecycle, epoch-policy bindings, and proposal funding. Bond integration, economic rounds, settlement, claims, slashing, and cleanup remain later Milestone 6 passes.

The existing `ProposalVerificationGate` is still the sole automatic-rejection record. `finalize_replay_result` remains the sole replay verdict finalizer. `execute_guarded_upgrade` remains Faultline's sole loader-v3 route. Every existing account layout, discriminator, PDA, enum discriminant, error code, commitment preimage, and replay-result preimage is preserved.

## Frozen constants

| Constant | Value |
|---|---:|
| `ECONOMIC_POLICY_FIRST_CONFIG_ID` | 0 |
| `ECONOMIC_ENFORCEMENT_DELAY_SLOTS` | 32 |
| `MAX_VERIFIERS` | 8 |
| `MAX_BONDED_CHALLENGES` | 8 |
| `BPS_DENOMINATOR` | 10,000 |
| `HOLD_BOND_SLASH_BPS` | 2,500 (25%) |
| `HUNTER_NON_REVEAL_SLASH_BPS` | 10,000 (100%) |
| fee-claim grace | 1..=216,000 slots |
| objective-slash grace | 1..=216,000 slots |
| stake-withdraw cooldown | 1..=1,296,000 slots |

All configured capital amounts are positive `u64` values. Arithmetic is checked. Percentage arithmetic uses `u128`, divides by 10,000 once, and rounds down.

## Token boundary

Only the legacy SPL Token program `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` is supported. Token-2022 is not supported. A payment mint must be a valid initialized 82-byte Tokenkeg Mint with no freeze authority; its decimals are snapshotted in the immutable EconomicPolicy.

Funder, hunter, and verifier canonical associated token accounts must already exist during their respective setup operations. Permissionless settlement never creates somebody else's ATA. Every ATA is checked against the legacy Associated Token derivation, owner, mint, initialized state, and Tokenkeg ownership.

Raw vaults are 165-byte Tokenkeg accounts. ProposalEscrow controls BountyVault, FeeVault, and PenaltyVault; ChallengeBond controls BondVault; VerifierStake controls StakeVault. The PDA owner is also the Tokenkeg close authority because the token account's optional close authority is unset. Vault rent returns only to the recorded setup payer: proposal funder, hunter, or verifier respectively.

Vault initialization is resistant to lamport dusting. An unallocated system-owned vault PDA is normalized to the exact rent-exempt balance, PDA-signs System Program `Allocate` and `Assign`, and is then initialized by Tokenkeg. A non-system-owned or already allocated address is rejected. All of these CPIs remain atomic with the enclosing instruction.

## Accounts and PDAs

All sizes include the eight-byte Anchor discriminator.

| Account | Size | Discriminator | PDA seeds |
|---|---:|---|---|
| `EconomicPolicyRegistry` | 97 | `b7 6f 19 ea bb 28 65 99` | `['economic-policy-registry', SafetyPolicy]` |
| `EconomicPolicy` | 251 | `9a e6 27 aa ee 39 e1 e8` | `['economic-policy', EconomicPolicyRegistry, config_id_le]` |
| `ProposalEscrow` | 370 | `8b 7f 61 7d 11 a0 4d 25` | `['proposal-escrow', UpgradeProposal]` |
| `ChallengeBond` | 211 | `5b 4c 2e 8a 24 40 06 ee` | `['challenge-bond', ChallengeCommit]` |
| `VerifierStake` | 212 | `2f aa 0c 2b b7 d5 ad 7b` | `['verifier-stake', EconomicPolicy, verifier]` |
| `VerifierEpochEconomics` | 113 | `dd 77 98 cd 6a e8 71 e2` | `['verifier-epoch-economics', VerifierEpoch, EconomicPolicy]` |
| `RoundEconomicState` | 139 | `21 ad ea b2 ae 0f 7c 3e` | `['round-economics', VerificationRound]` |
| `VerifierFeeClaim` | 153 | `f4 05 8d 39 e2 10 f2 bf` | `['verifier-fee-claim', VerificationRound, verifier]` |
| `VerifierSlashReceipt` | 153 | `e4 d0 83 cf 68 1f db 7e` | `['verifier-slash', VerificationRound, verifier]` |

Vault PDAs are `['bounty-vault', proposal]`, `['fee-vault', proposal]`, `['penalty-vault', proposal]`, `['bond-vault', ChallengeCommit]`, and `['stake-vault', EconomicPolicy, verifier]`.

### EconomicPolicyRegistry

Fields are `safety_policy: Pubkey`, `governance: Pubkey`, `next_config_id: u64`, `economic_enforcement_slot: u64`, `created_at_slot: u64`, and `bump: u8`. Initialization fixes the enforcement slot to the checked sum of the current slot and 32. The first config ID is zero. Policy creation requires the exact next ID and advances the counter atomically. Failed creation consumes no ID. Historical EconomicPolicy accounts have no update or close instruction.

### EconomicPolicy

Fields are registry, SafetyPolicy, governance, payment mint, token program, config ID, mint decimals, bounty, challenger bond, verifier fee, minimum verifier stake, verifier non-reveal slash amount, maximum bonded challenges, three bounded delays, creation slot, and bump. All capital values are non-zero; slash amount cannot exceed minimum stake; challenge count is 1..=8; fee-reserve multiplication must fit `u64`.

### ProposalEscrow

The account binds proposal, immutable EconomicPolicy, original funder, payment mint, three distinct vaults, bounty and fee reserve liabilities, bounded commit/bond/round counters, bounty status, canonical winning round/trace, timing, cumulative transfers, and bump. The original funder is the only refund beneficiary. No governance or admin withdrawal exists.

### ChallengeBond

The account binds ChallengeCommit, ProposalEscrow, hunter, BondVault, fixed hunter rent recipient, amount, settlement status, funding/settlement slots, refunded/forfeited totals, and bump. It remains allocated as a settlement tombstone after its vault closes. `RevealedUnopenedReturned` is a distinct terminal economic status.

### VerifierStake

Stake is keyed by EconomicPolicy plus verifier, so a stake can never satisfy another policy or mint. Fields bind the policy, verifier, vault, mint, verifier rent recipient, recorded stake, monotonic `slash_lock_until_slot`, withdrawal request/availability, cumulative slashes, status, and bump. Status is Active or WithdrawalPending. There is no governance withdrawal and no ambiguous epoch-membership counter.

### Epoch and round companions

VerifierEpochEconomics immutably binds one existing VerifierEpoch to one EconomicPolicy after governance supplies exactly the epoch's sorted policy-specific stake accounts. Existing VerifierEpoch bytes never change. RoundEconomicState records the round, proposal escrow, epoch-economic binding, terminal economic status, exact fee/slash deadlines, opening/closing slots, and bump.

Fee-claim and slash-receipt PDAs are permanent idempotency records.

## Capital rules

The exact proposal fee reserve is:

```text
verifier_fee_amount * MAX_VERIFIERS * max_bonded_challenges
```

Each multiplication is checked. `max_bonded_challenges` counts only successfully created bonded ChallengeCommit accounts. One commit can reveal once, one canonical trace can open one round, an epoch has at most eight distinct verifiers, and each round/verifier pair has one canonical fee-claim PDA. Claims therefore cannot exceed the reserve. Failed atomic commits do not increment counters.

The bounty is paid only to the first canonical accepted VIOLATION hunter. Every matching attestation recorded before finalization earns one fixed fee. Unclaimed fees become refundable to the original proposal funder strictly after the fee deadline. Invalid/HOLD activity never spends bounty capital. Protocol fee is zero. Penalties and objective slashes enter PenaltyVault and ultimately refund to the original proposal funder.

## Deadlines and locks

For challenge end `E`, fee grace `F`, slash grace `S`, cooldown `C`, withdrawal request `R`, and existing stake lock `L`:

```text
fee_claim_deadline       = E.checked_add(F)
objective_slash_deadline = E.checked_add(S)
escrow_refund_slot       = E.checked_add(max(F, S))
withdrawal_available     = max(R, L).checked_add(C)
```

Fee and slash actions are valid through their deadline inclusively. Escrow refund requires the current slot strictly after its refund slot. Withdrawal requires current slot at or after availability and strictly after `slash_lock_until_slot`.

Opening an economic round updates every assigned policy-specific stake to `max(old_lock, objective_slash_deadline)`. No instruction shortens a lock. WithdrawalPending stake cannot enter a new round. Earlier round closure cannot shorten a lock established by an overlapping round.

## Compatibility

Proposals created before the registry's immutable enforcement slot are historical and cannot opt into M6 economics. Proposals at or after the slot must use funded M6 paths in later passes. The existing `start_challenge`, `commit_challenge`, and `open_verification_round` will gain the canonical registry account and will be limited to historical proposals. New funded/bonded/economic instructions will serve M6 proposals. Existing finalization, decision, expiry, replay, attestation, and guarded execution account lists and semantics remain unchanged.

## Settlement rules frozen for later passes

- HOLD: proposal remains ChallengeActive; exact 25% bond penalty; no bounty; matching finalized attestations may earn fees.
- VIOLATION: existing finalizer rejects first; later permissionless settlement returns full bond and pays exact bounty to the canonical hunter.
- Hunter non-reveal: 100% bond penalty.
- Verifier-caused timeout: full hunter bond refund.
- Unrelated canonical rejection aborting a sibling: full hunter bond refund and no slash.
- Verifier slash: only assigned non-reveal on an objectively timed-out round, within its deadline. Minority disagreement is never slashable.
- All settlement destinations are pre-existing canonical ATAs. No arbitrary destination or admin seizure exists.

## Revealed-but-unopened liveness rule

`settle_revealed_unopened_challenge` is mandatory in the later bond-settlement pass. It applies only when:

1. a bonded ChallengeCommit reached `Revealed` and produced its canonical TraceClaim;
2. the canonical VerificationRound PDA and RoundEconomicState were never opened;
3. the proposal is terminal or the current slot is strictly after `challenge_end_slot`;
4. ChallengeBond is still Pending.

The instruction returns the entire bond to the hunter's pre-existing canonical ATA, applies no penalty, bounty, verifier fee, or verifier slash, decrements `ProposalEscrow.unsettled_bonds` exactly once, closes BondVault to the recorded hunter rent recipient, and retains ChallengeBond with status `RevealedUnopenedReturned`. It rejects a noncanonical trace, an early call, any existing round, destination substitution, a previously settled bond, and counter underflow.

## Validation numbering erratum

This section corrects validation numbering only. It makes the already-frozen final-refund and revealed-but-unopened checks explicit and changes no account schema, instruction, authorization rule, state transition, deadline, token flow, rent destination, or other protocol semantic.

Final proposal-escrow refund and cleanup assertions are:

105. Draft, ChallengeActive, and Approved proposals are nonterminal and cannot refund proposal escrow.
106. Refund at `refund_eligible_slot` is rejected; eligibility begins strictly after that slot.
107. Substituting either the original funder's canonical ATA or recorded rent recipient is rejected atomically without changing escrow bytes or vault balances.
108. A permissionless refund transfers every actual BountyVault, FeeVault, and PenaltyVault token, including unsolicited surplus, only to the original funder's canonical ATA.
109. Refunding a Pending bounty records `BountyStatus::RefundedToFunder`, the exact checked `refunds_paid`, and retains ProposalEscrow as the permanent accounting receipt.
110. A successful refund closes all three empty proposal vaults and returns their exact lamport rent only to the recorded original funder.
111. Final escrow refund cannot be repeated, including after all three vaults have closed.
112. Outstanding bond or round liabilities block final refund; rejection leaves escrow state and vault balances unchanged until settlement ordering clears both counters.
113. If the bounty was already `PaidToHunter`, that status and the configured bounty payment remain unchanged; only residual bounty surplus and all remaining fee and penalty balances refund to the original funder.

Required adversarial assertions are:

114. Early revealed-unopened settlement is rejected.
115. Settlement is rejected when the canonical VerificationRound or RoundEconomicState exists.
116. A revealed unopened challenge receives a full refund after challenge end.
117. A revealed unopened challenge receives a full refund after unrelated terminal rejection.
118. Hunter destination substitution is rejected.
119. Duplicate revealed-unopened settlement is rejected.
120. `unsettled_bonds` decrements exactly once without changing unrelated counters or vaults.

## Pass boundaries

Pass 1 implements accounts, constants, immutable policies, legacy token helpers, stakes, epoch-economic activation, and proposal funding. It deliberately does not modify challenge/replay/finalization behavior and does not implement any bond, bounty, fee, slash, refund, or revealed-unopened settlement instruction.

Pass 2 should add the funded challenge, bonded commit, economic-round, deadline, and overlapping-lock integration. Pass 3 should add every frozen settlement, claim, slash, refund, vault-close, and liveness path plus the fresh-ledger adversarial suite and closeout evidence.

This document freezes the design; it does not claim Milestone 6 implementation completion.
