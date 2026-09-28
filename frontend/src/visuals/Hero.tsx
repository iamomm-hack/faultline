import { useEffect, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import { gsap, ScrollTrigger, useGSAP, useMotion } from '../motion/system';
import { Photo } from './Photo';
const phases = [
  'Exposure',
  'Inspection',
  'Three outputs. One result.',
  'VIOLATION / REJECTED',
  'PRESERVED / HOLD',
];
export function Hero() {
  const root = useRef<HTMLElement>(null);
  const { enabled } = useMotion();
  const [phase, setPhase] = useState(0);
  const [prepared, setPrepared] = useState(0);
  const [layers, setLayers] = useState(false);
  // Fetch progression photographs only after intentional desktop scroll.
  useEffect(() => {
    if (!enabled) return;
    const reveal = () => {
      if (
        window.scrollY > 24 &&
        matchMedia('(min-width: 1024px)').matches &&
        !(navigator as Navigator & { connection?: { saveData: boolean } })
          .connection?.saveData
      )
        setLayers(true);
    };
    window.addEventListener('scroll', reveal, { passive: true });
    reveal();
    return () => window.removeEventListener('scroll', reveal);
  }, [enabled]);
  useGSAP(
    () => {
      if (!enabled) return;
      const media = gsap.matchMedia();
      media.add(
        '(min-width: 1024px) and (prefers-reduced-motion: no-preference)',
        () => {
          const timeline = gsap.timeline({
            scrollTrigger: {
              trigger: root.current,
              start: 'top top',
              end: '+=300%',
              pin: true,
              scrub: 0.7,
              invalidateOnRefresh: true,
              onUpdate: (self) => {
                const next = Math.min(4, Math.floor(self.progress * 5));
                setPhase(next);
                setPrepared((previous) => Math.max(previous, next));
              },
            },
          });
          timeline
            .fromTo(
              '.exposure-photo',
              { scale: 1.22, xPercent: 2 },
              { scale: 1, xPercent: 0, duration: 1.4, ease: 'none' },
              0,
            )
            .to(
              '.cinema-heading',
              { y: -24, letterSpacing: '-0.055em', duration: 2, ease: 'none' },
              0,
            );
          if (layers)
            timeline
              .to(
                '.hero-inspection',
                {
                  clipPath: 'polygon(0% 0%,100% 0%,100% 100%,0% 100%)',
                  duration: 0.9,
                },
                0.8,
              )
              .fromTo(
                '.inspection-annotation',
                { autoAlpha: 0, y: 12 },
                { autoAlpha: 1, y: 0, stagger: 0.15, duration: 0.3 },
                1.1,
              )
              .to('.hero-inspection', { opacity: 0, duration: 0.4 }, 1.9)
              .to('.verifier-fragments', { opacity: 1, duration: 0.3 }, 1.9)
              .fromTo(
                '.verifier-fragments figure',
                {
                  yPercent: (i) => (i % 2 ? 40 : -30),
                  xPercent: (i) => (i - 1) * 28,
                  rotate: (i) => (i - 1) * 5,
                },
                {
                  yPercent: 0,
                  xPercent: 0,
                  rotate: 0,
                  stagger: 0.1,
                  duration: 0.7,
                },
                2,
              )
              .to('.verifier-fragments', { opacity: 0, duration: 0.3 }, 2.75)
              .to(
                '.hero-rejection',
                { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.45 },
                2.8,
              )
              .fromTo(
                '.rejection-cut',
                { scaleX: 0 },
                { scaleX: 1, duration: 0.4 },
                3.05,
              )
              .to(
                '.hero-held',
                { clipPath: 'inset(0% 16% 0% 16%)', duration: 0.7 },
                3.65,
              )
              .to('.hero-rejection', { opacity: 0, duration: 0.5 }, 3.8)
              .to('.hero-status', { opacity: 1, duration: 0.3 }, 3.9);
          timeline.to({}, { duration: 0.35 }, 4.4);
        },
      );
      return () => media.revert();
    },
    { scope: root, dependencies: [enabled, layers], revertOnUpdate: true },
  );
  useEffect(() => {
    if (!layers) return;
    const images = Array.from(root.current?.querySelectorAll('img') ?? []);
    const refresh = () => ScrollTrigger.refresh();
    images.forEach((image) =>
      image.addEventListener('load', refresh, { once: true }),
    );
    return () =>
      images.forEach((image) => image.removeEventListener('load', refresh));
  }, [layers]);
  return (
    <section
      className="cinema-hero"
      ref={root}
      aria-label="Critical infrastructure under controlled inspection"
      data-phase={phase}
    >
      <div className="cinema-frames">
        <Photo
          name="monument"
          className="exposure-photo"
          priority
          alt="Monumental concrete structures frame a narrow opening, a physical metaphor for the upgrade boundary."
        />
        {layers && (
          <>
            <div className="hero-layer hero-inspection">
              <Photo name="fracture" eager />
              <span className="inspection-annotation annotation-one">
                01 / SURFACE DISCONTINUITY
              </span>
              <span className="inspection-annotation annotation-two">
                BIND THE EXECUTABLE. NOT THE CLAIM.
              </span>
            </div>
            <div className="hero-layer verifier-fragments" aria-hidden="true">
              {(['inspection', 'precision', 'aperture'] as const).map(
                (name, i) => (
                  <figure key={name}>
                    {prepared >= 1 && <Photo name={name} sizes="33vw" eager />}
                    <figcaption>0{i + 1} / ATTESTATION</figcaption>
                  </figure>
                ),
              )}
            </div>
            <div className="hero-layer hero-rejection">
              {prepared >= 2 && <Photo name="boundary" eager />}
              <div className="rejection-cut" />
              <span className="physical-label">× PASSAGE DENIED</span>
            </div>
            <div className="hero-layer hero-held">
              {prepared >= 3 && <Photo name="passage" eager />}
              <span className="physical-label">PRESERVED. NOT APPROVED.</span>
            </div>
          </>
        )}
      </div>
      <div className="cinema-shade" />
      <div className="cinema-topline">
        <span>SOLANA UPGRADE SAFETY</span>
        <span>DEMO MODE / INSPECTION STUDY 001</span>
      </div>
      <div className="cinema-copy">
        <p className="cinema-kicker">AUTHORITY HAS A BOUNDARY.</p>
        <h1 className="cinema-heading">
          Unsafe upgrades
          <br />
          stop here.
        </h1>
        <p className="cinema-support">Safety claims. Enforced.</p>
        <a href="#protocol" className="cinema-link" data-magnetic>
          Explore the protocol <ArrowDown size={18} />
        </a>
      </div>
      <div className="hero-status">
        <span>HOLD ≠ APPROVAL</span>
        <p>
          Separate governance approval is still required.
          <br />
          v3 passage is a demo simulation.
        </p>
      </div>
      <div className="cinema-bottom">
        <span>SCROLL TO INSPECT ↓</span>
        <div className="chapter">
          <span>0{phase + 1} / 05</span>
          <strong>{phases[phase]}</strong>
        </div>
        <span>BOUND BEFORE EXECUTION</span>
      </div>
      <p className="sr-only">
        A fracture is exposed, evidence is inspected, and three outputs
        converge. Unsafe v2 is rejected at the boundary. Preserved v3 remains on
        HOLD, not approved. Separate governance approval and eligibility are
        required. This photographic sequence is illustrative, not on-chain
        evidence.
      </p>
    </section>
  );
}
