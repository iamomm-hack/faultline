import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, Copy, Check } from 'lucide-react';
import { Hero } from '../visuals/Hero';
import { Photo } from '../visuals/Photo';
import { useCinematicChapters } from '../motion/cinematic';
import vectors from '../../../manifests/checkpoint-1-vectors.json';
export function CopyValue({ value, label }: { value: string; label: string }) {
  const [message, setMessage] = useState('');
  return (
    <button
      className="copy-value"
      data-cursor="COPY"
      aria-label={`Copy ${label}: ${value}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setMessage('Copied');
        } catch {
          setMessage('Copy unavailable. Select the value manually.');
        }
      }}
    >
      <code>{value}</code>
      {message === 'Copied' ? <Check size={15} /> : <Copy size={15} />}
      <span className="sr-only" role="status">
        {message}
      </span>
    </button>
  );
}

const stages = [
  [
    'Bind candidate',
    'The proposal binds the executable bytes and candidate buffer.',
  ],
  ['Replay the trace', 'AUTH-001 is tested against the bound candidate.'],
  [
    'Collect attestations',
    'Three worker outputs bind to one canonical result.',
  ],
  [
    'Finalize the decision',
    'VIOLATION rejects. Preserved produces non-approving HOLD.',
  ],
  [
    'Enforce the boundary',
    'Separate approval and eligibility precede Guard-signed execution.',
  ],
];
function SectionIndex({
  number,
  children,
}: {
  number: string;
  children: React.ReactNode;
}) {
  return (
    <div className="editorial-index">
      <span>{number} /</span>
      <span>{children}</span>
    </div>
  );
}
export function EvidenceWall() {
  const values = [
    ['Executable payload', vectors.replay_jobs[0].candidate_executable_sha256],
    ['Replay receipt · format vector', vectors.hashes.receipt_v2_hash],
    [
      'Result commitment · HOLD vector',
      vectors.unsigned_worker_outputs[0].replay_result_commitment,
    ],
    ['Bound trace', vectors.hashes.trace_hash],
  ];
  return (
    <section
      id="evidence"
      className="receipt-chapter"
      data-cinema-chapter="evidence"
    >
      <Photo
        name="receipts"
        className="receipt-photograph"
        alt="Layers of textured paper: an editorial metaphor for candidate-bound evidence."
        sizes="(max-width: 767px) 100vw, 65vw"
      />
      <div className="receipt-content">
        <SectionIndex number="05">THE EVIDENCE WALL</SectionIndex>
        <h2>
          Claims fade.
          <br />
          <em>Receipts remain.</em>
        </h2>
        <p className="editorial-lead">
          Exact bytes. Bound context.
          <br />A result you can inspect.
        </p>
        <dl className="receipt-values">
          {values.map(([label, value], i) => (
            <div key={label}>
              <dt>
                <span>0{i + 1}</span>
                {label}
              </dt>
              <dd>
                <CopyValue label={label} value={value} />
              </dd>
            </div>
          ))}
        </dl>
        <p className="image-provenance-note">
          COMMITTED FORMAT VECTORS · NOT VM EXECUTION EVIDENCE
        </p>
        <Link className="editorial-text-link" to="/docs#provenance">
          Read the provenance <ArrowUpRight size={16} />
        </Link>
      </div>
      <div className="receipt-margin-note" aria-hidden="true">
        CANDIDATE / TRACE / RECEIPT / RESULT
        <br />
        BOUND INTO ONE CANONICAL COMMITMENT
      </div>
    </section>
  );
}
function Infrastructure() {
  const nodes = [
    'Governance approval',
    'Candidate buffer',
    'Proposal + BufferClaim',
    'Three replay workers',
    'Verifier epoch',
    'Verification round',
    'Replay result',
    'Guard PDA',
    'ProgramData',
    'Treasury state',
  ];
  return (
    <section
      id="architecture"
      className="infrastructure-chapter"
      data-cinema-chapter="architecture"
    >
      <Photo
        name="infrastructure"
        alt="An ordered sequence of concrete structural supports and deep shadow."
      />
      <div className="infrastructure-shade" />
      <div className="infrastructure-copy">
        <SectionIndex number="06">THE AUTHORITY BOUNDARY</SectionIndex>
        <h2>
          Not a warning.
          <br />
          <em>An enforced edge.</em>
        </h2>
        <p>
          Evidence informs a decision.
          <br />
          The Guard PDA controls passage.
        </p>
      </div>
      <div className="infrastructure-map">
        <svg
          viewBox="0 0 1200 260"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            className="architecture-path"
            d="M50 130H1130M270 30V130M520 30V130M770 30V130M950 15V245"
          />
          <circle cx="950" cy="130" r="8" />
        </svg>
        <ol>
          {nodes.map((name, i) => (
            <li key={name} className={i === 7 ? 'boundary-name' : ''}>
              <span>{String(i + 1).padStart(2, '0')}</span>
              {name}
            </li>
          ))}
        </ol>
      </div>
      <div className="infrastructure-foot">
        <p>
          Proposal → replay → attestations → decision → separate approval →
          guarded execution.
          <br />
          HOLD does not authorize the loader. Treasury state remains protected.
        </p>
        <Link className="editorial-text-link" to="/docs">
          Read the architecture <ArrowUpRight size={16} />
        </Link>
      </div>
    </section>
  );
}
export default function Landing() {
  const root = useRef<HTMLDivElement>(null);
  useCinematicChapters(root);
  return (
    <div className="image-led-landing" ref={root}>
      <Hero />
      <section
        id="protocol"
        className="fracture-chapter"
        data-cinema-chapter="failure"
      >
        <SectionIndex number="01">THE FAILURE SURFACE</SectionIndex>
        <div className="fracture-image">
          <Photo
            name="fracture"
            alt="A network of stress fractures running through pale stone."
          />
          <span className="material-coordinate">
            MATERIAL STUDY / 001
            <br />
            STRESS BECOMES VISIBLE
          </span>
        </div>
        <h2>
          A valid signature.
          <br />
          <span>An unsafe change.</span>
        </h2>
        <div className="fracture-copy">
          <p>
            Authority can move an upgrade.
            <br />
            It cannot prove what runs next.
          </p>
          <ol>
            <li>
              <span>01</span>Mutable authority.
            </li>
            <li>
              <span>02</span>Unverified executable.
            </li>
            <li>
              <span>03</span>Irreversible execution.
            </li>
          </ol>
        </div>
        <figure className="aggregate-inset">
          <Photo
            name="aggregate"
            alt="A broken concrete surface exposes the rough structure underneath."
            sizes="(max-width: 767px) 65vw, 25vw"
          />
          <figcaption>INSPECT BELOW THE SURFACE.</figcaption>
        </figure>
      </section>
      <section
        id="how-it-works"
        className="gate-chapter"
        data-cinema-chapter="gate"
      >
        <div className="gate-image">
          <Photo
            name="passage"
            alt="An empty concrete passage narrows toward a controlled exit."
          />
        </div>
        <div className="gate-shade" />
        <div className="gate-title">
          <SectionIndex number="02">THE ENFORCED GATE</SectionIndex>
          <h2>
            Every upgrade
            <br />
            takes the
            <br />
            <em>same passage.</em>
          </h2>
          <p>
            Bind the candidate.
            <br />
            Earn the right to execute.
          </p>
        </div>
        <ol className="gate-sequence">
          {stages.map(([title, body], i) => (
            <li key={title}>
              <span>0{i + 1}</span>
              <div>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="gate-baseline">
          <span>CANDIDATE → EVIDENCE → DECISION</span>
          <span>NO APPROVAL BY INFERENCE.</span>
        </div>
      </section>
      <section
        id="outcomes"
        className="outcome-chapter"
        data-cinema-chapter="outcomes"
      >
        <div className="outcome-editorial-head">
          <SectionIndex number="03">TWO OUTCOMES</SectionIndex>
          <h2>
            Same trace.
            <br />
            Different consequence.
          </h2>
          <p>
            AUTH-001 / TWO CANDIDATES
            <br />
            ILLUSTRATIVE DEMO STATES
          </p>
        </div>
        <div className="outcome-diptych">
          <article className="outcome-frame rejected-frame">
            <Photo
              name="boundary"
              className="rejected-photo"
              alt="Solid concrete planes obstruct passage: the rejected candidate cannot cross."
              sizes="(max-width: 767px) 100vw, 50vw"
            />
            <div className="outcome-shade" />
            <div className="outcome-frame-top">
              <span>V2 / UNSAFE</span>
              <span className="rejection-label">× VIOLATION</span>
            </div>
            <div className="outcome-copy">
              <h3>Rejected.</h3>
              <p>
                The exploit succeeds in replay.
                <br />
                Three workers agree. The Guard stays closed.
              </p>
              <span className="outcome-settlement">
                BOUNTY · BOND RETURN · VERIFIER FEES
              </span>
              <Link to="/demo?candidate=v2" className="editorial-text-link">
                Follow the rejection <ArrowUpRight size={16} />
              </Link>
            </div>
            <div className="outcome-stop-line" aria-hidden="true" />
          </article>
          <article className="outcome-frame held-frame">
            <Photo
              name="precision"
              className="preserved-photo"
              alt="Precisely aligned metal components: a preserved candidate still awaits authorization."
              sizes="(max-width: 767px) 100vw, 50vw"
            />
            <div className="outcome-shade" />
            <div className="outcome-frame-top">
              <span>V3 / PATCHED</span>
              <span className="preserved-label">— PRESERVED</span>
            </div>
            <div className="outcome-copy">
              <h3>Held.</h3>
              <p>
                The exploit is blocked. The result is HOLD.
                <br />
                Approval is a separate governance action.
              </p>
              <span className="outcome-settlement">
                GUARDED EXECUTION / DEMO SIMULATION
              </span>
              <Link to="/demo?candidate=v3" className="editorial-text-link">
                Explore the held candidate <ArrowUpRight size={16} />
              </Link>
            </div>
          </article>
        </div>
      </section>
      <section className="verifier-chapter" data-cinema-chapter="verifiers">
        <div className="verifier-heading">
          <SectionIndex number="04">THREE-VERIFIER CONSENSUS</SectionIndex>
          <h2>
            Independent outputs.
            <br />
            <em>A single bound result.</em>
          </h2>
        </div>
        <div className="verifier-triptych">
          {(
            [
              ['inspection', 'Observe.'],
              ['precision', 'Replay.'],
              ['aperture', 'Attest.'],
            ] as const
          ).map(([name, title], i) => (
            <figure key={name}>
              <Photo
                name={name}
                alt={
                  i === 0
                    ? 'An inspection camera casts a precise shadow on concrete.'
                    : i === 1
                      ? 'A precision machine holds aligned metal parts.'
                      : 'A concrete interior frames a sharply defined aperture.'
                }
                sizes="(max-width: 767px) 55vw, 30vw"
              />
              <figcaption>
                <span>0{i + 1} / WORKER</span>
                <strong>{title}</strong>
              </figcaption>
            </figure>
          ))}
        </div>
        <div className="verifier-convergence">
          <span>↘</span>
          <span>↓</span>
          <span>↙</span>
        </div>
        <div className="verifier-result">
          <span>THREE ATTESTATIONS → ONE CANONICAL RESULT</span>
          <p>
            Agreement is required. Disagreement stops the flow.
            <br />
            Three processes do not imply three independent trust domains.
          </p>
        </div>
      </section>
      <EvidenceWall />
      <Infrastructure />
      <section className="product-window-chapter" data-cinema-chapter="product">
        <div className="product-window-title">
          <SectionIndex number="07">FROM STORY TO SYSTEM</SectionIndex>
          <h2>
            Inspect the
            <br />
            <em>actual workflow.</em>
          </h2>
          <Link className="editorial-text-link" to="/app">
            Open the application <ArrowUpRight size={18} />
          </Link>
        </div>
        <Link to="/demo" className="product-scene">
          <div className="preview-bar">
            <span>FAULTLINE / PROPOSAL EXPLORER</span>
            <span>DEMO MODE</span>
          </div>
          <div className="preview-body">
            <aside>
              <span>OVERVIEW</span>
              <strong>Proposals</strong>
              <span>Verification</span>
              <span>Evidence</span>
            </aside>
            <div>
              <div className="preview-title">
                <h3>Upgrade proposals</h3>
                <span className="label">2 CANDIDATES</span>
              </div>
              <div className="preview-table">
                <div>
                  <span>CANDIDATE</span>
                  <span>DECISION</span>
                  <span>EXECUTION</span>
                </div>
                <div>
                  <strong>Treasury / v2</strong>
                  <span>× VIOLATION</span>
                  <span>BLOCKED</span>
                </div>
                <div>
                  <strong>Treasury / v3</strong>
                  <span>— HOLD</span>
                  <span>AWAITING APPROVAL</span>
                </div>
              </div>
              <div className="preview-bottom">
                <span>AUTH-001 / Unauthorized treasury outflow</span>
                <ArrowUpRight />
              </div>
            </div>
          </div>
          <span className="preview-disclaimer">
            ILLUSTRATIVE DEMO STATES · OPEN TO RUN THE WORKFLOW
          </span>
        </Link>
      </section>
      <section className="honest-limits" data-cinema-chapter="limitations">
        <SectionIndex number="08">TRUST HAS LIMITS</SectionIndex>
        <div className="limits-layout">
          <h2>
            Precisely what
            <br />
            this is.
            <br />
            <em>And isn’t.</em>
          </h2>
          <div>
            <p>
              v3 guarded execution is simulated in this frontend. HOLD is not
              approval.
            </p>
            <p>
              Live RPC requires explicit configuration. Connection or decoding
              failures remain visible—there is no silent demo fallback.
            </p>
            <p>
              Wallet signing and transaction broadcasting are not implemented.
            </p>
            <p>
              Replay checks a bounded trace, not universal safety. Common-mode
              VM risk and current worker-isolation limits remain. No production
              Byzantine-security claim.
            </p>
          </div>
        </div>
      </section>
      <section className="closing-frame" data-cinema-chapter="closing">
        <Photo
          name="closing"
          alt="A sequence of substantial concrete boundaries continues into the distance."
        />
        <div className="closing-shade" />
        <span className="closing-identity">FAULTLINE</span>
        <div className="closing-copy">
          <p>BUILDING UPGRADE GATES FOR SOLANA.</p>
          <h2>
            Evidence first.
            <br />
            Authority after.
          </h2>
          <Link className="cinema-link" data-magnetic to="/app">
            Launch Faultline <ArrowRight size={20} />
          </Link>
        </div>
        <span className="closing-note">SAFETY CLAIMS. ENFORCED.</span>
      </section>
    </div>
  );
}
