# Faultline frontend

## Audit and architecture

Baseline: `18a8b6efbb2329c81420b9341452436df1df8273`, branch `frontend-demo`.
The existing application is Vite + React 19 + React Router, not Next.js. Preserve that runtime, the lockfile, and committed SDK/IDL source. No protocol or backend files are changed.

- `/`: editorial protocol story, demand-rendered Guard Aperture, evidence and architecture.
- `/app`: protocol dashboard; `/proposals`: searchable explorer.
- `/proposals/:proposalId`: evidence, authority and settlement detail.
- `/demo`: resettable deterministic v2/v3 walkthrough.
- `/docs`: architecture and explicit trust boundaries.
- `src/motion`: GSAP/Lenis lifecycle and scroll orchestration.
- `src/visuals`: original procedural geometry and accessible static diagrams.
- `src/protocol`: isolated demo and configured read-only RPC adapters.

Visual thesis: an enforced structural boundary. Black machined geometry, paper-white editorial fields, large restrained typography, small evidence annotations, square controls and thin rules. No stock or generated artwork.

## Evidence and brand audit

The original frontend contains invented placeholder keys/hashes and a legacy 2-of-3 demo. It is not a source of actual execution evidence. Committed checkpoint-1 vectors explicitly say “Format-only receipt and worker vectors; not VM execution evidence.” Display their provenance with every evidence surface. A local demonstration never creates an on-chain signature.

No approved logo file is present in the supplied checkout. The old favicon is unrelated blue starter artwork and the old sidebar mark is CSS geometry. Use the plain Faultline name until the approved asset is supplied; do not invent a logo or claim a logo-symbol preloader was delivered.

Reference principles: editorial density and negative space from kimia.live; the supplied Valdyum direction for scene evolution; the supplied Vouch direction for lifecycle-safe motion. Valdyum and Vouch could not be fetched through the research browser; do not claim source inspection of those references.

## Local configuration

RPC mode requires `VITE_FAULTLINE_RPC_URL` and `VITE_FAULTLINE_GENESIS_HASH`. These are public browser configuration: use no secret-bearing endpoints. Missing configuration, transport, genesis, ownership, discriminator and decoding failures remain errors; never substitute demo data. No wallet or transaction broadcaster is enabled.

SDK browser imports re-export the committed browser-relevant modules through a frontend-only bridge. SHA-256 is adapted to a browser implementation; protocol preimages, layouts, PDA seeds, instruction construction and error definitions remain SDK-owned.
