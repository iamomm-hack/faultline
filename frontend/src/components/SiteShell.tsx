import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ArrowUpRight, Menu, X, Pause, Play } from 'lucide-react';
import { useMotion } from '../motion/system';
import { useProtocol } from '../protocol/ProtocolProvider';
export function SiteShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false),
    [compressed, setCompressed] = useState(false);
  const { enabled, toggle } = useMotion();
  const { pathname } = useLocation();
  const { mode, connected } = useProtocol();
  useEffect(() => {
    const scroll = () => setCompressed(window.scrollY > 50);
    window.addEventListener('scroll', scroll, { passive: true });
    return () => window.removeEventListener('scroll', scroll);
  }, []);
  useEffect(() => {
    document.title =
      pathname === '/'
        ? 'Faultline — Safety claims. Enforced.'
        : `${pathname.startsWith('/demo') ? 'Interactive demo' : pathname.startsWith('/docs') ? 'Architecture' : pathname.startsWith('/proposals') ? 'Proposals' : 'Control plane'} — Faultline`;
  }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        document.getElementById('menu-toggle')?.focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [open]);
  const close = () => setOpen(false);
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className={`site-header ${compressed ? 'compressed' : ''}`}>
        <Link to="/" className="wordmark" aria-label="Faultline home">
          FAULTLINE
        </Link>
        <nav
          aria-label="Main navigation"
          id="main-navigation"
          className={open ? 'is-open' : ''}
        >
          <Link onClick={close} to="/#protocol">
            Protocol
          </Link>
          <Link onClick={close} to="/#how-it-works">
            How it works
          </Link>
          <Link onClick={close} to="/#evidence">
            Evidence
          </Link>
          <NavLink onClick={close} to="/demo">
            Demo
          </NavLink>
          <NavLink onClick={close} to="/docs">
            Docs
          </NavLink>
        </nav>
        <div className="nav-end">
          <span className="mode-indicator">
            <i />{' '}
            {mode === 'demo'
              ? 'DEMO MODE'
              : connected
                ? 'RPC CONNECTED'
                : 'RPC UNAVAILABLE'}
          </span>
          <Link className="button launch" to="/app">
            Launch App <ArrowUpRight size={15} />
          </Link>
          <button
            id="menu-toggle"
            className="menu-toggle"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-controls="main-navigation"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X /> : <Menu />}
          </button>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        {children}
      </main>
      <footer className="site-footer">
        <div className="footer-top">
          <Link to="/" className="wordmark">
            FAULTLINE
          </Link>
          <p>Building upgrade gates for Solana.</p>
          <button
            className="motion-toggle"
            onClick={toggle}
            aria-pressed={!enabled}
          >
            {enabled ? <Pause size={13} /> : <Play size={13} />} Motion{' '}
            {enabled ? 'on' : 'off'}
          </button>
        </div>
        <div className="footer-bottom">
          <span>© 2026 FAULTLINE</span>
          <span>PROTOTYPE / NO PRODUCTION SECURITY CLAIM</span>
          <Link to="/docs">
            Architecture <ArrowUpRight size={12} />
          </Link>
        </div>
      </footer>
    </>
  );
}
