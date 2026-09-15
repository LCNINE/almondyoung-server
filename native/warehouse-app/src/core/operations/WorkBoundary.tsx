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
import type { StoredOperation } from './operationStore';

export interface ScanAllowance {
  path: string;
  operationId?: string;
  warehouseId: string;
  sourceLocationId: string;
}
const AreaContext = createContext({
  operations: [] as StoredOperation[],
  scope: null as string | null,
  problem: false,
  restoring: false,
});
/** A scan region can accept more inputs only for its first, normal send. */
export function useWorkAreaBlocked(
  kind: string,
  scanAllowance?: ScanAllowance
) {
  const state = useContext(AreaContext);
  if (state.problem || state.restoring) return true;
  if (scanAllowance && state.operations.length) {
    return !state.operations.every((op) => {
      if (
        op.scope !== state.scope ||
        op.id !== scanAllowance.operationId ||
        op.path !== scanAllowance.path ||
        !/^\/shipments\/[^/]+\/location-outbound-scans$/.test(op.path) ||
        !['queued', 'sending'].includes(op.status) ||
        op.attempts > 1
      )
        return false;
      try {
        const body = JSON.parse(op.bodyJson);
        return (
          body.warehouseId === scanAllowance.warehouseId &&
          body.sourceLocationId === scanAllowance.sourceLocationId
        );
      } catch {
        return false;
      }
    });
  }
  return state.operations.some(({ path }) =>
    kind === 'inbound'
      ? path.startsWith('/inbound/') || path.startsWith('/purchase-orders/')
      : kind === 'outbound'
        ? path.startsWith('/shipments/')
        : kind === 'adjust'
          ? path.startsWith('/inventory/stocks/adjust')
          : path.startsWith(`/${kind}/`)
  );
}
export function WorkArea({
  kind,
  scanAllowance,
  children,
}: {
  kind: string;
  scanAllowance?: ScanAllowance;
  children: ReactNode;
}) {
  const blocked = useWorkAreaBlocked(kind, scanAllowance);
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
  const [restoring, setRestoring] = useState(true);
  const [scope, setScope] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void runtime
      .getScope()
      .then((value) => {
        if (live) setScope(value);
      })
      .catch(() => {
        if (live) setProblem(true);
      });
    return () => {
      live = false;
    };
  }, [runtime, authed, ops]);
  useEffect(() => {
    if (!authed) return;
    let live = true;
    setRestoring(true);
    void runtime.runner
      .restore()
      .catch(() => {
        if (live) setProblem(true);
      })
      .finally(() => {
        if (live) setRestoring(false);
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
        operations: authed ? ops : [],
        scope,
        problem: authed && problem,
        restoring: authed && restoring,
      }}
    >
      {children}
      {authed && restoring && (
        <p role="status">
          저장된 작업을 확인하고 있어요. 잠시만 기다려 주세요.
        </p>
      )}
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
