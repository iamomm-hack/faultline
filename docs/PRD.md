# Faultline — Product Requirements Document

**Product:** Faultline
**Category:** Deployment security control plane for upgradeable Solana programs
**Document status:** Locked build specification
**Version:** 1.0
**Date:** 2026-09-12
**Initial target:** Colosseum Crypto World's Fair 2026

> **Implementation status notice:** This document describes the intended product and is not a claim that every feature is implemented. At checkpoint `d42ef0b`, the Milestone 1-6 documents are authoritative for implemented behavior. Known current deviations include direct verifier attestations instead of verdict commit/reveal, HOLD being non-approving, temporary governance approval, partial on-chain artifact binding, Tokenkeg-only support, and no emergency path.

---

## 1. Executive summary

Faultline is an optimistic deployment gate for upgradeable Solana programs.

A protocol proposing an upgrade publishes a pinned program build, a bounded set of executable safety invariants, a challenge deadline, and a funded bounty. During that window, researchers and automated fuzzers can submit bonded, reproducible counterexamples. Independent replay workers execute a revealed trace against the same pinned build and state fixture. If the required quorum reproduces an invariant violation, Faultline rejects the proposal, prevents that upgrade from shipping through the guarded path, and pays the hunter. If no valid challenge is accepted before the deadline, the guarded upgrade becomes executable.

The core primitive is:

> **Executable safety invariant → bonded challenge → reproducible counterexample → enforced deployment decision.**

Faultline does not claim that an upgrade is secure. It enforces only the specific properties a protocol declared. “Passed” means no accepted counterexample violated those properties during that proposal's challenge process; it does not mean no other vulnerability exists.

### One-line pitch

> **Faultline turns executable safety invariants into enforceable deployment conditions.**

### Public positioning

> Every critical upgrade makes safety claims. Faultline makes those claims attackable before the code reaches production.

---

## 2. Decision and product thesis

Faultline is the project to build. The decision is conditional on one adoption assumption: serious protocols must be willing to place a policy-controlled program in their normal upgrade path. The product therefore supports a governed, auditable emergency path rather than pretending operational emergencies do not exist.

The product is not:

- an AI auditor;
- a replacement for audits, formal verification, verified builds, multisigs, or bug bounties;
- a generic crowdsourced security marketplace;
- an English-language policy evaluator;
- a token or speculative security-score protocol;
- proof that a program has no vulnerabilities.

The product is:

- a pre-deployment enforcement layer;
- a machine-checkable policy format for critical financial invariants;
- a market for concrete counterexamples, not opinions;
- a bridge between verified program artifacts, adversarial testing, governance, and the actual upgrade authority;
- an auditable record of what was claimed, tested, challenged, bypassed, and deployed.

---

## 3. Problem

Upgradeable onchain programs combine three risks:

1. Release velocity is rising as AI-assisted development produces more code and more frequent upgrades.
2. Capital at risk is rising as protocols become financial infrastructure.
3. Human security review does not scale proportionally with either.

Existing controls solve separate parts of the pipeline:

| Control | What it answers | What it does not answer |
| --- | --- | --- |
| Unit/integration tests | Does known behavior pass developer-written cases? | Can an outsider find a violating transaction sequence? |
| Audit | Did selected reviewers find issues within scope and time? | Does a discovered counterexample automatically stop deployment? |
| Verified build | Does the built/deployed binary match claimed source? | Is the behavior safe? |
| Multisig/governance | Who can approve an upgrade? | What safety properties must the upgrade satisfy? |
| Bug bounty | Will researchers be paid for valid findings? | Is the bounty coupled to the pre-deployment permission? |
| Monitoring/firewalls | Is suspicious activity detected at runtime? | Should this upgrade have shipped at all? |

The missing coordination point is the deployment boundary. Today, a protocol can receive a warning and still deploy. Faultline makes a confirmed violation of a declared invariant block the normal upgrade path.

---

## 4. Why Solana is structurally necessary

Faultline is not using Solana as a timestamp database. The guarded program's upgrade authority is itself controlled by a Faultline program-derived address (PDA). The chain therefore enforces the decision.

Solana's model supports the required primitives:

- loader-v3 programs can be upgraded while an upgrade authority exists; revoking that authority makes the program immutable;
- a PDA can represent governed authority and sign a cross-program invocation using program seeds;
- program buffers, proposal state, bonds, bounties, votes, and settlement can be tied together onchain;
- low-cost transactions make challenge, commitment, verdict, and payout events economical;
- Solana Verified Builds can bind source and build metadata to an executable hash, while Faultline adds behavioral claims.

The important distinction is:

> Verified Builds establish **source-to-binary correspondence**. Faultline establishes **a challengeable record and enforcement path for declared behavior**.

If the protocol team can silently press “deploy anyway,” the product collapses into ordinary CI. Any bypass must therefore be explicitly authorized, delayed where feasible, and permanently visible onchain.

---

## 5. Target users and jobs to be done

### 5.1 Protocol engineering lead

**Job:** Ship an upgrade without relying only on internal tests and a closed review process.

Needs:

- bind a proposal to a reproducible build and exact buffer;
- select or write relevant invariants;
- fund a meaningful bounty;
- track challenges without learning private exploit details prematurely;
- deploy only after the gate resolves;
- retain an emergency route for severe live incidents.

### 5.2 Protocol governance or multisig signer

**Job:** Know exactly what is being authorized and what safety conditions were applied.

Needs:

- human-readable proposal summary;
- source commit, executable hash, buffer address, policy hash, deadlines, and bounty amount;
- challenge and verifier history;
- explicit risk acknowledgement for an emergency bypass.

### 5.3 Security researcher / hunter

**Job:** Test an unreleased upgrade, prove a concrete violation, protect the exploit until verification, and receive deterministic payment.

Needs:

- access to build, IDL, fixture, invariant definitions, and allowed tooling;
- clear submission format and severity-independent acceptance rule;
- commit/reveal protection;
- bounded verification time;
- automatic bond return and bounty payment on acceptance;
- clear rejection and dispute evidence.

### 5.4 Replay worker / verifier operator

**Job:** Reproduce assigned evidence consistently and earn fees without gaining unilateral control.

Needs:

- pinned runner image and execution manifest;
- encrypted evidence delivery;
- commit/reveal verdict flow;
- stake and slashing rules;
- reproducibility diagnostics;
- protection against being selected for evidence they cannot execute.

### 5.5 Auditor / security firm

**Job:** Turn expertise into reusable invariant packs and private pre-deployment challenges.

Needs:

- versioned policy packs;
- attribution and licensing;
- private contest mode;
- exportable regression fixtures;
- integration with existing audit delivery.

---

## 6. Product principles

1. **Deterministic trust path.** AI may search for attacks, prioritize fuzzing, or explain results. AI never decides PASS/FAIL.
2. **Claims, not certificates.** Every status names the exact policy, build, fixture, window, and verifier basis.
3. **Fail closed on ambiguity.** A mismatched build hash, expired reveal, incomplete evidence package, or divergent replay environment cannot silently authorize deployment.
4. **Bounded liveness.** A challenge cannot freeze an upgrade indefinitely merely by existing.
5. **Minimal authority.** Faultline controls only the guarded upgrade operation and bounty settlement required for the product.
6. **No hidden bypass.** Emergency execution is possible only through an explicit configured authority and leaves an unmistakable record.
7. **Artifacts over assertions.** A valid finding is a replayable trace plus state-delta proof, not a prose report.
8. **Progressive decentralization.** The hackathon verifier set is permissioned and honestly labeled. Production decentralization is a roadmap, not demo theater.

---

## 7. V1 scope

### 7.1 Supported target

- One Anchor-based, loader-v3 upgradeable Solana financial program.
- One intentionally vulnerable treasury example with v1, vulnerable v2, and patched v3.
- One target program per Faultline policy in the MVP.
- Devnet/local-validator execution.
- Mock devnet USDC (`fUSDC`) for deterministic demos; production design remains compatible with SPL Token/Token-2022 payment mints selected by policy.

### 7.2 Supported invariant classes

V1 ships a typed, finite policy schema. It does not interpret arbitrary text.

1. **Authorization**
   - Example: a non-admin signer cannot cause a treasury outflow.
2. **Asset conservation**
   - Example: tracked assets after execution must not be lower than expected after authorized withdrawals and fees.
3. **Solvency**
   - Example: liabilities must remain below policy-defined collateral value.
4. **Migration preservation**
   - Example: user balances in a canonical fixture must be preserved across a state migration.
5. **Privilege boundary**
   - Example: an upgrade must not make a privileged instruction reachable by an unauthorized signer.

The hackathon demo implements authorization completely. The other four classes appear in the schema and documentation but are not claimed as production-complete unless their evaluators and tests exist.

### 7.3 Core lifecycle

1. Protocol creates a policy and configures guard/emergency authorities.
2. Protocol produces a verifiable build and writes the candidate program to a buffer.
3. Protocol creates a proposal bound to hashes of the source commit, executable, buffer bytes, policy bundle, runner manifest, and fixture manifest.
4. Protocol funds the bounty and opens a challenge window.
5. Hunter commits `H(proposal || evidence_hash || salt)` and posts a bond.
6. Hunter reveals an encrypted evidence manifest before the reveal deadline.
7. Selected workers independently execute the exact trace and commit verdict hashes.
8. Workers reveal verdicts and result commitments.
9. The onchain program checks quorum and deadlines, then resolves the proposal.
10. Accepted counterexample: proposal becomes `Rejected`, hunter is paid, and guarded execution is impossible.
11. No accepted counterexample: proposal becomes `Approved`, subject to challenge-window completion.
12. Any caller may trigger the approved upgrade; the Guard PDA authorizes the loader operation.

### 7.4 Product surfaces

- Protocol dashboard: create policy, create/fund proposal, monitor, resolve, execute.
- Researcher console: download artifacts, commit, reveal, monitor verdict, claim result.
- Verifier daemon: register, accept assignment, fetch/decrypt evidence, replay, commit/reveal verdict.
- Public proposal page: exact claims and lifecycle history.
- CLI/SDK: CI-oriented equivalent of every critical UI action.
- Indexer/API: derived views only; onchain state remains authoritative.

---

## 8. Functional requirements

Priority codes: **P0** required for the hackathon submission, **P1** required for credible beta, **P2** later.

### 8.1 Policy and integration

| ID | Priority | Requirement | Acceptance condition |
| --- | --- | --- | --- |
| FR-001 | P0 | Create a policy for one target program and governance authority. | Policy PDA stores immutable target, mint, limits, quorum, and emergency configuration. |
| FR-002 | P0 | Register one executable authorization invariant. | Policy bundle has a canonical hash and evaluator version. |
| FR-003 | P0 | Transfer/configure target upgrade authority to the Guard PDA. | Onchain authority query returns the expected PDA before a proposal can open. |
| FR-004 | P1 | Version policies without mutating active proposals. | New policy version creates a new immutable policy record. |
| FR-005 | P1 | Publish reusable policy-pack metadata. | Pack identifier, author, version, license, evaluator hashes, and documentation resolve publicly. |

### 8.2 Proposal and artifact binding

| ID | Priority | Requirement | Acceptance condition |
| --- | --- | --- | --- |
| FR-010 | P0 | Create a proposal bound to a candidate buffer and artifact hashes. | Altering any pinned artifact produces a different proposal commitment. |
| FR-011 | P0 | Require a funded bounty before opening. | `open_challenge` fails if escrow balance is below configured bounty plus fees. |
| FR-012 | P0 | Enforce ordered deadlines. | Commit, reveal, verdict, and execution actions fail outside valid phases. |
| FR-013 | P0 | Refuse a candidate whose buffer authority/hash does not match. | Proposal cannot open and emits a typed error. |
| FR-014 | P1 | Require verified-build evidence. | Configurable verification adapter records verification status and evidence hash. |

### 8.3 Challenges

| ID | Priority | Requirement | Acceptance condition |
| --- | --- | --- | --- |
| FR-020 | P0 | Accept bonded challenge commitments without exposing traces. | Commitment and bond are recorded; raw evidence is absent onchain. |
| FR-021 | P0 | Reveal a challenge against its commitment. | Incorrect salt, proposal, evidence hash, or late reveal is rejected. |
| FR-022 | P0 | Prevent duplicate reward claims for identical evidence. | Canonical evidence hash can settle once per proposal. |
| FR-023 | P0 | Return bond for a valid accepted challenge. | Hunter receives bounty plus refundable bond after resolution. |
| FR-024 | P0 | Forfeit defined bond portion for invalid/non-revealed challenges. | Settlement follows policy and is visible onchain. |
| FR-025 | P1 | Support encrypted evidence delivery to assigned workers. | Only assigned worker keys can decrypt before disclosure. |

### 8.4 Reproduction and verdict

| ID | Priority | Requirement | Acceptance condition |
| --- | --- | --- | --- |
| FR-030 | P0 | Register three allowlisted MVP verifiers with stake. | Worker records are active and adequately funded. |
| FR-031 | P0 | Assign a fixed verifier set to a revealed challenge. | Assignment is deterministic/auditable and cannot be changed after creation. |
| FR-032 | P0 | Commit and reveal verifier verdicts. | A revealed vote must match its prior commitment. |
| FR-033 | P0 | Resolve accepted violation at 2-of-3 reproduced verdicts. | Proposal transitions irreversibly to `Rejected`. |
| FR-034 | P0 | Record a result commitment and normalized failure code. | Public state identifies invariant and result without leaking sensitive raw evidence. |
| FR-035 | P1 | Detect abstention/timeouts and apply configured penalties. | Resolution remains live after the verifier deadline. |
| FR-036 | P2 | Require heterogeneous runner classes. | Quorum policy can demand agreement across at least two execution implementations. |

### 8.5 Deployment enforcement

| ID | Priority | Requirement | Acceptance condition |
| --- | --- | --- | --- |
| FR-040 | P0 | Reject execution before challenge window completion. | Loader CPI is unreachable from non-approved states. |
| FR-041 | P0 | Reject execution for any rejected/cancelled/expired proposal. | State transition and account constraints prevent reuse. |
| FR-042 | P0 | Execute approved candidate using Guard PDA authority. | Target program hash/version changes to the approved candidate. |
| FR-043 | P0 | Ensure executed bytes correspond to the proposal buffer. | Buffer identity/hash is revalidated at execution. |
| FR-044 | P1 | Provide an emergency bypass. | Requires configured emergency authority/threshold, cooldown rules, reason hash, and emits `EmergencyBypassExecuted`. |
| FR-045 | P1 | Publicly distinguish challenged, unchallenged, and bypassed deployments. | API/UI never labels bypassed execution as passed. |

### 8.6 Dashboard and developer experience

| ID | Priority | Requirement | Acceptance condition |
| --- | --- | --- | --- |
| FR-050 | P0 | Show proposal state and countdown from chain time. | Refresh/reconnect does not invent local state. |
| FR-051 | P0 | Show policy, bounty, artifact commitments, challenges, verifier status, and settlement. | Every displayed critical field links to its transaction/account. |
| FR-052 | P0 | Provide typed transaction errors and remediation. | User sees why an action failed without inspecting raw logs. |
| FR-053 | P0 | Provide a one-command local demo reset. | Fresh demo reaches known v1 state reproducibly. |
| FR-054 | P1 | GitHub/CI command can create proposal metadata from a tagged commit. | CLI emits canonical manifest and verifies hashes before signing. |

---

## 9. Non-functional requirements

### Security

- No private key is stored by the web application.
- Guard authority signing occurs only inside the onchain program and only for the exact approved proposal.
- Proposal-critical fields are immutable after challenge opening.
- Monetary arithmetic uses checked integer operations and mint decimals, never floating point.
- Every token transfer uses explicit mint, vault, authority, and destination constraints.
- Evidence URLs are never accepted as the integrity boundary; content hashes are.
- Replay images, toolchains, programs, fixture accounts, clock, and oracle snapshots are pinned.
- The MVP must pass static analysis, unit tests, program-test/LiteSVM tests, and adversarial state-transition tests.

### Reliability and liveness

- A verifier outage cannot freeze a proposal forever; deadlines lead to reassignment, expiry, or conservative rejection according to policy.
- UI and indexer outages cannot change or bypass onchain state.
- Demo setup is fully scripted and can be reset in under five minutes.
- Critical state changes require confirmed transactions and idempotent indexer handling.

### Performance targets

- Dashboard reflects confirmed events within five seconds on devnet under normal RPC conditions.
- Local replay of the demo trace completes in under ten seconds per worker.
- Proposal creation uses a bounded number of transactions and does not store program binaries or raw traces onchain.

### Transparency

- UI always displays: target program, proposal, artifact hash, policy version, challenge window, quorum basis, and final path.
- Copy uses “No accepted counterexample” rather than “Secure.”
- Emergency bypass is visually distinct and cannot be hidden by the protocol operator.

---

## 10. State and status language

Canonical proposal states:

```text
Draft → Funded → Challenging → Verifying → Approved → Executed
                         └──────────────→ Rejected
Draft/Funded/Challenging ──────────────→ Cancelled
Approved ──────────────────────────────→ Expired
Any eligible state ── governed route ─→ EmergencyBypassed
```

User-visible labels must preserve epistemic honesty:

| Internal result | Allowed UI language | Forbidden language |
| --- | --- | --- |
| Challenge window open | “Open for counterexamples” | “Under audit” |
| Window ended, no accepted challenge | “No accepted counterexample” | “Secure” / “Bug-free” |
| Quorum reproduced | “Declared invariant violated” | “Program fully compromised” unless demonstrated |
| Approved | “Eligible for guarded execution” | “Safe to deploy” |
| Emergency bypass | “Deployed without completed Faultline gate” | “Passed with exception” |

---

## 11. Economic design for V1

No native token is created.

### Bounty

- Funded by the protocol in an approved SPL token.
- Locked before the challenge opens.
- Paid to the first canonical accepted counterexample under the MVP's single-winner policy.
- Future versions may split rewards among independent discoveries or invariant-pack authors.

### Challenger bond

- Large enough to make spam non-free, small enough not to exclude researchers.
- Returned on accepted challenges.
- Partially or fully forfeited on non-reveal or deterministically invalid evidence.
- A rejected challenge must not pay verifiers from the protocol bounty; verifier fees use a separate proposal fee reserve.

### Verifier stake and fee

- MVP workers are allowlisted and stake `fUSDC` or SOL.
- Matching the final deterministic result earns a fixed fee.
- Non-reveal and provable malformed results are slashable.
- Minority disagreement is not automatically malicious and should not be fully slashed; implementation diversity can produce legitimate divergence.

Economic parameters are configurable per policy but bounded by protocol-level safety limits.

---

## 12. MVP demo specification

### Example protocol

`faultline_treasury` has:

- v1: correct admin-only withdrawal;
- v2: migration/authority validation bug that lets a non-admin reduce treasury reserves;
- v3: patched validation and a regression test for the v2 trace.

### Demo invariant

```text
AUTH-001:
For every transaction sequence in the accepted trace grammar,
if the effective signer is not the configured admin,
then tracked treasury token balance after execution
must be greater than or equal to its balance before execution.
```

### Three-minute demo

1. Show safe v1 and its current program data hash.
2. Propose v2 with a 100 `fUSDC` bounty and a 60–90 second demo window.
3. Show the exact invariant and pinned artifact set.
4. Hunter commits then reveals the exploit package.
5. Three independent worker processes replay; at least two reproduce.
6. UI shows `DECLARED INVARIANT VIOLATED` and `UPGRADE REJECTED`.
7. Hunter receives bounty; direct `execute_upgrade` fails onchain.
8. Propose v3; the same trace no longer reproduces.
9. Window closes with no accepted counterexample.
10. Guard executes v3; show the target program hash changed to the approved hash.

The demo must include real transactions, real state transitions, and real token movement. A dashboard animation pretending to do those things is disqualifying.

---

## 13. Success metrics

### Hackathon success

- 100% reliable end-to-end demo across ten clean resets.
- Vulnerable v2 is blocked at the loader-authority level, not merely in the UI.
- Patched v3 is executed through the same guard.
- Bounty settlement is visible onchain.
- Another developer can reproduce the demo from the README.
- At least five protocol/security interviews, including two people who control or advise an upgradeable program.

### Beta metrics

- Number of real upgrade proposals gated.
- Total value protected is tracked cautiously as protocol-reported context, not claimed savings.
- Percentage of proposals with independently authored invariants.
- Median proposal setup time.
- Challenge false-positive and irreproducibility rates.
- Verifier agreement and timeout rates.
- Number of accepted counterexamples converted into regression fixtures.
- Number of emergency bypasses and stated reasons.
- Protocol retention across successive upgrades.

### North-star metric

> **Number of high-value program upgrades executed through Faultline with a complete, reproducible policy record.**

Bounty volume alone is a bad north-star metric because a secure proposal may correctly produce no payout.

---

## 14. Rollout plan

### Phase 0 — Hackathon proof (4 weeks)

- One program, one invariant, one vulnerability, one patched upgrade.
- Permissioned three-worker verifier set.
- Local/devnet.
- Public dashboard, CLI, and open repository.

### Phase 1 — Advisory pilot

- Run Faultline in shadow mode beside a protocol's existing process.
- No production authority at first.
- Compare results with audits and existing test suites.
- Convert historical exploits into invariant/regression packs.

### Phase 2 — Governed normal path

- Guard controls normal upgrades.
- Existing governance retains a delayed, explicit emergency bypass.
- Private pre-release evidence and selected verifier pools.
- Squads/Realms transaction-generation integrations.

### Phase 3 — Security policy platform

- Versioned DSL and audited evaluator library.
- Lending, AMM, vault, stablecoin, bridge, and governance packs.
- Audit firms author and maintain packs.
- Heterogeneous runner attestations.

### Phase 4 — Open challenge network

- Permissionless hunter participation.
- Verifier reputation/stake with robust dispute rules.
- Private and public challenge markets.
- Cross-protocol counterexample and migration corpus.

---

## 15. Business model

Faultline cannot survive on a percentage of rare bug bounties. The primary business must be recurring infrastructure revenue.

1. **Enterprise control plane subscription:** policy management, private environments, governance integration, compliance exports, and support.
2. **Challenge operations fee:** fixed or percentage fee for managing funded challenge windows.
3. **Verifier infrastructure:** hosted deterministic runners and private verifier pools.
4. **Policy-pack marketplace:** revenue share with audit firms and specialist authors.
5. **Implementation services:** initially useful for onboarding, but should not become the core business.

Initial customers are upgradeable DeFi protocols, bridges, stablecoin systems, treasuries, and infrastructure programs with meaningful capital at risk.

Audit firms are potential distribution partners and suppliers. Treating them as enemies would be strategically stupid: they already own trust and protocol relationships.

---

## 16. Defensibility

The Anchor program is not the moat. A competent team can copy it.

Compounding assets are:

- executable invariant corpus by protocol class;
- normalized exploit traces and regression fixtures;
- evaluator and runner correctness history;
- protocol, audit-firm, multisig, and governance integrations;
- verifier reliability and implementation-diversity graph;
- researcher network and private challenge liquidity;
- historical evidence about which upgrade patterns repeatedly fail.

The strongest long-term position is becoming the policy and evidence standard every high-value upgrade passes through.

---

## 17. Critical risks and mitigations

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Weak/incomplete invariants | A pass can create false confidence while missing catastrophic bug classes. | Typed scopes, explicit coverage, forbidden “secure” language, auditor-authored packs, coverage review. |
| Protocols refuse authority delegation | Without enforcement, Faultline becomes a CI feature. | Shadow-mode adoption, guarded normal path, delayed public emergency bypass, governance integrations. |
| Faultline bug bricks upgrades | The product sits in a critical authority path. | Minimal program, formal review, immutable stable core where possible, timelocked recovery, capped beta scope. |
| Replay is not truly deterministic | CPI, clock, oracle, or state mismatches can produce false verdicts. | Canonical execution manifest, pinned state roots, normalized trace grammar, explicit unsupported dependencies. |
| Verifier collusion | False accept/reject can move money and block releases. | Commit/reveal, stake, random assignment, diverse operators, future heterogeneous runners/disputes. |
| Exploit leakage/front-running | Vulnerable code may be exploitable before patching. | Pre-deployment candidate, encrypted evidence, private windows, limited disclosure, patch-first publication. |
| Griefing during emergency | Attackers may delay a critical fix. | Bounded deadlines, bond, rapid emergency policy, visible governed bypass. |
| Incumbent copies mechanism | Auditors and bounty platforms own distribution. | Partner early; own policy standard, integrations, corpus, and execution reliability. |
| Regulatory/payment issues | Bounties may create tax/KYC/sanctions obligations. | Configurable access controls and compliance at the business layer; no protocol token. |

### Kill conditions

Stop or materially pivot if either is true after structured interviews and pilots:

1. credible protocols will not allow any enforceable guarded upgrade path even with an emergency mechanism; or
2. representative historical Solana exploits cannot be encoded as practical deterministic invariants and counterexample traces.

Do not rationalize around these. They attack the product's two essential claims: enforceability and useful expressiveness.

---

## 18. Four-week execution plan

### Week 1 — Authority before UI

- Build vulnerable treasury v1/v2/v3.
- Implement Guard PDA and real loader upgrade flow.
- Define canonical manifests and authorization invariant.
- Prove direct unauthorized upgrade is impossible once guarded.

**Exit criterion:** locally execute v1 → guarded v3 upgrade without challenge machinery.

### Week 2 — Counterexample path

- Implement challenge commit/reveal and bonds.
- Define trace/evidence format.
- Build three replay worker processes.
- Commit/reveal verdict and deterministic resolution.

**Exit criterion:** v2 counterexample produces an irreversible onchain rejection.

### Week 3 — Economics and product surface

- Bounty vault and settlement.
- Verifier registration/stake/fees.
- CLI/SDK and indexer.
- Minimal operator/researcher dashboard.
- Verified-build metadata integration.

**Exit criterion:** complete demo flow works without manual account edits.

### Week 4 — Reliability and proof

- Ten clean demo rehearsals.
- Threat-model tests and state-machine fuzzing.
- Add v3 regression and artifact verification.
- Benchmark runner and transaction timings.
- Write pitch, README, architecture, limitations, and demo video.
- Conduct protocol/security interviews.

**Exit criterion:** a stranger can clone, reset, and reproduce the full story.

---

## 19. Explicit non-goals for the hackathon

- Permissionless production-grade verifier decentralization.
- Formal proof of arbitrary Rust/Anchor programs.
- Natural-language-to-invariant generation in the trust path.
- Mainnet integration with a third-party production protocol.
- Cross-chain support.
- A generalized dispute court.
- Severity arbitration for prose reports.
- A native token, DAO, or emissions scheme.
- Full private computation or zero-knowledge replay.
- Automated vulnerability disclosure to the public before the protocol patches.
- Supporting every oracle, CPI dependency, sysvar, or runtime version.

---

## 20. Launch checklist

- [ ] Target program upgrade authority resolves to Guard PDA.
- [ ] Guard cannot execute unapproved/rejected/expired buffers.
- [ ] Proposal binds all artifacts and policy versions.
- [ ] Challenge/reveal/verdict deadlines are enforced by chain time.
- [ ] Evidence commitment and verdict commitment domains are separated.
- [ ] Bounty and bond settlement invariants pass.
- [ ] v2 is reproducibly rejected by at least 2-of-3 workers.
- [ ] v3 is executable only after its own window.
- [ ] Emergency path is disabled for the public demo or visibly labeled and tested.
- [ ] UI contains no “secure,” “bug-free,” or “audit passed” claim.
- [ ] Ten clean demo resets succeed.
- [ ] README identifies centralized MVP assumptions.
- [ ] All source, IDLs, build manifests, program IDs, and demo transactions are public.

---

## 21. Reference baseline

- [Solana program model and upgrade authority](https://solana.com/docs/core/programs)
- [Solana Verified Builds](https://solana.com/docs/programs/verified-builds)
- [SPL Governance](https://github.com/solana-program/governance)
- [LiteSVM](https://github.com/LiteSVM/litesvm)
- [Anchor](https://www.anchor-lang.com/)

These references establish feasibility and adjacent tooling, not a claim that Faultline itself is already production-safe.
