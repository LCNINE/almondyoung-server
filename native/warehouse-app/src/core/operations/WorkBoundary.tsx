import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useIsAuthenticated, useSession } from '../../app/session-context';
import { useWorkRuntime } from './OperationContext';
import { workStatus } from './workStatus';
import { Button } from '../design/Button';

const AreaContext = createContext({ paths: [] as string[], problem: false });
export function WorkArea({
  kind,
  children,
}: {
  kind: string;
  children: ReactNode;
}) {
  const state = useContext(AreaContext);
  const blocked =
    state.problem ||
    state.paths.some((path) =>
      kind === 'inbound'
        ? path.startsWith('/inbound/') || path.startsWith('/purchase-orders/')
        : kind === 'outbound'
          ? path.startsWith('/shipments/')
          : kind === 'adjust'
            ? path.startsWith('/inventory/stocks/adjust')
            : path.startsWith(`/${kind}/`)
    );
  return <div inert={blocked || undefined}>{children}</div>;
}
export function WorkBoundary({ children }: { children: ReactNode }) {
  const runtime = useWorkRuntime();
  if (!runtime) return children;
  return <ActiveBoundary runtime={runtime}>{children}</ActiveBoundary>;
}
function ActiveBoundary({
  runtime,
  children,
}: {
  runtime: NonNullable<ReturnType<typeof useWorkRuntime>>;
  children: ReactNode;
}) {
  const authed = useIsAuthenticated();
  const session = useSession();
  const ops = useSyncExternalStore(
    runtime.runner.subscribe,
    runtime.runner.getSnapshot
  );
  const [now, setNow] = useState(Date.now());
  const [problem, setProblem] = useState(false);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    if (!authed) return;
    let live = true;
    void runtime.runner.restore().catch(() => {
      if (live) setProblem(true);
    });
    return () => {
      live = false;
    };
  }, [runtime, authed]);
  useEffect(() => {
    if (!ops.length) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    const guard = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', guard);
    return () => {
      clearInterval(timer);
      window.removeEventListener('beforeunload', guard);
    };
  }, [ops.length]);
  useEffect(() => {
    if (!authed) return;
    const resume = () => {
      void runtime.runner.retryPending().catch(() => setProblem(true));
    };
    window.addEventListener('online', resume);
    return () => window.removeEventListener('online', resume);
  }, [runtime, authed]);
  const state = workStatus(authed ? ops : [], now);
  const blocked = authed && (state.blocksWork || problem);
  return (
    <AreaContext.Provider
      value={{
        paths: authed ? ops.map((o) => o.path) : [],
        problem: authed && problem,
      }}
    >
      {children}
      {blocked && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center pointer-events-none p-4">
          {(state.message || problem) && (
            <section
              role="status"
              className="pointer-events-auto max-w-lg rounded-lg border bg-white p-4 shadow-lg"
            >
              <p>
                {problem
                  ? '작업 저장소나 서버 연결을 확인하지 못했어요. 연결을 확인해 주세요.'
                  : state.message}
              </p>
              <Button
                disabled={checking}
                className="mt-2"
                onClick={async () => {
                  setChecking(true);
                  try {
                    await runtime.runner.retryPending();
                    setProblem(false);
                  } catch {
                    setProblem(true);
                  } finally {
                    setChecking(false);
                  }
                }}
              >
                처리 내역 확인
              </Button>
              <Button
                className="ml-2 mt-2"
                onClick={() => void session.logout()}
              >
                다시 로그인
              </Button>
            </section>
          )}
        </div>
      )}
    </AreaContext.Provider>
  );
}
