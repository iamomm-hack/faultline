import { useRef } from 'react';
import { gsap, useGSAP, useMotion } from '../motion/system';
export function ReceiptDiagram({
  variant = 'receipt',
}: {
  variant?: 'receipt' | 'fault' | 'array' | 'core';
}) {
  return (
    <svg
      viewBox="0 0 600 360"
      className={`receipt-visual ${variant}`}
      role="img"
      aria-label={
        variant === 'fault'
          ? 'Unsafe candidate fragments stopped at a fault plane'
          : variant === 'array'
            ? 'Three verifier nodes connect to a single canonical result'
            : variant === 'core'
              ? 'Program state core protected inside a Guard boundary'
              : 'Layered replay receipt, executable and result commitments'
      }
    >
      <g fill="none" stroke="currentColor" strokeWidth="1">
        {variant === 'array' ? (
          <>
            <path d="M110 90L300 260M300 90V260M490 90L300 260" opacity=".4" />
            {[110, 300, 490].map((x, i) => (
              <g key={x}>
                <rect x={x - 36} y="52" width="72" height="72" />
                <text
                  x={x}
                  y="94"
                  textAnchor="middle"
                  fill="currentColor"
                  stroke="none"
                  fontFamily="monospace"
                  fontSize="16"
                >
                  0{i + 1}
                </text>
              </g>
            ))}
            <rect x="260" y="222" width="80" height="80" />
            <path d="M278 262h44M300 240v44" />
          </>
        ) : variant === 'fault' ? (
          <>
            <path d="M320 30V330" strokeWidth="3" />
            {Array.from({ length: 12 }, (_, i) => (
              <path
                key={i}
                d={`M${70 + (i % 3) * 63} ${100 + Math.floor(i / 3) * 40}h45v24h-45z`}
                opacity={0.3 + i * 0.045}
              />
            ))}
            <path d="M338 70l90 50v145l-90 50M355 90v204" />
            <path d="M460 165h60v60h-60z" />
          </>
        ) : (
          <>
            {Array.from({ length: 5 }, (_, i) => (
              <g key={i} transform={`translate(${i * 13} ${-i * 18})`}>
                <path
                  d="M105 160L305 70L495 170L295 265Z"
                  fill={i === 4 ? '#1c1c1c' : 'none'}
                  strokeOpacity={0.25 + i * 0.15}
                />
                {i === 4 && (
                  <>
                    <path
                      d="M175 162l112-52M200 177l95-43M225 192l122-56M250 207l110-50"
                      opacity=".5"
                    />
                    <path d="M340 117l62 33v40l-62-33z" />
                  </>
                )}
              </g>
            ))}
          </>
        )}
      </g>
      <path
        d="M20 20h15M20 20v15M580 20h-15M580 20v15M20 340h15M20 340v-15M580 340h-15M580 340v-15"
        stroke="currentColor"
        opacity=".3"
      />
    </svg>
  );
}
const nodes = [
  ['Governance', 'Separate approval', 60, 60],
  ['Candidate buffer', 'Executable payload', 420, 60],
  ['Proposal + BufferClaim', 'Exact address binding', 420, 220],
  ['Replay workers', 'Three processes', 780, 60],
  ['Verifier epoch', 'Frozen membership', 780, 220],
  ['Verification round', 'Candidate + trace + epoch', 780, 380],
  ['Replay result', 'Receipt + commitment', 420, 380],
  ['Guard PDA', 'Enforced authority', 420, 540],
  ['ProgramData', 'Loader-v3 passage', 60, 540],
  ['Treasury state', 'Protected state', 60, 380],
] as const;
const paths = [
  'M535 150V220',
  'M650 265H735V425H780',
  'M1010 105H1040V425H1010',
  'M895 310V380',
  'M780 425H650',
  'M175 150V265H420',
  'M535 470V540',
  'M420 585H290',
  'M175 540V470',
];
export function ArchitectureDiagram() {
  const root = useRef<HTMLDivElement>(null);
  const { enabled } = useMotion();
  useGSAP(
    () => {
      if (!enabled) return;
      const media = gsap.matchMedia();
      media.add(
        '(min-width:768px) and (prefers-reduced-motion:no-preference)',
        () => {
          const edges = gsap.utils.toArray<SVGPathElement>(
            '.causal-edge',
            root.current,
          );
          edges.forEach((edge) => {
            const length = edge.getTotalLength();
            gsap.set(edge, {
              strokeDasharray: length,
              strokeDashoffset: length,
            });
          });
          gsap.to(edges, {
            strokeDashoffset: 0,
            stagger: 0.2,
            ease: 'none',
            scrollTrigger: {
              trigger: root.current,
              start: 'top 80%',
              end: 'bottom 60%',
              scrub: true,
            },
          });
        },
      );
      return () => media.revert();
    },
    { scope: root, dependencies: [enabled], revertOnUpdate: true },
  );
  return (
    <div className="architecture-diagram" ref={root}>
      <svg
        className="topology"
        viewBox="0 0 1100 690"
        role="img"
        aria-label="Faultline causal architecture: candidate buffer binds to proposal, three workers and a frozen epoch feed the verification round, the replay result informs the decision, and separate governance approval precedes Guard-signed loader execution. Treasury state remains protected."
      >
        <defs>
          <marker
            id="flow-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M0 0L10 5L0 10" fill="#55554b" />
          </marker>
        </defs>
        <g fill="#5c5c53" fontFamily="monospace" fontSize="12">
          <text x="60" y="28">
            AUTHORITY / STATE
          </text>
          <text x="420" y="28">
            CANDIDATE / DECISION
          </text>
          <text x="780" y="28">
            REPLAY / ATTESTATION
          </text>
        </g>
        <g fill="none" stroke="#68685e" strokeWidth="1.3">
          {paths.map((d) => (
            <g key={d}>
              <path d={d} opacity=".18" />
              <path
                className="causal-edge"
                d={d}
                markerEnd="url(#flow-arrow)"
              />
            </g>
          ))}
        </g>
        {nodes.map(([name, detail, x, y], i) => (
          <g key={name} className="topology-node">
            <rect
              x={x}
              y={y}
              width="230"
              height="90"
              fill={i === 7 ? '#171717' : '#eae9e2'}
              stroke="#858578"
            />
            <text
              x={x + 17}
              y={y + 24}
              fontFamily="monospace"
              fontSize="11"
              fill={i === 7 ? '#b8b8ab' : '#5c5c53'}
            >
              {String(i + 1).padStart(2, '0')} /{' '}
              {i === 7 ? 'AUTHORITY BOUNDARY' : 'BOUND ACCOUNT'}
            </text>
            <text
              x={x + 17}
              y={y + 49}
              fontFamily="Arial, sans-serif"
              fontSize="17"
              fill={i === 7 ? '#eae9e2' : '#171717'}
            >
              {name}
            </text>
            <text
              x={x + 17}
              y={y + 72}
              fontFamily="monospace"
              fontSize="11"
              fill={i === 7 ? '#b8b8ab' : '#5c5c53'}
            >
              {detail}
            </text>
          </g>
        ))}
        <path
          d="M395 518h282v135H395Z"
          fill="none"
          stroke="#55554b"
          strokeDasharray="3 5"
        />
        <text
          x="800"
          y="585"
          fill="#5c5c53"
          fontFamily="monospace"
          fontSize="12"
        >
          HOLD ≠ APPROVAL
        </text>
      </svg>
      <ol className="architecture-mobile">
        {nodes.map(([name, detail], i) => (
          <li className={`architecture-node node-${i}`} key={name}>
            <span>{String(i + 1).padStart(2, '0')}</span>
            <strong>{name}</strong>
            <small>{detail}</small>
          </li>
        ))}
      </ol>
      <p className="diagram-note">
        REPLAY EVIDENCE → DECISION → SEPARATE APPROVAL → GUARD-SIGNED EXECUTION
      </p>
    </div>
  );
}
