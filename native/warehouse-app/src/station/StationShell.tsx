import { useCallback, useEffect, useMemo } from 'react';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { ArrowLeftRight, ChevronDown, Download, LayoutGrid, ListChecks, ScanBarcode, Search, Undo2, Warehouse, Wrench, type LucideIcon } from 'lucide-react';
import { useWarehouse } from '../app/warehouse-context';
import { useWorkerIdentity } from '../app/useWorkerIdentity';
import { cn } from '../core/design/cn';
import { ShellChromeContext } from '../core/design/shellChrome';
import { useDeveloperMode } from '../core/diagnostics/DeveloperModeProvider';
import { useCommandScans } from '../core/hardware/scan/useScanner';
import { ActionRegistryProvider, useRegistryApi, useStationActions } from './ActionRegistry';
import { NewBatchNotice } from './batches/NewBatchNotice';
import { TAB_ACTION_PREFIX, type StationAction } from './actions';
import { parseCommand } from './commandCode';
import { FeedbackProvider, useFeedback, useFlash } from './feedback/FeedbackProvider';
import type { ToneSink } from './feedback/soundPlayer';
import { FunctionKeyBar } from './FunctionKeyBar';
import { Kbd } from './Kbd';
import { BatchProgressProvider } from './status/batchProgress';
import { StatusBar } from './status/StatusBar';
import type { TabKey } from './keys';
import { STATION_TABS, activeSectionOf, activeTabOf } from './tabs';
import { modalOpen, useStationKeyCapture } from './useStationKeys';

const STATION_CHROME = { hidesHomeBack: true };

const TAB_ICONS: Record<TabKey, LucideIcon> = {
  F1: ScanBarcode,
  F2: LayoutGrid,
  F3: Download,
  F4: ArrowLeftRight,
  F5: ListChecks,
  F6: Search,
  F7: Undo2,
};

/**
 * 스테이션 셸(스펙 §5) — 탭 바 70px · (하위 탭) · 작업 영역 · 기능키 바 56px · 상태바 28px.
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
  const worker = useWorkerIdentity();
  const developer = useDeveloperMode();
  const { signal, clearFlash } = useFeedback();
  const flash = useFlash();
  const registry = useRegistryApi();

  // 탭 전환(F1~F7)은 셸 자신의 액션이다(스펙 §5.2). 기능키 바는 id 접두어로 알아보고 뺀다
  const tabActions = useMemo<StationAction[]>(
    () =>
      STATION_TABS.map((t) => ({
        id: `${TAB_ACTION_PREFIX}${t.key}`,
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
    <div className="flex h-screen flex-col overflow-hidden bg-[#f5f5f5] text-[#27272a] print:h-auto print:overflow-visible print:bg-white">
      <header className="flex h-[70px] shrink-0 items-center gap-6 border-b border-[#e4e4e7] bg-white px-7 print:hidden">
        <div className="mr-4 text-[21px] font-extrabold tracking-[-1px]">
          {import.meta.env.VITE_APP_STAGE === 'demo' ? 'LCNINE 물류 · DEMO' : 'LCNINE 물류'}
        </div>
        <nav aria-label="탭" className="flex gap-1 self-stretch">
          {STATION_TABS.map((t) => {
            const active = tab?.key === t.key;
            const Icon = TAB_ICONS[t.key];
            return (
              <Link
                key={t.key}
                to={t.to}
                data-active={String(active)}
                className={cn(
                  'relative flex items-center gap-2 px-3 text-[13px] font-semibold whitespace-nowrap hover:bg-[#eff6ff]',
                  active
                    ? 'text-[#2563eb] after:absolute after:inset-x-3 after:bottom-0 after:h-[3px] after:rounded-t after:bg-[#2563eb]'
                    : 'text-[#71717a]'
                )}
              >
                <Icon className="h-[17px] w-[17px]" strokeWidth={1.65} aria-hidden />
                {t.label}
                <Kbd tone="outline">{t.key}</Kbd>
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2.5 text-xs whitespace-nowrap text-[#71717a]">
          <NewBatchNotice />
          {developer.enabled && (
            <Link to="/diagnostics" aria-label="개발자 진단" className="hover:text-[#27272a]">
              <Wrench className="h-4 w-4" aria-hidden />
            </Link>
          )}
          {worker.status === 'ready' && (
            <Link
              to="/settings"
              aria-label={`로그인한 작업자 ${worker.identity.name}`}
              className="flex items-center gap-2 hover:text-[#27272a]"
            >
              <span aria-hidden className="grid h-[31px] w-[31px] place-items-center rounded-full bg-[#f4f4f5] text-xs text-[#52525b]">
                {worker.identity.name.slice(0, 1)}
              </span>
              {worker.identity.name}
            </Link>
          )}
          <span aria-hidden className="h-5 w-px bg-[#e4e4e7]" />
          <Link to="/settings" className="flex items-center gap-1.5 hover:text-[#27272a]">
            <Warehouse className="h-[17px] w-[17px]" strokeWidth={1.65} aria-hidden />
            {warehouseName ?? '창고 미설정'}
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      </header>
      {tab !== null && tab.sections.length > 0 && (
        <nav
          aria-label="하위 탭"
          className="mx-[30px] mt-[18px] flex shrink-0 items-center gap-[5px] border-b border-[#e4e4e7] pb-2.5 print:hidden"
        >
          {tab.sections.map((s) => {
            const active = section?.to === s.to;
            return (
              <Link
                key={s.to}
                to={s.to}
                data-active={String(active)}
                className={cn(
                  'rounded-[5px] px-[13px] py-2 text-xs whitespace-nowrap hover:text-[#27272a]',
                  active ? 'bg-white font-semibold text-[#27272a] shadow-[0_0_0_1px_#d4d4d8]' : 'font-medium text-[#71717a]'
                )}
              >
                {s.label}
              </Link>
            );
          })}
        </nav>
      )}
      <main className="min-h-0 flex-1 overflow-y-auto px-[30px] py-[26px] print:overflow-visible print:p-0">
        <Outlet />
      </main>
      <FunctionKeyBar />
      <StatusBar tab={tab?.key ?? null} />
      {flash !== null && (
        <div
          aria-hidden
          data-flash={flash}
          className={cn(
            'pointer-events-none fixed inset-0 z-[90] border-[6px] print:hidden',
            flash === 'error' ? 'border-[#C62828]' : flash === 'attention' ? 'border-[#E0A100]' : 'border-[#1E7A46]'
          )}
        />
      )}
    </div>
  );
}
