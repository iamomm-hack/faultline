import type { RefObject } from 'react';
import { gsap, useGSAP, useMotion } from './system';

/** Scroll moves photographic focal planes, not a stack of entering UI panels. */
export function useCinematicChapters(scope: RefObject<HTMLElement | null>) {
  const { enabled } = useMotion();
  useGSAP(
    () => {
      if (!enabled) return;
      const media = gsap.matchMedia();
      media.add(
        '(min-width: 1024px) and (prefers-reduced-motion: no-preference)',
        () => {
          gsap.fromTo(
            '.fracture-image',
            { clipPath: 'polygon(20% 0%,100% 0%,100% 100%,0% 100%)', y: 40 },
            {
              clipPath: 'polygon(0% 0%,100% 0%,100% 100%,0% 100%)',
              y: -30,
              ease: 'none',
              scrollTrigger: {
                trigger: '.fracture-chapter',
                start: 'top 85%',
                end: 'bottom 30%',
                scrub: 0.6,
              },
            },
          );
          gsap.fromTo(
            '.aggregate-inset',
            { y: 60 },
            {
              y: -50,
              ease: 'none',
              scrollTrigger: {
                trigger: '.fracture-chapter',
                start: 'top 40%',
                end: 'bottom top',
                scrub: 0.6,
              },
            },
          );
          gsap.fromTo(
            '.gate-image img',
            { scale: 1.18, yPercent: -5 },
            {
              scale: 1,
              yPercent: 3,
              ease: 'none',
              scrollTrigger: {
                trigger: '.gate-chapter',
                start: 'top bottom',
                end: 'bottom top',
                scrub: 0.8,
              },
            },
          );
          gsap.fromTo(
            '.gate-sequence li',
            { x: 40 },
            {
              x: 0,
              stagger: 0.12,
              ease: 'none',
              scrollTrigger: {
                trigger: '.gate-chapter',
                start: 'top 55%',
                end: 'bottom 85%',
                scrub: 0.6,
              },
            },
          );
          gsap.fromTo(
            '.rejected-photo',
            { scale: 1.12, xPercent: -6 },
            {
              scale: 1.12,
              xPercent: 0,
              ease: 'none',
              scrollTrigger: {
                trigger: '.outcome-diptych',
                start: 'top 85%',
                end: 'center center',
                scrub: 0.5,
              },
            },
          );
          gsap.fromTo(
            '.outcome-stop-line',
            { scaleX: 0 },
            {
              scaleX: 1,
              ease: 'none',
              scrollTrigger: {
                trigger: '.outcome-diptych',
                start: 'top 65%',
                end: 'center center',
                scrub: 0.3,
              },
            },
          );
          gsap.fromTo(
            '.preserved-photo',
            { clipPath: 'inset(0 35% 0 35%)', scale: 1.15 },
            {
              clipPath: 'inset(0 0% 0 0%)',
              scale: 1,
              ease: 'none',
              scrollTrigger: {
                trigger: '.outcome-diptych',
                start: 'top 85%',
                end: 'center center',
                scrub: 0.7,
              },
            },
          );
          gsap.fromTo(
            '.verifier-triptych figure',
            { y: (i) => (i === 1 ? 70 : 0), x: (i) => (i - 1) * 45 },
            {
              y: 0,
              x: 0,
              ease: 'none',
              scrollTrigger: {
                trigger: '.verifier-triptych',
                start: 'top 85%',
                end: 'center center',
                scrub: 0.8,
              },
            },
          );
          gsap.fromTo(
            '.receipt-photograph',
            { yPercent: 8, scale: 1.08 },
            {
              yPercent: -4,
              scale: 1.02,
              ease: 'none',
              scrollTrigger: {
                trigger: '.receipt-chapter',
                start: 'top bottom',
                end: 'bottom top',
                scrub: 0.7,
              },
            },
          );
          const edge =
            scope.current?.querySelector<SVGPathElement>('.architecture-path');
          if (edge) {
            const length = edge.getTotalLength();
            gsap.fromTo(
              edge,
              { strokeDasharray: length, strokeDashoffset: length },
              {
                strokeDashoffset: 0,
                ease: 'none',
                scrollTrigger: {
                  trigger: '.infrastructure-chapter',
                  start: 'top 65%',
                  end: 'bottom 75%',
                  scrub: 0.7,
                },
              },
            );
          }
          gsap.fromTo(
            '.closing-frame>.editorial-photo',
            { scale: 1.1, yPercent: -4 },
            {
              scale: 1,
              yPercent: 0,
              ease: 'none',
              scrollTrigger: {
                trigger: '.closing-frame',
                start: 'top bottom',
                end: 'bottom bottom',
                scrub: 0.8,
              },
            },
          );
        },
      );
      return () => media.revert();
    },
    { scope, dependencies: [enabled], revertOnUpdate: true },
  );
}
