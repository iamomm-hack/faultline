import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUpRight } from 'lucide-react';
import { gsap, useGSAP, useMotion } from '../motion/system';
const GuardScene = lazy(() => import('./GuardScene'));
const chapters = [
  'UPGRADES MOVE FAST.',
  'AUTHORITY SHOULD NOT.',
  'EVIDENCE FIRST.',
  'EXECUTION ONLY AFTER CONSENSUS.',
  'SAFETY CLAIMS. ENFORCED.',
];
export function Hero() {
  const root = useRef<HTMLElement>(null);
  const { enabled } = useMotion();
  const [progress, setProgress] = useState(0);
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const media = matchMedia('(min-width: 1024px)');
    const update = () =>
      setDesktop(
        media.matches &&
          !(navigator as Navigator & { connection?: { saveData: boolean } })
            .connection?.saveData,
      );
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useGSAP(
    () => {
      if (!enabled) return;
      const media = gsap.matchMedia();
      media.add(
        '(min-width: 1024px) and (prefers-reduced-motion: no-preference)',
        () => {
          const state = { value: 0 };
          gsap.to(state, {
            value: 1,
            ease: 'none',
            scrollTrigger: {
              trigger: root.current,
              start: 'top top',
              end: '+=200%',
              pin: true,
              scrub: 0.6,
            },
            onUpdate: () => setProgress(state.value),
          });
          gsap.from('.hero-heading span', {
            yPercent: 110,
            stagger: 0.12,
            duration: 1,
            ease: 'power3.out',
          });
        },
      );
      return () => media.revert();
    },
    { scope: root, dependencies: [enabled], revertOnUpdate: true },
  );
  const chapter = Math.min(4, Math.floor(progress * 5));
  return (
    <section
      ref={root}
      className="hero"
      aria-label="Faultline protocol introduction"
    >
      <div className="hero-meta">
        <span>SOLANA UPGRADE SAFETY PROTOCOL</span>
        <span>BOUND BY EVIDENCE. CONTROLLED BY CODE.</span>
      </div>
      <div className="hero-art">
        <img
          src="/guard-aperture.svg"
          width="1400"
          height="1000"
          alt="Candidate executable fragments approach a layered Guard aperture. A protected program core remains behind the boundary."
          fetchPriority="high"
        />
        {enabled && desktop && (
          <Suspense fallback={null}>
            <GuardScene progress={progress} />
          </Suspense>
        )}
      </div>
      <div className="hero-copy">
        <div className="hero-index">
          <span className="cross">+</span> BUILDING UPGRADE GATES FOR SOLANA.
        </div>
        <h1 className="hero-heading">
          <span>Safety claims.</span>
          <span>
            Enforced<span className="period">.</span>
          </span>
        </h1>
        <p>
          Upgrades should earn their authority.
          <br />
          Bind the executable. Replay the evidence.
          <br />
          Enforce the boundary.
        </p>
        <div className="hero-actions">
          <a className="button light" data-magnetic href="#protocol">
            Explore the protocol <ArrowDown size={16} />
          </a>
          <Link className="hero-demo" to="/demo">
            Open interactive demo <ArrowUpRight size={16} />
          </Link>
        </div>
      </div>
      <div className="scene-caption">
        <span>FIG. 01 / GUARD APERTURE</span>
        <span>
          {progress > 0.72
            ? 'SEPARATE APPROVAL → LOADER V3'
            : progress > 0.48
              ? 'HOLD / AWAITING GOVERNANCE'
              : 'EXECUTION BOUNDARY · LOADER V3'}
        </span>
        <span className="scene-coordinate">PROTOCOL SCHEMATIC / SIMULATED</span>
      </div>
      <div className="hero-bottom">
        <span className="scroll-label">
          <ArrowDown size={14} /> SCROLL TO FOLLOW THE EVIDENCE
        </span>
        <div className="chapter">
          <span>0{chapter + 1} / 05</span>
          <strong>{chapters[chapter]}</strong>
        </div>
        <div className="chapter-track" aria-hidden="true">
          {chapters.map((c, i) => (
            <i key={c} className={i <= chapter ? 'active' : ''} />
          ))}
        </div>
      </div>
      <p className="sr-only">
        Candidates align, three verifier nodes contribute evidence, an unsafe
        candidate is displaced, and the preserved candidate remains held until
        separate approval and execution eligibility. The protected treasury
        state remains intact. This scene illustrates protocol causality, not an
        on-chain transaction.
      </p>
    </section>
  );
}
