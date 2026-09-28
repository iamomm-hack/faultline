import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  RotateCcw,
  Search,
  List,
  LayoutGrid,
} from 'lucide-react';
import { useProtocol } from '../protocol/ProtocolProvider';
import {
  advanceRun,
  demoSteps,
  evidence,
  recordFor,
  type Candidate,
  type ProposalRecord,
} from '../protocol/model';
import { CopyValue } from './Landing';
import { SdkEvidence } from '../components/SdkEvidence';
import { ArchitectureDiagram, ReceiptDiagram } from '../visuals/Diagrams';
import { Photo, type PhotoName } from '../visuals/Photo';

function PageTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  const image: PhotoName = eyebrow.startsWith('PROPOSAL /')
    ? 'receipts'
    : title === 'Proposal explorer'
      ? 'alloy'
      : title === 'Protocol overview'
        ? 'infrastructure'
        : title === 'Authority with conditions.'
          ? 'monument'
          : 'passage';
  return (
    <div className="product-heading environmental-heading">
      <Photo
        name={image}
        className="product-environment"
        sizes="(max-width: 767px) 100vw, 55vw"
      />
      <div>
        <span className="mono">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
function Badge({ status }: { status: string }) {
  return (
    <span className={`status-badge status-${status.toLowerCase()}`}>
      {status === 'Rejected' || status === 'VIOLATION'
        ? '×'
        : status === 'HOLD'
          ? '—'
          : status === 'Executed'
            ? '↗'
            : '○'}{' '}
      {status}
    </span>
  );
}
function Notice() {
  const { mode, connected } = useProtocol();
  return (
    <div className="mode-notice">
      <span className="label">
        {mode === 'demo'
          ? 'DEMO SIMULATION'
          : connected
            ? 'RPC CONNECTED'
            : 'RPC MODE'}
      </span>
      <p>
        {mode === 'demo'
          ? 'Deterministic local state. No wallet, validator or transaction broadcast. Checkpoint 5 v3 execution is simulated.'
          : connected
            ? 'Accounts decoded through the committed SDK and IDL on the configured chain. Read-only access.'
            : 'Configured endpoint only. Unavailable data is never replaced with demo records.'}
      </p>
    </div>
  );
}
function DataBoundary({ children }: { children: ReactNode }) {
  const { loading, error, refresh, records } = useProtocol();
  if (loading)
    return (
      <div
        className="loading-state"
        role="status"
        aria-label="Loading chain accounts"
      >
        <span>Reading configured chain and decoding protocol accounts…</span>
        {[1, 2, 3].map((i) => (
          <i key={i} />
        ))}
      </div>
    );
  if (error)
    return (
      <div className="error-panel" role="alert">
        <span className="mono">CONNECTION UNAVAILABLE</span>
        <h2>No chain data loaded.</h2>
        <p>{error}</p>
        <button className="button" onClick={refresh}>
          Retry connection <RotateCcw size={14} />
        </button>
      </div>
    );
  if (!records.length)
    return (
      <div className="empty-state">
        <h2>No proposals found.</h2>
        <p>The configured chain returned no Faultline proposal accounts.</p>
        <button className="button" onClick={refresh}>
          Refresh accounts
        </button>
      </div>
    );
  return <>{children}</>;
}
function ProposalTable({
  records,
  expanded = false,
}: {
  records: ProposalRecord[];
  expanded?: boolean;
}) {
  return (
    <div className={`proposal-table ${expanded ? 'expanded' : ''}`}>
      <div className="table-head">
        <span>PROPOSAL / CANDIDATE</span>
        <span>DECISION</span>
        <span>ATTESTATIONS</span>
        <span>EXECUTION</span>
        <span />
      </div>
      {records.map((p) => (
        <Link key={p.id} to={`/proposals/${p.id}`} className="proposal-row">
          <div>
            <strong>Treasury / {p.candidate}</strong>
            <small>
              {p.id.length > 28
                ? `${p.id.slice(0, 12)}…${p.id.slice(-8)}`
                : p.id}
            </small>
            {expanded && <code>{p.payload}</code>}
          </div>
          <Badge status={p.status} />
          <span className="table-attestations">
            {p.attestations}{' '}
            <small>{p.source === 'demo' ? '/ 3' : 'votes'}</small>
          </span>
          <span className="table-eligibility">
            {p.status === 'Rejected'
              ? 'Blocked'
              : p.status === 'HOLD'
                ? 'Awaiting approval'
                : p.status === 'Executed'
                  ? 'Completed'
                  : 'Not executed'}
          </span>
          <ArrowUpRight size={17} />
        </Link>
      ))}
    </div>
  );
}
function Dashboard() {
  const { records, mode } = useProtocol();
  const metrics = [
    ['Proposals', records.length],
    ['Active rounds', records.filter((p) => p.status === 'Pending').length],
    ['Rejected', records.filter((p) => p.status === 'Rejected').length],
    ['Awaiting approval', records.filter((p) => p.status === 'HOLD').length],
  ];
  return (
    <>
      <PageTitle
        eyebrow="CONTROL PLANE / 01"
        title="Protocol overview"
        description="Follow the candidate. Inspect the evidence. Understand the authority."
        action={
          <Link className="button light" to="/demo">
            Run interactive demo <ArrowUpRight size={16} />
          </Link>
        }
      />
      <Notice />
      <DataBoundary>
        <div className="protocol-metrics">
          {metrics.map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{String(value).padStart(2, '0')}</strong>
              <small>
                {mode === 'demo' ? 'LOCAL DEMO' : 'CONFIGURED CHAIN'}
              </small>
            </div>
          ))}
        </div>
        <section className="dashboard-status">
          <div>
            <span className="mono">GUARDED EXECUTION</span>
            <h2>
              Evidence first.
              <br />
              Authority held.
            </h2>
            <p>
              {records.filter((p) => p.status === 'Approved').length} approved
              candidates. HOLD does not satisfy execution eligibility.
            </p>
            <Link className="text-link" to="/docs">
              Understand the boundary <ArrowRight size={15} />
            </Link>
          </div>
          <ReceiptDiagram variant="array" />
        </section>
        <div className="panel-heading">
          <h2>Recent proposals</h2>
          <Link to="/proposals">
            View explorer <ArrowUpRight size={14} />
          </Link>
        </div>
        <ProposalTable records={records} />
        <div className="product-two">
          <section className="product-panel">
            <span className="mono">RECENT DECISIONS</span>
            {records.map((p) => (
              <div className="summary-row" key={p.id}>
                <span>Treasury {p.candidate}</span>
                <Badge status={p.status} />
              </div>
            ))}
          </section>
          <section className="product-panel">
            <span className="mono">SETTLEMENT SUMMARY</span>
            {records.map((p) => (
              <div className="settlement-row" key={p.id}>
                <strong>{p.candidate}</strong>
                <p>{p.settlement}</p>
              </div>
            ))}
          </section>
        </div>
      </DataBoundary>
    </>
  );
}
function Explorer() {
  const { records } = useProtocol();
  const [query, setQuery] = useState(''),
    [filter, setFilter] = useState('All'),
    [expanded, setExpanded] = useState(false);
  const filters = [
    'All',
    'Pending',
    'VIOLATION',
    'HOLD',
    'Approved',
    'Executed',
    'Rejected',
  ];
  const filtered = records.filter(
    (p) =>
      (filter === 'All' ||
        p.status === filter ||
        (filter === 'VIOLATION' && p.status === 'Rejected')) &&
      [p.id, p.candidate, p.target, p.buffer ?? '', p.payload].some((v) =>
        v.toLowerCase().includes(query.toLowerCase()),
      ),
  );
  return (
    <>
      <PageTitle
        eyebrow="CONTROL PLANE / 02"
        title="Proposal explorer"
        description="Every candidate, its evidence and its path to a decision."
        action={
          <Link className="button light" to="/demo">
            Open a demo proposal <ArrowUpRight size={16} />
          </Link>
        }
      />
      <Notice />
      <div className="explorer-tools">
        <label className="search-field">
          <Search size={16} />
          <span className="sr-only">Search proposals</span>
          <input
            placeholder="Search proposal, program or public key"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button
          className="button"
          aria-pressed={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <List size={16} /> : <LayoutGrid size={16} />}{' '}
          {expanded ? 'Compact view' : 'Expanded view'}
        </button>
      </div>
      <div
        className="filter-row"
        role="group"
        aria-label="Filter by proposal status"
      >
        {filters.map((f) => (
          <button
            className={f === filter ? 'active' : ''}
            aria-pressed={f === filter}
            onClick={() => setFilter(f)}
            key={f}
          >
            {f}
          </button>
        ))}
      </div>
      <DataBoundary>
        {filtered.length ? (
          <ProposalTable records={filtered} expanded={expanded} />
        ) : (
          <div className="empty-state">
            <h2>No matching proposals.</h2>
            <p>Try a different status or search term.</p>
            <button
              className="button"
              onClick={() => {
                setFilter('All');
                setQuery('');
              }}
            >
              Clear filters
            </button>
          </div>
        )}
      </DataBoundary>
    </>
  );
}
function Field({
  label,
  value,
  copy = false,
}: {
  label: string;
  value?: string;
  copy?: boolean;
}) {
  const { mode } = useProtocol();
  return (
    <div className="record-field">
      <dt>{label}</dt>
      <dd>
        {value ? (
          copy ? (
            <CopyValue value={value} label={label} />
          ) : (
            value
          )
        ) : (
          <span className="muted">
            Not available in this{' '}
            {mode === 'demo' ? 'committed vector' : 'account snapshot'}
          </span>
        )}
      </dd>
    </div>
  );
}
function Detail() {
  const { proposalId } = useParams();
  const { records, mode } = useProtocol();
  const p = records.find((r) => r.id === proposalId);
  const [derived, setDerived] = useState('');
  const target = p?.target;
  useEffect(() => {
    let mounted = true;
    if (target)
      void import('@faultline/sdk')
        .then((sdk) => {
          if (mounted) setDerived(sdk.deriveGuard(target)[0].toBase58());
        })
        .catch(() => {
          if (mounted) setDerived('');
        });
    return () => {
      mounted = false;
    };
  }, [target]);
  return (
    <>
      <Link className="back-link" to="/proposals">
        <ArrowLeft size={14} /> Proposal explorer
      </Link>
      <DataBoundary>
        {p ? (
          <>
            <PageTitle
              eyebrow={`PROPOSAL / ${p.source === 'demo' ? 'DEMO SIMULATION' : 'RPC ACCOUNT'}`}
              title={`Treasury / ${p.candidate}`}
              description="Candidate-bound evidence and guarded authority."
              action={<Badge status={p.status} />}
            />
            <Notice />
            <div
              className={`decision-banner ${p.status === 'Rejected' ? 'hatched' : ''}`}
            >
              <span className="mono">EXECUTION ELIGIBILITY</span>
              <h2>{p.eligibility}</h2>
              <p>
                {p.status === 'HOLD'
                  ? 'A preserved trace is a non-approving result. Separate governance approval is still required.'
                  : p.status === 'Rejected'
                    ? 'The rejected candidate cannot pass the Guard. This outcome is terminal.'
                    : 'Approval and eligibility are distinct from replay preservation.'}
              </p>
            </div>
            <div className="detail-layout">
              <section>
                <div className="panel-heading">
                  <h2>Bound evidence</h2>
                  <span className="mono">EXACT VALUES</span>
                </div>
                <dl className="record-fields">
                  <Field label="Target program" value={p.target} copy />
                  <Field
                    label="Guard PDA · SDK derived"
                    value={p.guard ?? derived}
                    copy
                  />
                  <Field
                    label="Candidate loader buffer"
                    value={p.buffer}
                    copy
                  />
                  <Field
                    label="Executable payload SHA-256"
                    value={p.payload}
                    copy
                  />
                  <Field
                    label="Invariant · AUTH-001"
                    value={p.invariant}
                    copy
                  />
                  <Field label="Trace claim" value={p.trace} copy />
                  <Field label="Verifier epoch" value={p.epoch} copy />
                  <Field label="Verification round" value={p.round} copy />
                  <Field
                    label={
                      mode === 'demo'
                        ? 'Replay receipt · format vector'
                        : 'Replay receipt'
                    }
                    value={p.receipt}
                    copy
                  />
                  <Field
                    label={
                      mode === 'demo'
                        ? 'Result commitment · original HOLD vector'
                        : 'Result commitment'
                    }
                    value={p.commitment}
                    copy
                  />
                </dl>
                {mode === 'demo' && (
                  <p className="provenance-note">
                    The committed format vector uses HOLD even for its v2 input.
                    It is displayed unchanged and does not substantiate the
                    simulated VIOLATION above. Buffer and epoch addresses are
                    not present in this vector; none are fabricated.
                  </p>
                )}
              </section>
              <aside>
                <section className="product-panel">
                  <span className="mono">
                    VERIFIER OUTPUTS / {p.attestations} ATTESTATIONS
                  </span>
                  <div className="worker-list">
                    {p.workers.map((w) => (
                      <div key={w.id}>
                        <span>{w.id}</span>
                        <strong>{w.output}</strong>
                        {w.identity ? (
                          <CopyValue
                            value={w.identity}
                            label={`${w.id} identity`}
                          />
                        ) : (
                          <small>
                            Identity not supplied in committed vector
                          </small>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
                <section className="product-panel">
                  <span className="mono">ECONOMIC STATE</span>
                  <p>{p.settlement}</p>
                </section>
                <section className="product-panel">
                  <span className="mono">TRANSACTION SIGNATURES</span>
                  <p>
                    {p.signatures.length
                      ? p.signatures.join('\n')
                      : mode === 'demo'
                        ? 'No transactions broadcast. No signatures generated.'
                        : 'Not included in this account snapshot. Account state is not a transaction receipt.'}
                  </p>
                </section>
              </aside>
            </div>
            {mode === 'demo' && <SdkEvidence candidate={p.candidate} />}
            <section className="product-panel">
              <span className="mono">PROPOSAL TIMELINE</span>
              <ol className="proposal-timeline">
                {p.timeline.map((t, i) => (
                  <li key={`${i}-${t}`}>
                    <span>{String(i + 1).padStart(2, '0')}</span>
                    {t}
                  </li>
                ))}
              </ol>
            </section>
            <Link
              className="button light"
              to={`/demo?candidate=${p.candidate === 'v3' ? 'v3' : 'v2'}`}
            >
              Replay this scenario <ArrowRight size={16} />
            </Link>
          </>
        ) : (
          <div className="empty-state">
            <h1>Proposal not found.</h1>
            <p>The selected mode has no record with this identifier.</p>
            <Link className="button" to="/proposals">
              Back to explorer
            </Link>
          </div>
        )}
      </DataBoundary>
    </>
  );
}
function Demo() {
  const { run, setRun, reset, mode, setMode } = useProtocol();
  const [params] = useSearchParams();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initial = useRef(false);
  useEffect(() => {
    if (!initial.current) {
      initial.current = true;
      const c = params.get('candidate');
      if (c === 'v2' || c === 'v3') reset(c);
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [params, reset]);
  const p = recordFor(run);
  const terminal = run.step >= (run.candidate === 'v2' ? 7 : 10);
  const next = () => {
    setError('');
    try {
      if (run.step === 8) {
        setBusy(true);
        timer.current = setTimeout(() => {
          setRun(advanceRun(run));
          setBusy(false);
        }, 1200);
      } else setRun(advanceRun(run));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transition failed');
    }
  };
  const restart = (c: Candidate) => {
    if (timer.current) clearTimeout(timer.current);
    setBusy(false);
    setError('');
    reset(c);
  };
  return (
    <>
      <PageTitle
        eyebrow="INTERACTIVE DEMO / AUTH-001"
        title="See the boundary work."
        description="One exploit trace. Two candidates. Follow every decision."
        action={
          <button className="button" onClick={() => restart(run.candidate)}>
            <RotateCcw size={15} /> Reset demo
          </button>
        }
      />
      <Notice />
      {mode === 'rpc' ? (
        <div className="empty-state">
          <h2>The demo runs locally.</h2>
          <p>
            Switch to Demo Mode to run the simulation. No RPC transactions will
            be submitted.
          </p>
          <button className="button light" onClick={() => setMode('demo')}>
            Switch to Demo Mode
          </button>
        </div>
      ) : (
        <>
          <div
            className="candidate-select"
            role="group"
            aria-label="Select candidate"
          >
            {(['v2', 'v3'] as const).map((c) => (
              <button
                key={c}
                aria-pressed={run.candidate === c}
                className={run.candidate === c ? 'selected' : ''}
                onClick={() => restart(c)}
              >
                <span className="mono">CANDIDATE / {c.toUpperCase()}</span>
                <strong>
                  {c === 'v2' ? 'Vulnerable executable' : 'Patched executable'}
                </strong>
                <small>
                  {c === 'v2'
                    ? 'Violation → terminal rejection'
                    : 'Preserved → HOLD → separate approval'}
                </small>
                <ArrowUpRight size={18} />
              </button>
            ))}
          </div>
          <div className="demo-workspace">
            <section className="demo-control">
              <div className="demo-step-meta">
                <span className="mono">
                  STEP{' '}
                  {String(
                    Math.min(run.step + 1, run.candidate === 'v2' ? 7 : 10),
                  ).padStart(2, '0')}{' '}
                  / {run.candidate === 'v2' ? '07' : '10'}
                </span>
                <Badge status={p.status} />
              </div>
              <h2>
                {terminal
                  ? run.candidate === 'v2'
                    ? 'Candidate rejected.\nBoundary intact.'
                    : 'Guarded execution.\nSimulated.'
                  : demoSteps[run.step]}
              </h2>
              <p>
                {run.step === 0
                  ? 'Bind the exact executable and AUTH-001 trace before replay begins.'
                  : run.step < 4
                    ? 'Each worker returns a deterministic local result for the selected candidate.'
                    : run.step === 4
                      ? 'All three worker outputs must agree before attestations are submitted.'
                      : run.step === 5
                        ? 'VIOLATION rejects the proposal. A preserved trace produces HOLD.'
                        : run.step === 6
                          ? 'Settle the scenario economics without changing execution authority.'
                          : run.step === 7
                            ? 'HOLD remains blocked. This button performs a separate simulated governance action.'
                            : run.step === 8
                              ? 'Wait for the demonstration eligibility delay. This timer represents conditions; it is not a chain slot proof.'
                              : 'The protected treasury state remains unchanged. No on-chain transaction is sent.'}
              </p>
              <div className="demo-gate" data-stage={run.step}>
                <span
                  className={
                    run.step >= 6 && run.candidate === 'v2'
                      ? 'candidate-blocked'
                      : ''
                  }
                >
                  CANDIDATE
                  <br />
                  <strong>{run.candidate}</strong>
                </span>
                <i className={run.step >= 9 ? 'gate-open' : ''}>
                  <span>GUARD</span>
                </i>
                <span>
                  TREASURY
                  <br />
                  <strong>INTACT</strong>
                </span>
              </div>
              <button
                className="button light"
                onClick={next}
                disabled={terminal || busy}
              >
                {busy
                  ? 'Waiting for eligibility…'
                  : terminal
                    ? 'Scenario complete'
                    : demoSteps[run.step]}{' '}
                {!terminal && <ArrowRight size={16} />}
              </button>
              {error && (
                <p role="alert" className="error-inline">
                  {error}
                </p>
              )}
              <p role="status" className="demo-announcement">
                {busy
                  ? 'Execution remains blocked during the delay.'
                  : run.step
                    ? `${run.step} transitions completed. ${p.eligibility}.`
                    : 'Ready. Select a candidate and bind its executable.'}
              </p>
            </section>
            <aside className="demo-workers">
              <div className="panel-heading">
                <h2>Three replay workers</h2>
                <span className="mono">LOCAL SIMULATION</span>
              </div>
              {p.workers.map((w, i) => (
                <div className="demo-worker" key={w.id}>
                  <span className="worker-number">0{i + 1}</span>
                  <div>
                    <strong>{w.id}</strong>
                    <small>{w.output}</small>
                  </div>
                  <span>
                    {w.output === 'Pending' ? (
                      '—'
                    ) : w.output === 'Runner fault' ? (
                      '×'
                    ) : (
                      <Check size={16} />
                    )}
                  </span>
                </div>
              ))}
              <div className="demo-consensus">
                <span>Attestations submitted</span>
                <strong>{p.attestations} / 3</strong>
              </div>
              <label className="divergence-toggle">
                <input
                  type="checkbox"
                  checked={run.divergent}
                  disabled={run.step > 0}
                  onChange={(e) =>
                    setRun({ ...run, divergent: e.target.checked })
                  }
                />
                <span>
                  Simulate a worker fault
                  <br />
                  <small>Set before binding to test disagreement.</small>
                </span>
              </label>
              <p className="provenance-note">
                Three workers do not imply three independent trust domains. The
                demonstration does not execute a VM.
              </p>
            </aside>
          </div>
          <ol className="demo-timeline">
            {demoSteps
              .slice(0, run.candidate === 'v2' ? 7 : 10)
              .map((step, i) => (
                <li
                  key={step}
                  className={
                    i < run.step ? 'done' : i === run.step ? 'current' : ''
                  }
                  aria-current={i === run.step ? 'step' : undefined}
                >
                  <span>
                    {i < run.step ? (
                      <Check size={13} />
                    ) : (
                      String(i + 1).padStart(2, '0')
                    )}
                  </span>
                  <strong>{step}</strong>
                </li>
              ))}
          </ol>
          <div className="product-two">
            <section className="product-panel">
              <span className="mono">BOUND EXECUTABLE / COMMITTED VALUE</span>
              <CopyValue label="Candidate executable" value={p.payload} />
              <Link className="text-link" to={`/proposals/${p.id}`}>
                Inspect proposal details <ArrowUpRight size={15} />
              </Link>
            </section>
            <section className="product-panel">
              <span className="mono">SETTLEMENT</span>
              <p>{p.settlement}</p>
              <p className="provenance-note">
                No balances or signatures are represented as chain data.
              </p>
            </section>
          </div>
        </>
      )}
    </>
  );
}
function Docs() {
  return (
    <>
      <PageTitle
        eyebrow="PROTOCOL / TECHNICAL NOTES"
        title="Authority with conditions."
        description="What Faultline binds, what replay establishes, and where trust remains."
      />
      <div className="docs-intro">
        <p>
          Faultline places a Guard PDA on the Solana loader-v3 upgrade path. A
          proposal binds candidate bytes and policy. A frozen verification round
          ties the candidate to a declared invariant, a revealed trace and a
          verifier epoch.
        </p>
        <p>
          Replay receipts are evidence for that exact job. Matching worker
          attestations inform the decision. A VIOLATION rejects; HOLD is
          explicitly non-approving.
        </p>
      </div>
      <div className="paper docs-architecture">
        <ArchitectureDiagram />
      </div>
      <div className="docs-grid">
        <nav aria-label="Documentation sections">
          <a href="#binding">01 / Binding</a>
          <a href="#decisions">02 / Decisions</a>
          <a href="#provenance">03 / Evidence provenance</a>
          <a href="#trust">04 / Trust boundaries</a>
          <a href="#rpc">05 / RPC configuration</a>
        </nav>
        <div>
          <section id="binding">
            <span className="mono">01 / BINDING</span>
            <h2>Exact bytes. Exact context.</h2>
            <p>
              The candidate executable digest is the SHA-256 of the loader-v3
              executable payload, not the full buffer account. BufferClaim and
              the Guard authority constrain the candidate address and its
              passage. The frontend uses the committed SDK for PDA derivation
              and account decoding.
            </p>
          </section>
          <section id="decisions">
            <span className="mono">02 / DECISIONS</span>
            <h2>HOLD is not approval.</h2>
            <p>
              Preserved means the declared invariant held for the replayed
              trace. It does not prove universal safety. Governance approval is
              a separate action, and guarded execution still requires the
              protocol’s eligibility conditions. The v3 approval and execution
              walkthrough is DEMO SIMULATION; it does not claim Checkpoint 5
              completion.
            </p>
          </section>
          <section id="provenance">
            <span className="mono">03 / EVIDENCE PROVENANCE</span>
            <h2>Read the scope of the receipt.</h2>
            <p>
              Displayed fixture hashes come directly from committed
              manifests/checkpoint-1-vectors.json. That file declares:
              “Format-only receipt and worker vectors; not VM execution
              evidence.” Both original worker vectors contain Preserved/HOLD.
              The demo’s v2 rejection is a scenario, not a claim about those
              format-only outputs.
            </p>
            <p>
              Only one public verifier identity is supplied in that vector.
              Workers 02 and 03 remain named simulation roles; no public keys,
              transaction signatures, buffer addresses or epochs are invented.
            </p>
            <CopyValue
              label="Committed verifier identity"
              value={evidence.unsigned_worker_outputs[0].verifier_pubkey}
            />
          </section>
          <section id="trust">
            <span className="mono">04 / TRUST BOUNDARIES</span>
            <h2>Deterministic does not mean infallible.</h2>
            <p>
              Common-mode VM risk remains. Workers share runtime implementation
              and current host-isolation assumptions. Multiple processes are not
              independent Byzantine trust domains. Faultline makes no production
              Byzantine-security, audit, mainnet usage or universal safety
              claim.
            </p>
            <p>
              The Guard protects the upgrade boundary. It does not establish the
              absence of every bug, economic attack, malicious governance action
              or unsupported environment behavior.
            </p>
          </section>
          <section id="rpc">
            <span className="mono">05 / RPC CONFIGURATION</span>
            <h2>Explicit connection. Honest failure.</h2>
            <p>
              Configure the public frontend environment variables below before
              starting the app. The expected genesis hash must match the
              endpoint. Never place a private credential in browser
              configuration.
            </p>
            <pre>
              VITE_FAULTLINE_RPC_URL
              <br />
              VITE_FAULTLINE_GENESIS_HASH
            </pre>
            <p>
              RPC Mode reads actual program accounts and validates owner,
              account discriminator and layout using @faultline/sdk and the
              committed IDLs. Transport, genesis and decoding failures are
              displayed. A successful connection with no proposals produces an
              empty state. This frontend does not sign or broadcast
              transactions.
            </p>
            <Link className="button light" to="/app">
              Open connection controls <ArrowUpRight size={16} />
            </Link>
          </section>
        </div>
      </div>
    </>
  );
}
function ResearcherRedirect() {
  const { proposalId } = useParams();
  return <Navigate to={`/proposals/${proposalId}`} replace />;
}
export default function Product() {
  const { mode, setMode, connected } = useProtocol();
  return (
    <div className="product-shell">
      <div className="product-nav">
        <nav aria-label="Application navigation">
          <NavLink to="/app">Overview</NavLink>
          <NavLink to="/proposals" end>
            Proposals
          </NavLink>
          <NavLink to="/demo">Interactive demo</NavLink>
          <NavLink to="/docs">Architecture</NavLink>
        </nav>
        <label className="mode-select">
          <span>{connected ? 'RPC CONNECTED' : 'DATA SOURCE'}</span>
          <select
            aria-label="Data source"
            value={mode}
            onChange={(e) => setMode(e.target.value as 'demo' | 'rpc')}
          >
            <option value="demo">Demo Mode</option>
            <option value="rpc">RPC Mode</option>
          </select>
        </label>
      </div>
      <div className="product-content">
        <Routes>
          <Route path="/app" element={<Dashboard />} />
          <Route path="/proposals" element={<Explorer />} />
          <Route
            path="/proposals/new"
            element={<Navigate to="/demo" replace />}
          />
          <Route
            path="/researcher/:proposalId"
            element={<ResearcherRedirect />}
          />
          <Route path="/proposals/:proposalId" element={<Detail />} />
          <Route path="/demo" element={<Demo />} />
          <Route path="/docs" element={<Docs />} />
          <Route
            path="*"
            element={
              <div className="empty-state">
                <h1>Page not found.</h1>
                <Link className="button" to="/">
                  Return to Faultline
                </Link>
              </div>
            }
          />
        </Routes>
      </div>
    </div>
  );
}
