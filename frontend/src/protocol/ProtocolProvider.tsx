import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  demoExamples,
  newRun,
  recordFor,
  type Candidate,
  type DemoRun,
  type ProposalRecord,
} from './model';
type Mode = 'demo' | 'rpc';
interface ProtocolContextValue {
  mode: Mode;
  setMode: (mode: Mode) => void;
  records: ProposalRecord[];
  run: DemoRun;
  setRun: (run: DemoRun) => void;
  reset: (candidate: Candidate) => void;
  loading: boolean;
  error: string;
  refresh: () => void;
  connected: boolean;
}
const Context = createContext<ProtocolContextValue | null>(null);
export function ProtocolProvider({ children }: { children: ReactNode }) {
  const [mode, changeMode] = useState<Mode>('demo'),
    [run, setRun] = useState(newRun()),
    [rpcRecords, setRpcRecords] = useState<ProposalRecord[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [connected, setConnected] = useState(false);
  const request = useRef(0);
  const load = async () => {
    const id = ++request.current;
    setLoading(true);
    setError('');
    setRpcRecords([]);
    setConnected(false);
    try {
      const { readProtocol } = await import('./rpc-adapter');
      const result = await readProtocol();
      if (id === request.current) {
        setRpcRecords(result);
        setConnected(true);
      }
    } catch (e) {
      if (id === request.current)
        setError(e instanceof Error ? e.message : 'RPC read failed');
    } finally {
      if (id === request.current) setLoading(false);
    }
  };
  const setMode = (next: Mode) => {
    changeMode(next);
    if (next === 'rpc') void load();
    else {
      request.current++;
      setLoading(false);
      setError('');
      setConnected(false);
      setRpcRecords([]);
    }
  };
  const reset = useCallback((c: Candidate) => setRun(newRun(c)), []);
  const examples = demoExamples();
  const records =
    mode === 'rpc'
      ? rpcRecords
      : run.step
        ? examples.map((p) =>
            p.candidate === run.candidate ? recordFor(run) : p,
          )
        : examples;
  return (
    <Context.Provider
      value={{
        mode,
        setMode,
        records,
        run,
        setRun,
        reset,
        loading,
        error,
        refresh: () => {
          if (mode === 'rpc') void load();
        },
        connected,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useProtocol() {
  const value = useContext(Context);
  if (!value) throw new Error('ProtocolProvider missing');
  return value;
}
