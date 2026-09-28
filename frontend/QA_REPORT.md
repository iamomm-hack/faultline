# Faultline frontend delivery / 2026-09-27

## Scope

Built on `frontend-demo` from `18a8b6efbb2329c81420b9341452436df1df8273`. All changes are under `frontend/`. No protocol, SDK, IDL, manifest, backend suite, validator, original worktree, preserved WIP branch, deployment or push was changed/run. Existing Vite/React architecture was retained.

## Completed routes and visual QA

| Route | Surface | Result |
| --- | --- | --- |
| `/` | Editorial landing, Guard narrative, pipeline, outcomes, evidence, architecture, product preview, limitations | Pass |
| `/app` | Dashboard, source status, counts, decisions, eligibility, settlement | Pass |
| `/proposals` | Search, status filters, compact/expanded explorer, empty state | Pass |
| `/proposals/proposal-v2` | Rejection, bound evidence, worker outputs, settlement, timeline | Pass |
| `/proposals/proposal-v3` | Non-approving HOLD, separate authority, evidence and timeline | Pass |
| `/demo` | Resettable v2/v3 walkthrough, disagreement, three attestations, separate approval and delay | Pass |
| `/docs` | Architecture, evidence provenance, trust boundaries, RPC configuration | Pass |

All seven routes were captured and checked at 1440×900, 1280×800, 1024×768, 768×900, 390×844 and 360×800: 42 route/viewport checks. No horizontal overflow or runtime/console errors. Desktop and mobile screenshots were reviewed for hierarchy, line breaks, evidence wrapping, navigation, stacked layouts and spacing. The 768px case uses a vertical product layout; phone screens use a static hero and vertical pipeline rather than a compressed pinned scene.

Automated WCAG A/AA checks at desktop and phone sizes found no violations on these routes. Additional normal-motion desktop checks pass. Keyboard checks cover the first-tab skip link, mobile menu Escape/focus restoration and route navigation. Native buttons/selects/links, visible focus, semantic headings, status announcements, copy feedback, text alternatives and a global motion toggle are provided. These checks are not a claim of a comprehensive assistive-technology certification.

Screenshots and machine-readable results are generated in ignored `outputs/`. Reproduce against a production preview on port 3001 with `npm run test:browser` and `npm run test:motion`. The browser harness uses installed Microsoft Edge via Playwright; no machine-specific executable path is committed.

## Motion and asset architecture

`src/motion/system.tsx` owns GSAP/ScrollTrigger registration, Lenis synchronization with the GSAP ticker, reduced-motion subscription, route transitions, image/font refresh, cursor and magnetic controls. Scoped contexts and matchMedia cleanup revert route effects. Motion is optional, never necessary to understand an outcome.

`Hero.tsx` synchronizes the pinned desktop narrative and chapter labels. `GuardScene.tsx` lazily loads Three.js; its aperture, candidate fragments, verifier array, displaced unsafe fragments, held passage and intact state core respond to scroll progress. The gate opens only in the explicitly labeled approval/loader portion of the illustration. This is a protocol schematic, not a transaction claim.

Rendering is demand-driven with no perpetual scene loop, DPR capped at 1.5, intersection and document-visibility checks, no real-time shadows, instanced bolts and byte markings, resource disposal and context-loss fallback. Mobile, reduced-motion and data-saver users retain the original SVG poster. The poster is preloaded and dimensioned. Receipt/fault/verifier diagrams, architecture, SVG poster and all Three geometry are original code-generated assets. Byte markings derive from the committed v2 payload hash. No stock images, AI art, copied assets or remote fonts are used.

## Evidence and adapter boundary

Demo Mode is deterministic local state without wallet, validator, RPC or broadcasts. All three simulated workers must complete; disagreement prevents submission; VIOLATION rejects terminally; HOLD never approves. v3 approval, eligibility delay and guarded execution are explicitly DEMO SIMULATION. Reset works without refreshing.

Displayed hashes and the one available verifier public key come from committed checkpoint-1 format vectors. Those vectors are explicitly NOT VM execution evidence and contain HOLD even for v2. They are shown unchanged, never presented as proof of the simulated v2 VIOLATION. Missing verifier identities, buffer, epoch and signatures are not fabricated. The browser SDK inspector recomputes the original commitment, derives the replay-result PDA and constructs an unsigned IDL instruction without sending it.

RPC Mode requires an explicit endpoint and expected genesis hash. It reads genuine accounts using committed SDK/IDL decoding and checks ownership/discriminators. Missing configuration, transport, genesis and decode errors are exposed without substituting demo data. SDK PDA seeds, account layouts, instruction construction, commitments and error definitions remain authoritative; the frontend bridge only adapts browser hashing/buffer support and avoids importing the SDK CLI.

No live validator endpoint was supplied or contacted. Positive/negative adapter behavior was tested with controlled transport responses. Wallet signing, transaction broadcasting, historical transaction indexing and actual Checkpoint 5 guarded execution remain backend-integration boundaries. There is no mainnet, production Byzantine-security, audit or Checkpoint 5 completion claim.

## Validation and performance

- `npm run lint`: pass.
- `npm run typecheck`: pass.
- `npm test`: 22 tests pass across 3 files, including SDK parity and adapter failure cases.
- `npm run build`: pass.
- `npm run test:browser`: 42 route checks, 10 interaction scenarios, zero errors/overflow/accessibility violations.
- `npm run test:motion`: normal-motion accessibility, WebGL progression and zero remaining route pin spacers pass.
- `git diff --check`: pass.

Final Lighthouse mobile measurement: performance 94, accessibility 100, best-practices 100 and SEO 100; LCP 1.9s, CLS 0 and total blocking time 260ms. Earlier runs varied from 81–94; the slow run exposed avoidable small-screen ScrollTrigger initialization, which was removed before the final measurement. Animated text contrast and visible-label naming were also corrected. Local throttled results vary; they are not production field measurements. The final raw report is `outputs/lighthouse-mobile-optimized.json`.

Main entry is approximately 138KB gzip, CSS 8.6KB gzip, lazy product route 8.4KB gzip, lazy SDK 71.6KB gzip and lazy Three scene 137KB gzip. SDK/RPC/Three are absent from initial mobile execution. The build retains an advisory for the lazy Three chunk exceeding 500KB uncompressed; it is not suppressed. Edge's software WebGL compiler emits a non-fatal precision warning in Three's environment shader; no application console errors were observed. Dependency remediation removed high/critical audit findings; four moderate findings remain in the committed SDK-compatible web3 dependency tree. A breaking protocol-library downgrade was not forced.

## Brand handoff

No approved Faultline logo asset exists in the supplied checkout. The site uses the plain Faultline name and a restrained wordmark/rule startup reveal, not an invented replacement symbol. Supplying the approved file is required to complete exact-logo integration. Legacy inactive frontend files were preserved instead of destructively deleting existing work.

## Changed files

- Configuration: `.oxlintrc.json`, `index.html`, `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`.
- Foundation: `app/globals.css`, `src/App.tsx`, `src/main.tsx`, `src/components/SiteShell.tsx`, `src/components/SdkEvidence.tsx`.
- Motion and visuals: `src/motion/system.tsx`, `src/motion/BootSignal.tsx`, `src/visuals/Hero.tsx`, `src/visuals/GuardScene.tsx`, `src/visuals/Diagrams.tsx`, `public/guard-aperture.svg`, `public/robots.txt`.
- Routes: `src/pages/Landing.tsx`, `src/pages/Product.tsx`.
- Data: `src/protocol/model.ts`, `src/protocol/ProtocolProvider.tsx`, `src/protocol/rpc-adapter.ts`, `src/protocol/sdk-browser.ts`, `src/protocol/browser-buffer.ts`, `src/protocol/browser-crypto.ts`.
- Validation and handoff: `tests/protocol-adapters.test.ts`, `tests/visual-qa.mjs`, `tests/motion-qa.mjs`, `IMPLEMENTATION.md`, `QA_REPORT.md`.
