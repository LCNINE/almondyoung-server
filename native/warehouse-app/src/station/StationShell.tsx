import { useCallback, useEffect, useMemo } from 'react';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { Wrench } from 'lucide-react';
import { useWarehouse } from '../app/warehouse-context';
import { cn } from '../core/design/cn';
import { ShellChromeContext } from '../core/design/shellChrome';
import { useDeveloperMode } from '../core/diagnostics/DeveloperModeProvider';
import { useCommandScans } from '../core/hardware/scan/useScanner';
import { ActionRegistryProvider, useRegistryApi, useStationActions } from './ActionRegistry';
import type { StationAction } from './actions';
import { parseCommand } from './commandCode';
import { FeedbackProvider, useFeedback, useFlash } from './feedback/FeedbackProvider';
import type { ToneSink } from './feedback/soundPlayer';
import { FunctionKeyBar } from './FunctionKeyBar';
import { Kbd } from './Kbd';
import { TAB_KEYS, type StationKey } from './keys';
import { BatchProgressProvider } from './status/batchProgress';
import { StatusBar } from './status/StatusBar';
import { STATION_TABS, activeSectionOf, activeTabOf } from './tabs';
import { modalOpen, useStationKeyCapture } from './useStationKeys';

const TAB_KEY_SET: ReadonlySet<StationKey> = new Set<StationKey>(TAB_KEYS);
const STATION_CHROME = { hidesHomeBack: true };

/**
 * 스테이션 셸(스펙 §5) — 탭 바 52px · (하위 탭) · 작업 영역 · 기능키 바 56px · 상태바 28px.
 * 라우트 레이아웃이다: 작업 화면은 <Outlet/> 으로 그 안에 그려진다.
 */
export function StationShell({ sink }: { sink?: ToneSink | null }) {
  return (
    <ActionRegistryProvider>
      <FeedbackProvider sink={sink}>
        <BatchProgressProvider>
          <ShellChromeContext.Provider value={STATION_CHROME}>
            <ShellFrame />
          </ShellChromeContext.Provider>
        </BatchProgressProvider>
      </FeedbackProvider>
    </ActionRegistryProvider>
  );
}

function ShellFrame() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const tab = activeTabOf(pathname);
  const section = tab ? activeSectionOf(tab, pathname) : null;
  const navigate = useNavigate();
  const { warehouseName } = useWarehouse();
  const developer = useDeveloperMode();
  const { signal, clearFlash } = useFeedback();
  const flash = useFlash();
  const registry = useRegistryApi();

  // 탭 전환(F1~F6)은 셸 자신의 액션이다(스펙 §5.2).
  const tabActions = useMemo<StationAction[]>(
    () =>
      STATION_TABS.map((t) => ({
        id: `tab-${t.key}`,
        key: t.key,
        label: t.label,
        enabled: true,
        run: () => void navigate({ to: t.to }),
      })),
    [navigate]
  );
  useStationActions(tabActions);

  // 오류·완료 테두리는 탭을 옮기면 사라진다 — 스캔이 없는 화면에서 영영 남지 않게
  useEffect(() => clearFlash(), [pathname, clearFlash]);

  const reject = useCallback(() => signal('error'), [signal]);
  useStationKeyCapture(reject);

  useCommandScans(
    useCallback(
      (code: string) => {
        const command = parseCommand(code);
        if (command.kind === 'key') {
          // 키 명령은 그 키를 누른 것과 같다 — 열린 확인창 뒤의 화면 액션은 돌리지 않는다
          if (modalOpen()) {
            signal('error');
            return;
          }
          const dispatch = registry?.resolveKey(command.key);
          if (dispatch?.kind === 'run') {
            signal('command');
            dispatch.action.run();
            return;
          }
        } else if (command.kind === 'digit') {
          const handler = registry?.digitHandler();
          if (handler) {
            signal('command');
            handler(command.digit);
            return;
          }
        }
        // 모르는 명령·지금 꺼진 명령(스펙 §5.3)
        signal('error');
      },
      [registry, signal]
    )
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#EDEEF0] text-[#15171C] print:h-auto print:overflow-visible print:bg-white">
      <header className="flex h-[52px] shrink-0 items-stretch gap-0.5 bg-[#161A22] pl-5 pr-4 text-[#E6E8EC] print:hidden">
        <div className="flex items-center pr-5 text-[15px] font-bold">
          {import.meta.env.VITE_APP_STAGE === 'demo' ? 'LCNINE 물류 · DEMO' : 'LCNINE 물류'}
        </div>
        <nav aria-label="탭" className="flex items-end gap-0.5">
          {STATION_TABS.map((t) => {
            const active = tab?.key === t.key;
            return (
              <Link
                key={t.key}
                to={t.to}
                data-active={String(active)}
                className={cn(
                  'flex h-11 items-center gap-2 pl-2.5 pr-4 text-sm',
                  active
                    ? 'rounded-t-lg bg-[#EDEEF0] font-semibold text-[#15171C]'
                    : 'font-medium text-[#C3C8D2] hover:text-white'
                )}
              >
                <Kbd tone={active ? 'dark' : 'muted'}>{t.key}</Kbd>
                {t.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-4 text-[13px] text-[#A9AFBB]">
          {developer.enabled && (
            <Link to="/diagnostics" aria-label="개발자 진단" className="hover:text-white">
              <Wrench className="h-4 w-4" aria-hidden />
            </Link>
          )}
          <Link to="/settings" className="hover:text-white">
            {warehouseName ?? '창고 미설정'}
          </Link>
        </div>
      </header>
      {tab !== null && tab.sections.length > 0 && (
        <nav
          aria-label="하위 탭"
          className="flex h-10 shrink-0 items-center gap-1 border-b border-[#D5D8DE] bg-white px-3 print:hidden"
        >
          {tab.sections.map((s) => {
            const active = section?.to === s.to;
            return (
              <Link
                key={s.to}
                to={s.to}
                data-active={String(active)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm',
                  active ? 'bg-[#15171C] font-semibold text-white' : 'text-[#3F4450] hover:bg-[#EDEEF0]'
                )}
              >
                {s.label}
              </Link>
            );
          })}
        </nav>
      )}
      <main className="min-h-0 flex-1 overflow-y-auto p-3 print:overflow-visible print:p-0">
        <Outlet />
      </main>
      <FunctionKeyBar omit={TAB_KEY_SET} />
      <StatusBar tab={tab?.key ?? null} />
      {flash !== null && (
        <div
          aria-hidden
          data-flash={flash}
          className={cn(
            'pointer-events-none fixed inset-0 z-[90] border-[6px] print:hidden',
            flash === 'error' ? 'border-[#C62828]' : 'border-[#1E7A46]'
          )}
        />
      )}
    </div>
  );
}
