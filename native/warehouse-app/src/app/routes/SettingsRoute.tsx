import { useState, type ReactNode } from 'react';
import { ArrowRight, Printer, ScanBarcode, Volume2, Warehouse, type LucideIcon } from 'lucide-react';
import { useDeveloperMode } from '../../core/diagnostics/DeveloperModeProvider';
import { Button } from '../../core/design/Button';
import { cn } from '../../core/design/cn';
import { Link } from '@tanstack/react-router';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { useWarehouses } from '../../domains/warehouse/useWarehouses';
import { errorMessage } from '../../core/data/errorMessage';
import { PrinterSettings } from '../../core/hardware/print/PrinterSettings';
import { isStationDevice } from '../station';
import { useSession } from '../session-context';
import { SoundSettings } from '../../station/feedback/SoundSettings';
import { useUnresolvedWork } from '../../core/operations/workArea';
import { useWorkerIdentity } from '../useWorkerIdentity';
import { useWarehouse } from '../warehouse-context';

function SettingsCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[#e4e4e7] bg-white px-[26px] py-[23px]">
      <div className="mb-[22px] flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] border border-[#e4e4e7] text-[#52525b]">
          <Icon className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <div>
          <h2 className="text-[17px] font-bold tracking-[-0.3px] text-[#27272a]">{title}</h2>
          <p className="mt-[5px] text-xs text-[#71717a]">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function WarehouseSetting() {
  const { warehouseId, setWarehouse } = useWarehouse();
  const { data, isLoading, isError, error } = useWarehouses();
  const [choice, setChoice] = useState<string | null>(null);
  const warehouses = data ?? [];
  const selected = choice ?? warehouseId ?? '';
  const target = warehouses.find((w) => w.id === selected);

  let control: ReactNode;
  if (isError) {
    control = (
      <p role="alert" className="text-sm text-[#aa4037]">
        {errorMessage(error)}
      </p>
    );
  } else if (isLoading) {
    control = <p className="text-sm text-[#71717a]">불러오는 중…</p>;
  } else if (warehouses.length === 0) {
    control = <p className="text-sm text-[#71717a]">등록된 창고가 없어요.</p>;
  } else {
    control = (
      <div className="flex flex-wrap items-center gap-2">
        <select
          id="warehouse-choice"
          value={selected}
          onChange={(e) => setChoice(e.target.value)}
          className="w-[150px] rounded-lg border border-[#e4e4e7] bg-white px-[11px] py-[9px] text-[13px] text-[#27272a]"
        >
          {warehouseId === null && (
            <option value="" disabled>
              창고 선택
            </option>
          )}
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <Button
          className="px-3.5 py-2 text-xs"
          disabled={!target || target.id === warehouseId}
          onClick={() => {
            if (target) setWarehouse({ id: target.id, name: target.name });
          }}
        >
          적용
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-3 border-t border-[#e4e4e7] pt-[18px] min-[901px]:flex-row min-[901px]:items-center min-[901px]:justify-between min-[901px]:gap-5">
      <div>
        <label htmlFor="warehouse-choice" className="text-[13px] font-semibold text-[#27272a]">
          이 기기의 창고
        </label>
        <p className="mt-[5px] text-xs text-[#71717a]">입고·적치·이동·조정·실사에 적용됩니다.</p>
      </div>
      {control}
    </div>
  );
}

export function SettingsRoute() {
  const developer = useDeveloperMode();
  const session = useSession();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [checking, setChecking] = useState(false);
  const worker = useWorkerIdentity();
  const { warehouseName } = useWarehouse();
  const unresolved = useUnresolvedWork();
  const needsWarning = unresolved.count > 0 || unresolved.unknown;

  const recheck = async () => {
    setChecking(true);
    try {
      await unresolved.recheck();
    } finally {
      setChecking(false);
    }
  };

  const signOut = async () => {
    setConfirming(false);
    setSigningOut(true);
    setSignOutFailed(false);

    try {
      await (session.signOut ?? session.logout)();
    } catch {
      setSignOutFailed(true);
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1176px] space-y-6">
      <ScreenHeader
        title="설정"
        backTo="/"
        description="이 스테이션에서 사용하는 창고와 작업 환경을 관리하세요."
      />

      <div className="grid grid-cols-1 items-start gap-4 min-[701px]:grid-cols-[minmax(0,1fr)_240px] min-[901px]:grid-cols-[minmax(0,1fr)_290px] min-[901px]:gap-[22px]">
        <div className="flex flex-col gap-[18px]">
          <SettingsCard
            icon={Warehouse}
            title="작업 창고"
            description="이 기기의 재고 작업이 기록되는 창고입니다."
          >
            <WarehouseSetting />
          </SettingsCard>

          {isStationDevice() && (
            <>
              <SettingsCard
                icon={Printer}
                title="프린터"
                description="현재 PC에서 사용할 프린터를 설정하세요."
              >
                <PrinterSettings slot="waybill" />
                <PrinterSettings slot="label" />
              </SettingsCard>
              <SettingsCard
                icon={Volume2}
                title="소리"
                description="스캔 결과와 작업 알림의 음량을 조절하세요."
              >
                <SoundSettings />
              </SettingsCard>
            </>
          )}
        </div>

        <aside className="flex flex-col gap-[18px]">
          <section className="space-y-1 rounded-xl border border-[#e4e4e7] bg-white p-[25px] text-center">
            {worker.status === 'ready' && (
              <h2 className="mb-6 text-xl font-bold text-[#27272a]">
                {worker.identity.name}
              </h2>
            )}
            {worker.status === 'loading' && (
              <p className="mb-6 text-sm text-[#71717a]">작업자를 확인하고 있어요.</p>
            )}
            {worker.status === 'failed' && (
              <p className="mb-6 text-sm text-[#71717a]">
                작업자를 확인하지 못했어요.{' '}
                <button
                  type="button"
                  className="font-medium text-[#2563eb] underline"
                  onClick={worker.retry}
                >
                  다시 확인
                </button>
              </p>
            )}
            <div className="my-[15px] flex justify-between text-xs">
              <span className="text-[#71717a]">작업 창고</span>
              <strong className="font-medium text-[#27272a]">{warehouseName ?? '미설정'}</strong>
            </div>
            <div className="my-[15px] flex justify-between text-xs">
              <span className="text-[#71717a]">프로필</span>
              <strong className="font-medium text-[#27272a]">
                {isStationDevice() ? 'PC 스테이션' : '핸드헬드'}
              </strong>
            </div>
            <Button
              className="mt-2 mb-3 w-full border border-[#e4e4e7] bg-white text-xs text-[#27272a] hover:bg-[#f4f4f5] hover:brightness-100"
              disabled={signingOut || (confirming && needsWarning)}
              onClick={() => (needsWarning ? setConfirming(true) : void signOut())}
            >
              로그아웃
            </Button>
            <p className="text-[11px] leading-[1.8] text-[#71717a]">
              다른 계정으로 바꾸려면 로그아웃한 뒤 다시 로그인해 주세요.
            </p>
            {confirming && needsWarning && (
              <div
                role="alert"
                className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-left text-sm text-[#9a681c]"
              >
                <p>
                  {unresolved.count > 0
                    ? `처리 결과를 확인하지 못한 작업이 ${unresolved.count}건 있어요.`
                    : '이 기기에 남은 작업을 아직 확인하지 못했어요.'}{' '}
                  로그아웃하면 이 계정으로 다시 로그인할 때까지 확인할 수 없어요.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={checking} onClick={() => void recheck()}>
                    처리 내역 확인
                  </Button>
                  <Button disabled={signingOut} onClick={() => void signOut()}>
                    그래도 로그아웃
                  </Button>
                  <Button onClick={() => setConfirming(false)}>취소</Button>
                </div>
              </div>
            )}
            {confirming && !needsWarning && (
              <p role="status" className="text-xs text-[#71717a]">
                남은 작업을 모두 확인했어요. 이제 로그아웃할 수 있어요.
              </p>
            )}
            {signOutFailed && (
              <p role="alert" className="text-xs text-[#aa4037]">
                로그아웃하지 못했어요. 다시 눌러 주세요.
              </p>
            )}
          </section>

          <section className="rounded-xl border border-[#e4e4e7] bg-white p-[21px]">
            <h3 className="mb-3 text-[13px] font-bold text-[#27272a]">작업 도구</h3>
            {isStationDevice() && (
              <Link
                to="/station/command-sheet"
                className="flex w-full items-center gap-[9px] py-3 text-xs text-[#27272a] hover:text-[#2563eb]"
              >
                <ScanBarcode className="h-4 w-4 text-[#71717a]" aria-hidden />
                <span>명령 바코드 시트</span>
                <ArrowRight className="ml-auto h-4 w-4 text-[#71717a]" aria-hidden />
              </Link>
            )}
            <div className="mt-[7px] flex items-center justify-between border-t border-[#e4e4e7] pt-[17px] text-xs text-[#71717a]">
              <span>개발자 모드</span>
              <button
                type="button"
                role="switch"
                aria-checked={developer.enabled}
                aria-label="개발자 모드"
                onClick={() => void developer.toggle()}
                className={cn(
                  'h-5 w-8 rounded-full p-[3px] transition-colors',
                  developer.enabled ? 'bg-[#2563eb]' : 'bg-[#d4d4d8]'
                )}
              >
                <span
                  className={cn(
                    'block h-3.5 w-3.5 rounded-full bg-white transition-transform',
                    developer.enabled && 'translate-x-3'
                  )}
                />
              </button>
            </div>
            {developer.enabled && (
              <Link
                to="/diagnostics"
                className="mt-2 inline-flex items-center gap-1.5 py-[7px] text-xs font-medium text-[#2563eb]"
              >
                개발자 진단 열기
                <ArrowRight className="h-[13px] w-[13px]" aria-hidden />
              </Link>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
