import {
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useNavigate, useRouter, useRouterState } from '@tanstack/react-router';
import { activeTabOf } from '../../station/tabs';
import type { PendingWorkPath } from './pendingWork';
import { useIsAuthenticated, useSession } from '../../app/session-context';
import { useWorkRuntime } from './OperationContext';
import { workStatus } from './workStatus';
import { Button } from '../design/Button';
import { useWorkReadiness } from './useWorkReadiness';
import { AreaContext, type WorkNavigator } from './workArea';
import { isBoxCheck, shipmentOf, useBoxChecksHosted } from './boxChecks';
import { BoxChecks } from './BoxCheckList';
import { useDeviceWorkReport } from './deviceWorkReport';

export interface ScanAllowance {
  path: string;
  operationId?: string;
  /** 위치 확인 출고(`location-outbound-scans`)만 — 본문의 창고·출발 위치가 지금 고른 것과 같아야 한다 */
  warehouseId?: string;
  sourceLocationId?: string;
}
const SCAN_PATH = /^\/shipments\/[^/]+\/(location|simple)-outbound-scans$/;
/**
 * A scan region can accept more inputs only for its first, normal send.
 * 출고는 박스 단위다 — `shipmentId` 를 주면 그 박스의 작업만 보고, 안 주면(목록 화면) 다른 박스의 결과 모름은 보지 않는다.
 * `boxOnly` 면 박스에 묶이지 않은 다른 작업(입고 등)도 보지 않는다 — 그 박스를 내려놓아도 되는지 볼 때.
 */
export function useWorkAreaBlocked(
  kind: string,
  scanAllowance?: ScanAllowance,
  shipmentId?: string,
  boxOnly = false
) {
  const state = useContext(AreaContext);
  if (state.problem || state.restoring) return true;
  const box = shipmentId ?? (scanAllowance && shipmentOf(scanAllowance.path));
  const operations = state.operations.filter((op) =>
    box
      ? shipmentOf(op.path) === box || (!boxOnly && !shipmentOf(op.path))
      : !isBoxCheck(op)
  );
  if (scanAllowance && operations.length) {
    return !operations.every((op) => {
      if (
        op.scope !== state.scope ||
        op.id !== scanAllowance.operationId ||
        op.path !== scanAllowance.path ||
        !SCAN_PATH.test(op.path) ||
        !['queued', 'sending'].includes(op.status) ||
        op.attempts > 1
      )
        return false;
      // 단순출고 스캔 본문(바코드·수량)엔 창고·위치가 없다 — 경로와 오퍼레이션 id 가 같으면 그 박스의 첫 전송이다
      if (op.path.endsWith('/simple-outbound-scans')) return true;
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
  return operations.some(({ path }) =>
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
  shipmentId,
  children,
}: {
  kind: string;
  scanAllowance?: ScanAllowance;
  shipmentId?: string;
  children: ReactNode;
}) {
  const blocked = useWorkAreaBlocked(kind, scanAllowance, shipmentId);
  return <div inert={blocked || undefined}>{children}</div>;
}
/** 라우터 안에 한 번 둔다. 경계는 라우터 바깥이라 남은 작업 안내가 그 작업 화면으로 가려면 이 다리가 필요하다 */
export function WorkNavigationBridge({ station }: { station: boolean }) {
  const { registerNavigator } = useContext(AreaContext);
  const navigate = useNavigate();
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    registerNavigator?.({
      pathname,
      station,
      go: async (href) => {
        // 막힌 이동은 navigate 의 약속이 끝나지 않는다 — 막는 판정(비동기)이 끝난 다음 틱에 실제 위치로 본다
        void navigate({ href });
        await new Promise((resolve) => setTimeout(resolve, 0));
        return within(router.history.location.pathname, href);
      },
    });
    return () => registerNavigator?.(null);
  }, [registerNavigator, navigate, router, pathname, station]);
  return null;
}

const within = (pathname: string, screen: string) =>
  pathname === screen || pathname.startsWith(`${screen}/`);

function screenButtonLabel(screen: PendingWorkPath, station: boolean) {
  const tab = activeTabOf(screen);
  if (!tab) return '작업 화면으로 가기';
  return station
    ? `${tab.key} ${tab.label} 화면으로 가기`
    : `${tab.label} 화면으로 가기`;
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
  const [checking, setChecking] = useState(false);
  const [navigator, setNavigator] = useState<WorkNavigator | null>(null);
  // 이동을 막은 화면 — 그 화면을 떠나거나 남은 작업이 바뀌면 지운다
  const [goBlockedAt, setGoBlockedAt] = useState<string | null>(null);
  const { state: readiness, recheck } = useWorkReadiness(runtime, authed);
  const ready = readiness.status === 'ready';
  const scope = ready ? readiness.scope : null;
  const problem = authed && readiness.status === 'failed';
  const denied = readiness.status === 'failed' && readiness.denied;
  const restoring = authed && !ready && !problem;
  const workerName = useCallback(
    async () => (await session.identity?.())?.name,
    [session]
  );
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
      void recheck();
    };
    window.addEventListener('online', resume);
    return () => window.removeEventListener('online', resume);
  }, [authed, recheck]);
  useDeviceWorkReport({
    runtime,
    operations: authed ? ops : [],
    scope: authed ? scope : null,
    station: navigator ? navigator.station : null,
    workerName,
  });
  const state = workStatus(authed ? ops : [], now);
  const blocked = authed && (state.blocksWork || problem);
  const hosted = useBoxChecksHosted();
  const screen = !problem && state.screen;
  const go =
    screen && navigator && !within(navigator.pathname, screen) ? screen : null;
  const goBlocked =
    go !== null && goBlockedAt === `${navigator?.pathname} ${go}`;
  return (
    <AreaContext.Provider
      value={{
        operations: authed ? ops : [],
        scope,
        problem: authed && problem,
        restoring: authed && restoring,
        recheck,
        registerNavigator: setNavigator,
      }}
    >
      {children}
      {authed && ready && !hosted && (
        <div className="fixed bottom-4 right-4 z-[80]">
          <BoxChecks />
        </div>
      )}
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
                {denied
                  ? '이 계정은 물류앱을 쓸 권한이 없어요. 관리자에게 요청하거나 다른 계정으로 로그인해 주세요.'
                  : problem
                    ? '작업 저장소나 서버 연결을 확인하지 못했어요. 연결을 확인해 주세요.'
                    : state.message}
              </p>
              {goBlocked && (
                <p className="mt-1 text-sm text-red-700">
                  {
                    '옮기지 못했어요. 이 화면에 저장하지 않은 입력이 있었어요 — 입력을 마치거나 지운 뒤 다시 눌러 주세요.'
                  }
                </p>
              )}
              {denied ? (
                <Button
                  className="mt-2"
                  onClick={() => void (session.signOut ?? session.logout)()}
                >
                  다른 계정으로 로그인
                </Button>
              ) : (
                <>
                  {go && (
                    <Button
                      className="mr-2 mt-2"
                      onClick={async () => {
                        const from = navigator?.pathname;
                        if (!(await navigator?.go(go)))
                          setGoBlockedAt(`${from} ${go}`);
                      }}
                    >
                      {screenButtonLabel(go, navigator?.station ?? false)}
                    </Button>
                  )}
                  <Button
                    disabled={checking}
                    className="mt-2"
                    onClick={async () => {
                      setChecking(true);
                      try {
                        await recheck();
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
                </>
              )}
            </section>
          )}
        </div>
      )}
    </AreaContext.Provider>
  );
}
