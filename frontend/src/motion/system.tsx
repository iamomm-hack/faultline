import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger, useGSAP);
export { gsap, ScrollTrigger, useGSAP };
const MotionContext = createContext({ enabled: false, toggle: () => {} });
export const useMotion = () => useContext(MotionContext);
const subscribeReducedMotion = (listener: () => void) => {
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
};
const getReducedMotion = () =>
  matchMedia('(prefers-reduced-motion: reduce)').matches;

export function MotionProvider({ children }: { children: ReactNode }) {
  const reduced = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotion,
    () => true,
  );
  const [paused, setPaused] = useState(false);
  const enabled = !reduced && !paused;
  const { pathname, hash } = useLocation();
  const cursor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (
      !enabled ||
      !matchMedia('(min-width: 1024px) and (pointer: fine)').matches
    )
      return;
    const lenis = new Lenis({
      duration: 0.85,
      anchors: true,
      smoothWheel: true,
    });
    lenis.on('scroll', () => ScrollTrigger.update());
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    const visibility = () => (document.hidden ? lenis.stop() : lenis.start());
    document.addEventListener('visibilitychange', visibility);
    return () => {
      gsap.ticker.remove(tick);
      lenis.destroy();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [enabled]);
  useGSAP(
    () => {
      window.scrollTo(0, 0);
      let active = true;
      const finish = () => {
        if (!active) return;
        if (enabled && matchMedia('(min-width: 768px)').matches)
          ScrollTrigger.refresh();
        if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
      };
      void document.fonts.ready.then(finish);
      const images = Array.from(document.images).filter((img) => !img.complete);
      images.forEach((img) =>
        img.addEventListener('load', finish, { once: true }),
      );
      if (enabled && matchMedia('(min-width: 768px)').matches)
        gsap.fromTo(
          '#main',
          { opacity: 0, y: 8 },
          { opacity: 1, y: 0, duration: 0.4, clearProps: 'all' },
        );
      return () => {
        active = false;
        images.forEach((img) => img.removeEventListener('load', finish));
      };
    },
    { dependencies: [pathname, hash, enabled] },
  );
  useEffect(() => {
    if (!enabled || !matchMedia('(pointer: fine)').matches) return;
    const move = (event: PointerEvent) => {
      if (!cursor.current) return;
      cursor.current.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
      const target = (event.target as Element).closest(
        '[data-cursor], a, button',
      );
      cursor.current.dataset.state =
        target?.getAttribute('data-cursor') || (target ? 'open' : '');
      cursor.current.textContent = target?.getAttribute('data-cursor') || '';
    };
    window.addEventListener('pointermove', move, { passive: true });
    return () => window.removeEventListener('pointermove', move);
  }, [enabled]);
  return (
    <MotionContext.Provider
      value={{ enabled, toggle: () => setPaused((p) => !p) }}
    >
      <div data-motion={enabled ? 'on' : 'off'}>{children}</div>
      {enabled && <div ref={cursor} className="cursor" aria-hidden="true" />}
    </MotionContext.Provider>
  );
}

export function useEditorialMotion(scope: React.RefObject<HTMLElement | null>) {
  const { enabled } = useMotion();
  useGSAP(
    () => {
      if (!enabled) return;
      const media = gsap.matchMedia();
      media.add(
        '(min-width: 768px) and (prefers-reduced-motion: no-preference)',
        () => {
          gsap.utils
            .toArray<HTMLElement>('[data-reveal]', scope.current)
            .forEach((node) => {
              gsap.fromTo(
                node,
                { y: 32 },
                {
                  y: 0,
                  duration: 0.8,
                  ease: 'power2.out',
                  scrollTrigger: {
                    trigger: node,
                    start: 'top 94%',
                    once: true,
                  },
                },
              );
            });
          gsap.utils
            .toArray<HTMLElement>('[data-clip]', scope.current)
            .forEach((node) => {
              gsap.fromTo(
                node,
                { clipPath: 'inset(0 0 12% 0)' },
                {
                  clipPath: 'inset(0 0 0% 0)',
                  scrollTrigger: {
                    trigger: node,
                    start: 'top 90%',
                    end: 'top 25%',
                    scrub: true,
                  },
                },
              );
            });
        },
      );
      media.add(
        '(min-width: 1024px) and (pointer: fine) and (prefers-reduced-motion: no-preference)',
        () => {
          const elements = gsap.utils.toArray<HTMLElement>(
            '[data-magnetic]',
            scope.current,
          );
          const cleanups = elements.map((node) => {
            const move = (event: PointerEvent) => {
              const r = node.getBoundingClientRect();
              gsap.to(node, {
                x: (event.clientX - r.left - r.width / 2) * 0.12,
                y: (event.clientY - r.top - r.height / 2) * 0.15,
                duration: 0.2,
              });
            };
            const leave = () => gsap.to(node, { x: 0, y: 0, duration: 0.3 });
            node.addEventListener('pointermove', move);
            node.addEventListener('pointerleave', leave);
            return () => {
              node.removeEventListener('pointermove', move);
              node.removeEventListener('pointerleave', leave);
              gsap.set(node, { clearProps: 'transform' });
            };
          });
          return () => cleanups.forEach((cleanup) => cleanup());
        },
      );
      return () => media.revert();
    },
    { scope, dependencies: [enabled], revertOnUpdate: true },
  );
}
