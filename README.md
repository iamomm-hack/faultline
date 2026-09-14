# Faultline

Faultline is an optimistic deployment gate for upgradeable Solana programs. This repository contains a polished, deterministic Vite + React frontend prototype of the complete vulnerable-v2 rejection and patched-v3 guarded-execution story.

## Milestone 1: real Guard authority proof

The repository now also contains a real localnet feasibility proof that a Faultline PDA can be the recorded loader-v3 upgrade authority and authorize an approved upgrade through the gate program. See [docs/MILESTONE_1_GUARD.md](docs/MILESTONE_1_GUARD.md) for the loader contract, buffer-locking mechanism, adversarial cases, evidence, and limitations.

```powershell
npm.cmd install
npm.cmd run demo:guard
```

The command builds isolated treasury v1/v2 SBF artifacts, starts a clean validator, deploys v1, transfers ProgramData and buffer authority to the Guard PDA, proves unauthorized/pending/rejected paths fail, performs the guarded loader upgrade, verifies v2 behavior under the same program ID, and proves repeat execution fails.

The prototype is intentionally honest: it demonstrates protocol behavior locally and does not submit transactions, sign with a wallet, run Solana RPC, execute LiteSVM, or move real tokens.

## Run locally

Requirements: Node.js 22.13 or newer and npm.

```bash
cd frontend
npm install
npm run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`). Demo progress is persisted in browser local storage.

## Verify

```bash
cd frontend
npm run typecheck
npm run lint
npm test
npm run build
```

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Protocol overview, active gate, balances, and recent activity |
| `/proposals/new` | Prefilled v2 proposal review and creation flow |
| `/proposals/[proposalId]` | Operational proposal, artifacts, invariant, replay, settlement, and guarded action |
| `/researcher/[proposalId]` | Commit/reveal researcher console using the prepared bounded trace |
| `/demo` | 20-step guided control room with autoplay and reset |

Canonical proposal IDs are `proposal-v2` and `proposal-v3` after their creation steps.

## Architecture

All product UI consumes the `FaultlineClient` interface from `frontend/faultline/client.ts`. `MockFaultlineClient` owns asynchronous delays, persistence, typed error injection, and the deterministic transition engine. React components receive it through `FaultlineProvider`; no page imports fixture objects as application state.

The pure transition logic lives in `frontend/faultline/state-machine.ts`, while explicit shared domain models live in `frontend/faultline/types.ts`. Token amounts use integer base-unit strings plus mint decimals and never floating-point arithmetic.

To integrate Solana later, implement `SolanaFaultlineClient implements FaultlineClient` and swap the provider construction. Page components do not need to change. State-changing methods should build/decode instructions, request wallet signatures, submit through RPC, and then refresh authoritative accounts.

## Prototype simulation boundary

Simulated actions include proposal creation and funding, stored deadlines, challenge commit/reveal, replay assignment and verdicts, quorum resolution, bounty settlement, blocked execution, approval, and Guard execution. Generated action IDs are local receipts, never explorer links or transaction signatures.

The interface deliberately limits its claims to the declared invariant, pinned artifact set, replayed trace, verifier result, and challenge window. It never represents a clean result as a general security guarantee. Infrastructure outcomes such as `runner_fault` and `unsupported_environment` fail closed and never count as preservation.

## Day-2 integration points

- Add `SolanaFaultlineClient` using generated Anchor types and wallet-adapter signing.
- Replace local deadlines with Clock-sysvar/confirmed account data.
- Connect the indexer read API while retaining direct account verification for critical state.
- Replace simulated replay results with signed commit/reveal attestations from isolated workers.
- Connect content-addressed artifact and encrypted evidence services.
- Add decoded transaction previews, commitment level, and real explorer links only when real signatures exist.
- Validate candidate buffer ownership, authority, and executable digest before opening or execution.

The MVP verifier view is explicitly labeled permissioned 2-of-3; it is not presented as decentralized.
