# Faultline / image-led redesign QA
Date: 2026-09-28. Branch: `frontend-demo`. Baseline: `848cbae5d82c98cf96aa130aae7124f78dfd92df`.

## Visual audit and correction

The baseline hero isolated a procedural object in empty space; the failure surface, pipeline and outcomes repeated component grids and SVG illustrations. Evidence appeared as a row of data cells, architecture as boxed nodes, and the final CTA reused the hero drawing. This pass replaces that landing-page visual system, not the working application.

The new direction is **critical infrastructure under controlled inspection**. Ten chapters vary full-bleed photography, pale stone macros, monumental type, asymmetric image overlap, a photographic triptych, paper-and-hash composition, infrastructure annotations and a closing architectural frame. Only the product-window chapter uses interface panels. The story is predominantly imagery, large editorial typography and spatial composition; it is not a sequence of feature cards.

## Direct reference study

All three references were inspected before product edits. Reference frames are in ignored `outputs/references/`; `tests/reference-study.mjs` reproduces the visual study.

| Reference | Directly inspected | Applied principle, not copied material |
| --- | --- | --- |
| [Kimia](https://kimia.live/) | Rendered opening, middle and lower page | Image-dominant opening, oversized controlled type, asymmetry, structural spacing and contrast between editorial and product surfaces |
| [Valdyum](https://www.valdyum.live/) | Rendered full-viewport opening and scroll states | A scene changes under scroll: crop/scale, image masking, depth, transitions and stable foreground typography |
| [Vouch frontend](https://github.com/SATISH-JALAN/Vouch/tree/main/frontend) | Public MotionProvider, Lenis, motion constants and route-transition files | One GSAP-driven scroll clock, lifecycle ownership, font refresh, reversible scoped effects and reduced-motion completeness |

No source implementation, branding, wording, illustration, photograph or layout was copied from these references. Existing Faultline motion infrastructure was extended in place.

## Image inventory and provenance

Twelve distinct licensed photographs, each in 640/960/1280/1920px WebP sizes (48 local files). The image system uses source photography rather than generated artwork or runtime 3D.

| Stem | Role |
| --- | --- |
| `monument` | Dominant hero / monumental boundary |
| `fracture` | Inspection progression and failure-surface macro |
| `boundary` | Physical obstruction / rejected candidate |
| `passage` | Enforced gate and partially revealed HOLD progression |
| `alloy` | Candidate material / explorer environmental header |
| `receipts` | Layered evidence composition and proposal-detail header |
| `inspection` | First photographic verifier fragment / observation |
| `precision` | Second verifier fragment and preserved-candidate composition |
| `aperture` | Third verifier fragment / structural integrity |
| `infrastructure` | Architecture scene and dashboard environmental header |
| `closing` | Final architectural frame |
| `aggregate` | Exposed interior / failure-surface detail |

Every source page, original image URL, creator, licence and modification is recorded in [ASSET_PROVENANCE.md](public/images/faultline/ASSET_PROVENANCE.md). All use the verified Pexels License. No hotlinked media, invented creator credit, AI image or reference-site asset. Photography is explicitly an editorial metaphor, not imagery of Faultline facilities, workers or chain execution. Original bytes remain in ignored QA/source storage; optimized derivatives are the published assets.

## Motion architecture

- `src/visuals/Hero.tsx`: one five-phase desktop pin, 300% scroll distance. Exposure uses a tight photographic crop and scrubbed zoom; inspection opens a mask; three photographic fragments converge; a rejection boundary closes; a passage opens only partially into explicitly non-approving HOLD.
- `src/motion/cinematic.ts`: reversible scene-level effects—fracture mask, opposing focal-plane movement, verifier convergence, receipt parallax, causal architecture path and closing image drift.
- `src/motion/system.tsx`: existing GSAP/ScrollTrigger/Lenis ownership retained. Critical-image/font refresh remains centralized; late chapter images no longer repeatedly reposition hash navigation.
- Hero layers are absent from startup and warmed progressively after intentional scroll. Below-fold photographs request only near the viewport; no perpetual image animation or off-screen WebGL.
- The previous Three scene is retained in source but is no longer imported into the landing bundle. No new dependency or lockfile change.
- Mobile is unpinned and art-directed independently. Reduced motion and the motion toggle retain all meaningful content and outcomes. No information requires completing the animation.

## Preserved application

`/app`, `/proposals`, both proposal-detail examples, `/demo`, `/docs`, redirects and error/empty states are retained. Product changes are limited to environmental header imagery; protocol records, demo state machine, RPC adapter, SDK bridge, commitment code and existing unit tests were not changed.

The v2/v3 walkthrough still requires three outputs, rejects disagreement, distinguishes terminal rejection from HOLD, keeps separate governance approval and the eligibility delay, and resets without refresh. SDK inspection and copy controls remain functional. RPC errors never substitute demo records.

## Screenshots and responsive findings

All seven major routes were captured at **1440×900, 1280×800, 1024×768, 768×1024, 390×844 and 360×800**: 42 route/viewport combinations.

The additional motion suite captures all five hero phases, then start/middle/end frames of all nine subsequent chapters at 1440px and 390px. Contact sheets and individual frames were reviewed for composition, crop, hierarchy, overlap and readability:
- `outputs/cinema/hero-phase-0.png` through `hero-phase-4.png`
- `outputs/cinema/{chapter}-{width}-{start|middle|end}.png`
- `outputs/cinema/chapter-contact-1440.jpg` and `chapter-contact-390.jpg`
- `outputs/cinema/landing-{width}-full.png`
- Route captures and machine-readable `outputs/qa-results.json`

Corrections from visual QA: fixed dark-on-dark product CTA and rejection-badge overrides; moved a HOLD annotation inside its image mask; lightened the mobile fracture region behind dark typography; waited for photographic decoding in screenshot tests; staged clipped hero images explicitly rather than relying on native lazy-loading visibility. Phone outcomes stack vertically, the verifier triptych uses narrow photographic strips, evidence hashes wrap, and architecture labels become a readable list. No horizontal overflow or route errors were observed.

## Accessibility

Automated WCAG A/AA checks pass on all seven routes at desktop and phone sizes. The cinematic suite also checks WCAG 2.2 AA tags. Keyboard skip link, mobile-menu Escape/focus restoration, copy confirmation and native controls remain intact. Meaningful photographs have alt text; decorative environments use empty alt text. Contrast is maintained through image grading and localized scrims, not coloured status alone. Rejection and preservation have visible text labels. Reduced motion removes pins and preserves the story.

Automated audits do not replace comprehensive assistive-technology or human usability testing.

## Performance

Final Lighthouse mobile: **Performance 98 / Accessibility 100 / Best practices 100 / SEO 100**. **LCP 2.0s, CLS 0, TBT 80ms.** All requested targets pass. Raw report: `outputs/lighthouse-cinematic-final.json`.

Production bundles: main approximately 137KB gzip, CSS 12.6KB gzip, lazy product route 10.6KB gzip, lazy SDK 71.6KB gzip. The old 137KB-gzip Three chunk is no longer emitted. Only the responsive opening photograph is preloaded, and only on the landing route. Below-fold media is intersection-gated; hero progression requests are staged by scroll. Image boxes have stable dimensions. No remote fonts, runtime media hotlinks, new libraries or autoplay video.

The first image-led Lighthouse run scored 89 with 3.6s LCP because native lazy loading fetched multiple distant chapters. Intersection-gated loading improved that to 96 and 2.6s LCP; the final pass also added an intermediate responsive size and tightened the prefetch distance. Scores are local throttled measurements, not production field data.

## Validation

- Lint, typecheck and production build: pass.
- Existing focused tests: 22 pass across 3 files.
- Existing browser regression: 42 route checks and 10 preserved interaction scenarios; zero runtime/console errors, horizontal overflow or automated accessibility violations.
- Cinematic motion suite: five expected phases, partial HOLD mask, local decoded images, reduced-motion cleanup, desktop-to-phone resize and route pin cleanup.
- Asset inspection: 12 distinct source photographs; all 48 WebP derivatives local and documented.
- `git diff --check`: pass.

Reproduce with production preview on port 3001, then `npm run test:browser` and `npm run test:motion`. `python tests/contact-sheets.py` assembles chapter review sheets; `tests/prepare-images.py` reproduces the licensed image derivatives with Pillow.

## Honest boundaries and scope

v3 guarded execution remains DEMO SIMULATION, not Checkpoint 5 completion. HOLD is not approval. Live RPC requires explicit endpoint/genesis configuration; no live endpoint was supplied or exercised here. Wallet signing and transaction broadcasting are not implemented. Original checkpoint-1 hashes remain format vectors, not VM execution proof; missing identities/signatures are not fabricated. Common-mode VM risk and current worker-isolation limitations remain explicit.

No approved logo asset was added or invented: the existing plain Faultline wordmark remains. Social image metadata now references the existing local asset; a production origin must be supplied if deployment later requires absolute social URLs.

All changes are inside `frontend/`. No backend, on-chain semantics, worker logic, manifests, commitment algorithms, WIP branch or original worktree files were modified. No deployment or push.
