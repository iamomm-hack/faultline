import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { SiteShell } from './components/SiteShell';
import { MotionProvider } from './motion/system';
import Landing from './pages/Landing';
import { ProtocolProvider } from './protocol/ProtocolProvider';
import { BootSignal } from './motion/BootSignal';
const Product = lazy(() => import('./pages/Product'));
export function App() {
  return (
    <ProtocolProvider>
      <MotionProvider>
        <BootSignal />
        <SiteShell>
          <Suspense
            fallback={
              <div className="route-loading" role="status">
                Loading Faultline…
              </div>
            }
          >
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="*" element={<Product />} />
            </Routes>
          </Suspense>
        </SiteShell>
      </MotionProvider>
    </ProtocolProvider>
  );
}
