/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- The evidence overflow region needs focus for native keyboard scrolling. */
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, Copy, Check } from 'lucide-react';
import { Hero } from '../visuals/Hero';
import { ArchitectureDiagram, ReceiptDiagram } from '../visuals/Diagrams';
import { gsap, useGSAP, useMotion, useEditorialMotion } from '../motion/system';
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
    'A proposal binds the exact executable payload, candidate buffer and declared invariant.',
    '01 / EXECUTABLE',
  ],
  [
    'Replay exploit trace',
    'Run the bounded AUTH-001 counterexample against the pinned candidate and environment.',
    '02 / REPLAY',
  ],
  [
    'Collect three attestations',
    'Three workers independently return evidence bound to one canonical replay result.',
    '03 / CONSENSUS',
  ],
  [
    'Finalize VIOLATION or HOLD',
    'A reproduced violation rejects. A preserved trace produces HOLD, never approval.',
    '04 / DECISION',
  ],
  [
    'Reject or execute through Guard',
    'Execution requires separate governance approval and all guarded eligibility conditions.',
    '05 / AUTHORITY',
  ],
];
function Pipeline() {
  const root = useRef<HTMLElement>(null);
  const { enabled } = useMotion();
  const [active, setActive] = useState(0);
  useGSAP(
    () => {
      if (!enabled) return;
      const media = gsap.matchMedia();
      media.add('(min-width: 1024px)', () => {
        const state = { v: 0 };
        gsap.to(state, {
          v: 4.99,
          ease: 'none',
          scrollTrigger: {
            trigger: root.current,
            start: 'top 80px',
            end: '+=150%',
            pin: true,
            scrub: true,
          },
          onUpdate: () => setActive(Math.floor(state.v)),
        });
      });
      return () => media.revert();
    },
    { scope: root, dependencies: [enabled], revertOnUpdate: true },
  );
  return (
    <section id="how-it-works" className="pipeline section-pad" ref={root}>
      <div className="section-label">
        <span>02 / ENFORCED PIPELINE</span>
        <span>FIVE STAGES. ONE BOUND CANDIDATE.</span>
      </div>
      <div className="pipeline-grid">
        <div>
          <h2>
            Evidence is a path.
            <br />
            <span className="muted">Not a promise.</span>
          </h2>
          <div className="pipeline-visual" data-clip>
            <ReceiptDiagram
              variant={
                active === 2 ? 'array' : active === 3 ? 'fault' : 'receipt'
              }
            />
            <span className="mono">{stages[active][2]}</span>
          </div>
        </div>
        <ol className="pipeline-stages">
          {stages.map(([title, body], i) => (
            <li key={title} className={i === active ? 'active' : ''}>
              <button onClick={() => setActive(i)} aria-expanded={i === active}>
                <span>0{i + 1}</span>
                <h3>{title}</h3>
                <ArrowUpRight size={16} />
              </button>
              <p>{body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
export function EvidenceWall() {
  const root = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; scroll: number } | null>(null);
  const { enabled } = useMotion();
  useGSAP(
    () => {
      if (!enabled) return;
      const media = gsap.matchMedia();
      media.add(
        '(min-width:1024px) and (prefers-reduced-motion:no-preference)',
        () => {
          const viewport =
            root.current?.querySelector<HTMLElement>('.evidence-viewport');
          if (!viewport) return;
          gsap.to(viewport, {
            scrollLeft: () => viewport.scrollWidth - viewport.clientWidth,
            ease: 'none',
            scrollTrigger: {
              trigger: root.current,
              start: 'top 55%',
              end: 'bottom 35%',
              scrub: true,
              invalidateOnRefresh: true,
            },
          });
        },
      );
      return () => media.revert();
    },
    { scope: root, dependencies: [enabled], revertOnUpdate: true },
  );
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
    <section className="evidence section-pad" id="evidence" ref={root}>
      <div className="section-label">
        <span>04 / INSPECT THE EVIDENCE</span>
        <span>COMMITTED VECTORS / NO LIVE CLAIM</span>
      </div>
      <div className="section-heading" data-reveal>
        <h2>
          Don’t trust the headline.
          <br />
          Read the receipt.
        </h2>
        <p>
          Exact values from the repository. The checkpoint-1 receipt and worker
          vectors validate format and commitments; they are not VM execution
          evidence.
        </p>
      </div>
      <div
        className="evidence-viewport"
        tabIndex={0}
        role="region"
        aria-label="Scrollable committed evidence"
      >
        <div className="evidence-wall">
          {values.map(([label, value], i) => (
            <div className="evidence-entry" key={label}>
              <span className="mono">
                0{i + 1} / {label}
              </span>
              <CopyValue value={value} label={label} />
            </div>
          ))}
        </div>
      </div>
      <div className="evidence-foot">
        <span>SOURCE / manifests/checkpoint-1-vectors.json</span>
        <button
          className="evidence-drag"
          data-cursor="DRAG"
          aria-label="Scroll evidence; drag horizontally or use arrow keys"
          onPointerDown={(e) => {
            const viewport =
              root.current?.querySelector<HTMLElement>('.evidence-viewport');
            if (!viewport) return;
            drag.current = { x: e.clientX, scroll: viewport.scrollLeft };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const viewport =
              root.current?.querySelector<HTMLElement>('.evidence-viewport');
            if (viewport && drag.current)
              viewport.scrollLeft =
                drag.current.scroll + drag.current.x - e.clientX;
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            e.preventDefault();
            root.current
              ?.querySelector('.evidence-viewport')
              ?.scrollBy({
                left: e.key === 'ArrowRight' ? 320 : -320,
                behavior: 'auto',
              });
          }}
        >
          ← DRAG EVIDENCE →
        </button>
        <Link to="/docs#provenance">
          Read provenance <ArrowUpRight size={14} />
        </Link>
      </div>
    </section>
  );
}
export default function Landing() {
  const root = useRef<HTMLDivElement>(null);
  useEditorialMotion(root);
  return (
    <div className="landing" ref={root}>
      <Hero />
      <div className="protocol-ticker">
        <span>EXECUTABLE BOUND</span>
        <span>AUTH-001</span>
        <span>DETERMINISTIC REPLAY</span>
        <span>THREE VERIFIERS</span>
        <span>GUARDED AUTHORITY</span>
        <span>HOLD ≠ APPROVAL</span>
      </div>
      <section className="intro section-pad paper" id="protocol">
        <div className="section-label">
          <span>01 / THE FAILURE SURFACE</span>
          <span>AUTHORITY IS NOT EVIDENCE.</span>
        </div>
        <div className="section-heading" data-reveal>
          <h2>
            The next upgrade
            <br />
            changes everything.
            <br />
            <span className="muted">What stands in its way?</span>
          </h2>
          <p>
            Faultline is a Solana-native upgrade safety protocol that binds
            candidate executables to deterministic replay evidence, independent
            verifier attestations, and an on-chain guarded authority before an
            upgrade can execute.
          </p>
        </div>
        <div className="failure-grid">
          {[
            [
              'Mutable authority',
              'A valid signature can still authorize a dangerous upgrade. The authority needs an enforceable boundary.',
            ],
            [
              'Unverified executable',
              'A reviewed source tree is not the candidate buffer. Bind the exact bytes that will execute.',
            ],
            [
              'Irreversible execution',
              'Once an unsafe upgrade runs, a warning arrives too late. Stop the candidate before passage.',
            ],
          ].map(([title, body], i) => (
            <article key={title} data-reveal>
              <span className="mono">0{i + 1} /</span>
              <h3>{title}</h3>
              <p>{body}</p>
              <div className={`failure-symbol symbol-${i}`} aria-hidden="true">
                {i === 0 ? '↗' : i === 1 ? '≠' : '↳'}
              </div>
            </article>
          ))}
        </div>
      </section>
      <Pipeline />
      <section className="outcomes" id="outcomes">
        <div className="outcome-intro section-pad">
          <div className="section-label">
            <span>03 / TWO CANDIDATES. TWO OUTCOMES.</span>
            <span>THE SAME AUTH-001 TRACE.</span>
          </div>
          <h2 data-reveal>
            One boundary.
            <br />
            No ambiguity.
          </h2>
        </div>
        <div className="outcome-columns">
          <article className="outcome unsafe">
            <div className="outcome-title">
              <span className="mono">CANDIDATE / V2</span>
              <span className="label inverted">× VIOLATION</span>
            </div>
            <h3>
              Exploit reproduced.
              <br />
              Upgrade rejected.
            </h3>
            <ReceiptDiagram variant="fault" />
            <ol>
              <li>AUTH-001 succeeds in deterministic replay.</li>
              <li>Three workers agree on VIOLATION.</li>
              <li>Proposal is terminally rejected. Guard stays closed.</li>
              <li>Bounty, bond return and verifier fees settle.</li>
            </ol>
            <Link to="/demo?candidate=v2">
              Follow the rejection <ArrowUpRight size={16} />
            </Link>
          </article>
          <article className="outcome patched">
            <div className="outcome-title">
              <span className="mono">CANDIDATE / V3</span>
              <span className="label">DEMO SIMULATION</span>
            </div>
            <h3>
              Exploit blocked.
              <br />
              Authority still held.
            </h3>
            <ReceiptDiagram variant="array" />
            <ol>
              <li>The same trace returns Preserved.</li>
              <li>Three workers produce a non-approving HOLD.</li>
              <li>Separate governance approval is required.</li>
              <li>Execution waits for guarded eligibility.</li>
            </ol>
            <Link to="/demo?candidate=v3">
              Explore the held candidate <ArrowUpRight size={16} />
            </Link>
          </article>
        </div>
      </section>
      <EvidenceWall />
      <section className="architecture section-pad paper" id="architecture">
        <div className="section-label">
          <span>05 / PROTOCOL ARCHITECTURE</span>
          <span>TRUST HAS AN ADDRESS.</span>
        </div>
        <div className="section-heading" data-reveal>
          <h2>
            A boundary
            <br />
            you can trace.
          </h2>
          <p>
            Evidence informs the decision. The Guard PDA enforces authority.
            Each transition stays bound to the proposal, candidate and
            verification round.
          </p>
        </div>
        <ArchitectureDiagram />
        <Link className="button dark" to="/docs">
          Read the architecture <ArrowUpRight size={16} />
        </Link>
      </section>
      <section className="product-preview section-pad">
        <div className="section-label">
          <span>06 / THE CONTROL PLANE</span>
          <span>INSPECT. REPLAY. UNDERSTAND.</span>
        </div>
        <div className="section-heading" data-reveal>
          <h2>
            From claim
            <br />
            to consequence.
          </h2>
          <Link className="button light" to="/app">
            Open the application <ArrowUpRight size={16} />
          </Link>
        </div>
        <Link
          to="/demo"
          className="product-scene"
        >
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
      <section className="limitations section-pad">
        <div className="section-label">
          <span>07 / TRUST & LIMITATIONS</span>
          <span>PRECISE CLAIMS. EXPLICIT LIMITS.</span>
        </div>
        <div className="limitations-grid">
          <h2>
            Evidence has scope.
            <br />
            So do our claims.
          </h2>
          <div>
            {[
              [
                'Replay is not universal safety.',
                'Deterministic replay checks a declared invariant and a bounded trace. Shared VM behavior creates common-mode risk.',
              ],
              [
                'HOLD is not approval.',
                'Preserved evidence cannot authorize an upgrade. Temporary governance approval remains a separate action.',
              ],
              [
                'Three processes are not three trust domains.',
                'Current workers share implementation and host assumptions. We make no production Byzantine-security claim.',
              ],
              [
                'Simulation is clearly separated.',
                'Demo Mode runs locally. RPC Mode reads a configured chain and fails explicitly when data is unavailable. Checkpoint 5 guarded v3 execution is simulated.',
              ],
            ].map(([title, body]) => (
              <details key={title}>
                <summary>
                  {title}
                  <span>+</span>
                </summary>
                <p>{body}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
      <section className="final-cta paper section-pad">
        <span className="mono">THE BOUNDARY IS THE PRODUCT.</span>
        <h2>
          Unsafe upgrades
          <br />
          stop here<span>.</span>
        </h2>
        <div className="cta-row">
          <Link className="button dark" data-magnetic to="/app">
            Launch Faultline <ArrowUpRight size={18} />
          </Link>
          <Link className="text-link" to="/docs">
            Read the architecture <ArrowRight size={16} />
          </Link>
        </div>
        <img
          src="/guard-aperture.svg"
          loading="lazy"
          width="1400"
          height="1000"
          alt="The Guard boundary protects the program core."
        />
      </section>
    </div>
  );
}
