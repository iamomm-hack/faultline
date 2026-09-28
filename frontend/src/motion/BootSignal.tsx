import { useRef } from 'react';
import { gsap, useGSAP, useMotion } from './system';
/** A short, non-blocking wordmark reveal. The unavailable approved symbol is not recreated. */
export function BootSignal() {
  const root = useRef<HTMLDivElement>(null);
  const { enabled } = useMotion();
  useGSAP(
    () => {
      if (!enabled || !root.current) return;
      gsap
        .timeline()
        .fromTo(
          root.current,
          { autoAlpha: 1 },
          { autoAlpha: 1, duration: 0.25 },
        )
        .fromTo(
          '.boot-rule',
          { scaleX: 0 },
          { scaleX: 1, duration: 0.4, ease: 'power2.out' },
          0,
        )
        .to(root.current, { autoAlpha: 0, duration: 0.3 }, 0.4);
    },
    { scope: root, dependencies: [enabled], revertOnUpdate: true },
  );
  return enabled ? (
    <div className="boot-signal" aria-hidden="true" ref={root}>
      <span>FAULTLINE</span>
      <i className="boot-rule" />
    </div>
  ) : null;
}
