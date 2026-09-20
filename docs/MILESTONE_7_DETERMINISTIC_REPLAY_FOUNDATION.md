# Milestone 7 — Deterministic Replay Foundation

**Status:** Frozen implementation specification

**Baseline:** `8ae9bb8` (`docs: track product and architecture specifications`)

**On-chain baseline:** Milestones 1–6 through `d42ef0b`

**Scope rule:** This milestone changes no production Solana program semantics.

---

## 1. Objective

Milestone 7 builds the deterministic off-chain execution foundation that converts fully bound Faultline artifacts and a typed `faultline.trace.v1` counterexample into a reproducible replay receipt and the exact existing Milestone 5 replay-result commitment.

The milestone is complete only when:

- the canonical v2 treasury artifact and trace deterministically produce `Violated`;
- the same normalized trace against the canonical v3 artifact deterministically produces `Preserved`;
- three distinct isolated verifier worker processes independently produce the same receipt and result commitment;
- invalid evidence, unsupported environments, crashes, timeouts, resource failures, and worker disagreement fail closed; and
- eligible worker outputs map exactly to the frozen Milestone 5 direct-attestation interface without submitting a Solana transaction.

Milestone 7 ends at signed attestation intents. Transaction construction, transaction submission, a public SDK, an operator CLI, validator reset orchestration, and the complete protocol demo belong to Milestone 8.

---

## 2. Feasibility decision and pinned execution engine

> **Revision note — Solana runtime pin erratum (2026-09-20):** Attempting to match the existing artifacts' Solana/SBF `1.18.10` build provenance in the replay runtime could not create a fresh lockfile because that runtime's `solana-bpf-loader-program` requires the yanked `solana_rbpf 0.8.0`. Solana `1.18.22` is the first compatible `1.18.x` patch using non-yanked `solana_rbpf 0.8.3`. The compatibility probe resolved one unified Solana `1.18.22` family within the off-chain replay dependency closure. Under LiteSVM `0.1.0` plus Solana `1.18.22`, both existing treasury v2/v3 artifacts loaded and entered their Anchor programs, returning the expected `InstructionMissing` / `Custom(100)`. Their build provenance and artifact hashes remain unchanged.

> **Revision note — Cargo workspace isolation erratum (2026-09-20):** Cargo cannot resolve the semver-compatible exact crates.io `solana-program` pins `=1.18.10` and `=1.18.22` in one workspace resolution. The root on-chain workspace and the standalone nested replay workspace therefore have separate manifests and authoritative lockfiles. This isolation changes no runtime pin, fixture genesis, Tokenkeg provenance, schema, hash or signature domain, artifact hash, assertion meaning, or checkpoint boundary.

### 2.1 Dependency planes

Milestone 7 freezes two separate dependency planes:

**On-chain artifact build plane.** The root Cargo workspace continues to contain only `programs/faultline_gate` and `programs/faultline_treasury`; both remain pinned to `solana-program = "=1.18.10"`. During Checkpoint 1, the root `Cargo.toml` adds `exclude = ["crates/faultline-replay"]` and must not add the replay crate as a workspace member. The root `/Cargo.lock` remains the authoritative on-chain-plane lockfile and Checkpoint 1 must not update it. The existing v2/v3 SBF artifacts and their historical build manifests retain their Solana CLI/SBF `1.18.10` provenance and hashes. Program manifests, program source, artifacts, and historical build hashes are not modified. This plane represents the already validated deployable BPF artifacts.

**Off-chain deterministic replay plane.** `crates/faultline-replay` is an independent nested Cargo workspace and package. Its `Cargo.toml` contains its package definition and a `[workspace]` section with `resolver = "2"`; `/crates/faultline-replay/Cargo.lock` is its authoritative lockfile. `faultline-replay` uses `litesvm = "=0.1.0"`. Its complete normal, build, development, target-specific, and runtime dependency closure uses the Solana runtime family exactly `1.18.22` and resolves `solana_rbpf` exactly once at `0.8.3`. No Solana `1.18.10` package and neither on-chain workspace crate may be reachable from `faultline-replay`. Rust types from the two Solana versions never cross crate boundaries. Replay consumes the existing repository artifacts, policies, traces, and manifests through validated repository-relative paths as verified bytes and canonical data; it does not depend on, link, or import either on-chain program crate.

The repository has two authoritative lockfiles and two disjoint resolution graphs: `/Cargo.lock` contains the root on-chain plane at Solana `1.18.10`, while `/crates/faultline-replay/Cargo.lock` contains the replay plane at Solana `1.18.22` and `solana_rbpf 0.8.3`. Neither lockfile may contain the other plane merely to share one resolution. No package-source trick, Git override, `[patch]`, vendored duplicate, or version migration may be used merely to force both exact Solana versions into one graph. “One unified Solana runtime family” and “no second runtime version” apply to the standalone replay workspace and its dependency closure. Artifact build provenance remains `1.18.10`; replay execution provenance is `1.18.22`.

### 2.2 Selected engine

The deterministic engine is the Rust crate `litesvm = "=0.1.0"`, upstream tag `v0.1.0`, peeled commit `5cda1d2dcfae16714a6ff808b58f0c087b21bd42`.

The dependency is pinned exactly. Its Solana dependency family must also resolve exactly to `1.18.22`, not merely to any version accepted by LiteSVM's `~1.18` requirements. The replay crate therefore pins these runtime crates to `=1.18.22`, and its dependency closure must contain no second Solana runtime version:

- `solana-program`;
- `solana-program-runtime`;
- `solana-bpf-loader-program`;
- `solana-sdk`;
- `solana-system-program`;
- `solana-compute-budget-program`;
- `solana-loader-v4-program`; and
- `solana-address-lookup-table-program`.

The replay crate also pins `solana_rbpf = "=0.8.3"`, official upstream tag `v0.8.3`, commit `20648d721f8cba862df874754650919a66ca9966`, crates.io checksum `da5d083187e3b3f453e140f292c09186881da8a02a7b5e27f645ee26de3d9cc5`.

Checkpoint 1 must verify these exact versions with a dependency tree rooted in `crates/faultline-replay/Cargo.toml` plus inspection of the replay workspace's own lockfile. Upgrading LiteSVM, `solana_rbpf`, or any Solana runtime crate in the replay plane is a specification change.

### 2.3 Pinned toolchain

| Component | Frozen value |
| --- | --- |
| Host Rust | `rustc 1.89.0 (29483883e 2025-08-04)` |
| Host Cargo | `cargo 1.89.0 (c24e10642 2025-06-23)` |
| LiteSVM | `0.1.0`, commit `5cda1d2dcfae16714a6ff808b58f0c087b21bd42` |
| LiteSVM MSRV | `1.75.0` |
| On-chain program-crate Solana dependency | `solana-program 1.18.10` exactly |
| Off-chain replay Solana/Agave runtime crates | `1.18.22` exactly |
| Off-chain replay Solana RBPF | `0.8.3` exactly; tag `v0.8.3`; commit `20648d721f8cba862df874754650919a66ca9966`; crates.io checksum `da5d083187e3b3f453e140f292c09186881da8a02a7b5e27f645ee26de3d9cc5` |
| Solana CLI used for existing artifacts | `solana-cli 1.18.10 (src:a093e239; feat:3469865029, client:Agave)` |
| SBF builder | `solana-cargo-build-sbf 1.18.10` |
| SBF platform tools | `v1.41` |
| Anchor program crates | `0.30.1` exactly |
| Token program | legacy Tokenkeg; LiteSVM 0.1.0 bundled `spl-token-3.5.0.so` |

The Anchor CLI and on-chain program crates are not Milestone 7 replay-runtime dependencies. The repository pins the Anchor crates in the on-chain plane, and the existing artifacts are already built.

### 2.4 Existing-artifact compatibility

LiteSVM 0.1.0 is an in-process Solana 1.18 VM. It exposes `add_program_from_file` and `add_program`, initializes System Program support, sysvars, signature verification, and a bundled legacy Tokenkeg program. It does not start or contact `solana-test-validator`.

The existing replay targets are SBF artifacts built with the pinned Solana 1.18.10 toolchain:

| Artifact | Program ID | SHA-256 |
| --- | --- | --- |
| `artifacts/treasury/v2/faultline_treasury.so` | `46zDmEZAYrpwi3k6FsKFf1rPWZDbZEKM21SFzMKzb1a4` | `82bf0adc96092daeae5758715ba1e05d7c9b272b03b8588e62ec3858ef4b4f6a` |
| `artifacts/treasury/v3/faultline_treasury.so` | `46zDmEZAYrpwi3k6FsKFf1rPWZDbZEKM21SFzMKzb1a4` | `8ef2ad4bd0b7bf799ebe82ce17984b8ec80d55b47bd5ea5b9ec6aa304010fffa` |

The treasury uses Anchor instruction decoding, System Program account creation, PDA signing, and legacy Tokenkeg transfer CPI. All are in the selected runtime surface. Each replay VM loads exactly one candidate artifact directly at the treasury program ID; loader upgrade state is not part of replay execution.

The compatibility probe proves that both artifacts load and enter their Anchor programs under the selected runtime. Assertions 10 and 11 remain the implementation proof that full deterministic replay produces the frozen results.

---

## 3. Threat model and trust boundary

### Protected properties

- The trace, artifacts, fixture, policy, runner, result, and on-chain binding cannot be substituted without changing a bound hash.
- An invalid or unavailable replay cannot become a clean result.
- One worker cannot impersonate another verifier.
- Disagreeing worker results cannot be aggregated into attestation intents.
- `Preserved` cannot be represented as proposal approval, and `Violated` cannot bypass the existing on-chain quorum.

### Untrusted inputs

- candidate SBF bytes;
- trace JSON and instruction bytes;
- manifest files and paths supplied to the coordinator;
- fixture aliases and declared expected results; and
- worker stdout and process exit status.

### Trusted computing base

- coordinator and worker native Rust code;
- canonical JSON and hashing implementation;
- the off-chain replay plane: LiteSVM 0.1.0, the pinned Solana 1.18.22 runtime crates, and `solana_rbpf 0.8.3`;
- host Rust standard library and Windows kernel;
- artifact files after digest verification;
- coordinator configuration and its allowed-root list; and
- Solana Ed25519 verifier private keys while present in worker memory.

The three workers are independent processes and identities, not heterogeneous execution implementations. A shared LiteSVM/runtime defect can affect all three identically.

---

## 4. In scope and out of scope

### In scope

- one canonical JSON format and hashing implementation;
- versioned build, runner, fixture, invariant, replay-job, replay-receipt, and worker-output schemas;
- strict typed parsing and normalization of the existing `faultline.trace.v1` fixture;
- a reusable AUTH-001 evaluator extracted from the existing treasury test harness;
- deterministic v2 `Violated` and v3 `Preserved` results;
- normalized, fully bound receipts;
- a Windows-compatible isolated worker process and coordinator;
- three distinct worker processes with three distinct Solana Ed25519 identities;
- stable invalid-evidence, unsupported-environment, runner-fault, and disagreement handling;
- exact calculation of the existing Milestone 5 replay-result commitment; and
- signed attestation intents without on-chain submission.

### Out of scope

- any change under `programs/**` or to an existing account, instruction, PDA, event, deadline, verdict, or economic rule;
- changing direct verifier attestations into verdict commit/reveal;
- automatic approval after HOLD;
- Solana transaction construction or submission;
- public TypeScript SDK, operator CLI, generated IDL package, or validator reset orchestration;
- full v2 rejection/settlement or v3 approval/execution demonstration;
- indexer, API, database, artifact service, evidence service, or frontend integration;
- Devnet or Mainnet deployment;
- permissionless verifier admission or heterogeneous engines;
- generic invariant DSL, arbitrary native evaluator plugins, or arbitrary scripts;
- AI trace generation;
- Token-2022 or additional runtime/CPI support; and
- refactoring or rerunning Milestone 1–6 suites.

---

## 5. Minimum file structure

Implementation is one cohesive Rust crate rather than a package-per-concept split:

```text
crates/
  faultline-replay/
    Cargo.toml
    Cargo.lock
    src/
      lib.rs
      canonical.rs
      schema.rs
      trace.rs
      invariant.rs
      runner.rs
      receipt.rs
      worker.rs
      bin/
        faultline-replay-worker.rs
    tests/
      canonical_vectors.rs
      auth001_vectors.rs
      worker_isolation.rs

manifests/
  auth-001-invariant.json
  programs/
    spl-token-3.5.0.so
  treasury-v2-build.json
  treasury-v3-build.json
  treasury-runner.json
  treasury-v1-fixture.json

scripts/
  run-replay-foundation-tests.ps1
```

The root workspace keeps only `programs/faultline_gate` and `programs/faultline_treasury` as members and explicitly excludes `crates/faultline-replay`. The replay directory is a standalone nested workspace with its own `[workspace]` section, resolver 2, package, and lockfile. It has no dependency path to `faultline_gate` or `faultline_treasury`; it reads repository inputs as validated bytes through repository-relative paths. Existing policy, trace, logical fixture, and treasury SBF files remain inputs; they are not silently rewritten. Checkpoint 1 additionally tracks the exact Tokenkeg SBF bytes embedded by LiteSVM 0.1.0 at `manifests/programs/spl-token-3.5.0.so`, as specified in Section 7.4.3.

---

## 6. Canonical JSON profile

The identifier is `faultline.canonical-json.v1`.

### 6.1 Input decoding

- Input must be valid UTF-8 without a BOM, NUL byte, or invalid scalar sequence.
- The parser must detect duplicate object keys before mapping into typed structures. A duplicate is an error even if both values are equal.
- JSON comments and trailing commas are forbidden.
- Every trust-path structure uses recursive unknown-field rejection. An unrecognized field at any object depth is `INVALID_UNKNOWN_FIELD`.
- Schema discriminators and versions are required; no implicit default version exists.

### 6.2 Object keys

- Object keys must be Unicode NFC.
- Keys are ordered lexicographically by their unsigned UTF-8 byte sequences.
- Array order is preserved and is never sorted implicitly.

### 6.3 Integers

- JSON numeric tokens may contain only an optional leading `-` followed by `0` or a nonzero digit and decimal digits.
- `-0`, leading zeroes, decimal points, and exponent notation are forbidden.
- Numeric tokens are limited to the interoperable integer range `-9007199254740991` through `9007199254740991`, inclusive.
- Schema fields typed as `u8`, `u16`, `u32`, or a bounded counter use numeric tokens and enforce their narrower range.
- `u64`, `i64`, lamport/token quantities, slots, Unix timestamps, and any value outside the interoperable range use canonical decimal strings. Unsigned strings match `0|[1-9][0-9]*`; signed strings match `0|-?[1-9][0-9]*`. Each typed field enforces its Rust range.
- Floating-point values are forbidden everywhere in the trust path.

### 6.4 Strings and Unicode

- All input strings and object keys must already be Unicode NFC. Non-NFC input is rejected rather than normalized silently.
- Unpaired UTF-16 surrogate escapes are rejected. A valid surrogate pair is decoded to its Unicode scalar and then checked for NFC.
- Canonical output emits Unicode scalar values directly as UTF-8 except for required JSON escapes.
- `"` and `\\` are used for quotation mark and reverse solidus.
- Backspace, tab, line feed, form feed, and carriage return use `\b`, `\t`, `\n`, `\f`, and `\r`.
- Other U+0000–U+001F controls use lowercase `\u00xx`.
- Solidus is not escaped. Printable non-ASCII characters are not converted to `\u` escapes.

### 6.5 Canonical output

- Output contains no insignificant whitespace and no trailing newline.
- All required fields are present. Optional fields are omitted when absent; JSON `null` is used only where the schema explicitly permits it.
- Canonicalization is idempotent: parsing and reserializing canonical bytes yields identical bytes.

---

## 7. Frozen schemas

All hashes are lowercase 64-character SHA-256 hex. All Solana public keys are canonical Base58 strings that decode to exactly 32 bytes and re-encode identically. All signatures are canonical Base58 strings that decode to exactly 64 bytes.

> **Revision note — Checkpoint 1 schema clarification (2026-09-20):** This section replaces underspecified schema shorthand with the complete closed input formats. It does not change evaluator behavior, hash domains, runtime pins, or checkpoint boundaries. Unless a field is explicitly marked optional or nullable, it is required. Every object at every depth is closed: missing required fields, duplicate keys, and unknown fields are invalid. Nested objects do not carry independent schema discriminators; they are valid only inside their declared parent schema. Strings and keys obey Section 6, decimal strings obey Section 6.3, and arrays obey the cardinality, uniqueness, and ordering rules stated below.

> **Revision note — deterministic fixture genesis (2026-09-20):** The Milestone 7 fixture is an authored synthetic genesis snapshot, not a transcription of a validator run. Its complete state is constructed from the constants and binary recipes in Sections 7.4.1–7.4.3, the tracked logical fixture and trace, the tracked program ID and layout, Solana 1.18.22 `Rent::default()`, and the SPL Token 3.5.0 layouts. Live RPC state, validator ledgers, ignored resolved-fixture outputs, wall-clock time, random key generation, machine paths, host rent queries, and other untracked state are forbidden inputs. Historical resolved-fixture files are non-authoritative provenance aids only. This erratum does not change any hash domain, assertion meaning, dependency plane, or checkpoint boundary.

The tracked Milestone 2 policy, logical fixture, trace, program source, milestone evidence, and artifact build-manifest JSON were reviewed as source/provenance records. The new files under `manifests/` are the Milestone 7 trust-path manifests defined here; historical fixture and artifact JSON are not silently reinterpreted or rewritten as those manifests even where a legacy `schema` string is shared. The build manifests transcribe the existing artifact path, digest, feature, program ID, and toolchain provenance into the closed Section 7.2 shape. The fixture manifest is generated solely from the synthetic-genesis constants and recipes in Section 7.4. The tracked policy supplies the exact Section 7.5 values, while the tracked trace itself is parsed directly under Section 7.6.

### 7.1 Common manifest fields

Every manifest is a closed object containing these required fields:

- `schema`: JSON string equal to the exact schema identifier named by its subsection; and
- `canonicalization`: JSON string exactly `faultline.canonical-json.v1`.

For all duplicate-free arrays, uniqueness is equality of the canonical field identified by that schema. “Canonical order” means ascending unsigned UTF-8 byte order of that field. Arrays described as execution ordered preserve input order and are never sorted. Arrays not explicitly declared duplicate-free may contain repeated values; their input order remains hash-binding.

### 7.2 `faultline.build.v1`

The closed build manifest has exactly these required keys:

| Key | JSON type | Required value or constraint |
| --- | --- | --- |
| `schema` | string | `faultline.build.v1` |
| `canonicalization` | string | `faultline.canonical-json.v1` |
| `program` | string | `faultline_treasury` |
| `program_id` | string | canonical treasury public key |
| `build` | string enum | `v2` or `v3` |
| `cargo_features` | array of strings | exactly one element, equal to `build` |
| `artifact_path` | string | normalized repository-relative path |
| `executable_sha256` | string | SHA-256 hex |
| `toolchain` | object | closed toolchain object below |

The closed `toolchain` object has exactly four required string keys: `solana_cli` = `solana-cli 1.18.10 (src:a093e239; feat:3469865029, client:Agave)`, `cargo_build_sbf` = `solana-cargo-build-sbf 1.18.10`, `platform_tools` = `v1.41`, and `anchor_crates` = `0.30.1`.

Absolute paths, `.` or `..` segments, drive prefixes, UNC paths, alternate data streams, and backslashes are invalid.

### 7.3 `faultline.runner.v1`

The closed runner manifest has exactly these required keys:

| Key | JSON type | Required value or constraint |
| --- | --- | --- |
| `schema` | string | `faultline.runner.v1` |
| `canonicalization` | string | `faultline.canonical-json.v1` |
| `engine` | string | `litesvm` |
| `engine_version` | string | `0.1.0` |
| `engine_source_commit` | string | `5cda1d2dcfae16714a6ff808b58f0c087b21bd42` |
| `solana_runtime` | string | `1.18.22` |
| `feature_set` | string | `litesvm-0.1.0-all-enabled` |
| `sigverify` | Boolean | `true` |
| `clock_mode` | string | `fixture` |
| `recent_blockhash_mode` | string | `runner-deterministic` |
| `token_program` | string | canonical Tokenkeg public key |
| `token_program_bundle` | string | `spl-token-3.5.0` |
| `allowed_external_programs` | array of public-key strings | exactly one element, Tokenkeg; unique and canonically ordered |
| `limits` | object | closed limits object below |

The closed `limits` object contains exactly nine required JSON integer fields, each fixed to the shown value: `max_transactions` = 32, `max_instructions_per_transaction` = 16, `max_accounts_per_instruction` = 64, `max_instruction_data_bytes` = 10240, `max_compute_units_per_transaction` = 1400000, `max_manifest_bytes` = 1048576, `max_trace_bytes` = 2097152, `max_fixture_bytes` = 10485760, and `max_output_bytes` = 8388608. Each value is within `u32` and uses a JSON numeric token.

### 7.4 `faultline.fixture.v1`

The closed fixture manifest has exactly these required keys:

| Key | JSON type | Required value or constraint |
| --- | --- | --- |
| `schema` | string | `faultline.fixture.v1` |
| `canonicalization` | string | `faultline.canonical-json.v1` |
| `fixture_id` | string | `treasury-v1` |
| `base_slot` | string | canonical `u64` decimal string |
| `clock` | object | closed clock object |
| `programs` | array | exactly two closed tagged entries, canonically ordered by `alias` |
| `accounts` | array | 1–64 closed account entries, unique and canonically ordered by `alias` |
| `signers` | array | 1–64 closed signer entries, unique and canonically ordered by `alias` |
| `setup_transactions` | array | 0–32 raw transactions in execution order |
| `initial_state` | object | closed initial-state object |

The closed `clock` object has exactly `slot`, a canonical `u64` decimal string equal to `base_slot`, and `unix_timestamp`, a canonical signed `i64` decimal string.

The fixture is candidate-independent. Its `programs` array contains exactly:

- one closed target entry with `kind` = `target`, `alias` = `faultline_treasury`, and `program_id` = the canonical treasury public key; and
- one closed bundled entry with `kind` = `bundled`, `alias` = `spl_token`, `program_id` = the canonical Tokenkeg public key, `bundle_name` = `spl-token-3.5.0`, `artifact_path` = `manifests/programs/spl-token-3.5.0.so`, `executable_sha256` = `18264f491c7e0ad056dd36f42f8de6d1fedf9f044d1f521e714b4dc6b61594b6`, `source_crate` = `litesvm`, `source_crate_version` = `0.1.0`, `source_crate_sha256` = `0963e4df461a414763f0348b73eb284a734534a53558fcae35f984a0c16a6e6c`, and `source_member_path` = `src/spl/programs/spl_token-3.5.0.so`.

The target entry contains no executable hash or build-manifest hash. `candidate_executable_sha256` and `build_manifest_hash` exist only in `faultline.replay-job.v1`; selecting v2 versus v3 therefore changes the replay-job hash but not the fixture hash. Bundled external programs remain independently hash-bound by the fixture.

Each closed `accounts` entry has exactly these required fields: `alias` (nonempty string), `pubkey` (canonical public key), `owner` (canonical public key), `lamports` (canonical `u64` decimal string), `executable` (Boolean), `rent_epoch` (canonical `u64` decimal string), and `data_base64` (canonical RFC 4648 standard-alphabet padded Base64 string). Account-array order is canonical alias order; aliases and public keys are each unique.

Each closed `signers` entry has exactly `alias` (nonempty string), `pubkey` (canonical public key), and `lamports` (canonical `u64` decimal string fixed to `10000000000`). Signer-array order is canonical alias order; aliases and public keys are each unique. Private key bytes are never present in the fixture manifest. Validation recomputes the public key from the alias using Section 7.4.1 and rejects a mismatch.

The closed `initial_state` object has exactly these required fields:

| Key | JSON type | Constraint |
| --- | --- | --- |
| `original_admin` | string | canonical public key |
| `treasury_state` | string | canonical public key |
| `treasury_vault` | string | canonical public key |
| `attacker_token_account` | string | canonical public key |
| `payment_mint` | string | canonical public key |
| `mint_decimals` | JSON integer | `0..=255` (`u8`) |
| `treasury_vault_base_units` | string | canonical `u64` decimal string |
| `attacker_base_units` | string | canonical `u64` decimal string |

Missing, duplicate, or unknown `initial_state` fields are invalid.

#### 7.4.1 Synthetic identities and fixed genesis metadata

The fixture has `base_slot` = `"1"`, `clock` = `{ "slot": "1", "unix_timestamp": "0" }`, and `setup_transactions` = `[]`. The tracked exploit trace needs no setup transaction because all required state is already present in the snapshot. When Checkpoint 2 installs the corresponding Solana `Clock`, the fields not represented in the fixture are fixed to `epoch_start_timestamp = 0`, `epoch = 0`, and `leader_schedule_epoch = 0`; no host clock is consulted.

Signer seeds are exactly:

```text
seed = SHA256(ASCII("FAULTLINE_TEST_SIGNER_V1") || BYTE(0x00) || UTF8(alias))
```

The 32-byte digest is passed as the Ed25519 keypair seed using Solana's standard seed-to-keypair operation. The fixture contains exactly these signers in canonical alias order:

| Alias | Frozen public key | Lamports |
| --- | --- | ---: |
| `attacker` | `Dvci5BTD5CkwYCQh6pC6UumLWF9LHSinJ5doS8PS9hV6` | `10000000000` |
| `treasury-admin` | `564Gpg3mVA7LwcW7hVQkeATttbaRRMTntp9eV2AGNpbd` | `10000000000` |
| `user` | `58aVWrJhcixCdUrm8wVdfUVZiC5Y7QzpFQuoQbJHMV4i` | `10000000000` |

These aliases come from the tracked logical fixture; only `attacker` signs the tracked exploit trace. At runtime each signer is materialized as a System Program-owned, non-executable, zero-data account with `rent_epoch = 0` and the manifest's lamports. These publicly derivable identities are test-only. They must never be accepted as production verifier, payer, governance, deployment, or upgrade-authority identities.

Non-PDA fixture keypairs use a separate domain:

```text
seed = SHA256(ASCII("FAULTLINE_TEST_ACCOUNT_V1") || BYTE(0x00) || UTF8(keypair_alias))
```

The resulting 32 bytes are the Ed25519 keypair seed and only the derived public key enters the manifest. The complete alias closure is:

| Logical or trace alias | Derivation and frozen public key | Owner | Executable | Data bytes | Lamports | Writable during replay | Logical source |
| --- | --- | --- | --- | ---: | ---: | --- | --- |
| `attacker` | signer alias `attacker`; `Dvci5BTD5CkwYCQh6pC6UumLWF9LHSinJ5doS8PS9hV6` | System Program | false | 0 | `10000000000` | no | trace signer and fixture token authority |
| `legitimate_admin` | signer alias `treasury-admin`; `564Gpg3mVA7LwcW7hVQkeATttbaRRMTntp9eV2AGNpbd` | System Program | false | 0 | `10000000000` | no | fixture original administrator |
| `user` | signer alias `user`; `58aVWrJhcixCdUrm8wVdfUVZiC5Y7QzpFQuoQbJHMV4i` | System Program | false | 0 | `10000000000` | no | fixture depositor identity; not referenced by the exploit trace |
| `treasury_pda` | Solana PDA for seed tuple `[UTF8("treasury")]` and program `46zDmEZAYrpwi3k6FsKFf1rPWZDbZEKM21SFzMKzb1a4`, canonical bump 255; `EiRj7VptpwZTy2uRMbHeqCU45fmbPFd4FrGGbQ2MZfi2` | treasury program | false | 210 | `2352480` | yes | tracked `TreasuryState` layout and fixture state |
| `payment_mint` | account seed alias `payment-mint`; `2cmmKxvd7YMFYhfqSFb45Q7zVYyhqsgoswxbvVeThgkG` | Tokenkeg | false | 82 | `1461600` | no | fixture decimals and aggregate supply |
| `treasury_vault` | account seed alias `treasury-vault-token`; `E1wvHDQMjFVw8hZgdsLzo5tXqSttrvHB56Du1oD1roDY` | Tokenkeg | false | 165 | `2039280` | yes | fixture mint, PDA authority, and `1000000000` balance |
| `attacker_token_account` | account seed alias `attacker-token`; `3DUXuoksqpratbjmysGEKQQUUb1mZRR4y3GWNjSiNTPP` | Tokenkeg | false | 165 | `2039280` | yes | fixture mint, attacker authority, and `0` balance |
| `spl_token` | fixture program alias; `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | loaded program | true | 133352-byte SBF artifact | loader-derived | no | tracked trace and Section 7.4.3 |
| `programs.faultline_treasury` | target program alias; `46zDmEZAYrpwi3k6FsKFf1rPWZDbZEKM21SFzMKzb1a4` | loaded program | true | selected v2 or v3 artifact | loader-derived | invoked | tracked program ID and replay-job candidate binding |

Only the four non-program, non-signer state accounts (`attacker_token_account`, `payment_mint`, `treasury_pda`, and `treasury_vault`) appear in the fixture `accounts` array, in that canonical alias order. The three signer identities appear only in `signers`. Account references resolve across the `accounts`, `signers`, and `programs` namespaces as permitted by Section 7.4.4. `faultline_gate` from the historical logical fixture is not included because neither the tracked trace nor synthetic genesis depends on it.

The System Program public key is `11111111111111111111111111111111`; the treasury and Tokenkeg owners are the program IDs shown above. Every synthetic non-executable state account has `rent_epoch` = `"0"`. Rent-exempt lamports are the literal constants in the table, computed once with Solana 1.18.22 `Rent::default().minimum_balance(data_length)`: `lamports_per_byte_year = 3480`, `exemption_threshold = 2.0`, and storage overhead = 128 bytes. Thus the exact integer rule is `(128 + data_length) * 3480 * 2`, yielding `1461600` for 82 bytes, `2039280` for 165 bytes, and `2352480` for 210 bytes. Generators emit these constants and never query a host or RPC rent value.

The closed `initial_state` values are: `original_admin` = `564Gpg3mVA7LwcW7hVQkeATttbaRRMTntp9eV2AGNpbd`, `treasury_state` = `EiRj7VptpwZTy2uRMbHeqCU45fmbPFd4FrGGbQ2MZfi2`, `treasury_vault` = `E1wvHDQMjFVw8hZgdsLzo5tXqSttrvHB56Du1oD1roDY`, `attacker_token_account` = `3DUXuoksqpratbjmysGEKQQUUb1mZRR4y3GWNjSiNTPP`, `payment_mint` = `2cmmKxvd7YMFYhfqSFb45Q7zVYyhqsgoswxbvVeThgkG`, `mint_decimals` = 6, `treasury_vault_base_units` = `"1000000000"`, and `attacker_base_units` = `"0"`.

#### 7.4.2 Frozen binary account encodings

All public-key fields below are the raw 32 bytes decoded from their frozen canonical Base58 strings. All unused bytes are zero. Multi-byte integers are unsigned little-endian. Final `data_base64` uses canonical padded RFC 4648 standard-alphabet Base64.

- **System-owned signers (0 bytes):** empty account data; ownership, funding, executable flag, and rent epoch are supplied by Section 7.4.1 rather than an `accounts` entry.
- **SPL Token mint (82 bytes):** bytes 0–3 are the `COption<Pubkey>` mint-authority tag 0 and bytes 4–35 are zero; bytes 36–43 are supply `1000000000` as `u64`, exactly the sum of the synthetic vault and attacker token balances; byte 44 is decimals 6; byte 45 is initialization Boolean 1; bytes 46–49 are the freeze-authority tag 0 and bytes 50–81 are zero. The synthetic fixed-supply mint deliberately has neither mint nor freeze authority because the tracked logical fixture declares neither authority and replay performs no mint operation.
- **SPL Token accounts (165 bytes):** bytes 0–31 are the payment mint; bytes 32–63 are the token authority; bytes 64–71 are amount as `u64`; bytes 72–75 are delegate tag 0 and bytes 76–107 are zero; byte 108 is state `Initialized` = 1; bytes 109–112 are native-option tag 0 and bytes 113–120 are zero; bytes 121–128 are delegated amount 0; bytes 129–132 are close-authority tag 0 and bytes 133–164 are zero. The vault authority and amount are the treasury PDA and `1000000000`; the attacker account authority and amount are the attacker signer and `0`.
- **`TreasuryState` (210 bytes):** bytes 0–7 are the Anchor discriminator, first eight bytes of `SHA256(UTF8("account:TreasuryState"))` = `f038e29e8af44f9a`; byte 8 is `schema_version` 1; bytes 9–40 are original admin; bytes 41–72 are treasury vault; bytes 73–80 are `total_deposited` `1000000000` as `u64`; byte 81 is PDA bump 255; bytes 82–209 are the tracked 128-byte reserved field, with payment mint in bytes 82–113 and bytes 114–209 zero. This is derived from the tracked v1 layout (`8 + TreasuryState::LEN`, where `TreasuryState::LEN = 202`) without importing an on-chain crate.

The required canonical account payloads are:

| Alias | `data_base64` | Data SHA-256 |
| --- | --- | --- |
| `attacker_token_account` | `GAWhXr8Te/HwStVu41Wu9UUeK+Ud7g6hhKgs1Sevr8nACGa81c5JSZROzXi+2CO1zF/+Sin+SX3UwmQpgS8XzQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` | `e094f0d1d58669afcf6f576d05c1acda6ffec11ca45d5feee8b0b1f68a4e737f` |
| `payment_mint` | `AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMqaOwAAAAAGAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==` | `e5871cb75e1a408fe8a3830c2b0c84abe831f86909d8d8c3cff2b4d0cd001846` |
| `treasury_pda` | `8Djinor0T5oBPLpaMOkYW/wulgNMC9NraYAtzOWhHbRY4P2y6gN1AozBZgbW3vEnrKAemtF7WtHzOeyN6IxMMWvHvaAkJ25D9wDKmjsAAAAA/xgFoV6/E3vx8ErVbuNVrvVFHivlHe4OoYSoLNUnr6/JAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` | `c58208ee116dbc2140d342fb876f04a9aef1683c1de165c2b3a9aba41fd4b155` |
| `treasury_vault` | `GAWhXr8Te/HwStVu41Wu9UUeK+Ud7g6hhKgs1Sevr8nLxLN5V+YZLpuK9pdX5gk3kBxU5SrQY4Xi/nw8e/dqQwDKmjsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` | `d1801a802d583187730d51ea26a1aac2a1388de3d2ec24869b712a8c0643167f` |

Validation decodes each payload, requires its exact length, reconstructs it independently from the frozen logical inputs, and requires byte equality and the listed SHA-256. The fixture is invalid if a serialized field disagrees with `initial_state` or the frozen public-key table.

#### 7.4.3 Tokenkeg executable provenance

LiteSVM 0.1.0 does not execute Tokenkeg through a native Rust processor. `LiteSVM::new()` calls `with_spl_programs()`, whose `load_spl_programs` passes `include_bytes!("programs/spl_token-3.5.0.so")` to `add_program` for the Tokenkeg program ID. Tokenkeg therefore executes as actual SBF bytes in the pinned Solana 1.18.22 loader/runtime.

The authoritative source package is the non-yanked crates.io `litesvm` 0.1.0 crate from `registry+https://github.com/rust-lang/crates.io-index`, checksum `0963e4df461a414763f0348b73eb284a734534a53558fcae35f984a0c16a6e6c`, corresponding to the already pinned upstream commit `5cda1d2dcfae16714a6ff808b58f0c087b21bd42`. Its member `src/spl/programs/spl_token-3.5.0.so` is exactly 133352 bytes with SHA-256 `18264f491c7e0ad056dd36f42f8de6d1fedf9f044d1f521e714b4dc6b61594b6`. The replay crate's exact `litesvm = "=0.1.0"` dependency and the package source/checksum in `/crates/faultline-replay/Cargo.lock`, together with the runner manifest's engine version and `token_program_bundle`, bind that implementation; no separate native `spl-token` processor dependency is used for execution.

Checkpoint 1 extracts those bytes without modification into the tracked repository-relative file `manifests/programs/spl-token-3.5.0.so`. Generation rejects any crate-checksum, member-length, member-hash, tracked-file-hash, program-ID, or runner-version mismatch. Checkpoint 2 uses LiteSVM's embedded copy and first verifies that the tracked mirror has the same frozen hash; the fixture manifest binds the tracked path, source identity, and executable hash. Neither a local Solana distribution nor a separately downloaded SPL artifact is authoritative.

#### 7.4.4 Shared raw transaction input

`faultline.trace.v1.transactions` and `faultline.fixture.v1.setup_transactions` use this same raw, closed input structure. These bytes are the pre-normalization input. Alias resolution, account-meta resolution, and runtime normalization remain Checkpoint 2 work.

Each raw transaction has exactly these required keys:

| Key | JSON type | Constraint |
| --- | --- | --- |
| `step` | JSON integer | `u32` in `1..=32`; steps in each containing array are contiguous from 1 |
| `label` | string | nonempty descriptive label |
| `recent_blockhash_mode` | string | `runner` |
| `signer_aliases` | array of strings | 0–64 unique aliases in canonical alias order |
| `instructions` | array | 1–16 closed instructions in execution order |

Each closed instruction has required `program_id_ref` (string exactly `programs.<alias>`, where `<alias>` is a declared fixture program alias), `instruction` (nonempty instruction label), `data_base64` (canonical padded Base64 decoding to at most 10,240 bytes), and `accounts` (1–64 closed account entries in account-meta order). It may additionally contain optional `amount_base_units`, a canonical `u64` decimal string. No other instruction field is allowed.

Each closed instruction account has required `ref` (nonempty string referencing one declared fixture account, signer, or program), `is_signer` (Boolean), and `is_writable` (Boolean). It may additionally contain optional `role` (nonempty descriptive string). No other account field is allowed. Repeated `ref` values are permitted because the tracked canonical trace deliberately passes the attacker account in two roles; array position and flags remain binding.

### 7.5 `faultline.invariant.v1`

The tracked `policies/invariants/AUTH-001.json` is the semantic baseline. `manifests/auth-001-invariant.json` adds only the required common `canonicalization` field and preserves these exact closed fields and values:

| Key | JSON type | Required value or constraint |
| --- | --- | --- |
| `schema` | string | `faultline.invariant.v1` |
| `canonicalization` | string | `faultline.canonical-json.v1` |
| `invariant_id` | string | `AUTH-001` |
| `version` | JSON integer | `1` |
| `name` | string | `Unauthorized treasury token outflow is forbidden` |
| `statement` | string | `A non-admin signer must never cause the tracked treasury token balance to decrease.` |
| `machine_evaluator` | object | closed object below |
| `tracked_treasury_account` | object | closed object below |
| `admin_authority_source` | object | closed object below |
| `allowed_outflow_conditions` | array | exactly two closed objects in the order shown below |
| `pre_state_selector` | string | `treasury_vault.token_balance` |
| `post_state_selector` | string | `treasury_vault.token_balance` |
| `violation_relation` | string | `if_no_valid_original_admin_authorization_then_post_balance_must_be_greater_than_or_equal_to_pre_balance` |
| `semantic_rule` | string | `Let original_admin be TreasuryState.admin in the captured pre-state. If no transaction in the trace contains a valid authorization from original_admin for the relevant migration or withdrawal operation, then post_treasury_vault_balance >= pre_treasury_vault_balance. A trace cannot satisfy authorization by first corrupting TreasuryState.admin.` |
| `supported_trace_schema` | string | `faultline.trace.v1` |
| `limits` | object | closed object below |
| `limitations` | array of strings | exactly the three tracked entries in tracked order |

The closed `machine_evaluator` object is exactly `{ "type": "unauthorized_token_outflow_v1", "version": 1 }`. The closed `tracked_treasury_account` object has `fixture_account_ref` = `treasury_pda`, `state_account_type` = `TreasuryState`, and `vault_field` = `vault_token_account`. The closed `admin_authority_source` object has `kind` = `pre_state_treasury_admin` and `field` = `TreasuryState.admin`.

The two closed `allowed_outflow_conditions` objects each have exactly `operation` (string enum), `required_authority` = `original_admin`, and `required_signature` = `true`. Their execution-independent canonical order is: first `operation` = `admin_withdraw`, then `operation` = `migrate_authority`. Duplicate operations are invalid.

The closed invariant `limits` object is exactly: `max_transactions` as JSON integer 32, `token_program` = `spl-token-v3-tokenkeg`, and `amount_encoding` = `u64_base_units`.

The three required `limitations` strings, in order, are: `Milestone 2 defines the evaluator contract and canonical policy but does not implement the verifier quorum or generic replay daemon.`; `Only the configured fixture treasury and Tokenkeg mint are in scope.`; and `Token-2022 extensions, transfer fees, confidential balances, rebasing assets, and oracle-dependent policies are out of scope.` Reordering, omitting, adding, or duplicating an entry changes or invalidates the invariant manifest.

`name`, `statement`, `semantic_rule`, and `limitations` are hash-bound. Only `machine_evaluator`, `tracked_treasury_account`, `admin_authority_source`, `allowed_outflow_conditions`, the selector/relation fields, `supported_trace_schema`, and `limits` are evaluator configuration. Descriptive fields cannot independently alter evaluator behavior.

### 7.6 `faultline.trace.v1`

The tracked exploit trace is the compatibility baseline. The closed trace has exactly these required keys:

| Key | JSON type | Required value or constraint |
| --- | --- | --- |
| `schema` | string | `faultline.trace.v1` |
| `trace_id` | string | `auth-001-v2-authority-takeover` |
| `invariant_id` | string | `AUTH-001` |
| `target_version` | string | `v2`; this identifies the trace's discovery target and does not select the replay candidate |
| `fixture` | string | `treasury-v1` |
| `canonicalization` | object | closed trace-canonicalization object |
| `signer_aliases` | array of strings | 1–64 unique aliases in canonical alias order |
| `pre_state_selectors` | object | exact closed selector object below |
| `transactions` | array | 1–32 shared raw transactions in execution order |
| `expected_violation` | object | exact closed metadata object below |
| `safety_notes` | array of strings | 1–32 descriptive entries; input order preserved |

The closed trace `canonicalization` object has exactly `encoding` = `utf8`, `json` = `sorted_keys_no_insignificant_whitespace_for_hashing`, and `instruction_data` = `anchor_discriminator_plus_borsh_args_base64`.

The closed `pre_state_selectors` object has exactly these required string fields and values: `original_admin` = `treasury_state.admin`, `treasury_vault_balance` = `treasury_vault.token_balance`, and `attacker_balance` = `attacker_token_account.token_balance`. These three field names are the selector IDs used in receipt state-hash arrays.

The closed `expected_violation` object has exactly these required fields: `selector` = `treasury_vault.token_balance`; `relation` = `post_gte_pre_for_non_admin`; and `pre_balance_base_units`, `post_balance_after_v2_base_units`, and `attacker_post_balance_after_v2_base_units`, each a canonical `u64` decimal string.

`expected_violation` and `safety_notes` are descriptive test metadata. They are included in canonical trace bytes and the trace hash, but are removed before runtime normalization and are not evaluator input. No metadata field becomes evaluator input unless this specification explicitly identifies it as such.

### 7.7 `faultline.replay-job.v1`

The closed replay job has exactly these required keys:

| Key | JSON type | Required value or constraint |
| --- | --- | --- |
| `schema` | string | `faultline.replay-job.v1` |
| `canonicalization` | string | `faultline.canonical-json.v1` |
| `verification_round` | string | canonical public key |
| `proposal` | string | canonical public key |
| `invariant_account` | string | canonical public key |
| `trace_claim` | string | canonical public key |
| `candidate_buffer_hash` | string | SHA-256 hex copied from the frozen round binding |
| `invariant_specification_hash` | string | SHA-256 hex copied from the frozen round binding |
| `build_manifest_hash` | string | SHA-256 hex |
| `runner_manifest_hash` | string | SHA-256 hex |
| `fixture_manifest_hash` | string | SHA-256 hex |
| `invariant_manifest_hash` | string | SHA-256 hex |
| `trace_hash` | string | SHA-256 hex |
| `target_program_id` | string | canonical treasury public key |
| `candidate_executable_sha256` | string | SHA-256 hex matching the selected build manifest |
| `expected_invariant_id` | string | `AUTH-001` |

Verifier identity, worker ordinal, host path, wall-clock time, and coordinator nonce are excluded so all workers share one job hash.

### 7.8 `faultline.replay-receipt.v1`

The closed receipt has exactly these required keys:

| Key | JSON type | Required value or constraint |
| --- | --- | --- |
| `schema` | string | `faultline.replay-receipt.v1` |
| `canonicalization` | string | `faultline.canonical-json.v1` |
| `replay_job_hash` | string | SHA-256 hex |
| `build_manifest_hash` | string | SHA-256 hex copied from the job |
| `runner_manifest_hash` | string | SHA-256 hex copied from the job |
| `fixture_manifest_hash` | string | SHA-256 hex copied from the job |
| `invariant_manifest_hash` | string | SHA-256 hex copied from the job |
| `trace_hash` | string | SHA-256 hex copied from the job |
| `candidate_executable_sha256` | string | SHA-256 hex copied from the job |
| `engine` | string | `litesvm` |
| `engine_version` | string | `0.1.0` |
| `engine_source_commit` | string | `5cda1d2dcfae16714a6ff808b58f0c087b21bd42` |
| `solana_runtime` | string | `1.18.22` |
| `feature_set` | string | `litesvm-0.1.0-all-enabled` |
| `transactions` | array | 1–32 closed results in execution order |
| `pre_state_hashes` | array | exact selector set in canonical selector order |
| `post_state_hashes` | array | exact selector set in canonical selector order |
| `normalized_logs_sha256` | string | SHA-256 hex |
| `classification` | string enum | `Preserved` or `Violated` |
| `result_code` | JSON integer | `0` for `Preserved`, `1` for `Violated`; `u32` |
| `total_compute_units` | string | canonical `u64` decimal string |

Each closed transaction result has exactly `index` (JSON integer `u16`, contiguous from 0 in array order), `status` (`success` or `error`), `error` (nullable stable runtime error object below), `compute_units` (JSON integer `u32` in `0..=1400000`), `return_data_sha256` (SHA-256 hex string or JSON `null`), and `logs_sha256` (SHA-256 hex). `status = success` requires `error = null`; `status = error` requires a non-null error object. JSON `null` is permitted only for these two explicitly nullable fields.

Each state-hash array element is a closed object with exactly `selector_id` (string referencing one declared `pre_state_selectors` field name) and `sha256` (SHA-256 hex). Both `pre_state_hashes` and `post_state_hashes` contain exactly the three unique selector IDs `attacker_balance`, `original_admin`, and `treasury_vault_balance` in that canonical UTF-8 order. Missing, additional, duplicate, or out-of-order selector IDs are invalid.

#### 7.8.1 Stable Solana instruction errors

Transaction failure `error` is either JSON `null` or a closed object with exactly `instruction_index`, `kind`, and `code`:

- `instruction_index` is a JSON integer representable as `u16`;
- for `kind` = `custom`, `code` is a JSON integer representable as `u32`; and
- for `kind` = `builtin`, `code` is one of the exact symbolic strings in the table below.

The table is authoritative for Solana `1.18.22`: it is derived directly from `solana_program::instruction::InstructionError`. Exact Rust variant identifiers are used as the wire symbols so debug/display text is never serialized. `Custom(u32)` maps to `kind = custom` and its numeric payload. `BorshIoError(String)` maps to `kind = builtin`, `code = BorshIoError`; its unstable string payload is deliberately discarded.

| Supported builtin `code` symbols | | |
| --- | --- | --- |
| `GenericError` | `InvalidArgument` | `InvalidInstructionData` |
| `InvalidAccountData` | `AccountDataTooSmall` | `InsufficientFunds` |
| `IncorrectProgramId` | `MissingRequiredSignature` | `AccountAlreadyInitialized` |
| `UninitializedAccount` | `UnbalancedInstruction` | `ModifiedProgramId` |
| `ExternalAccountLamportSpend` | `ExternalAccountDataModified` | `ReadonlyLamportChange` |
| `ReadonlyDataModified` | `DuplicateAccountIndex` | `ExecutableModified` |
| `RentEpochModified` | `NotEnoughAccountKeys` | `AccountDataSizeChanged` |
| `AccountNotExecutable` | `AccountBorrowFailed` | `AccountBorrowOutstanding` |
| `DuplicateAccountOutOfSync` | `InvalidError` | `ExecutableDataModified` |
| `ExecutableLamportChange` | `ExecutableAccountNotRentExempt` | `UnsupportedProgramId` |
| `CallDepth` | `MissingAccount` | `ReentrancyNotAllowed` |
| `MaxSeedLengthExceeded` | `InvalidSeeds` | `InvalidRealloc` |
| `ComputationalBudgetExceeded` | `PrivilegeEscalation` | `ProgramEnvironmentSetupFailure` |
| `ProgramFailedToComplete` | `ProgramFailedToCompile` | `Immutable` |
| `IncorrectAuthority` | `BorshIoError` | `AccountNotRentExempt` |
| `InvalidAccountOwner` | `ArithmeticOverflow` | `UnsupportedSysvar` |
| `IllegalOwner` | `MaxAccountsDataAllocationsExceeded` | `MaxAccountsExceeded` |
| `MaxInstructionTraceLengthExceeded` | `BuiltinProgramsMustConsumeComputeUnits` | |

#### 7.8.2 Normative receipt digest preimages

The following rules are normative for every runtime-derived Checkpoint 3 receipt digest.

##### Common framing rules

- SHA-256 is applied to the exact byte concatenations defined below.
- Domain strings are uppercase ASCII bytes with no trailing NUL.
- `u32be(n)` is an unsigned 32-bit big-endian integer.
- `u64be(n)` is an unsigned 64-bit big-endian integer.
- Hash values embedded in another preimage are their raw 32 bytes, never lowercase hexadecimal text.
- Public keys are their decoded raw 32-byte values, never base58 text.
- Text is validated UTF-8 and used byte-for-byte.
- No separators, JSON serialization, platform newlines, trimming, whitespace rewriting, or implicit conversions are permitted unless explicitly specified.
- Any overflow, missing value, unsupported selector/type, malformed encoding, or inconsistent count fails closed.

##### Selector state-value hashes

Each entry in `pre_state_hashes` and `post_state_hashes` hashes the typed scalar value produced by that selector, not the complete containing account bytes.

```text
state_value_hash = SHA256(
    "FAULTLINE_STATE_VALUE_V1"
    || u32be(selector_name_utf8.length)
    || selector_name_utf8
    || type_tag
    || u32be(value_bytes.length)
    || value_bytes
)
```

The Checkpoint 3 selector encoding table is frozen as follows:

- `original_admin`
  - `type_tag = 0x01`
  - `value_bytes = decoded 32-byte public key`
- `treasury_vault_base_units`
  - `type_tag = 0x02`
  - `value_bytes = u64be(amount)`
- `attacker_base_units`
  - `type_tag = 0x02`
  - `value_bytes = u64be(amount)`

The receipt schema's already-frozen selector IDs remain `attacker_balance`, `original_admin`, and `treasury_vault_balance`. Their typed scalar inputs are `attacker_base_units`, `original_admin`, and `treasury_vault_base_units`, respectively. In the preimage above, `selector_name_utf8` is the UTF-8 name from the Checkpoint 3 selector encoding table: `attacker_base_units`, `original_admin`, or `treasury_vault_base_units`. This mapping clarifies the digest input without renaming or reordering the receipt schema's selector IDs.

The same selector name and scalar value must produce the same hash in pre-state and post-state. The pre/post position is represented by the containing receipt field and is not included in the selector hash.

Every selector required by the frozen invariant manifest must appear exactly once in both state-hash arrays. Entries remain in the schema's frozen canonical selector-ID order: `attacker_balance`, `original_admin`, `treasury_vault_balance`. Missing, duplicate, additional, unsupported, or misordered selectors fail closed.

##### Return-data hash

Absence of Solana return data:

```text
return_data_sha256 = SHA256(
    "FAULTLINE_RETURN_DATA_V1"
    || 0x00
)
```

Presence of Solana return data `(program_id, data)`:

```text
return_data_sha256 = SHA256(
    "FAULTLINE_RETURN_DATA_V1"
    || 0x01
    || program_id_raw_32_bytes
    || u32be(data.length)
    || data
)
```

An explicit empty return-data payload is therefore distinct from no return data. If the payload length cannot fit in `u32`, construction fails closed.

##### Per-transaction log hash

For the exact ordered runtime log vector `logs[0..N]`:

```text
logs_sha256 = SHA256(
    "FAULTLINE_TX_LOGS_V1"
    || u32be(N)
    || for each log in runtime order:
         u32be(log_utf8.length)
         || log_utf8
)
```

- Preserve transaction-local runtime order.
- Preserve each emitted log string byte-for-byte.
- Do not append CR, LF, NUL, or another separator.
- Do not trim, case-fold, redact, parse, or rewrite program IDs, compute-unit messages, error messages, or other log contents.
- An empty log vector is valid and hashes the domain followed by `u32be(0)`.

##### Aggregate normalized-log hash

For receipt transactions in frozen transaction/step order:

```text
normalized_logs_sha256 = SHA256(
    "FAULTLINE_NORMALIZED_LOGS_V1"
    || u32be(transaction_count)
    || for each transaction in receipt order:
         raw_32_byte_logs_sha256
)
```

The aggregate is constructed from the raw per-transaction log hashes defined above, not their hexadecimal representation and not by joining log text. Transaction grouping and order are therefore preserved.

A transaction without logs contributes the valid empty-log-vector digest. A missing per-transaction log digest fails closed.

##### Checkpoint 1 vector status

- Existing Checkpoint 1 receipts and unsigned worker outputs are format/schema/hash vectors only.
- They are not evidence of VM execution and are not authoritative Checkpoint 3 runtime receipts.
- Checkpoint 3 must create runtime-derived golden evidence using the newly frozen nested digest rules.
- Arbitrary Checkpoint 1 digest values must not be silently reinterpreted as runtime-derived values.
- The canonical serialization and outer hash algorithms frozen in Checkpoint 1 remain unchanged.

##### Scope and assertion clarification

These definitions unblock Checkpoint 3 assertions 17–23. Assertions 13–16 remain assigned to later failure-handling and worker work, and assertions 24–28 remain assigned to worker isolation, agreement, and closeout. No assertion is renumbered or reinterpreted by this clarification.

Worker identity, process ID, host timing, memory use, and signature are excluded from the receipt.

### 7.9 `faultline.worker-output.v1`

This schema is the unsigned canonical payload. Checkpoint 1 implements and validates only this format. It has these required keys plus the conditionally present eligible-result keys:

| Key | JSON type | Required value or constraint |
| --- | --- | --- |
| `schema` | string | `faultline.worker-output.v1` |
| `canonicalization` | string | `faultline.canonical-json.v1` |
| `coordinator_nonce` | string | exactly 64 lowercase hexadecimal characters |
| `worker_ordinal` | JSON integer | `0`, `1`, or `2` |
| `verifier_pubkey` | string | canonical public key |
| `replay_job_hash` | string | SHA-256 hex |
| `classification` | string enum | `Preserved`, `Violated`, `InvalidEvidence`, `UnsupportedEnvironment`, or `RunnerFault` |
| `result_code` | JSON integer | one `u32` code permitted for the classification by Section 9 |
| `receipt_hash` | string | required only for eligible results; otherwise absent |
| `verdict_u8` | JSON integer | required only for eligible results: 0 for `Preserved`, 1 for `Violated`; otherwise absent |
| `replay_result_commitment` | string | SHA-256 hex required only for eligible results; otherwise absent |
| `attestation_intent` | object | required only for eligible results; otherwise absent |
| `process_peak_memory_bytes` | string | canonical `u64` decimal string |
| `elapsed_milliseconds` | string | canonical `u64` decimal string |

The closed `attestation_intent` object has exactly these required fields: `verification_round`, `proposal`, `invariant_account`, `trace_claim`, and `verifier_pubkey` as canonical public keys; `verdict_u8` as JSON integer 0 or 1 matching the output; and `receipt_hash` and `replay_result_commitment` as SHA-256 hex matching the output. Its verifier public key must equal the enclosing output's `verifier_pubkey`.

`Preserved` requires result code `0`; `Violated` requires `1`. `InvalidEvidence` permits only `0x00010001..=0x00010009`; `UnsupportedEnvironment` permits only `0x00020001..=0x00020005`; and `RunnerFault` permits only `0x00030001..=0x00030007`. Only `Preserved` and `Violated` contain the four eligible-result fields. No unsigned payload contains a signature or signature-algorithm field.

### 7.10 `faultline.signed-worker-output.v1`

The signed form is a separate closed wrapper with exactly these required keys:

| Key | JSON type | Required value or constraint |
| --- | --- | --- |
| `schema` | string | `faultline.signed-worker-output.v1` |
| `canonicalization` | string | `faultline.canonical-json.v1` |
| `output` | object | complete closed `faultline.worker-output.v1` unsigned payload |
| `signature_algorithm` | string | `solana-ed25519-sha256-v1` |
| `signer_pubkey` | string | canonical public key equal to `output.verifier_pubkey` |
| `signature` | string | canonical Base58 encoding of exactly 64 signature bytes |

The wrapper is not part of Checkpoint 1 implementation. Signed parsing, signature generation, and verification remain deferred to the receipt/signing and worker checkpoints. The signature preimage contains only canonical serialized `output`; no wrapper field is included.

### 7.11 Checkpoint 1 provenance closure and vector-only identities

Every Checkpoint 1 generated field has one authoritative source and one deterministic validation rule:

| Output | Authoritative source | Deterministic derivation and validation |
| --- | --- | --- |
| v2/v3 build manifests | tracked Milestone 2 program ID and artifact-hash evidence; existing artifact bytes and build manifests | transcribe the exact Section 7.2 constants; independently hash the artifact and require the frozen digest |
| runner manifest | Sections 3, 7.3, and the replay-plane lockfile | emit exact constants; audit all replay-reachable versions and Tokenkeg provenance |
| fixture manifest | tracked logical fixture and trace plus Sections 7.4.1–7.4.3 | reconstruct every key and byte; validate all cross-field relationships, lengths, rents, hashes, ordering, and aliases |
| invariant manifest | tracked `policies/invariants/AUTH-001.json` | preserve every tracked semantic field and add only the common canonicalization string; validate exact values from Section 7.5 |
| trace bytes and hash | tracked `fixtures/exploits/auth-001-v2-authority-takeover.json` | parse that file directly under Section 7.6, canonicalize it, and apply Section 8.2; ignored materializations are forbidden inputs |
| replay-job vectors | generated manifest hashes, canonical trace hash, actual candidate artifact digest, and the vector-only identifiers below | construct each Section 7.7 field explicitly and apply Section 8.3; v2 and v3 differ only in candidate/build bindings |
| receipt schema vectors | the corresponding replay-job vector and fixed vector-only transaction/state/log values | validate Section 7.8 cross-field rules and apply Section 8.4; these are schema/hash vectors, not claims of VM execution |
| unsigned worker-output vectors | receipt vectors plus the fixed verifier identity and nonce below | validate all Section 7.9 conditional fields and apply Section 8.5; no signing occurs in Checkpoint 1 |
| Milestone 5 result vector | tracked Milestone 5 repeated-byte vector | preserve the Section 8.6 preimage and expected result unchanged |
| Tokenkeg artifact and hash | crates.io `litesvm` 0.1.0 package and member fixed by Section 7.4.3 | require package checksum, member length/hash, tracked mirror hash, program ID, and runner binding |

For Checkpoint 1 job, receipt, and worker schema vectors only, the following frozen raw 32-byte values and canonical Base58 encodings are used. They are test data, not protocol identities and not a new hash domain:

| Field | Raw bytes | Canonical Base58 |
| --- | --- | --- |
| `verification_round` | `0x11` repeated 32 times | `29d2S7vB453rNYFdR5Ycwt7y9haRT5fwVwL9zTmBhfV2` |
| `proposal` | `0x12` repeated 32 times | `2DYKaRPBeNM5WdW8rNsYEktjPrnd89Mm4Lzp3qonSzoj` |
| `invariant_account` | `0x13` repeated 32 times | `2HTciirCEfeJeikeHgCTXdfVe1zpoD3ackfU7DrPCL8S` |
| `trace_claim` | `0x14` repeated 32 times | `2MNus2KCpxwXnp19iyXNpWSFtBD2UGjQBAL8AbtywfT9` |
| `verifier_pubkey` | `0x15` repeated 32 times | `2RJD1KnDRGEkvuFfAGrJ7PD28LRE9LRDjZznDywagzmr` |

The vector `coordinator_nonce` is `0x16` repeated 32 times and encoded as 64 lowercase hexadecimal characters. Any other placeholder SHA-256 field in a receipt or worker schema vector is `SHA256(ASCII("FAULTLINE_CP1_VECTOR_V1") || BYTE(0x00) || U16BE(byte_length(UTF8(field_path))) || UTF8(field_path))`, where `field_path` is its unique lowercase dotted JSON path recorded beside the vector constructor. This is only a reproducible source of syntactically valid vector data; production trust-path hashing still uses only Section 8. The replay-job vector's `candidate_buffer_hash` and `candidate_executable_sha256` are the selected real artifact hash, its `invariant_specification_hash` is SHA-256 of the exact tracked policy-file bytes (`b63f9fccb4731d21ea15c254634ba9f569ed3ff305e6e5c16bfab3dfc53dec7c`), and all five manifest/trace bindings are their actual Section 8 hashes rather than placeholders.

The positive receipt schema vector contains one closed transaction result with `index` = 0, `status` = `success`, `error` = `null`, `compute_units` = 1, `return_data_sha256` = `null`, and a path-derived `logs_sha256`; its three pre-state and three post-state hashes use the required selector order and path-derived digests. It has `normalized_logs_sha256` from the same rule, `classification` = `Preserved`, `result_code` = 0, and `total_compute_units` = `"1"`. This is deliberately a format vector rather than an execution receipt. The positive unsigned worker vector uses ordinal 0, the frozen verifier public key, `classification` = `Preserved`, `result_code` = 0, `verdict_u8` = 0, `process_peak_memory_bytes` = `"1"`, `elapsed_milliseconds` = `"1"`, the actual positive receipt hash, the Section 8.6 commitment computed from the vector job bindings, and a matching attestation intent. Negative vectors make one specified mutation at a time; they do not introduce additional source data.

Derived JSON files are pretty-printed only for repository review and end with exactly one LF. Their hashes always use re-parsed Section 6 canonical bytes, which contain no trailing newline. The generator runs twice in Checkpoint 1 and the second run must produce byte-for-byte identical manifests, binary mirror, and vectors.

---

## 8. Exact hash and signature preimages

All length fields in this section are unsigned big-endian. `U16BE`, `U64BE`, and `BYTE` mean exactly 2, 8, and 1 raw bytes. `ASCII(x)` contains no terminator. `CANONICAL(x)` is the exact canonical JSON byte sequence. Hashing uses SHA-256.

### 8.1 Manifest hash

For each build, runner, fixture, or invariant manifest:

```text
preimage = ASCII("FAULTLINE_MANIFEST_V1")
        || BYTE(0x00)
        || U16BE(byte_length(schema_utf8))
        || UTF8(schema)
        || U64BE(byte_length(CANONICAL(manifest)))
        || CANONICAL(manifest)

manifest_hash = SHA256(preimage)
```

### 8.2 Trace hash

```text
preimage = ASCII("FAULTLINE_TRACE_V1")
        || BYTE(0x00)
        || U64BE(byte_length(CANONICAL(trace)))
        || CANONICAL(trace)

trace_hash = SHA256(preimage)
```

### 8.3 Replay-job hash

```text
preimage = ASCII("FAULTLINE_REPLAY_JOB_V1")
        || BYTE(0x00)
        || U64BE(byte_length(CANONICAL(replay_job)))
        || CANONICAL(replay_job)

replay_job_hash = SHA256(preimage)
```

### 8.4 Receipt hash

```text
preimage = ASCII("FAULTLINE_REPLAY_RECEIPT_V1")
        || BYTE(0x00)
        || U64BE(byte_length(CANONICAL(receipt)))
        || CANONICAL(receipt)

replay_receipt_hash = SHA256(preimage)
```

### 8.5 Worker-output signature

Each worker identity is a Solana Ed25519 keypair. The public identity is the same 32-byte public key form used by the existing verifier epoch. The worker signs exactly one 32-byte message digest. Here `unsigned_worker_output` is the complete `faultline.worker-output.v1` object stored in the signed wrapper's `output` field:

```text
signature_preimage = ASCII("FAULTLINE_WORKER_OUTPUT_V1")
                  || BYTE(0x00)
                  || U64BE(byte_length(CANONICAL(unsigned_worker_output)))
                  || CANONICAL(unsigned_worker_output)

worker_message_digest = SHA256(signature_preimage)
signature = ED25519_SIGN(verifier_secret_key, worker_message_digest)
```

The `faultline.signed-worker-output.v1` wrapper introduces no additional hash or signature domain. Its `schema`, `canonicalization`, `signature_algorithm`, `signer_pubkey`, and `signature` fields are excluded from the preimage. Verification requires `signer_pubkey = output.verifier_pubkey`, decodes that Solana public key and the 64-byte signature, recomputes the digest from canonical `output` alone, and calls Ed25519 verification. The coordinator nonce and ordinal make copying or replaying another worker's signed output invalid for the current launch.

The signing key is passed to the worker through an inherited anonymous pipe. It is never placed in command-line arguments, environment variables, JSON input, logs, receipts, or repository files. Test identities are ephemeral and distinct. Persistent/on-chain verifier key management is Milestone 8 work.

### 8.6 Existing Milestone 5 replay-result commitment

This preimage is frozen by Milestone 5 and is not altered or length-prefixed:

```text
ASCII("FAULTLINE_REPLAY_V1")   // 19 bytes
|| proposal_pubkey              // 32 raw bytes
|| invariant_pubkey             // 32 raw bytes
|| trace_claim_pubkey           // 32 raw bytes
|| candidate_buffer_hash        // 32 bytes
|| invariant_specification_hash // 32 bytes
|| verdict_u8                   // 0 HOLD, 1 VIOLATION
|| replay_receipt_hash          // 32 bytes
```

The total is 212 bytes and `result_hash = SHA256(preimage)`. The stable VIOLATION vector remains `b7eb266542e099bd41398d8b78d6d571b57844356bfe7c6f5539a73e00046921`.

---

## 9. Result and error classifications

Codes are stable unsigned `u32` values. Renaming, renumbering, or changing eligibility is a specification change.

### Eligible evaluator results

| Classification | Code | Meaning | Attestation intent |
| --- | ---: | --- | --- |
| `Preserved` | `0x00000000` | Replay completed and AUTH-001 held | Yes; verdict byte 0/HOLD |
| `Violated` | `0x00000001` | Replay completed and AUTH-001 unauthorized outflow occurred | Yes; verdict byte 1/VIOLATION |

### Invalid evidence

| Code | Name |
| ---: | --- |
| `0x00010001` | `INVALID_JSON` |
| `0x00010002` | `INVALID_DUPLICATE_KEY` |
| `0x00010003` | `INVALID_UNKNOWN_FIELD` |
| `0x00010004` | `INVALID_CANONICAL_ENCODING` |
| `0x00010005` | `INVALID_SCHEMA_OR_VERSION` |
| `0x00010006` | `INVALID_DIGEST_BINDING` |
| `0x00010007` | `INVALID_ALIAS_OR_REFERENCE` |
| `0x00010008` | `INVALID_BOUNDS` |
| `0x00010009` | `INVALID_SIGNATURE_OR_IDENTITY` |

### Unsupported environment

| Code | Name |
| ---: | --- |
| `0x00020001` | `UNSUPPORTED_ENGINE_OR_RUNTIME` |
| `0x00020002` | `UNSUPPORTED_PROGRAM` |
| `0x00020003` | `UNSUPPORTED_CPI` |
| `0x00020004` | `UNSUPPORTED_SYSVAR_OR_EXTERNAL_DATA` |
| `0x00020005` | `UNSUPPORTED_TRACE_FEATURE` |

### Runner fault

| Code | Name |
| ---: | --- |
| `0x00030001` | `RUNNER_INTERNAL` |
| `0x00030002` | `RUNNER_CRASH` |
| `0x00030003` | `RUNNER_TIMEOUT` |
| `0x00030004` | `RUNNER_MEMORY_LIMIT` |
| `0x00030005` | `RUNNER_OUTPUT_LIMIT_OR_MALFORMED_OUTPUT` |
| `0x00030006` | `RUNNER_ISOLATION_SETUP` |
| `0x00030007` | `RUNNER_CLEANUP` |

### Coordinator outcome

| Code | Name |
| ---: | --- |
| `0x00040001` | `WORKER_DISAGREEMENT` |

Only `Preserved` and `Violated` may contain a receipt hash, verdict byte, replay-result commitment, or attestation intent. Every other classification must omit them. `WORKER_DISAGREEMENT` is produced by the coordinator and never signed as an evaluator result.

---

## 10. Windows worker isolation boundary

### 10.1 OS-enforced restrictions

The coordinator creates each worker suspended, assigns it to a dedicated Windows Job Object, applies the limits, and only then resumes it. The Job Object enforces:

- `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`;
- active-process limit of 1;
- per-process memory limit of 512 MiB;
- aggregate job memory limit of 512 MiB; and
- per-process user-mode CPU time limit of 25 seconds.

The coordinator enforces a separate 30-second wall-clock timeout. Timeout, cancellation, abnormal exit, or coordinator failure closes the Job Object and terminates the process tree. Cleanup has a 5-second grace period; any surviving process or unremovable run directory is `RUNNER_CLEANUP`.

The active-process limit makes a successfully created child process in the job impossible. Worker code additionally contains no subprocess API or shell invocation.

### 10.2 Code-enforced restrictions

- The coordinator resolves allowed roots once to absolute canonical paths.
- Allowed read roots are limited to the repository's `artifacts/treasury`, `fixtures`, `policies`, and `manifests` directories.
- The worker executable, per-run directory, and output pipe are coordinator-owned.
- Every input path must be repository-relative, use `/`, contain no empty, `.`, or `..` segment, and resolve beneath an allowed root.
- Reparse points, symlinks, junctions, UNC paths, drive-relative paths, alternate data streams, and device paths are rejected.
- After opening a file, its final resolved path is rechecked before bytes are accepted.
- Manifests and traces are passed as bounded bytes, not URLs.
- The worker has no networking dependency or networking call site. URL fields cannot be dereferenced.
- The worker has no subprocess call site, dynamic plugin loading, arbitrary evaluator loading, shell parsing, or script execution.
- Environment variables are cleared except for a minimal fixed Windows runtime allowlist. No secret is passed in the environment.
- Standard input/output/error are bounded pipes; structured output exceeding 8 MiB terminates the job.

### 10.3 Restrictions not claimed

Milestone 7 does **not** implement AppContainer, a restricted token, Windows Firewall rules, a filesystem minifilter, a virtual machine, or a container. Therefore:

- network denial is a code property, not an OS-enforced network sandbox;
- filesystem confinement is validated path allowlisting, not an OS-enforced filesystem sandbox; and
- a native-code compromise of the trusted worker or LiteSVM process could escape those code-level restrictions within the user's permissions.

Candidate SBF executes inside the pinned VM and cannot directly invoke Windows APIs, but the native VM remains part of the trusted computing base. Stronger OS isolation and heterogeneous runners are later reliability work.

---

## 11. Security invariants

1. Manifests and traces are data and never executable scripts.
2. Duplicate keys, unknown fields, malformed hashes, ambiguous aliases, and noncanonical encodings fail closed.
3. All referenced accounts, programs, executables, policies, and runtime inputs resolve through pinned manifests.
4. No worker code path fetches network data, launches a subprocess, loads a native plugin, or interprets a shell command.
5. Clock, slot, blockhash, transaction order, runtime features, program bytes, and fixture state are deterministic.
6. Unsupported dependencies return `UnsupportedEnvironment`, never `Preserved`.
7. Invalid inputs return `InvalidEvidence`, never a protocol verdict.
8. Worker faults and timeouts return `RunnerFault`, never a protocol verdict.
9. Expected-result metadata cannot influence normalized execution or evaluation.
10. AUTH-001 captures the original administrator from pre-state; corrupting admin state during the trace cannot manufacture authorization.
11. v2 and v3 replay the same normalized transaction and account sequence.
12. The receipt binds every trust-path input and relevant deterministic output.
13. Worker identity does not alter the receipt hash.
14. A changed bound input or replay output changes the receipt hash.
15. Three workers run as three OS processes with three distinct Solana verifier identities.
16. A signed output from one worker cannot be counted as another worker's output or replayed under another coordinator nonce.
17. The coordinator emits attestation intents only when all required outputs agree on classification, code, receipt hash, verdict byte, and replay-result commitment.
18. `Preserved` maps only to existing HOLD and never means proposal approval.
19. `Violated` maps only to existing VIOLATION.
20. No Milestone 7 component submits a transaction or uses governance, payer, deployment, or upgrade-authority keys.

---

## 12. Implementation phases

### Phase A — Canonical formats and vectors

- Implement the frozen canonical JSON profile.
- Implement closed manifest and trace schemas.
- Freeze positive and negative byte vectors for every hash preimage.
- Preserve the Milestone 5 result commitment vector.

### Phase B — Parsing and normalization

- Parse manifests and the existing `faultline.trace.v1` fixture strictly.
- Resolve fixture aliases into explicit program IDs, accounts, signer/writable flags, instruction bytes, and transaction order.
- Enforce all sizes, counts, allowlists, digests, and path rules.

### Phase C — AUTH-001 evaluator

- Extract AUTH-001 semantics from the existing treasury harness.
- Capture the original administrator and protected balances from pre-state.
- Execute the identical normalized trace against v2 and v3.
- Produce only the frozen result classes and codes.

### Phase D — Receipt and Milestone 5 adapter

- Produce the canonical receipt and receipt hash.
- Map eligible results to verdict byte 0 or 1.
- Compute the unchanged Milestone 5 replay-result commitment.
- Produce signed per-verifier attestation intents without transaction submission.

### Phase E — Worker isolation and agreement

- Implement the bounded pipe protocol and Windows Job Object boundary.
- Launch three workers with distinct ephemeral Solana identities.
- Authenticate outputs and require exact agreement.
- Fail closed on invalid output, crash, timeout, resource termination, cleanup failure, or disagreement.

### Phase F — Closeout

- Run only focused canonical, replay, and worker-isolation tests.
- Preserve hashes, classifications, process identities, memory, and timing evidence.
- Confirm no production Solana source or semantics changed.

---

## 13. Frozen validation assertions

The following 28 assertions are the complete Milestone 7 validation scope. They must not be renumbered or expanded without revising this specification.

1. Canonical serialization is stable across object insertion order.
2. Duplicate keys, unknown fields, floats, malformed UTF-8, and malformed digests are rejected.
3. A one-byte bound input change changes its manifest or job hash.
4. All four manifest schemas validate their required fields and declared versions.
5. The existing canonical `faultline.trace.v1` fixture parses successfully.
6. Duplicate aliases, unknown references, disallowed programs, invalid base64, and over-limit traces are rejected.
7. Normalization produces an explicit, stable instruction/account sequence.
8. Expected-result metadata does not affect normalized replay input or evaluator output.
9. AUTH-001 captures the original administrator from pre-state.
10. The canonical v2 replay returns `Violated` with the frozen violation code.
11. The same normalized trace against v3 returns `Preserved`.
12. The v3 failed unauthorized migration leaves protected balances unchanged.
13. Invalid or digest-mismatched evidence returns `InvalidEvidence`.
14. Unsupported program/runtime requirements return `UnsupportedEnvironment`.
15. Crash, memory-limit termination, and internal worker failure return `RunnerFault`.
16. Wall-clock expiration returns `RunnerFault` with the timeout code.
17. The receipt binds every required input hash, runtime version, transaction result, state hash, log digest, classification, and code.
18. Identical runs produce identical receipt bytes and hashes.
19. Verifier identity changes worker output but not receipt bytes or receipt hash.
20. Preserved maps exactly to Milestone 5 verdict byte `0`.
21. Violated maps exactly to Milestone 5 verdict byte `1`.
22. The Milestone 5 replay-result commitment matches its frozen Rust/TypeScript vector.
23. InvalidEvidence, UnsupportedEnvironment, and RunnerFault produce no result commitment or attestation intent.
24. Three distinct worker processes and verifier identities independently produce the same v2 receipt and commitment.
25. Three distinct worker processes and verifier identities independently produce the same v3 receipt and commitment.
26. Any worker disagreement produces no aggregate attestation intents.
27. Worker output substitution, replay, wrong job hash, or wrong verifier signature is rejected.
28. The focused suite leaves no worker process running and makes no production Solana source change.

---

## 14. Runtime and resource limits

Milestone 7 does not start Solana Validator and does not bind port 8899.

- Environment gate: at least 5 GiB available physical memory before cold build or worker-isolation tests.
- Cold Rust build allowance: 10 minutes and 4 GiB peak aggregate memory.
- Focused unit/vector suite after build: target 60 seconds.
- Worker process memory: 512 MiB OS-enforced process and job limit.
- Worker CPU time: 25 seconds OS-enforced user-mode limit.
- Worker wall time: 30 seconds coordinator-enforced limit.
- Worker structured output: 8 MiB.
- Manifest input: 1 MiB per manifest.
- Trace input: 2 MiB.
- Fixture input: 10 MiB.
- Trace: at most 32 transactions, 16 instructions per transaction, 64 accounts per instruction, 10,240 instruction-data bytes per instruction, and 1,400,000 compute units per transaction.
- Three-worker shard: up to three concurrent workers, 2.5 GiB aggregate host-memory budget including coordinator overhead, and 90-second timeout after binaries exist.
- Cleanup grace: 5 seconds, followed by failure if the Job Object or run directory is not clean.

Allocator abort, abnormal exit, limit violation, malformed worker output, disagreement, or cleanup failure stops the shard. An unchanged failed shard is not rerun.

---

## 15. Checkpoint plan

1. **Formats checkpoint:** crate skeleton, exact dependency pins, canonical JSON, closed schemas, and hash vectors.
2. **Evaluator checkpoint:** normalized trace plus deterministic AUTH-001 v2/v3 results.
3. **Receipt checkpoint:** frozen receipt, Ed25519 worker output, and Milestone 5 adapter.
4. **Worker checkpoint:** Windows Job Objects, resource limits, three-worker agreement, and failure handling.
5. **Closeout checkpoint:** the 28 focused assertions and preserved evidence.

Every checkpoint requires a scoped diff, `git diff --check`, relevant focused tests, separate review of any authoritative lockfile in scope, and confirmation that no production Solana semantics changed. Milestone 1–6 suites are rerun only at the later integration boundary, not during Milestone 7 planning or routine replay-foundation development.

Checkpoint 1 runs the replay and on-chain planes separately. Replay-plane verification uses exactly:

```text
cargo fmt --manifest-path crates/faultline-replay/Cargo.toml --all -- --check
cargo check --manifest-path crates/faultline-replay/Cargo.toml --workspace --all-targets --locked
cargo test --manifest-path crates/faultline-replay/Cargo.toml --workspace --all-targets --locked
```

Its dependency-tree audit is rooted in `crates/faultline-replay/Cargo.toml`. These commands must not resolve or compile either on-chain program crate.

Root on-chain-plane verification uses exactly:

```text
cargo fmt --all -- --check
cargo check --workspace --all-targets --locked
cargo test --workspace --all-targets --locked
```

These root commands must not resolve or compile the excluded replay workspace and must leave `/Cargo.lock` byte-for-byte unchanged.

Checkpoint 1 dependency evidence must prove all of the following:

- `cargo tree --manifest-path crates/faultline-replay/Cargo.toml -p faultline-replay` contains LiteSVM `0.1.0`;
- every Solana runtime package reachable from `faultline-replay`, including normal, build, development, and target-specific edges, is exactly `1.18.22`;
- `solana_rbpf` reachable from `faultline-replay` resolves exactly once at `0.8.3`;
- neither `faultline_gate` nor `faultline_treasury` is reachable from `faultline-replay`; and
- the existing on-chain program crates remain pinned to `solana-program 1.18.10`.

The replay audit inspects `/crates/faultline-replay/Cargo.lock` and rejects any `1.18.10` Solana package, any non-`1.18.22` replay-runtime package, a second replay-plane RBPF version, or a replay dependency on an on-chain program crate. The root audit verifies that `/Cargo.lock` remains the unchanged on-chain lockfile and that the program crates remain at `solana-program 1.18.10`. The planes are never audited as if they shared one lockfile or resolution graph.

---

## 16. Remaining roadmap

### Milestone 8 — SDK, CLI, and reproducible local demo

- shared public TypeScript SDK;
- generated public IDL package;
- complete operator CLI;
- clean-reset and owned-validator orchestration;
- submission of eligible worker results through the existing direct-attestation interface;
- full v2 rejection and economic settlement; and
- full v3 HOLD, explicitly labeled temporary governance approval, and guarded execution.

### Milestone 9 — Indexer, API, and artifact availability

- finalized/confirmed account reconciliation;
- derived read API;
- content-addressed public artifacts and manifests;
- verified-build metadata integration; and
- evidence availability without granting off-chain services authorization power.

### Milestone 10 — Real frontend integration

- replace the mock client with wallet/RPC-backed flows;
- make on-chain state authoritative;
- expose operator and researcher actions; and
- preserve accurate trust, commitment-level, and temporary-approval language.

### Milestone 11 — Reliability and release gates

- ten clean complete rehearsals;
- state-machine and property testing;
- LiteSVM/local-validator divergence checks;
- benchmarks and resource tuning;
- stronger worker sandbox evaluation and heterogeneous runner planning;
- operational key separation, runbooks, threat-model closeout, and audit preparation.

AI-assisted trace generation remains optional after reliability work and cannot enter the verdict trust path.

---

## 17. Known limitations

- LiteSVM 0.1.0 uses its deterministic all-enabled Solana 1.18 feature set; it is not a proof of exact historical Mainnet feature activation.
- Cargo operations run separately against the root on-chain workspace and the standalone nested replay workspace; no single Cargo invocation resolves or compiles both planes.
- The feasibility audit establishes dependency, loader, and program-entry compatibility. Full deterministic v2/v3 replay results are proven only by assertions 10 and 11 during implementation.
- All three workers share one engine and runtime implementation, so agreement does not protect against common-mode VM defects.
- Windows Job Objects enforce process, memory, CPU, and cleanup limits but do not provide network or filesystem sandboxing.
- Filesystem and network restrictions rely on audited coordinator/worker code and the inability of SBF code to call host Windows APIs directly.
- Ephemeral verifier identities prove three distinct signers in Milestone 7; persistent keys and on-chain transaction signing belong to Milestone 8.
- A signed attestation intent is not an on-chain attestation and has no protocol effect.
- `Preserved` maps to HOLD, which is deliberately non-approving.
- Approval still uses the existing temporary governance path.
- On-chain proposal artifact binding remains partial.
- The protocol remains Tokenkeg-only and has no emergency path.
- This milestone does not establish production safety, Byzantine verifier diversity, or secure execution of arbitrary Solana programs.
