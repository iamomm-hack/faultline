# Milestone 8 - Verifier Integration and Reproducible Demonstration

**Status:** Frozen implementation specification

**Baseline:** `041d4cafeec2a95396b1675285facdd478d29e17` (`test: complete Milestone 7 deterministic replay foundation`)

**Executable-hash compatibility decision baseline:** `795a2e5eba367a3fcf1afc2dc36ece3df9be874c` (completed Checkpoints 1-2; Checkpoint 3 implementation had not begun)

**Scope rule:** Milestone 8 integrates Milestones 1-7 and authorizes one narrow post-migration Gate semantic correction: the legacy-named `candidate_buffer_hash` becomes the exact loader-v3 executable-payload digest. This documentation task changes no production code. The later authorized implementation changes no account layout, instruction discriminator, PDA seed, stable error code, commitment preimage, verdict, economic rule, or Milestone 7 schema/vector.

---

## 1. Objective

Milestone 8 connects the completed deterministic replay foundation to the existing direct verifier-attestation protocol and proves the complete product path on a fresh owned local ledger.

The milestone is complete only when:

- a public TypeScript SDK and generated public IDL package construct and decode the existing protocol exactly;
- a production operator can run one verifier with one explicitly supplied Solana Ed25519 keypair without exposing that key;
- three independent authenticated worker outputs are validated before any attestation transaction is constructed;
- the canonical local demonstration uses three distinct identities, a three-member epoch, threshold `3`, three unanimous worker outputs, and three matching direct attestations;
- the v2 trace produces `VIOLATION`, terminal proposal rejection, and the existing Milestone 6 economic settlement;
- the v3 trace produces non-approving `HOLD`, followed by a separate temporary governance approval and a real guarded loader-v3 upgrade;
- validator, worker, ledger, secret, and process cleanup is proven after success and failure; and
- every assertion in Section 20 passes in its independently bounded checkpoint shard.

Milestone 8 is an integration and reproducible-demonstration milestone. It is not a new verifier protocol.

### 1.1 Non-goals

Except for the narrow Section 2.1 correction later authorized to Checkpoint 3, Milestone 8 does not add:

- any other change under `programs/**`;
- a verifier lifecycle account, operator account, assignment account, or reassignment account;
- a suspension, revocation, emergency-invalidation, or historical-round cancellation instruction;
- verifier verdict commit/reveal;
- on-chain verification or storage of Milestone 7 worker signatures;
- a coordinator nonce on chain;
- a replay-result, receipt, worker-output, PDA, account-layout, discriminator, or error-code change;
- automatic approval after HOLD;
- disagreement, compromise, false-result, or subjective slashing;
- permissionless verifier admission;
- hardware-wallet, HSM, remote-signer, or agent-backed custody;
- an indexer, API, artifact service, frontend, or production deployment; or
- Milestone 9, 10, or 11 work.

The broader verifier lifecycle described in `PRD.md` and `Architecture.md` remains aspirational future architecture. Where those documents describe verifier accounts, assignments, commit/reveal, reassignment, or an independently mutable active flag, the implemented Milestones 5-7 behavior and this document govern Milestone 8.

---

## 2. Baseline and compatibility closure

Milestone 8 consumes these completed layers without reinterpreting them except for the explicitly authorized Milestone 3 candidate-hash correction in Section 2.1:

1. Milestone 1: Guard PDA custody and the sole guarded loader-v3 upgrade route.
2. Milestone 2: treasury v2/v3 artifacts and AUTH-001 behavior.
3. Milestone 3: `SafetyPolicy`, proposal state, temporary governance decision, timing, and guarded execution.
4. Milestone 4: invariant registry, bonded challenge commitment/reveal, and canonical `TraceClaim`.
5. Milestone 5: immutable verifier epochs, replay results, direct verifier attestations, exact-result quorum, HOLD finalization, and automatic VIOLATION rejection.
6. Milestone 6: immutable economic policies, verifier stake, epoch-economic activation, bonds, fees, objective non-reveal slashing, settlement, refund, and cleanup.
7. Milestone 7: canonical replay formats, deterministic v2/v3 evaluation, receipts, signed worker outputs, isolated workers, authenticated three-worker agreement, and attestation intents.

The two dependency planes remain separate:

- root on-chain workspace: Solana `1.18.10`, Anchor crates `0.30.1`, authoritative `/Cargo.lock`;
- standalone replay workspace: LiteSVM `0.1.0`, Solana family `1.18.22`, `solana_rbpf 0.8.3`, authoritative `/crates/faultline-replay/Cargo.lock`.

Milestone 8 must not merge the workspaces or introduce an on-chain program dependency into the replay crate. The public SDK uses the repository's already pinned TypeScript/Solana dependency plane. Dependency updates require a separately reviewed specification change; convenience upgrades are forbidden.

### 2.1 Authoritative loader-v3 executable-payload binding

For all post-migration proposals, the existing on-chain field named `candidate_buffer_hash` means SHA-256 of exactly:

```text
buffer_account.data[
  UpgradeableLoaderState::size_of_buffer_metadata() ..
  buffer_account.data.len()
]
```

The digest excludes the complete loader-v3 state/authority header and includes every byte after that canonical metadata boundary in original order. It performs no ELF parsing, normalization, decompression, trailing-zero trimming, or padding removal; it uses no domain prefix. A staged Buffer therefore matches the raw `.so` artifact only when the payload slice has exactly the same length and contents. Extra trailing capacity or bytes are hash-significant and cannot match a shorter artifact.

The frozen cross-layer equality is:

```text
SHA256(exact raw .so artifact bytes)
== build_manifest.candidate_executable_sha256
== Milestone 7 candidate_executable_sha256
== SHA256(loader-v3 buffer payload slice)
== post-migration Proposal.candidate_buffer_hash
```

`candidate_buffer_hash` is retained as a legacy field name solely for ABI/account compatibility. Its post-migration meaning is the exact executable-payload digest above; no new hash field or account-layout migration is required.

Header exclusion cannot weaken loader validation. Independently of the digest, every relevant creation, verification, and execution path must require:

- the Buffer account owner to be the canonical upgradeable BPF loader;
- account data length of at least `UpgradeableLoaderState::size_of_buffer_metadata()`;
- decoded serialized loader state exactly `UpgradeableLoaderState::Buffer`;
- Buffer authority and state satisfying the existing Guard/`BufferClaim` lifecycle;
- the Buffer locked against unauthorized writes before approval or execution; and
- the exact proposal-bound Buffer account to be the Buffer later used for guarded execution.

The header remains security-critical loader state even though it is excluded from the executable-content digest.

#### 2.1.1 Fail-closed migration and cutover

There is exactly one post-migration interpretation. A full-account digest is never accepted as an alternative to the payload digest, and no `full account hash OR payload hash` fallback or automatic stored-hash conversion is permitted. Pre-migration active proposals containing the legacy full-account digest are invalid under the corrected rule and must fail closed. They may expire or close, or be recreated after migration through the existing lifecycle. The upgrade/cutover procedure must prove that no active proposal relies on the legacy digest before the corrected Gate is activated.

Historical finalized records remain readable, but their stored legacy digest must be identified as a pre-migration full-account digest and must never be represented as a Milestone 7 executable digest. The canonical fresh-ledger Milestone 8 demonstration uses only post-migration proposals. There is no transparent backward-compatibility claim for in-flight legacy proposals.

This correction changes no instruction discriminator, PDA seed, stable error code, existing commitment preimage, account layout, or Milestone 7 receipt, worker-output, signature, result-commitment, or attestation schema. All existing Milestone 7 golden vectors remain byte-for-byte unchanged.

### 2.2 Frozen protocol bytes

Milestone 8 defines no new protocol-visible hash or signature preimage. These bytes remain exact:

```text
result_hash = SHA256(
    ASCII("FAULTLINE_REPLAY_V1")
 || proposal_pubkey
 || invariant_pubkey
 || trace_claim_pubkey
 || candidate_buffer_hash
 || invariant_specification_hash
 || verdict_u8
 || replay_receipt_hash
)
```

The preimage is exactly 212 bytes. Public keys and hashes are raw 32-byte values, `verdict_u8` is `0` for HOLD and `1` for VIOLATION, and there are no separators, JSON bytes, Base58 text, or length prefixes.

The Milestone 7 signature remains:

```text
worker_message_digest = SHA256(
    ASCII("FAULTLINE_WORKER_OUTPUT_V1")
 || BYTE(0x00)
 || U64BE(byte_length(CANONICAL(unsigned_worker_output)))
 || CANONICAL(unsigned_worker_output)
)

signature = ED25519_SIGN(verifier_secret_key, worker_message_digest)
```

`FAULTLINE_REPLAY_V1`, `FAULTLINE_WORKER_OUTPUT_V1`, every Milestone 7 canonical schema, every golden hash/vector, every existing PDA seed, account layout, instruction discriminator, stable error code, and historical epoch/round rule is byte-for-byte and semantically unchanged.

### 2.3 Existing account and instruction surface

Milestone 8 creates no account type and changes no account size. Its verifier path consumes these existing accounts exactly:

| Account | Size | PDA seeds |
| --- | ---: | --- |
| `VerifierRegistry` | 122 | `["verifier-registry", safety_policy]` |
| `VerifierEpoch` | 414 | `["verifier-epoch", verifier_registry, epoch_id_le_u64]` |
| `ProposalVerificationGate` | 77 | `["proposal-verification-gate", upgrade_proposal]` |
| `VerificationRound` | 317 | `["verification-round", trace_claim]` |
| `ReplayResult` | 115 | `["replay-result", verification_round, result_hash]` |
| `VerifierAttestation` | 177 | `["verifier-attestation", verification_round, verifier]` |
| `VerifierStake` | 212 | `["verifier-stake", economic_policy, verifier]` |
| `VerifierEpochEconomics` | 113 | `["verifier-epoch-economics", verifier_epoch, economic_policy]` |
| `RoundEconomicState` | 139 | `["round-economics", verification_round]` |
| `VerifierFeeClaim` | 153 | `["verifier-fee-claim", verification_round, verifier]` |

The canonical implementation invokes only existing instructions: `create_verifier_epoch`, `activate_verifier_epoch`, `initialize_verifier_stake`, `activate_verifier_epoch_economics`, `open_economic_verification_round`, `create_replay_result`, `submit_verifier_attestation`, `finalize_replay_result`, `close_finalized_round_economics`, `settle_accepted_challenge`, `settle_hold_challenge`, `claim_verifier_fee`, `refund_proposal_escrow`, `record_temporary_decision`, and `execute_guarded_upgrade`. Their arguments, ordered accounts, signer/writable flags, constraints, discriminators, events, and errors remain the exact current program/IDL definitions. The SDK may expose builders for other existing instructions, but canonical evidence cannot introduce or substitute a new instruction.

---

## 3. Threat model and trust assumptions

### 3.1 Protected properties

- A worker identity must equal the epoch member, economic stake identity, and on-chain attestation signer used for that verifier.
- A malformed, stale, substituted, unauthenticated, ineligible, or disagreeing worker result cannot produce an attestation plan.
- No coordinator may select a successful subset from a non-unanimous three-worker shard.
- Worker-output signatures and coordinator nonces cannot be replayed across an ordinal, launch, job, proposal, or round.
- On-chain votes cannot be pooled across different result hashes.
- A verifier cannot attest twice or equivocate in one round.
- A VIOLATION quorum remains terminal and a HOLD quorum remains non-approving.
- A key secret cannot enter logs, command output, evidence, repository files, process arguments, or environment variables.
- The local runner cannot attach to, terminate, or clean a validator or process it did not create.
- Failure cannot leave an owned validator, worker, key file, ledger, pipe, or run directory behind.

### 3.2 Trusted components

- the existing Faultline Gate and Treasury programs and their frozen account/state rules;
- configured `SafetyPolicy` governance for epoch membership, threshold, and temporary approval;
- each production verifier operator for custody and use of its own key;
- the TypeScript SDK and operator CLI implementation;
- the Milestone 7 coordinator, production worker, canonicalization, hashing, and signature verification code;
- the pinned Solana clients, local validator, Windows kernel, filesystem, and monotonic clock; and
- local-demo orchestration while it owns the temporary ledger and three demo keys.

### 3.3 Untrusted inputs and services

- RPC responses until cross-checked against pinned genesis, program IDs, owners, PDAs, and account bindings;
- worker stdout, stderr, exit status, and all artifact paths;
- signed worker-output files until complete signature and binding validation;
- user-supplied addresses, hashes, transaction signatures, IDL files, and keypair paths;
- generated or downloaded artifacts not matching tracked provenance; and
- indexers, APIs, dashboards, artifact hosts, and other derived services.

### 3.4 Residual trust

Governance chooses verifier membership and threshold. A compromised configured threshold can attest falsely. All three canonical demo workers use the same LiteSVM/runtime implementation. The MVP does not claim Byzantine security, operator independence, arbitrary-program safety, or mainnet-ready custody.

---

## 4. On-chain and off-chain boundary

### 4.1 On-chain authority

The existing Gate program alone enforces:

- canonical accounts and PDA bindings;
- immutable epoch membership and snapshotted round threshold;
- direct verifier transaction signatures;
- one attestation per `(verification_round, verifier)`;
- the exact Milestone 5 replay-result commitment;
- vote counting for one exact result;
- finalization timing and state transitions;
- terminal VIOLATION rejection;
- HOLD remaining non-approving;
- temporary governance approval prerequisites;
- Milestone 6 economic eligibility and settlement; and
- the guarded loader-v3 execution route.

### 4.2 Off-chain responsibility

The SDK, CLI, coordinator, and workers:

- obtain and validate canonical artifacts and account state;
- authenticate worker outputs and enforce three-worker unanimity;
- protect the coordinator nonce and reject replay/substitution;
- map an eligible output to the existing `AttestationIntent`;
- construct existing instructions and transactions;
- obtain the required signer locally;
- submit, confirm, and decode transactions;
- preserve sanitized evidence; and
- own and clean local processes and temporary state.

Off-chain software cannot create protocol authority. An SDK result, signed worker output, attestation intent, CLI report, or local evidence file has no on-chain effect until an authorized epoch member signs a valid `submit_verifier_attestation` transaction.

### 4.3 Worker signature and nonce boundary

Milestone 7 worker signatures are authenticated off-chain evidence only. They are verified before aggregation but are not submitted to the Gate program, stored in an account, added to a PDA, added to `result_hash`, or treated as a replacement for the Solana transaction signature.

The coordinator nonce remains off-chain replay protection. It is not an instruction argument, account field, PDA seed, replay-result field, attestation field, or commitment input. On-chain replay protection remains Solana transaction freshness plus immutable round/result bindings, epoch membership, and the unique attestation PDA.

---

## 5. Verifier identity and lifecycle

### 5.1 One-key MVP identity

For Milestone 8, one Solana Ed25519 public key is all of:

- an immutable `VerifierEpoch` member;
- the verifier field in the policy-specific `VerifierStake`;
- the Milestone 7 worker-output signer;
- the signer and payer of `submit_verifier_attestation`; and
- the conceptual `vote_authority` in `Architecture.md`.

The public keys must match byte-for-byte. No operator key, vote-authority key, delegation certificate, or key alias can substitute for that identity. Separating these roles is future hardening and requires an explicit protocol migration.

### 5.2 Existing lifecycle

- Admission means governance includes the public key in a newly created immutable epoch.
- Governance is the existing `SafetyPolicy.governance_authority`; no other admission or revocation authority exists.
- Activation updates `VerifierRegistry.active_epoch` and is immediately effective for opening new rounds.
- Rotation means governance creates and activates a new epoch.
- There is no activation overlap, grace period, or delayed transition.
- Old epochs remain immutable.
- An already-open round remains bound to its snapshotted epoch and threshold.
- Operational suspension or revocation means omitting the key from a future epoch.
- Suspension and revocation have no distinct on-chain state.
- Removing a key from a later epoch does not remove its authority in an already-open historical round.
- A compromised key can act in such a round until finalization or expiry.

Milestone 8 must visibly report that last limitation. It must not simulate or claim emergency historical revocation.

### 5.3 Canonical demonstration quorum

The canonical local demonstration uses exactly three distinct keys, one three-member epoch, and threshold `3`. The epoch's raw public keys are sorted exactly as Milestone 5 requires. Exactly three authenticated and unanimous Milestone 7 outputs produce exactly three corresponding direct attestations. Finalization is attempted only after all three attestation accounts exist and the replay result's vote count is `3`.

The SDK may decode and operate against any existing valid epoch size and threshold supported by the Gate program. Such operation is not canonical Milestone 8 completion evidence. The canonical demo never silently chooses a subset of workers.

---

## 6. Private-key custody and secret handling

### 6.1 Production model

Production mode is single-operator-per-verifier:

- each operator controls only its own keypair;
- no coordinator, aggregator, service, or CLI invocation receives three production private keys;
- one operator invocation may load only its explicitly selected verifier key;
- the initial signer adapter may read a standard Solana keypair file;
- the keypair path is accepted only through an explicit CLI option, never an environment variable;
- raw seed/key bytes never enter arguments, environment variables, stdin JSON, stdout, stderr, errors, telemetry, evidence, crash reports, or tracked files;
- the file is read directly without a shell and parsed as the standard 64-byte Solana keypair representation;
- the derived public key must match the requested verifier identity, signed worker output, epoch member, and stake identity;
- mutable secret buffers are zeroized on a best-effort basis and signer objects are dropped as early as the invocation permits; and
- the CLI never copies, exports, repairs, generates, or persists a production key.

The CLI must not default to a well-known wallet path. It requires `--keypair <path>` for a signing operation, resolves the path canonically, requires a regular file, rejects reparse points, and rejects a tracked repository file. A sanitized error may identify the option and failure class but must not print the resolved path or file contents.

Filesystem-backed keypair custody is an explicit MVP limitation. Hardware wallets, remote signers, HSMs, agent-backed custody, role-separated keys, and threshold custody are deferred.

### 6.2 Production multi-operator flow

The aggregation coordinator creates three public work requests with distinct ordinals and nonces and the expected public identities. Each operator independently:

1. verifies the job and on-chain bindings;
2. loads only its own keypair;
3. invokes exactly one production worker through the frozen signing-seed pipe;
4. authenticates the returned signed worker output;
5. emits that existing canonical signed-output object; and
6. clears the mutable seed buffer.

The aggregator receives no private material. It authenticates exactly three outputs and emits an unsigned consensus/attestation plan only after unanimous agreement. Each operator then independently validates the complete plan and uses its own key to sign its own direct-attestation transaction. No operator can sign for another.

Transport between operators and the aggregator is outside Milestone 8; local files may be exchanged manually. No network service or assignment protocol is introduced.

Each work request is the existing closed canonical `faultline.worker-request.v1` payload from Milestone 7, transported out of band before it is framed for the local worker. Milestone 8 adds no signed work-order schema. Machine-local repository-relative `input_paths` may be rewritten only by the receiving operator before worker launch; the operator must independently verify that the referenced bytes reproduce every hash in the unchanged `replay_job`. The nonce, ordinal, expected identity, replay job, and any hash-bearing field may not be rewritten.

### 6.3 Local demonstration keys

The clean-reset demo may generate three ephemeral verifier keypairs with the OS CSPRNG. Private material may exist only in process memory or in the owned run directory. The files must be created with the narrowest practical user-only permissions, must never be committed or copied into sanitized evidence, and must be destroyed during cleanup. No deterministic seed, fallback key, or repository key is allowed.

The local orchestrator may control all three demo keys only for the bounded local demonstration. Evidence and documentation must label this as test/demo custody, not a production deployment model. Public keys and on-chain transaction signatures may be reported; private keypair bytes, seeds, and key-file names may not.

---

## 7. Public SDK

The implementation checkpoint creates a public TypeScript package named `@faultline/sdk`. Its public surface is data-oriented and has no ambient key access.

### 7.1 Responsibilities

The SDK must provide:

- exact PDA derivation helpers for the existing Milestones 1-6 accounts;
- strict account decoders using the generated IDL and explicit owner/discriminator checks;
- immutable typed views of policies, proposals, invariants, trace claims, verifier registries/epochs, rounds, replay results, attestations, and economic accounts;
- exact Milestone 5 replay-result commitment calculation;
- Milestone 7 canonical receipt, signed-output, and attestation-intent validation through a narrow adapter;
- direct instruction builders for existing epoch, stake, round, replay, attestation, finalization, settlement, decision, and guarded-execution instructions;
- transaction compilation and serialized-size checks;
- RPC read/confirmation helpers with explicit endpoint, commitment, timeout, and expected genesis hash; and
- closed structured errors without secrets.

### 7.2 Public API boundary

The SDK accepts public keys, byte arrays, decoded public account data, public hashes, explicit RPC configuration, and signer interfaces supplied by the caller. It must not:

- discover wallet files;
- read environment variables;
- read private keys;
- spawn processes;
- invoke a shell;
- run a validator or replay worker;
- submit automatically while building;
- retry a failed transaction automatically;
- contact an indexer or artifact service; or
- infer governance approval, safety, or settlement from an off-chain report.

Every builder returns an instruction or unsigned transaction plus its validated binding summary. Submission is a separate explicit call. Read helpers default to no endpoint; callers must supply one.

### 7.3 Canonical SDK checks

PDA integers use unsigned little-endian encoding exactly as the programs do. Hash inputs use raw bytes, never displayed strings. Public keys must decode to exactly 32 bytes. Hashes must decode to exactly 32 bytes. Verdicts accept only HOLD `0` or VIOLATION `1`. Unknown fields, enums, account discriminators, owners, and program IDs fail closed.

---

## 8. Generated public IDL package

The implementation checkpoint creates `@faultline/idl`, containing only generated public IDLs, TypeScript types, package metadata, and provenance.

### 8.1 Provenance

- IDLs are generated from the exact baseline program source with Anchor CLI `0.30.1` and the pinned root dependency plane.
- Generation occurs in a dedicated implementation checkpoint, never opportunistically during SDK import or runtime.
- The package records the source commit, Gate and Treasury program IDs, generator/Anchor version, and SHA-256 of each generated IDL.
- A clean regeneration must be byte-identical after the repository's frozen JSON formatting step.
- The audit compares every public instruction name, argument type, account order, writability/signature flag, account discriminator, enum discriminant, and error code used by Milestone 8 against current source.
- Generated IDL cannot redefine or override an on-chain constant.

The generated files are public interface artifacts, not protocol migrations. Any unexplained IDL/source drift blocks Milestone 8.

---

## 9. Operator CLI

The implementation checkpoint creates a CLI executable named `faultline`. Commands are non-interactive by default, accept explicit inputs, emit one bounded JSON result to stdout, and send bounded human diagnostics to stderr. Signing and submission always require an explicit command.

### 9.1 Command surface

```text
faultline inspect account
faultline inspect proposal
faultline epoch create
faultline epoch activate
faultline stake initialize
faultline epoch activate-economics
faultline verifier run
faultline quorum verify
faultline replay-result create
faultline attestation submit
faultline replay-result finalize
faultline economics close-round
faultline economics claim-fee
faultline economics settle-violation
faultline economics settle-hold
faultline economics refund
faultline governance temporary-approve
faultline upgrade execute
faultline demo v2
faultline demo v3
faultline demo all
```

Commands may be implemented as grouped subcommands but these names and responsibilities are stable for Milestone 8. The CLI must not expose an emergency historical-revocation, commit/reveal, reassignment, automatic retry, or automatic approval command.

### 9.2 Common inputs

RPC commands require explicit `--rpc-url`, `--expected-genesis-hash`, and program ID or checked repository configuration. Signing commands require explicit `--keypair`. Replay commands require explicit repository root, candidate/job, request, and output paths. Address and hash inputs must be provided explicitly or derived from already validated parent accounts; they cannot be guessed from the first RPC result.

### 9.3 Output and exit classifications

Success writes one bounded JSON object with `status = "ok"`, command name, a command-specific `result` object, transaction signature when applicable, confirmation slot/status, and sanitized evidence references. `faultline verifier run` writes the byte-exact existing canonical signed-worker-output to its explicit output file and places only its public identity/hash summary in stdout; stdout never wraps or mutates bytes later supplied to consensus. Failure writes no success object and returns exactly one stable process exit class:

| Exit | Name | Meaning |
| ---: | --- | --- |
| 0 | `OK` | Command completed and postconditions were verified |
| 10 | `USAGE_OR_CONFIG` | Missing, conflicting, or unsupported command/configuration |
| 20 | `INVALID_INPUT` | Malformed or noncanonical public input |
| 21 | `INVALID_SIGNATURE_OR_IDENTITY` | Wrong key, signature, nonce, ordinal, or identity |
| 22 | `WORKER_DISAGREEMENT` | Three authenticated projections do not agree exactly |
| 23 | `STALE_OR_SUBSTITUTED_STATE` | RPC/account state does not match the bound plan |
| 24 | `UNAUTHORIZED` | Signer is not authorized by the existing on-chain state |
| 30 | `RPC_FAILURE` | RPC transport, genesis, commitment, or response failure |
| 31 | `TRANSACTION_REJECTED` | Simulation or submission returned a program/runtime error |
| 32 | `CONFIRMATION_TIMEOUT` | Submitted signature did not reach the required status in time |
| 40 | `PROCESS_FAILURE` | Owned validator/worker/helper failed or exited abnormally |
| 41 | `STAGE_TIMEOUT` | A bounded local stage exceeded its deadline |
| 42 | `CLEANUP_FAILURE` | An owned process, handle, secret file, ledger, or run directory survived |
| 50 | `SECRET_HANDLING_FAILURE` | Secret path/content exposure or unsafe key file was detected |
| 70 | `INTERNAL_ERROR` | Closed internal failure not represented above |

The most specific validation failure wins before RPC or transaction construction. Once cleanup begins, `CLEANUP_FAILURE` overrides an otherwise successful result. Diagnostics must retain the underlying public program error code without remapping it to a false success. No command automatically retries an unchanged failed operation.

### 9.4 Secret rules

Argument echoing is disabled for `--keypair`. Panic hooks, tracing, structured errors, child command lines, stage ledgers, and debug output must redact keypair paths and content. A diagnostic may contain the public key only after successful derivation. The CLI must scan its own captured stdout/stderr and evidence before declaring success; a match for a known in-memory private representation or key-file basename is a secret-handling failure.

### 9.5 Unsigned attestation plan

`faultline quorum verify` writes one closed canonical `faultline.attestation-plan.v1` JSON object. It has exactly these fields: `schema`, `canonicalization`, `gate_program_id`, `expected_genesis_hash`, `verification_round`, `verifier_epoch`, `replay_job_hash`, `replay_receipt_hash`, `result_hash`, `verdict_u8`, `signed_worker_outputs`, and `attestation_intents`. `schema` is exactly `faultline.attestation-plan.v1`; `canonicalization` is exactly `faultline.canonical-json.v1`; public keys/hashes retain their existing canonical encodings; `verdict_u8` is `0` or `1`; and each array contains exactly three entries in worker-ordinal order `0,1,2`. The plan contains the original existing signed outputs and intents without modification.

The plan is not signed, hashed into the protocol, submitted, or trusted on read. Every operator reparses it as canonical JSON, reauthenticates all three worker outputs, reruns unanimity and cross-field checks, and re-reads every on-chain binding before signing. Unknown, duplicate, missing, reordered, or inconsistent fields fail closed. This internal transport object changes no Milestone 7 schema or on-chain encoding.

---

## 10. Production single-operator flow

Production operation is intentionally not a three-key coordinator:

1. Governance has already created and activated an immutable epoch and, for economic proposals, its epoch-economic binding.
2. An aggregation coordinator publishes three public requests with one expected identity, ordinal, and nonce each.
3. Each operator obtains the same bound replay job and one request.
4. `faultline verifier run` validates the request and chain bindings before loading the operator's key.
5. It verifies the derived public key equals the expected identity and invokes one real production worker.
6. It verifies the signed output, clears mutable seed material, and emits the canonical signed output.
7. `faultline quorum verify` authenticates exactly three distinct responses and requires the frozen identity-independent projection to agree exactly.
8. The aggregator publishes an unsigned plan containing the existing three signed outputs and three attestation intents; it contains no private material.
9. Each operator validates the entire plan, current chain state, and its own identity again.
10. Each operator signs and submits only its own direct attestation.
11. Any caller may finalize only after the configured threshold exists; Milestone 8 canonical evidence requires all three.

If any operator, output, or on-chain binding fails, no aggregate plan is returned. If chain state changes after plan creation, transaction construction or submission fails as stale rather than adapting silently.

---

## 11. Canonical local demonstration

The owned local orchestrator performs a clean, non-production flow:

1. prove port 8899 is free and no owned residue exists;
2. create a fresh bounded run directory beneath the repository's owned local-ledger parent;
3. generate payer, governance, hunter, and exactly three verifier demo keypairs at runtime;
4. launch one owned local validator with a fresh ledger and capture its PID and genesis hash;
5. deploy the already-built Gate, Treasury, and required candidate artifacts without rebuilding them;
6. initialize policy, economic policy, three stakes, a three-member threshold-3 epoch, and epoch economics;
7. create and fund the proposal, bond and reveal the canonical challenge, and open its economic verification round;
8. run three real production workers with distinct demo identities/nonces;
9. authenticate unanimous outputs and construct the existing replay result plus three direct attestations;
10. finalize and execute the scenario-specific v2 or v3 path;
11. verify all account, token, loader, and state postconditions; and
12. terminate only owned processes and delete the owned ledger, demo keys, IPC state, and run directory.

The v2 and v3 scenarios run on separate fresh ledgers. They are never combined into one long stateful shard.

---

## 12. Direct-attestation construction

### 12.1 Required preflight

Before constructing `create_replay_result` or any attestation, the SDK/CLI must:

1. parse all three `faultline.signed-worker-output.v1` objects with the frozen canonical JSON rules;
2. verify each Ed25519 worker signature over the exact Milestone 7 digest;
3. require ordinals exactly `{0,1,2}`;
4. require three distinct expected identities, nonces, responses, and signatures;
5. verify each nonce and identity against its public request;
6. require all three identity-independent projections to be byte-identical;
7. require an eligible classification and exactly one valid `AttestationIntent` per output;
8. require the three intents to differ only in `verifier_pubkey`;
9. query the expected genesis and Gate program account;
10. load and validate policy, proposal, invariant, trace claim, registry, epoch, round, round economics, economic policy, epoch economics, and all three stakes;
11. require the round to be open and the proposal `ChallengeActive`;
12. require the epoch to contain exactly the same three public identities and threshold `3` for canonical evidence;
13. require each stake to bind the same verifier and economic policy and satisfy existing active/minimum rules;
14. recompute `replay_receipt_hash` from the canonical receipt;
15. recompute `result_hash` from the exact 212-byte Milestone 5 preimage; and
16. require the proposal's legacy-named `candidate_buffer_hash`, the round snapshot, the Milestone 7 `candidate_executable_sha256`, the selected build-manifest executable digest, and SHA-256 of the exact loader-v3 payload slice from Section 2.1 all to equal SHA-256 of the exact raw `.so` artifact bytes, then require every other proposal, invariant, trace, specification hash, verdict, receipt, result, round, and epoch binding to match.

Failure returns no instruction, unsigned transaction, signature request, commitment, or attestation plan.

The preflight also validates the Buffer header independently: canonical upgradeable-loader owner, sufficient metadata length, exact `Buffer` state, Guard authority/write lock, valid `BufferClaim`, and exact proposal-bound account identity. A digest match cannot compensate for any header, state, authority, claim, or account-identity failure.

### 12.2 Existing instructions only

The canonical transaction sequence is:

1. one `create_replay_result(result_hash, verdict, replay_receipt_hash)` transaction, with payer, canonical verification round, canonical replay-result PDA, and System Program;
2. three separate `submit_verifier_attestation(result_hash)` transactions in ordinal order, each signed and paid by its corresponding verifier and containing the existing ordered accounts: verifier, policy, proposal, invariant, trace claim, verifier epoch, verification round, replay result, verifier-attestation PDA, and System Program;
3. one `finalize_replay_result` transaction by any caller, with policy, proposal, proposal verification gate, verification round, and replay result.

The replay-result PDA is derived from `verification_round` and `result_hash`. Each attestation PDA is derived from `verification_round` and that verifier's public key. Worker signatures and coordinator nonces are absent from all three instructions.

After every successful transaction the client re-reads the affected accounts at the required commitment. It does not submit the next attestation unless the prior vote count and attestation bytes match expectations. It does not finalize until all three attestation accounts exist, all three bind the same result, and `vote_count == 3`.

Creation may recognize an already-existing byte-identical replay-result account only when resuming under explicit operator direction; it is never an automatic retry. Existing mismatched state is fatal. The canonical demonstration always begins from an absent result PDA.

---

## 13. v2 VIOLATION flow

The v2 shard must prove this exact sequence:

1. a funded economic proposal is bound to the canonical v2 candidate and AUTH-001 invariant;
2. the canonical bonded challenge is committed and revealed;
3. an economic verification round opens against the active three-member threshold-3 epoch;
4. all three real production workers independently return authenticated `Violated` outputs with one identical consensus projection;
5. one replay result is created with verdict byte `1` and the recomputed receipt/result hashes;
6. all three distinct epoch members submit direct attestations;
7. finalization sets the round to `InvariantViolated`, records the winning result, clears the pending count, sets the permanent verification-gate violation, and moves the proposal to terminal `Rejected` with the existing automatic reason;
8. approval and guarded execution are rejected after finalization;
9. round economics close through the existing VIOLATION path;
10. the accepted challenge returns the hunter bond and pays the configured bounty;
11. each eligible matching verifier fee is claimed through the existing fee path; and
12. remaining liabilities/vaults are settled and refunded only through existing Milestone 6 instructions and destinations.

No new slash or reward is inferred from worker-output signatures. Balances, tombstones, counters, vault closures, rent destinations, and terminal state must match Milestone 6 exactly.

---

## 14. v3 HOLD and guarded execution flow

The v3 shard must prove this exact sequence:

1. a separate fresh ledger contains a funded proposal bound to the canonical v3 candidate and the same normalized trace/invariant;
2. an economic round opens against a three-member threshold-3 epoch;
3. all three real production workers independently return authenticated `Preserved` outputs mapped to HOLD verdict byte `0`;
4. all three direct attestations bind one identical replay result;
5. finalization sets the round to `InvariantHolds`, records the winner, and clears the pending count;
6. the proposal remains `ChallengeActive`, is not approved, and cannot execute;
7. the HOLD challenge follows the existing 25% bond-penalty and refund path, with no bounty;
8. governance performs a separate `record_temporary_decision(Approved, 0x8008)` transaction while the decision window is valid; `0x8008` is the canonical demo reason code and introduces no general protocol meaning;
9. evidence labels the approval `temporary_governance_approval_after_hold`, never `safe`, `verified safe`, or automatic approval;
10. guarded execution before the challenge window ends is rejected;
11. after the window, a separate caller invokes the existing `execute_guarded_upgrade` instruction;
12. the Guard PDA signs the real loader-v3 Upgrade only after the Section 2.1 payload digest equality and every independent proposal, gate, ProgramData, Buffer owner/state/authority, `BufferClaim`, account-identity, write-lock, and timing check pass; and
13. the target ProgramData reflects the v3 candidate and the proposal becomes `Executed`.

HOLD alone never authorizes the upgrade.

---

## 15. Validator, process, and ledger ownership

The local runner must be a bounded PowerShell entrypoint on Windows and must parse successfully before use.

### 15.1 Preflight

- require the exact expected source baseline or the explicitly enumerated implementation files under review;
- require port 8899 to be free;
- refuse to attach to an existing validator;
- require at least 5 GiB available memory before starting a validator or replay shard;
- verify no owned Milestone 8 run-directory or IPC residue exists;
- record both lockfile hashes; and
- leave historical compatibility-audit and unrelated temporary directories untouched.

### 15.2 Ownership

The runner creates one unpredictable run identifier, one run directory beneath the canonical owned local-ledger parent, and one fresh ledger beneath that directory. It rejects reparse points and any resolved path escaping the owned parent. It records the exact PID returned by its own hidden validator launch and the expected genesis hash. Child processes are tracked from creation; name matching or PID-only discovery cannot establish ownership.

The runner never invokes `Start-Process` without retaining the returned process object, never uses a shell to reinterpret untrusted values, never attaches to an existing validator, and never kills an unrelated process occupying port 8899.

### 15.3 Heartbeats and cleanup

Every stage records start, 15-second heartbeats, completion, elapsed milliseconds, exit code, and owned PID in raw ignored logs. Cleanup begins on success, failure, cancellation, or timeout. It terminates only recorded owned processes, waits up to 30 seconds, closes owned handles, deletes demo key files before other run contents, removes the owned ledger/run directory, verifies port release, and performs an orphan check.

An owned survivor, secret file, handle, ledger, IPC object, or run directory is `CLEANUP_FAILURE`, even if protocol assertions passed. Cleanup never deletes by broad glob and never deletes outside the resolved owned run directory.

---

## 16. Fail-closed validation and precedence

The following conditions produce no attestation plan and no transaction signature:

- noncanonical JSON, unknown/duplicate fields, invalid enum or wrong schema;
- invalid worker signature, nonce, ordinal, identity, or key pairing;
- duplicated identity, nonce, response, signature, attestation, or output;
- fewer or more than three canonical demonstration workers;
- any classification, receipt, verdict, result, projection, or intent disagreement;
- ineligible worker classification;
- wrong genesis, program owner/ID, account discriminator, PDA, epoch, threshold, stake, or round status;
- stale proposal, ended window, changed active epoch for a new round, or changed snapshotted state;
- proposal, invariant, trace, candidate, specification, receipt, result, round, or economic-policy substitution;
- unauthorized signer or a keypair whose public key differs from the expected verifier;
- simulation failure, oversized transaction, RPC ambiguity, confirmation timeout, or unexpected account post-state;
- secret-redaction failure; or
- cleanup failure.

Local validation precedes RPC simulation; simulation precedes signing when the RPC supports unsigned simulation; signing precedes submission; confirmation precedes postcondition checks. No validation failure is converted into HOLD or VIOLATION. No automatic retry, reassignment, alternative RPC, alternate signer, threshold reduction, or worker subset is allowed.

---

## 17. Evidence and privacy

### 17.1 Raw evidence

Raw stdout, stderr, validator logs, process IDs, absolute paths, run identifiers, and temporary directory names remain ignored and local. Raw evidence is bounded and retained only long enough to diagnose and derive the sanitized closeout report.

### 17.2 Sanitized tracked evidence

The closeout report may contain:

- source commit and dependency/lock hashes;
- IDL hashes and generator versions;
- public program/account keys, demo verifier public keys, verifier-set hash, and transaction signatures;
- public nonces only when required to prove replay protection and never alongside private material;
- receipt/result/manifest/artifact hashes;
- slots, elapsed durations, bounded resource measurements, exit classes, and program error codes;
- account states, counters, public token balances, settlement amounts, and consensus classifications; and
- cleanup/orphan results with paths and PIDs removed.

It must not contain private keypair arrays, seeds, raw signing-pipe bytes, environment secrets, usernames, drive-specific paths, key-file basenames, temporary directory names, or unrelated environment data.

Before a report is tracked, an automated scan checks known runtime secret representations, key-file names, absolute path forms, temporary path forms, NUL/replacement characters, and unexpected large logs. Detection fails closeout.

---

## 18. Transaction, RPC, and resource limits

| Limit | Frozen value |
| --- | ---: |
| Serialized Solana transaction | at most 1,232 bytes |
| Address lookup tables | forbidden in canonical evidence |
| Instructions per attestation transaction | exactly 1 Gate instruction |
| Automatic transaction retries | 0 |
| Automatic worker retries | 0 |
| RPC request deadline | 30 seconds |
| Transaction confirmation deadline | 90 seconds |
| Validator readiness deadline | 60 seconds |
| Worker wall deadline | existing Milestone 7 value: 30 seconds |
| Worker cleanup grace | existing Milestone 7 value: 5 seconds |
| Validator/process cleanup grace | 30 seconds |
| Heartbeat interval | 15 seconds |
| Captured stdout per child | 8 MiB |
| Captured stderr per child | 8 MiB |
| Minimum available-memory gate | 5 GiB |
| SDK/IDL unit shard | 5 minutes |
| Operator-security shard | 10 minutes |
| Attestation shard | 15 minutes |
| v2 end-to-end shard | 25 minutes |
| v3 end-to-end shard | 25 minutes |
| Orchestration-adversarial shard | 15 minutes |

Transactions over 1,232 serialized bytes are rejected before signing. The SDK does not silently change transaction format, add an address lookup table, split one atomic instruction, or omit accounts. RPC responses are bounded to the account/transaction data needed by the command. The runner uses `CARGO_BUILD_JOBS=1` for any implementation-time Rust build, but Milestone 8 validation never rebuilds inside a timed end-to-end shard.

---

## 19. Test architecture and shard boundaries

Every on-chain integration shard owns a fresh validator and fresh ledger. Required binaries and packages are built before timed shards. A failed shard is not rerun unchanged.

| Shard | Scope | Fresh validator |
| --- | --- | --- |
| `m8_sdk_idl` | generated IDL provenance, SDK parity, encodings, PDA/account/instruction/error parity | No |
| `m8_operator_security` | one-key operator flow, wrong keys, signature/nonce/substitution, redaction, no three-key production custody | No |
| `m8_direct_attestation` | threshold-3 epoch, stake/epoch economics, direct transactions, duplicates, unauthorized identity, stale/historical epoch | Yes |
| `m8_v2_violation` | real v2 workers, three attestations, rejection, fees, bounty/bond and cleanup | Yes |
| `m8_v3_hold_upgrade` | real v3 workers, HOLD, separate approval, real loader-v3 execution and cleanup | Yes |
| `m8_orchestration_adversarial` | occupied port, validator crash/hang, timeout, malformed RPC/output, secret scan, ledger/process cleanup | One fresh ledger per process case |
| `m8_closeout_audit` | assertion inventory, source boundaries, dependency/lock hashes, changed paths, sanitized evidence | No |

Resource-heavy process cases run serially. The memory gate is checked before each validator/worker shard. The v2 and v3 demonstrations are separate so slot deadlines, settlement timing, loader state, and timeout budgets remain independently attributable.

Tests must use real behavior. Source-string, constant-only, mocked-RPC, constructed-account, or format-only checks may support parity but cannot claim transaction authorization, state transition, settlement, loader execution, validator ownership, or cleanup behavior.

---

## 20. Frozen assertions

Each assertion appears once and is assigned to exactly one checkpoint and one primary named test. Supporting tests may exercise the same code but must not double-count the assertion.

### Checkpoint 1 - SDK and IDL (assertions 1-12)

| # | Assertion | Primary test |
| ---: | --- | --- |
| 1 | Generated Gate and Treasury IDLs are reproducible from the pinned source/toolchain and their recorded hashes match packaged bytes. | `m8_c1_idl_generation_is_reproducible` |
| 2 | IDL instruction arguments, account order/flags, account discriminators, enums, and errors used by Milestone 8 match current program source exactly. | `m8_c1_idl_matches_program_surface` |
| 3 | SDK PDA derivations match every existing Gate PDA used by the canonical flows, including little-endian integer seeds. | `m8_c1_sdk_pda_parity` |
| 4 | SDK account decoders reject wrong owners, programs, discriminators, lengths, enum values, and trailing bytes. | `m8_c1_closed_account_decoding` |
| 5 | SDK reproduces the unchanged Milestone 5 result commitment and all authoritative golden vectors. | `m8_c1_replay_commitment_parity` |
| 6 | SDK validates unchanged Milestone 7 receipt, worker-output, and attestation-intent schemas without adding fields. | `m8_c1_replay_schema_parity` |
| 7 | Every direct-attestation instruction builder matches the generated IDL byte-for-byte. | `m8_c1_attestation_instruction_parity` |
| 8 | Economic, decision, and guarded-upgrade builders used by v2/v3 match existing instruction data and account metadata. | `m8_c1_economic_and_upgrade_builder_parity` |
| 9 | Building is separate from signing/submission and performs no implicit RPC or key discovery. | `m8_c1_builders_have_no_ambient_authority` |
| 10 | Transactions over 1,232 bytes and canonical transactions using address lookup tables fail before signing. | `m8_c1_transaction_size_is_bounded` |
| 11 | RPC helpers require explicit endpoint/genesis/commitment and reject wrong genesis or malformed responses. | `m8_c1_rpc_boundary_is_explicit` |
| 12 | SDK errors are closed, stable, bounded, and contain no secret-bearing values. | `m8_c1_sdk_errors_are_closed` |

### Checkpoint 2 - Operator identity and custody (assertions 13-25)

| # | Assertion | Primary test |
| ---: | --- | --- |
| 13 | One public key is consistently enforced as epoch member, stake identity, worker signer, and direct-attestation signer. | `m8_c2_identity_is_consistent_across_layers` |
| 14 | A keypair whose derived public key differs from the requested verifier is rejected before worker launch or transaction construction. | `m8_c2_wrong_keypair_is_rejected` |
| 15 | Swapping two otherwise valid operator keys or signed outputs is rejected as identity substitution. | `m8_c2_mismatched_operator_identity_is_rejected` |
| 16 | A production operator invocation loads at most one explicit keypair and the aggregation path accepts no private-key input. | `m8_c2_production_never_custodies_three_keys` |
| 17 | Key seed/content never appears in arguments, environment, stdout, stderr, errors, telemetry, or evidence. | `m8_c2_key_secret_is_not_disclosed` |
| 18 | Unsafe, tracked, non-regular, reparse-point, malformed, or public/private-mismatched keypair files fail closed. | `m8_c2_unsafe_key_files_are_rejected` |
| 19 | Mutable seed buffers are cleared best-effort and key objects are dropped after their last required signature. | `m8_c2_key_lifetime_is_bounded` |
| 20 | Real Milestone 7 worker-output signatures are verified before consensus or intent use. | `m8_c2_worker_signature_is_authenticated` |
| 21 | Altered payloads, signatures, identities, ordinals, or signing algorithms are rejected. | `m8_c2_altered_worker_output_is_rejected` |
| 22 | Replaying an output under another coordinator nonce, ordinal, job, or launch is rejected. | `m8_c2_nonce_and_launch_replay_is_rejected` |
| 23 | Exactly three distinct authenticated outputs with an identical frozen projection are required; no successful subset is selected. | `m8_c2_consensus_requires_exact_unanimous_three` |
| 24 | Any mixed classification, receipt, verdict, commitment, projection, or eligibility fails with no plan or intent. | `m8_c2_disagreement_emits_no_plan` |
| 25 | Demo keys are OS-CSPRNG-generated, confined to the owned run, excluded from sanitized evidence, and deleted on cleanup. | `m8_c2_demo_keys_are_ephemeral` |

### Checkpoint 3 - Direct attestation and epoch behavior (assertions 26-38)

| # | Assertion | Primary test |
| ---: | --- | --- |
| 26 | Canonical evidence uses one three-member immutable epoch with three distinct identities and threshold `3`. | `m8_c3_canonical_epoch_is_three_of_three` |
| 27 | Epoch admission and activation require existing SafetyPolicy governance; no alternate authority is accepted. | `m8_c3_only_governance_controls_epochs` |
| 28 | Active stake and the existing epoch-economic binding are required to open the canonical economic round. | `m8_c3_epoch_economics_and_stake_are_enforced` |
| 29 | Proposal, round, epoch, invariant, and trace substitution are rejected before signing and on chain. | `m8_c3_core_account_substitution_is_rejected` |
| 30 | Receipt, verdict, result commitment, invariant specification, or any exact raw `.so` / build manifest / Milestone 7 executable / loader-v3 payload slice / post-migration `candidate_buffer_hash` equality mismatch is rejected; full-account fallback is impossible. | `m8_c3_result_and_executable_bindings_are_exact` |
| 31 | One replay result is created only from the recomputed unchanged Milestone 5 commitment. | `m8_c3_replay_result_uses_frozen_commitment` |
| 32 | Exactly three corresponding direct attestations, each signed by its matching epoch identity, raise vote count from zero to three. | `m8_c3_three_direct_attestations_reach_quorum` |
| 33 | Duplicate attestation and equivocation by one verifier are rejected by the canonical attestation PDA. | `m8_c3_duplicate_and_equivocating_vote_is_rejected` |
| 34 | A non-member or wrong-key signer cannot submit an attestation. | `m8_c3_unauthorized_attestation_is_rejected` |
| 35 | Finalization before the third canonical attestation is rejected, and finalization succeeds only after all three exist. | `m8_c3_finalization_requires_all_three` |
| 36 | Worker signatures and coordinator nonces are absent from instruction data, PDA seeds, and stored accounts. | `m8_c3_worker_authentication_stays_off_chain` |
| 37 | A newly opened round uses the newly active epoch immediately, with no overlap or grace period. | `m8_c3_rotation_affects_new_rounds_immediately` |
| 38 | A round opened under an old epoch remains valid under that immutable epoch after rotation; omitted keys retain authority only for that historical round. | `m8_c3_historical_round_keeps_snapshotted_epoch` |

### Checkpoint 4 - v2 violation and economics (assertions 39-48)

| # | Assertion | Primary test |
| ---: | --- | --- |
| 39 | Three real production workers replay canonical v2 and unanimously authenticate the same VIOLATION projection. | `m8_c4_v2_real_workers_unanimously_violate` |
| 40 | The v2 receipt hash, result commitment, identities, and all three direct attestations match the opened round. | `m8_c4_v2_attestation_bindings_match` |
| 41 | v2 finalization permanently marks the verification gate and proposal as rejected with the existing automatic reason. | `m8_c4_v2_finalization_is_terminal_rejection` |
| 42 | Temporary approval and guarded execution are impossible after the v2 violation. | `m8_c4_v2_rejection_blocks_approval_and_execution` |
| 43 | Closing v2 round economics records the existing finalized-VIOLATION economic state and canonical winner. | `m8_c4_v2_round_economics_close` |
| 44 | Accepted-challenge settlement pays the configured bounty and returns the exact hunter bond only to canonical destinations. | `m8_c4_v2_bounty_and_bond_settle` |
| 45 | Each of the three matching verifier attestations can earn exactly one existing configured fee and no duplicate fee. | `m8_c4_v2_verifier_fees_are_exact` |
| 46 | v2 settlement changes no slashing rule and applies no disagreement, compromise, or subjective slash. | `m8_c4_v2_introduces_no_new_slash` |
| 47 | Counters, tombstones, vault balances/closures, refunds, and rent destinations match Milestone 6 after settlement. | `m8_c4_v2_economic_cleanup_is_exact` |
| 48 | The v2 shard cleans every owned worker, validator, handle, key file, ledger, IPC object, and run directory. | `m8_c4_v2_shard_cleans_all_owned_state` |

### Checkpoint 5 - v3 hold and guarded upgrade (assertions 49-57)

| # | Assertion | Primary test |
| ---: | --- | --- |
| 49 | Three real production workers replay canonical v3 and unanimously authenticate the same Preserved/HOLD projection. | `m8_c5_v3_real_workers_unanimously_hold` |
| 50 | Three matching direct attestations finalize HOLD and clear the pending round without approving the proposal. | `m8_c5_hold_is_non_approving` |
| 51 | Guarded execution is rejected after HOLD and before a separate governance decision. | `m8_c5_hold_cannot_execute` |
| 52 | Existing HOLD settlement applies the exact bond penalty/refund, pays no bounty, and introduces no new slash. | `m8_c5_hold_economics_are_unchanged` |
| 53 | Only existing governance can record a separate temporary approval after HOLD, and evidence labels it accurately. | `m8_c5_governance_approval_is_separate` |
| 54 | Guarded execution remains rejected through the inclusive challenge end slot. | `m8_c5_upgrade_waits_until_after_window` |
| 55 | After the window, the real Guard PDA performs the sole loader-v3 upgrade route only after revalidating the exact payload digest and the independent Buffer owner, metadata length, state, authority, lock, claim, and account identity. | `m8_c5_real_guarded_upgrade_executes` |
| 56 | The target ProgramData contains the v3 candidate and the proposal becomes Executed; no direct-loader bypass is accepted. | `m8_c5_v3_programdata_and_state_are_final` |
| 57 | The v3 shard cleans every owned worker, validator, handle, key file, ledger, IPC object, and run directory. | `m8_c5_v3_shard_cleans_all_owned_state` |

### Checkpoint 6 - Orchestration and closeout (assertions 58-68)

| # | Assertion | Primary test |
| ---: | --- | --- |
| 58 | The runner refuses occupied port 8899 without attaching to or terminating the occupying process. | `m8_c6_occupied_port_fails_without_attachment` |
| 59 | The runner controls only its recorded validator/workers and rejects PID, genesis, or process-ownership substitution. | `m8_c6_process_ownership_is_exact` |
| 60 | Validator readiness, RPC, confirmation, worker, stage, and cleanup deadlines are enforced with 15-second heartbeats. | `m8_c6_all_stages_are_bounded` |
| 61 | Validator crash, worker crash, timeout, malformed output/RPC, transaction failure, or cancellation fails closed without retry. | `m8_c6_process_and_rpc_failures_do_not_retry` |
| 62 | Success and every injected failure remove the owned ledger, key files, IPC state, handles, processes, and run directory. | `m8_c6_failure_cleanup_has_no_residue` |
| 63 | Reparse points, parent escapes, broad deletion targets, and unrelated historical directories are rejected or left untouched. | `m8_c6_cleanup_scope_is_confined` |
| 64 | Raw logs are bounded/ignored and the sanitized report contains no secret, username, absolute path, key-file name, temporary name, or raw private material. | `m8_c6_sanitized_evidence_leaks_nothing` |
| 65 | SDK/CLI source contains no hidden default key, three-key production custody, automatic retry, emergency revocation, verdict commit/reveal, or automatic HOLD approval path. | `m8_c6_production_source_boundary_audit` |
| 66 | Compatibility audit confines program/artifact drift to the authorized Gate payload-hash correction and its regenerated provenance; replay schemas, Milestone 7 golden vectors, fixtures, candidate artifacts/manifests, policies, program IDs, and lockfiles remain unchanged. | `m8_c6_compatibility_hash_audit` |
| 67 | The assertion ledger contains assertions 1-68 exactly once, each mapped to its behavior-executing primary test and checkpoint. | `m8_c6_assertion_ledger_is_complete` |
| 68 | The final clean rehearsal proves both canonical shards, all expected failure classes, zero automatic retries, no orphans/residue, and a clean reviewed tree. | `m8_c6_complete_closeout_rehearsal` |

---

## 21. Implementation checkpoints

### Checkpoint 1 - Public SDK and IDL

Implement `@faultline/idl`, `@faultline/sdk`, exact generated provenance, closed decoders, PDA/hash helpers, instruction/transaction builders, size checks, and unit/parity tests. Owns assertions 1-12.

### Checkpoint 2 - Operator CLI and custody adapter

Implement the one-key signer abstraction, production one-worker command, three-output aggregator, CLI result/error surface, redaction, and demo-key lifecycle. It may add only the narrow replay/coordinator integration needed for a caller-supplied single verifier identity; it must not alter worker schemas, replay semantics, signatures, consensus projection, or the production three-key prohibition. Owns assertions 13-25.

### Checkpoint 3 - Direct-attestation integration

Implement chain preflight, exact result/attestation/finalization transaction construction, postcondition reads, governance epoch commands, stake/epoch-economic integration, and fresh-ledger epoch/adversarial tests. Owns assertions 26-38.

Checkpoint 3 is explicitly authorized to implement the narrow Section 2.1 Gate correction before completing direct-attestation integration. That authority is limited to:

- adding a narrow helper in `programs/faultline_gate/src/lib.rs` that validates canonical loader-v3 Buffer owner, minimum metadata length, exact `UpgradeableLoaderState::Buffer` state, and the existing authority/lifecycle requirements, then returns only the exact executable payload slice;
- replacing full-account hashing with payload-only hashing at every relevant proposal creation, verification, and execution path, without changing the `candidate_buffer_hash` field, account layouts, instruction data, discriminators, PDA seeds, errors, or commitment preimages;
- adding Rust unit tests in `programs/faultline_gate/src/lib.rs` for header exclusion, exact payload hashing, truncation, extra trailing bytes, wrong loader state, wrong owner, insufficient metadata length, and authority/state failures;
- updating the TypeScript/local-validator parity coverage in `tests/proposal-state-machine.spec.ts`, `tests/verifier-quorum.spec.ts`, and, where the shared proposal helper requires it, `tests/treasury-versions.spec.ts`, using a genuinely staged loader-v3 Buffer;
- regenerating `artifacts/gate/faultline_gate.so` and only its affected entry/provenance in `artifacts/manifest.json` after the implementation begins; and
- regenerating or comparing the generated public IDL and SDK parity surfaces, with no IDL change expected unless authoritative Anchor generation proves otherwise. Any proven generated change must be limited to the affected provenance files under `packages/faultline-idl` and corresponding SDK parity evidence.

The mandatory positive regression proves that a real staged Buffer whose payload is byte-for-byte and length-for-length identical to the raw `.so` produces the build-manifest/Milestone 7/proposal equality and succeeds through creation and guarded execution. Mandatory negative regressions cover a mutated or truncated payload, extra trailing capacity or bytes, inclusion or mutation of header bytes without weakening independent header validation, short data, wrong owner, non-Buffer loader state, invalid authority/write lock/`BufferClaim`, and substitution of a different Buffer account. Tests must prove the legacy full-account digest is rejected rather than accepted as a fallback, and that a pre-migration active proposal fails closed.

No Milestone 7 receipt, worker-output, signature, result-commitment, attestation schema, or golden vector may be regenerated or changed. SDK/IDL verification is parity work, not authority for a protocol-surface change.

### Checkpoint 4 - v2 rejection and settlement

Implement the bounded fresh-ledger v2 shard, real three-worker execution, threshold-3 direct attestations, terminal rejection, accepted-challenge settlement, verifier fees, refunds, and cleanup evidence. Owns assertions 39-48.

### Checkpoint 5 - v3 HOLD and guarded execution

Implement the independent fresh-ledger v3 shard, HOLD non-approval proof, existing HOLD economics, explicitly separate temporary governance approval, real delayed loader-v3 upgrade, and cleanup evidence. Owns assertions 49-57.

### Checkpoint 6 - Adversarial orchestration and closeout

Implement the owned-validator runner, independently bounded failure shards, assertion/evidence ledger, source/dependency/compatibility audits, and final clean rehearsal. Owns assertions 58-68. It must not begin Milestone 9.

No checkpoint may claim an assertion assigned to another checkpoint as part of its unique count. Focused execution totals and complete-suite totals are reported separately; overlapping executions are not summed as unique tests.

---

## 22. Closeout evidence and audit

The final Milestone 8 closeout must preserve a sanitized report containing:

- baseline and final commit hashes;
- exact changed files;
- SDK and IDL package versions, source commit, generator version, and IDL hashes;
- root and replay lockfile hashes and dependency summaries;
- unique test inventory, focused shard counts, complete-suite counts, and exact assertion 1-68 mapping;
- canonical v2/v3 public verifier identities or their explicit public evidence references, verifier-set hash, threshold, worker classifications, receipt hashes, result commitments, attestation transaction signatures, vote counts, and finalization signatures;
- v2 rejection, automatic reason, bounty/bond/fee amounts, balances, counters, vault/tombstone outcomes, and blocked approval/execution evidence;
- v3 HOLD state, failed pre-approval execution, separate governance approval signature/reason, failed early execution, guarded upgrade signature, and final ProgramData/proposal state;
- stale-epoch/historical-round, wrong-key, duplicate, unauthorized, replay, substitution, disagreement, timeout, process, RPC, transaction, and cleanup classifications;
- launch/retry counts showing zero automatic retries;
- stage elapsed times, bounded resource evidence, validator ownership, genesis hashes, and cleanup durations with machine-specific PIDs/paths removed;
- final port, orphan-process, handle, key-file, IPC, ledger, and run-directory checks;
- secret/redaction scan result;
- source-boundary audit proving no forbidden production behavior;
- compatibility audit proving unchanged programs, replay schemas, vectors, artifacts, fixtures, manifests, policies, IDs, and protocol bytes; and
- clean-tree and no-Milestone-9 confirmation.

The authoritative runner fails fast at the first real failure, preserves that shard's raw ignored diagnostics, performs cleanup, and does not rerun the unchanged failed shard. Closeout succeeds only when all 68 assertions appear exactly once and all required fresh-ledger shards passed.

---

## 23. Deferred work

### Milestone 9

- finalized/confirmed indexer reconciliation;
- derived read API;
- content-addressed public artifact and evidence availability;
- verified-build metadata integration; and
- service availability without service authorization power.

### Milestone 10

- wallet/RPC-backed frontend integration;
- real protocol/operator/researcher UI actions;
- on-chain-authoritative presentation; and
- accurate temporary-approval, commitment, and trust language.

### Milestone 11

- ten clean complete rehearsals;
- property/state-machine testing and benchmarks;
- LiteSVM/local-validator divergence analysis;
- stronger filesystem/network sandbox evaluation;
- heterogeneous runner planning;
- hardware wallets, HSMs, remote/agent signers, role separation, and operational custody runbooks;
- incident response, key-compromise procedures, and audit preparation; and
- any proposed migration for emergency historical-round revocation or distinct operator/vote-authority identities.

Permissionless admission, assignment/reassignment, verdict commit/reveal, subjective slashing, dispute resolution, open operator selection, and production Byzantine-security claims require later explicit specifications and on-chain migrations.

---

## 24. Known limitations

- All canonical workers use the same LiteSVM `0.1.0`, Solana `1.18.22`, and `solana_rbpf 0.8.3` implementation; three-worker agreement does not protect against a common-mode runtime defect.
- Initial production custody uses a filesystem-backed Solana keypair through a narrow signer abstraction. This is not hardware-backed or mainnet-ready custody.
- One public key combines epoch membership, stake identity, worker signing, transaction signing, and conceptual vote authority. Role separation requires migration.
- Governance controls membership, threshold, activation, and temporary approval after HOLD.
- There is no emergency revocation of an already-open historical round. A removed or compromised key retains authority in the old snapshotted epoch until that round terminates or expires.
- Epoch activation has no overlap or grace mechanism.
- HOLD is non-approving, but the MVP retains a separate temporary governance approval path.
- A compromised configured threshold can attest to a false result; the program does not prove honest replay.
- Objective assigned non-reveal is the only verifier slash added by Milestone 6. Disagreement, compromise, and alleged false results are not slashable here.
- Windows Job Objects enforce Milestone 7 process/resource constraints but do not provide OS-enforced filesystem or network isolation.
- Worker filesystem/network restrictions still rely on audited code and SBF inability to call host APIs directly.
- The local demo temporarily controls three demo keys and therefore does not demonstrate production operator independence.
- The protocol remains Tokenkeg-only, uses partial on-chain artifact binding, and has no emergency path.
- Milestone 8 is a local reproducible MVP demonstration. It makes no production Byzantine-security, arbitrary-program safety, permissionless-decentralization, or mainnet-custody claim.
