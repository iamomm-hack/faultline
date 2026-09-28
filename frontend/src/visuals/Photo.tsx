import { useEffect, useRef, useState, type CSSProperties } from 'react';
export type PhotoName =
  | 'monument'
  | 'boundary'
  | 'fracture'
  | 'passage'
  | 'alloy'
  | 'receipts'
  | 'inspection'
  | 'precision'
  | 'aperture'
  | 'infrastructure'
  | 'closing'
  | 'aggregate';
const ratios: Record<PhotoName, number> = {
  monument: 4160 / 6240,
  boundary: 4015 / 3011,
  fracture: 1.5,
  passage: 4032 / 3024,
  alloy: 1.5,
  receipts: 1.5,
  inspection: 1.5,
  precision: 2848 / 4288,
  aperture: 3280 / 2464,
  infrastructure: 5056 / 3920,
  closing: 1.5,
  aggregate: 2268 / 4032,
};
/** All photography is licensed, local, dimensioned and responsive. */
export function Photo({
  name,
  alt = '',
  className = '',
  sizes = '100vw',
  priority = false,
  eager = false,
  style,
}: {
  name: PhotoName;
  alt?: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
  eager?: boolean;
  style?: CSSProperties;
}) {
  const image = useRef<HTMLImageElement>(null);
  const [requested, setRequested] = useState(priority || eager);
  useEffect(() => {
    if (requested || !image.current) return;
    // Native lazy loading may fetch several screens ahead on fast connections.
    // Keep editorial chapters out of the critical path until they are near view.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setRequested(true);
          observer.disconnect();
        }
      },
      { rootMargin: '80px 0px' },
    );
    observer.observe(image.current);
    return () => observer.disconnect();
  }, [requested]);
  return (
    <img
      ref={image}
      className={`editorial-photo ${className}`}
      src={requested ? `/images/faultline/${name}-1280.webp` : undefined}
      srcSet={
        requested
          ? [640, 960, 1280, 1920]
              .map((w) => `/images/faultline/${name}-${w}.webp ${w}w`)
              .join(', ')
          : undefined
      }
      sizes={sizes}
      width={1280}
      height={Math.round(1280 * ratios[name])}
      alt={alt}
      loading={priority || eager ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'low'}
      decoding="async"
      style={{ ...style, visibility: requested ? undefined : 'hidden' }}
    />
  );
}
