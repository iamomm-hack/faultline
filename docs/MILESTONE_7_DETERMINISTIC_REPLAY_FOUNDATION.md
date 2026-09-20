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

> **Revision note — Solana runtime pin erratum (2026-09-20):** Attempting to match the existing artifacts' Solana/SBF `1.18.10` build provenance in the replay runtime could not create a fresh lockfile because that runtime's `solana-bpf-loader-program` requires the yanked `solana_rbpf 0.8.0`. Solana `1.18.22` is the first compatible `1.18.x` patch using non-yanked `solana_rbpf 0.8.3`. The compatibility probe resolved one unified Solana `1.18.22` runtime family. Under LiteSVM `0.1.0` plus Solana `1.18.22`, both existing treasury v2/v3 artifacts loaded and entered their Anchor programs, returning the expected `InstructionMissing` / `Custom(100)`. Their build provenance and artifact hashes remain unchanged.

### 2.1 Selected engine

The deterministic engine is the Rust crate `litesvm = "=0.1.0"`, upstream tag `v0.1.0`, peeled commit `5cda1d2dcfae16714a6ff808b58f0c087b21bd42`.

The dependency is pinned exactly. Its Solana dependency family must also resolve exactly to `1.18.22`, not merely to any version accepted by LiteSVM's `~1.18` requirements. The replay crate therefore pins these runtime crates to `=1.18.22` and the lockfile must contain no second Solana runtime version:

- `solana-program`;
- `solana-program-runtime`;
- `solana-bpf-loader-program`;
- `solana-sdk`;
- `solana-system-program`;
- `solana-compute-budget-program`;
- `solana-loader-v4-program`; and
- `solana-address-lookup-table-program`.

The replay crate also pins `solana_rbpf = "=0.8.3"`, official upstream tag `v0.8.3`, commit `20648d721f8cba862df874754650919a66ca9966`, crates.io checksum `da5d083187e3b3f453e140f292c09186881da8a02a7b5e27f645ee26de3d9cc5`.

The implementation checkpoint must verify these exact versions with `cargo tree -d` and lockfile inspection. Upgrading LiteSVM, `solana_rbpf`, or any Solana runtime crate is a specification change.

### 2.2 Pinned toolchain

| Component | Frozen value |
| --- | --- |
| Host Rust | `rustc 1.89.0 (29483883e 2025-08-04)` |
| Host Cargo | `cargo 1.89.0 (c24e10642 2025-06-23)` |
| LiteSVM | `0.1.0`, commit `5cda1d2dcfae16714a6ff808b58f0c087b21bd42` |
| LiteSVM MSRV | `1.75.0` |
| Solana/Agave runtime crates | `1.18.22` exactly |
| Solana RBPF | `0.8.3` exactly; tag `v0.8.3`; commit `20648d721f8cba862df874754650919a66ca9966`; crates.io checksum `da5d083187e3b3f453e140f292c09186881da8a02a7b5e27f645ee26de3d9cc5` |
| Solana CLI used for existing artifacts | `solana-cli 1.18.10 (src:a093e239; feat:3469865029, client:Agave)` |
| SBF builder | `solana-cargo-build-sbf 1.18.10` |
| SBF platform tools | `v1.41` |
| Anchor program crates | `0.30.1` exactly |
| Token program | legacy Tokenkeg; LiteSVM 0.1.0 bundled `spl-token-3.5.0.so` |

The Anchor CLI is not a Milestone 7 runtime dependency. The repository pins the Anchor crates, and the existing artifacts are already built.

### 2.3 Existing-artifact compatibility

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
- LiteSVM 0.1.0, the pinned Solana 1.18.22 runtime crates, and `solana_rbpf 0.8.3`;
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
  treasury-v2-build.json
  treasury-v3-build.json
  treasury-runner.json
  treasury-v1-fixture.json

scripts/
  run-replay-foundation-tests.ps1
```

The root workspace adds only `crates/faultline-replay`. Existing policy, trace, fixture, and SBF files remain inputs; they are not silently rewritten.

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

### 7.1 Common manifest fields

Every manifest is a closed object containing:

- `schema`: one of the exact schema identifiers below; and
- `canonicalization`: exactly `faultline.canonical-json.v1`.

### 7.2 `faultline.build.v1`

Required fields:

- common manifest fields;
- `program`: `faultline_treasury`;
- `program_id`: treasury program public key;
- `build`: `v2` or `v3`;
- `cargo_features`: a nonempty, duplicate-free ordered array containing the selected version feature;
- `artifact_path`: normalized repository-relative path using `/` separators;
- `executable_sha256`;
- `toolchain`: closed object with exact strings `solana_cli`, `cargo_build_sbf`, `platform_tools`, and `anchor_crates`.

Absolute paths, `.` or `..` segments, drive prefixes, UNC paths, alternate data streams, and backslashes are invalid.

### 7.3 `faultline.runner.v1`

Required fields:

- common manifest fields;
- `engine`: `litesvm`;
- `engine_version`: `0.1.0`;
- `engine_source_commit`: `5cda1d2dcfae16714a6ff808b58f0c087b21bd42`;
- `solana_runtime`: `1.18.22`;
- `feature_set`: `litesvm-0.1.0-all-enabled`;
- `sigverify`: `true`;
- `clock_mode`: `fixture`;
- `recent_blockhash_mode`: `runner-deterministic`;
- `token_program`: Tokenkeg public key;
- `token_program_bundle`: `spl-token-3.5.0`;
- `allowed_external_programs`: duplicate-free ordered public-key array;
- `limits`: closed object containing numeric `max_transactions` = 32, `max_instructions_per_transaction` = 16, `max_accounts_per_instruction` = 64, `max_instruction_data_bytes` = 10240, `max_compute_units_per_transaction` = 1400000, `max_manifest_bytes` = 1048576, `max_trace_bytes` = 2097152, `max_fixture_bytes` = 10485760, and `max_output_bytes` = 8388608.

### 7.4 `faultline.fixture.v1`

Required fields:

- common manifest fields;
- `fixture_id`: `treasury-v1`;
- `base_slot`: canonical `u64` decimal string;
- `clock`: closed object with canonical `slot` and signed `unix_timestamp` decimal strings;
- `programs`: duplicate-free ordered array of closed tagged objects. A `candidate` entry contains `kind`, `alias`, `program_id`, `executable_sha256`, and `build_manifest_hash`. A `bundled` entry contains `kind`, `alias`, `program_id`, `bundle_name`, and `executable_sha256`; Tokenkeg is the fixed bundled entry;
- `accounts`: duplicate-free ordered array of closed objects containing `alias`, `pubkey`, `owner`, `lamports` as a `u64` decimal string, `executable`, `rent_epoch` as a `u64` decimal string, and `data_base64`;
- `signers`: duplicate-free ordered array of closed objects containing `alias` and public key only;
- `setup_transactions`: an ordered array in normalized trace-transaction form;
- `initial_state`: closed object containing `original_admin`, `treasury_state`, `treasury_vault`, `attacker_token_account`, `payment_mint`, `mint_decimals`, `treasury_vault_base_units`, and `attacker_base_units`.

Private key bytes are never present in the fixture manifest. Deterministic test keypairs are derived in the trusted coordinator from a test-only seed domain and are not accepted from evidence.

### 7.5 `faultline.invariant.v1`

The tracked `policies/invariants/AUTH-001.json` is the semantic baseline. Implementation copies its semantics into `manifests/auth-001-invariant.json`, adds the common canonicalization field, and does not rewrite the tracked policy. Required fields are the resulting closed fields:

- common manifest fields;
- `invariant_id`: `AUTH-001`;
- numeric `version`: 1;
- `name`, `statement`, and `semantic_rule`;
- `machine_evaluator`: closed object with `type` = `unauthorized_token_outflow_v1` and numeric `version` = 1;
- typed treasury, admin-authority, allowed-operation, selector, relation, supported-trace-schema, and limit fields matching the tracked policy.

Human-readable `limitations` are bound by the manifest hash but cannot change evaluator behavior.

### 7.6 `faultline.trace.v1`

The tracked exploit trace is the compatibility baseline. The closed schema requires:

- `schema`, `trace_id`, `invariant_id`, `target_version`, and `fixture`;
- `canonicalization`: closed object describing UTF-8, canonical JSON, and instruction encoding;
- duplicate-free `signer_aliases`;
- closed `pre_state_selectors`;
- ordered `transactions`, each with numeric sequential `step`, `label`, `recent_blockhash_mode` = `runner`, duplicate-free signer aliases, and 1–16 instructions;
- each instruction has exactly one declared `program_id_ref`, an instruction label, canonical base64 data, optional canonical amount string, and 1–64 ordered closed account entries;
- each account entry has one declared fixture `ref`, optional role, and exact Boolean signer/writable flags;
- `expected_violation` and `safety_notes` as test metadata.

`expected_violation` and `safety_notes` are hashed but removed from normalized evaluator input. Changing them cannot alter the evaluator result.

### 7.7 `faultline.replay-job.v1`

The closed replay-job object requires:

- `schema` and `canonicalization`;
- `verification_round`, `proposal`, `invariant_account`, and `trace_claim` public keys;
- `candidate_buffer_hash` and `invariant_specification_hash` copied from the frozen round binding;
- `build_manifest_hash`, `runner_manifest_hash`, `fixture_manifest_hash`, `invariant_manifest_hash`, and `trace_hash`;
- `target_program_id` and `candidate_executable_sha256`; and
- `expected_invariant_id`: `AUTH-001`.

Verifier identity, worker ordinal, host path, wall-clock time, and coordinator nonce are excluded so all workers share one job hash.

### 7.8 `faultline.replay-receipt.v1`

The closed receipt requires:

- `schema` and `canonicalization`;
- `replay_job_hash`;
- all five manifest/trace hashes from the replay job;
- `candidate_executable_sha256`;
- `engine`, `engine_version`, `engine_source_commit`, `solana_runtime`, and `feature_set`;
- `transactions`: ordered closed results containing numeric index, `status` (`success` or `error`), stable runtime error code or `null`, numeric compute units, return-data hash or `null`, and log hash;
- `pre_state_hashes` and `post_state_hashes`: closed objects keyed by the frozen selectors;
- `normalized_logs_sha256`;
- `classification` and numeric stable `result_code`; and
- `total_compute_units` as a canonical `u64` decimal string.

Worker identity, process ID, host timing, memory use, and signature are excluded from the receipt.

### 7.9 `faultline.worker-output.v1`

The closed unsigned worker output requires:

- `schema` and `canonicalization`;
- `coordinator_nonce`: exactly 64 lowercase hexadecimal characters encoding 32 bytes supplied uniquely for the worker launch;
- numeric `worker_ordinal`: 0, 1, or 2;
- `verifier_pubkey`;
- `replay_job_hash`;
- `classification` and numeric stable code;
- `receipt_hash`, `verdict_u8`, and `replay_result_commitment`, present only for eligible results;
- `attestation_intent`, present only for eligible results, containing `verification_round`, `proposal`, `invariant_account`, `trace_claim`, `verifier_pubkey`, `verdict_u8`, `receipt_hash`, and `replay_result_commitment`;
- diagnostic `process_peak_memory_bytes` and `elapsed_milliseconds` as canonical `u64` decimal strings; and
- `signature_algorithm`: `solana-ed25519-sha256-v1`.

The serialized signed form adds exactly one `signature` field. The signature field is absent from the signed bytes.

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

Each worker identity is a Solana Ed25519 keypair. The public identity is the same 32-byte public key form used by the existing verifier epoch. The worker signs exactly one 32-byte message digest:

```text
signature_preimage = ASCII("FAULTLINE_WORKER_OUTPUT_V1")
                  || BYTE(0x00)
                  || U64BE(byte_length(CANONICAL(unsigned_worker_output)))
                  || CANONICAL(unsigned_worker_output)

worker_message_digest = SHA256(signature_preimage)
signature = ED25519_SIGN(verifier_secret_key, worker_message_digest)
```

Verification decodes the declared Solana public key and 64-byte signature, recomputes the digest, and calls Ed25519 verification. The coordinator nonce and ordinal make copying or replaying another worker's signed output invalid for the current launch.

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

Every checkpoint requires a scoped diff, `git diff --check`, relevant focused tests, lockfile review, and confirmation that no production Solana semantics changed. Milestone 1–6 suites are rerun only at the later integration boundary, not during Milestone 7 planning or routine replay-foundation development.

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
