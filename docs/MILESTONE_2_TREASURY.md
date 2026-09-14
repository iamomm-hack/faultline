# Milestone 2 - Treasury AUTH-001 target

## Result

Milestone 2 adds the real Faultline demo target while preserving the Milestone 1 Guard PDA loader path. The same `faultline_treasury` program ID now has three isolated SBF builds:

| Version | Schema compatibility | Authority migration | Exploit result |
| --- | --- | --- | --- |
| v1 | baseline | unavailable/safe | blocked |
| v2 | compatible | missing original-admin authorization | succeeds |
| v3 | compatible | original-admin authorization enforced | blocked |

All three versions share program ID `46zDmEZAYrpwi3k6FsKFf1rPWZDbZEKM21SFzMKzb1a4`.

## Toolchain

Observed during the successful 2026-09-15 local runs:

| Component | Version |
| --- | --- |
| Solana CLI / validator / SBF builder | `1.18.10` Agave |
| SBF platform tools | `v1.41` |
| Anchor Rust crates | exactly `0.30.1` |
| Host Rust / Cargo | `1.89.0` |
| Node | `22.22.0` |
| npm | `10.9.4` via `npm.cmd` |
| pnpm | `10.29.1` via `pnpm.cmd` |

The Windows SBF builder still prints the known undefined-syscall warning described in Milestone 1. Local validator execution remains the acceptance proof.

## Build isolation

Treasury builds are selected by mutually exclusive Cargo features:

- `v1`: safe baseline treasury, migration unavailable.
- `v2`: intentionally vulnerable authority migration.
- `v3`: patched authority migration.

The default build feature is `v3`. Scripts compile each version with `--no-default-features --features <version>` and place outputs under:

```text
artifacts/treasury/v1/
artifacts/treasury/v2/
artifacts/treasury/v3/
```

Each directory receives `faultline_treasury.so`, `executable.sha256`, and `build-manifest.json`. Generated artifacts are intentionally ignored by git.

Latest ELF hashes:

| Version | SHA-256 |
| --- | --- |
| v1 | `88869cecff32a3bc24bfa3e1ab2bd40a32852b93f6638d9028f7eff1d5eac34f` |
| v2 | `82bf0adc96092daeae5758715ba1e05d7c9b272b03b8588e62ec3858ef4b4f6a` |
| v3 | `8ef2ad4bd0b7bf799ebe82ce17984b8ec80d55b47bd5ea5b9ec6aa304010fffa` |

## State account layout

`TreasuryState` uses one stable Anchor discriminator and a fixed account length of 210 bytes including the discriminator.

```rust
pub struct TreasuryState {
    pub schema_version: u8,
    pub admin: Pubkey,
    pub vault_token_account: Pubkey,
    pub total_deposited: u64,
    pub bump: u8,
    pub reserved: [u8; 128],
}
```

The payment mint is stored in the first 32 bytes of `reserved`. This keeps the layout stable across v1, v2, and v3 without realloc. Existing v1 state is read directly after loading v2 and v3.

`VersionState` remains available for the Milestone 1 version-marker regression:

- v1: `1 / TREASURY_V1_____`
- v2: `2 / TREASURY_V2_____`
- v3: `3 / TREASURY_V3_____`

## PDA derivations and vault authority

Treasury state PDA:

```text
["treasury"]
```

Guard PDA remains the Milestone 1 PDA:

```text
["faultline", "guard", target_program]
```

The treasury vault is a normal SPL Token account whose token authority is the `TreasuryState` PDA. Withdrawals use a Tokenkeg transfer CPI signed with the treasury PDA seeds. The treasury permanently stores `vault_token_account`, and every deposit, withdrawal, and migration validates the exact vault, exact mint, and exact Tokenkeg program ID.

## Version behavior

### v1 safe baseline

v1 supports:

- `initialize_treasury`
- `deposit`
- `admin_withdraw`
- `initialize_version`
- `refresh_version`
- `migrate_authority`, but it always returns `MigrationUnavailable`

Only the configured admin can withdraw. Attacker withdrawal, vault substitution, treasury-state substitution, wrong mint, and wrong token-program cases fail in the localnet tests.

### v2 vulnerable regression

v2 introduces `migrate_authority`.

Intended behavior:

```text
current admin signs -> new admin is written -> schema_version becomes 2
```

Actual vulnerable behavior:

```rust
// INTENTIONALLY VULNERABLE DEMO IMPLEMENTATION.
// DO NOT DEPLOY TO A PUBLIC CLUSTER OR REUSE IN PRODUCTION.
```

v2 validates the treasury PDA, schema version, vault binding, mint, and Tokenkeg program, but it checks only that `new_admin` is a signer. It does not validate `current_admin == TreasuryState.admin` and does not require the original admin signature. The attacker can therefore submit the migration with the attacker account in both the `current_admin` and `new_admin` slots.

Two-step exploit:

1. Attacker signs `migrate_authority(new_admin = attacker)`.
2. Attacker signs `admin_withdraw(destination = attacker_token_account, amount = 100000000)`.

This is a realistic missing authority/account-constraint regression, not a public `steal()` instruction.

### v3 patch

v3 keeps the same migration instruction shape but adds the missing root-cause checks:

- current admin account must sign;
- current admin pubkey must equal `TreasuryState.admin` captured before migration;
- treasury PDA seeds must match;
- vault and mint bindings must match;
- schema version must be the expected pre-migration version;
- new authority must be non-default.

The exact same attacker-only serialized trace fails during step 1 before any token outflow. A legitimate migration signed by the original admin succeeds, and the newly configured admin can withdraw afterward.

## AUTH-001 semantics

Policy file: `policies/invariants/AUTH-001.json`

Rule:

```text
Let original_admin be TreasuryState.admin in captured pre-state.
If no transaction in the trace contains a valid authorization from original_admin
for the relevant migration or withdrawal operation, then:

post_treasury_vault_balance >= pre_treasury_vault_balance
```

The evaluator is deliberately defined against the pre-state admin. An attacker cannot satisfy the invariant by corrupting the admin field in transaction 1 and then claiming transaction 2 was authorized.

## Canonical fixture and trace

Fixture file: `fixtures/treasury-v1.json`

The fixture is a deterministic alias/PDA template. It contains no private keys. Local test tooling resolves aliases from ignored `.localnet/*.json` keypairs and writes resolved manifests under `artifacts/fixtures/`.

Canonical fixture values:

| Field | Value |
| --- | --- |
| Mint decimals | `6` |
| Treasury balance | `1000000000` base units (`1000.000000 fUSDC`) |
| Attacker balance | `0` |
| Exploit withdrawal | `100000000` base units (`100.000000 fUSDC`) |
| Starting schema | `1` |
| Starting runtime | `v1` |

Trace file: `fixtures/exploits/auth-001-v2-authority-takeover.json`

The trace is declarative data. It contains ordered transactions, signer aliases, account metas, and base64 instruction data. It contains no shell commands, HTTP calls, arbitrary code, or private keys.

Trace hash used by the demos:

```text
02de95f68d6a5ed5e396660539ca50405bee6ab1fb71e79d88145959d5b37982
```

The same alias ordering and instruction bytes are replayed against v2 and v3.

## Commands

```powershell
npm.cmd run build:treasury:all
npm.cmd run demo:exploit-v2
npm.cmd run demo:patch-v3
npm.cmd run demo:guard
```

`demo:exploit-v2` explicitly passes `-AllowVulnerableV2` and the runner refuses non-local RPC URLs. v2 is not the default build.

## Evidence

Latest v2 exploit output:

```text
Trace step 1 landed (unauthorized authority migration): 66GwFMRQ6NyEx7Z1yZaWdzX4VtFEopZGwZSZ9FMRHpMMRogocSJJmEsG4Q3mSD84dYm9K9XEzms4GiiGVeVxW7By
Trace step 2 landed (withdraw using captured authority): 4m3u88h4zkWWMNRi5GN9K2KYuKXjCzFGtqDEwEBc8xT9wQU7e4RGsHpb7TrrjDUWAJjTbq3DzjP6yoBjpLBXmDk
V2 FINAL BALANCES: treasury_vault=900000000 attacker=100000000 withdrawn=100000000 AUTH-001=VIOLATED
MILESTONE-2 V2 ASSERTIONS PASSED
```

Latest v3 patch output:

```text
Trace step 1 failed (unauthorized authority migration): Program log: EQ6Hiq6y4A83eXVWiD2KQm9StPduSYWaFKWX2kx1YPUr
EXPECTED FAILURE [v3 attacker withdraw after failed migration]: Program log: EQ6Hiq6y4A83eXVWiD2KQm9StPduSYWaFKWX2kx1YPUr
V3 SAME-TRACE FAILURE: step=1 reason="Program log: EQ6Hiq6y4A83eXVWiD2KQm9StPduSYWaFKWX2kx1YPUr" treasury_vault=1000000000 attacker=0 AUTH-001=PRESERVED
Legitimate v3 migration: 3XVmiBm8YutZLgkEgka3dBvR75He33Witfhkyd3PSwBGJeRewLdJBYcMJDwuRN28qTBfVWadWjN7HscnnWkifMYP
Post-migration deposit: 4HCM86jpDk6u5cMoaED3Dy9abVRfirfDSX6s8EbcCuxNnALoEvzeSTc89VUyYTgYziZyYaKJXcLim3zGSxCuvhjz
New admin withdraw: 3saZgbwkker6Ezapi4BggdsqMmsm1ZKGmBUZXeLZMtjDgCU5WLRATJKQqbsnFU1GGvqBP9aHYqjdy9RNjQnoXYYu
MILESTONE-2 V3 ASSERTIONS PASSED
```

## Milestone 1 preservation

The Guard program was not simplified or replaced. v2 and v3 are activated through the same loader-v3 buffer handoff and `execute_guarded_upgrade` CPI path established in Milestone 1.

## Differences from Architecture.md and limitations

- Milestone 2 implements the target, vulnerability, patch, fixture, trace, and invariant specification only.
- It does not implement the full Policy account, challenge window, commit/reveal, verifier quorum, bounty settlement, LiteSVM runner, API, indexer, or frontend integration.
- The trace materializer is a local TypeScript test harness, not the future generic replay daemon.
- The treasury uses Tokenkeg SPL Token only. Token-2022, transfer-fee, confidential, freeze, and extension policies are intentionally out of scope.
- Build manifests are generated locally and ignored; reproducibility comes from committed scripts, exact versions, and per-build hashes.
- The local demos use ignored deterministic keypairs under `.localnet`; no real funded wallet or real token mint is referenced.
