# Milestone 1 — Guard PDA loader-v3 upgrade proof

## Result

Milestone 1 is complete on the pinned local toolchain. A clean `npm run demo:guard` run deployed a real loader-v3 treasury, transferred its recorded `ProgramData` upgrade authority to the Faultline Guard PDA, rejected direct and invalid upgrade paths, and executed treasury v1 → v2 through a real loader CPI signed by that PDA.

The proof does not change a normal account and call it an upgrade. It writes an SBF ELF to a loader buffer and invokes `UpgradeableLoaderInstruction::Upgrade`. The treasury program ID stays constant while its compiled behavior changes from `1 / TREASURY_V1_____` to `2 / TREASURY_V2_____`.

## Toolchain

Observed on 2026-09-14:

| Component | Version |
| --- | --- |
| Solana CLI / test validator / SBF builder | `1.18.10` (`src:a093e239`, Agave client) |
| SBF platform tools | `v1.41`; bundled Cargo `1.75.0` |
| Workspace Anchor Rust crates | exactly `0.30.1` |
| AVM | `0.32.1` |
| Cached Anchor CLI | `0.32.1`, not used by the build |
| Host Rust / Cargo | `1.89.0` |
| Node | `22.22.0` |
| npm | `10.9.4` |
| pnpm | `10.29.1` |

The Windows AVM wrapper cannot create its selected-version symlink without additional OS privilege, so the reproducible build uses `cargo build-sbf` directly. Anchor 0.31.1 was rejected during implementation because its newly resolved Solana 2.2/Edition-2024 dependency graph is incompatible with Solana 1.18.10's bundled Cargo 1.75. The committed lockfile instead pins Anchor 0.30.1, `solana-program = 1.18.10`, Borsh 1.5.7, `proc-macro-crate` 3.3.0, `indexmap` 2.7.1, and `zeroize_derive` 1.4.2. Lockfile format v3 is intentional because the SBF Cargo cannot read v4.

The 1.18.10 Windows builder prints an undefined-syscall warning after producing each ELF. The local 1.18.10 validator then successfully ran the affected logging, PDA, sysvar, and `invoke_signed` paths, including the loader CPI. Runtime execution is the acceptance proof; the builder warning is retained in command output rather than hidden.

## Loader and account relationship

The target is owned by loader-v3:

```text
BPFLoaderUpgradeab1e11111111111111111111111
```

The target program account stores `UpgradeableLoaderState::Program { programdata_address }`. Its `ProgramData` address is:

```text
find_program_address([target_program.as_ref()], loader_v3_id)
```

The gate verifies all of the following onchain:

- target owner is exactly loader-v3;
- target is executable;
- supplied ProgramData equals the loader derivation;
- the target's serialized `Program` state names that same ProgramData;
- ProgramData owner is exactly loader-v3;
- serialized state is `ProgramData` and its authority is the Guard PDA;
- candidate owner is exactly loader-v3;
- serialized state is `Buffer` and its authority is the Guard PDA;
- the loader program account passed to execution is the constant loader-v3 ID.

The legacy non-upgradeable/deprecated BPF loaders are not accepted. The proof specifically uses the loader commonly called loader-v3 or the upgradeable BPF loader. It does not use loader-v4.

Relevant 1.18 source interfaces are the archived Solana [`bpf_loader_upgradeable` SDK module](https://github.com/solana-labs/solana/blob/v1.18.10/sdk/program/src/bpf_loader_upgradeable.rs) and [loader processor](https://github.com/solana-labs/solana/blob/v1.18.10/programs/bpf_loader/src/lib.rs).

## Guard and proposal PDAs

```text
GuardConfig / authority:
["faultline", "guard", target_program]

MinimalUpgradeProposal:
["faultline", "proposal", target_program, proposal_id]

BufferClaim:
["faultline", "buffer", candidate_buffer]
```

`GuardConfig` is both a real Anchor account and the target's loader authority. A PDA has no private key. The gate creates its signer privilege only inside `execute_guarded_upgrade` using the exact Guard seeds and bump.

`BufferClaim` makes a candidate address single-use across proposals. Its `init` fails if another proposal tries to claim the same buffer.

## Upgrade-authority transfer

1. Deploy treasury v1 with an ephemeral local deployer as authority.
2. Derive ProgramData from the treasury ID and loader-v3 ID.
3. Read and decode ProgramData through RPC; require the current authority to equal the expected deployer.
4. Submit loader-v3 `SetAuthority` signed by the current deployer, naming the Guard PDA as new authority.
5. Read ProgramData again through RPC and require the authority to equal the Guard PDA.

The implemented RPC verification is in `scripts/transfer-upgrade-authority.ts` and `scripts/verify-guard-authority.ts`. It does not parse human-formatted `solana program show` output.

Local program address keypairs and actor keys are generated under ignored `.localnet/`. `bootstrap-ids.ts` synchronizes only their public program IDs into the Rust sources and `Anchor.toml`; no authority secret is committed.

## Candidate buffer locking

The v2 ELF is completely written while the proposer controls the loader buffer. Before proposal creation, loader-v3 `SetAuthority` hands buffer authority to the Guard PDA. Proposal creation, approval, and execution each decode loader state and require the Guard PDA as buffer authority.

Loader-v3 `Write` requires the recorded buffer authority to sign. The gate exposes neither a buffer-write instruction nor a buffer-authority-change instruction. Consequently, after handoff:

```text
benign bytes proposed → buffer handed to Guard → proposer write rejected by loader
```

There is no Guard signing route that can mutate the buffer. Storing the address is not the integrity control; loader-enforced authority handoff is. The proposal additionally binds the exact candidate address, and `BufferClaim` prevents cross-proposal reuse.

## Exact loader CPI

`UpgradeableLoaderInstruction::Upgrade` receives these accounts in this order:

1. ProgramData — writable;
2. target Program — writable;
3. candidate Buffer — writable;
4. spill/refund account — writable and fixed by Faultline to configured governance;
5. Rent sysvar — read-only;
6. Clock sysvar — read-only;
7. Guard authority — read-only signer supplied by `invoke_signed`.

The executable loader-v3 account is also supplied to Solana's CPI API. It is constrained to the constant loader-v3 address and cannot be selected from remaining accounts.

Loader-v3 independently checks that both ProgramData and Buffer name account 7 as authority and that account 7 is a signer. Solana propagates the PDA signer privilege created by `invoke_signed`; no Guard private key exists.

The gate calls the CPI before setting the proposal to `Executed`. Solana transaction atomicity ensures both effects commit or neither commits. Solana 1.18.10 temporarily places an upgraded program in a one-slot delay-visibility cache state, so the harness waits two observed slots before invoking v2 behavior.

## Milestone governance and shortcuts

Configured governance can:

- initialize one Guard for the target;
- approve a `Pending` proposal directly;
- reject a `Pending` proposal directly.

The approval instruction is marked in source:

```text
TEMPORARY MILESTONE-1 APPROVAL PATH.
This will be replaced by challenge-window resolution.
```

Anyone with transaction fees may execute an already approved proposal, but cannot choose its target, ProgramData, buffer, loader, or spill account.

This milestone intentionally has no cancellation or emergency instruction. `Cancelled` is reserved in the enum but is unreachable. It also omits the final policy schema, challenges, verifier network, bounty economics, backend/indexer, and frontend integration.

## Reproduce

Prerequisites are the versions above plus Windows permission to let `cargo build-sbf` manage its user-level toolchain link. On Windows, validator `--log` mode is intentional: `--quiet` tries to create a `validator.log` symlink and fails when Developer Mode/symlink privilege is unavailable.

```powershell
npm.cmd install
npm.cmd run demo:guard
```

The command:

1. synchronizes local program IDs;
2. compiles gate, treasury v1, and treasury v2 as SBF;
3. asserts v1/v2 ELF hashes differ;
4. resets and starts a hidden local validator;
5. deploys the gate, makes it immutable, and deploys treasury v1 under loader-v3;
6. writes three real v2 buffers;
7. runs the authority, state, substitution, lock, and upgrade assertions;
8. stops the validator in a `finally` block.

Other checks:

```powershell
cargo fmt --all -- --check
cargo check --workspace --all-targets
npm.cmd run typecheck
cd frontend
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

## Latest clean-run evidence

Addresses are local-only but real for the retained `.localnet` keys:

| Value | Address |
| --- | --- |
| Faultline gate | `9PFPNC6TMNKBCVsm4RoCgVYmqTJJTwnHHuRcysosSCCe` |
| Treasury (before and after) | `46zDmEZAYrpwi3k6FsKFf1rPWZDbZEKM21SFzMKzb1a4` |
| ProgramData | `Cc6dc7YQWt9NQGkzC2XXKGPKMx4NhV2bJ5TKUSjUnzin` |
| Guard PDA | `2X3e9RkTxqMWpPwmAoHWihnghMp8Q5niMHtgajAbLF1j` |
| Approved candidate buffer | `6ZJQk3ya6MGM1p72tasn3g4L1fPRHyCSBC2KNdRWPhK7` |
| Approved proposal PDA | `BknNn8HK67J7hohGtW8CAheTEzFVA7ZBDaS4UuMtG6hU` |

Key clean-run transactions:

| Action | Signature |
| --- | --- |
| Transfer target authority | `42pXH8fnQWjKKADJ8d6LREKy1jgmuYLDpX46iB3sGdeURMVM7JNwyTsMiNVWs3oSQyxwUYJHcxx8Lh4gokZus8FG` |
| Original deployer direct upgrade (failed onchain) | `241mvNy8cXPSthCapbhmkdkUGqUo1aZFcXddQQUjh4x6kb2RhfDUs1veDEtSY6wh2h2Y9Bx7PSoKgYpov8CksMMF` |
| Random wallet direct upgrade (failed onchain) | `WPnhafgKu5GzjyFuv7W6xFpf8ZfQP5Y7qgNvew59EdaymrbBMm98DY4m9oYCNvczMiyRwAvTD4pA2d5f4W6X4pL` |
| Proposer locked-buffer write (failed onchain) | `5ghiz2yuY44PFxurE8jDYgmvtTuXGMuu5oCcnXkVeKNG4hsT7SMPDgacJtFYt5kwiFx7ZqhPiPA8QDW4zakubnCE` |
| Approve proposal | `4bkN3Qj8StCgezfk1Lb478JA4Fkt96EmR5z7qfAni23hTgyFvrXoYNJHDeeHuMiKHBzsxW4AiWfSh41JZj76JxJw` |
| Post-approval buffer mutation (failed onchain) | `5tqZJbzvz6pou1dbqUGXqUvBidWNXtz9z5BZ6osaEcc5TmdTG6eD5mXevnsjpRbostirdQ2rmGo5QhyjkBZArgwY` |
| Guarded loader upgrade | `75B16bKzXGxLyX6xVyyF6KpXs4PVMys5UcysfGN1tgGHYLViV5wu1aa48gVZnfsTwfMb1K4toFefUZPxqKpcQxm` |
| Refresh/read v2 behavior | `CWbW9MQpf5K6r4n99BSzybdGeU78VkYynnypeAANStmXYkodgpAFzR8TmTW57LbCpxKWZxHNdN6xBGqcVKjJfWQ` |

The run observed and asserted:

- treasury v1 returned/stored `version=1`, marker `TREASURY_V1_____`;
- original deployer direct loader upgrade failed;
- random-wallet direct loader upgrade failed;
- proposer loader write failed after buffer handoff, both before and after approval;
- fake Guard, wrong target, wrong ProgramData, wrong loader, and wrong buffer failed;
- pending and rejected proposals failed execution;
- non-governance approval failed;
- buffer reuse by a second proposal failed;
- approved Guard CPI succeeded;
- treasury v2 returned/stored `version=2`, marker `TREASURY_V2_____`;
- repeat execution and executed-to-approved/rejected transitions failed;
- ProgramData authority still equaled the Guard PDA after upgrade.

## Differences from `Architecture.md` and limitations

- This milestone uses `GuardConfig` itself as the small Guard authority PDA instead of a separate zero-data `GuardAuthority`; it preserves the same seed topology and enforcement property with fewer accounts.
- `BufferClaim` is added to enforce the architecture's no-buffer-reuse rule without implementing the final proposal/artifact schema.
- Governance directly approves or rejects; there is no challenge-window resolution yet.
- Proposal IDs are caller-provided unique 32-byte values for this feasibility proof, not the final canonical artifact commitment.
- Full executable hashing is not done onchain. Integrity is enforced by irreversible-within-this-program buffer-authority handoff plus exact address binding. The gate has no write or authority-change route.
- Rejected buffers remain Guard-owned and cannot be reclaimed in Milestone 1. Adding a close/refund policy belongs with the later lifecycle design.
- The Milestone-1 gate is made immutable immediately after deployment so its deployer cannot add a PDA-signing bypass. Production Faultline versioning, migration, and emergency governance remain outside this milestone.
- The proof is localnet-only and is not a production-readiness or mainnet safety claim.
