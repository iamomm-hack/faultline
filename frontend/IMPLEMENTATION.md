# Faultline frontend

## Audit and architecture

Baseline: `18a8b6efbb2329c81420b9341452436df1df8273`, branch `frontend-demo`.
The existing application is Vite + React 19 + React Router, not Next.js. Preserve that runtime, the lockfile, and committed SDK/IDL source. No protocol or backend files are changed.

- `/`: image-led protocol story, scroll-controlled photographic hero, evidence and architecture.
- `/app`: protocol dashboard; `/proposals`: searchable explorer.
- `/proposals/:proposalId`: evidence, authority and settlement detail.
- `/demo`: resettable deterministic v2/v3 walkthrough.
- `/docs`: architecture and explicit trust boundaries.
- `src/motion`: GSAP/Lenis lifecycle and scroll orchestration.
- `src/visuals`: original procedural geometry and accessible static diagrams.
- `src/protocol`: isolated demo and configured read-only RPC adapters.

Visual thesis after the 2026-09-28 correction: critical infrastructure under controlled inspection. Licensed monochrome architectural and material photography, oversized editorial typography, asymmetric crops, precise annotations and large negative-space areas. The former procedural Guard scene is retained but no longer imported or shipped in the landing-page bundle. Product behavior and SDK adapters are unchanged.

## Evidence and brand audit

The original frontend contains invented placeholder keys/hashes and a legacy 2-of-3 demo. It is not a source of actual execution evidence. Committed checkpoint-1 vectors explicitly say “Format-only receipt and worker vectors; not VM execution evidence.” Display their provenance with every evidence surface. A local demonstration never creates an on-chain signature.

No approved logo file is present in the supplied checkout. The old favicon is unrelated blue starter artwork and the old sidebar mark is CSS geometry. Use the plain Faultline name until the approved asset is supplied; do not invent a logo or claim a logo-symbol preloader was delivered.

References were directly inspected on 2026-09-28: Kimia and Valdyum via rendered browser frames, Vouch via its public frontend motion/lifecycle files. The earlier audit could not fetch two references; this redesign resolved that access limitation. Principles inform original compositions; no reference code, branding or assets were copied. See `QA_REPORT.md` for the mapping and `public/images/faultline/ASSET_PROVENANCE.md` for all 12 photograph sources and licence terms.

## Local configuration

RPC mode requires `VITE_FAULTLINE_RPC_URL` and `VITE_FAULTLINE_GENESIS_HASH`. These are public browser configuration: use no secret-bearing endpoints. Missing configuration, transport, genesis, ownership, discriminator and decoding failures remain errors; never substitute demo data. No wallet or transaction broadcaster is enabled.

SDK browser imports re-export the committed browser-relevant modules through a frontend-only bridge. SHA-256 is adapted to a browser implementation; protocol preimages, layouts, PDA seeds, instruction construction and error definitions remain SDK-owned.
