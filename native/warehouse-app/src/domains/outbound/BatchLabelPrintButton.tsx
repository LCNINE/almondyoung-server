import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { Button } from '../../core/design/Button';
import { ConfirmDialog } from '../../core/design/ConfirmDialog';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { localStoragePrefs, type DevicePrefs } from '../../core/data/devicePrefs';
import { errorMessage } from '../../core/data/errorMessage';
import { cn } from '../../core/design/cn';
import { useUnsavedWork } from '../../core/operations/useUnsavedWork';
import {
  NO_PRINTER_MESSAGE,
  PRINTER_FAILURE_MESSAGE,
  printRaw,
  readLabelPrinter,
  type PrintRaw,
} from '../../core/hardware/print/labelPrinter';
import {
  confirmLabelPrinted,
  fetchBatchLabelStates,
  fetchBatchWorkItems,
  fetchWaybillLabel,
  printableShipmentIds,
  readBatchPrintedAt,
  reprintTargets,
  runBatchLabelPrint,
  writeBatchPrintedAt,
  type BatchLabelState,
  type BatchPrintResult,
} from './waybillLabel';

const PRINTER_BUSY_MESSAGE = '다른 송장을 인쇄하고 있어요. 그 인쇄가 끝나면 이어서 인쇄해요.';
const SECONDARY = 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50';
const OUTLINE = 'gap-2 border border-[#e4e4e7] bg-white text-[#27272a] hover:bg-[#eff6ff] hover:brightness-100';

type Phase =
  | { kind: 'idle' }
  // retry: 「바뀐·미출력 송장만 다시」 — 대상이 서버 판정상 지금 내용으로 안 나온 건뿐이라 중복 경고를 띄우지 않는다.
  // alreadyPrinted: 서버 판정상 이미 나간 송장 수 — 다른 기기에서 뽑은 것도 센다. null = 판정을 받지 못했다
  // retryable: 새 판정에 «다시» 로 뽑을 송장이 있다 — 확인창이 그 단추를 안내해도 되는가
  | {
      kind: 'confirm';
      shipmentIds: string[];
      last: BatchPrintResult | null;
      retry: boolean;
      alreadyPrinted: number | null;
      retryable: boolean;
    }
  | { kind: 'running'; done: number; total: number }
  | { kind: 'done'; result: BatchPrintResult };

/** 서버 판정상 한 번이라도 나간 송장 */
const wasPrinted = (state: BatchLabelState) => state.state === 'current' || state.state === 'reprint_required';

function formatPrintedAt(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** 같은 사유를 한 줄로 — 실패한 박스의 shipmentId 는 현장이 읽을 수 있는 값이 아니다. */
function groupSkipped(result: BatchPrintResult): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const s of result.skipped) counts.set(s.message, (counts.get(s.message) ?? 0) + 1);
  return [...counts.entries()];
}

/**
 * 배치 일괄 인쇄(#913). 출고작업 진입점이 운송장 스캔이라 박스를 열기 전에 송장이 붙어 있어야 한다.
 * 같은 배치를 두 번 찍으면 같은 번호 라벨이 두 장 생긴다 — 재출력이 정당한 사용이라 막지 않고 알린다.
 */
export function BatchLabelPrintButton({
  batchId,
  prefs = localStoragePrefs,
  print = printRaw,
  now = () => new Date(),
  disabled = false,
  onRunningChange,
  afterPrinted,
  autoPrint = false,
  onAutoPrintStarted,
  label = '송장 인쇄',
  outline = false,
  className = 'mt-2',
  lock,
}: {
  batchId: string;
  prefs?: DevicePrefs;
  print?: PrintRaw;
  now?: () => Date;
  /** 다른 배치가 인쇄 중이면 부모가 막는다 — 프린터가 한 대라 라벨이 섞인다. */
  disabled?: boolean;
  onRunningChange?: (running: boolean) => void;
  /** 송장이 한 장이라도 나간 뒤 이어서 할 일 */
  afterPrinted?: string;
  /** 처음 그릴 때 바로 인쇄를 시작한다 — 「작업 시작하고 송장 인쇄」 뒤. 이미 나간 송장이 있으면 확인창을 띄운다 */
  autoPrint?: boolean;
  onAutoPrintStarted?: () => void;
  label?: string;
  outline?: boolean;
  className?: string;
  lock?: { acquire(): boolean; release(): void };
}) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const statesKey = ['waybill-label-states', batchId];
  // 서버가 판정한 송장 상태 — 다른 PC 의 출력도 반영한다. 이 기기의 지난 실행 결과가 아니다.
  const { data: states } = useQuery({
    queryKey: statesKey,
    queryFn: () => fetchBatchLabelStates(api, batchId),
  });
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [notice, setNotice] = useState<string | null>(null);
  // 조회·인쇄 중 연타 방지. state 는 다음 렌더에야 보이므로 ref 로 막는다.
  const busy = useRef(false);
  // 네트워크가 나쁘면 200건 × 15초 동안 화면 이동까지 막힌다 — 사람이 끊을 수 있어야 한다.
  // 지금 건은 끝까지 가고 다음 건부터 멈춘다(보낸 라벨을 되돌릴 수는 없다).
  const stopRequested = useRef(false);
  const [stopping, setStopping] = useState(false);
  const waitingFor = useRef<'auto' | 'manual' | null>(null);
  useUnsavedWork(phase.kind === 'running');

  const lastResult = phase.kind === 'done' ? phase.result : null;

  // 판정을 새로 받는다 — fetchQuery 는 화면을 열 때 시작된 조회가 아직 돌면 그 옛 응답을 돌려주므로 먼저 끊는다.
  // 새 조회도 같은 키로 받아, 실패하면 화면의 판정(배치 상세)도 실패 상태로 남고 다음 갱신이 다시 받는다
  const freshStates = async () => {
    await queryClient.cancelQueries({ queryKey: statesKey });
    return queryClient.fetchQuery({
      queryKey: statesKey,
      queryFn: () => fetchBatchLabelStates(api, batchId),
      staleTime: 0,
    });
  };

  const prepare = async (retry = false, auto = false) => {
    if (busy.current || disabled) return;
    // 확인 없이 바로 보낼 대상 — busy 를 놓은 뒤에 start 한다
    let direct: string[] | null = null;
    setNotice(null);
    // 새로 시작하면 지난 요약은 더 이상 지금 상태가 아니다 — 새 안내 옆에 남기지 않는다(취소하면 last 로 돌아간다).
    if (!retry) setPhase({ kind: 'idle' });
    if (!readLabelPrinter(prefs)) {
      setNotice(NO_PRINTER_MESSAGE);
      return;
    }
    busy.current = true;
    try {
      if (retry) {
        // 방금 끝난 인쇄가 반영된 서버 판정을 새로 받는다 — 캐시가 낡았을 수 있다.
        const fresh = reprintTargets(await freshStates());
        if (fresh.length === 0) {
          setNotice('다시 인쇄할 송장이 없어요.');
          return;
        }
        setPhase({ kind: 'confirm', shipmentIds: fresh, last: lastResult, retry: true, alreadyPrinted: 0, retryable: true });
        return;
      }
      // 판정도 새로 받는다 — 화면을 연 뒤 다른 기기가 뽑았으면 확인창이 알리고, «다시» 단추도 그 판정으로 나타난다.
      // 판정을 못 받아도 인쇄는 막지 않는다 — 확인창이 확인하지 못했다고 알린다
      const [workItems, states] = await Promise.all([
        fetchBatchWorkItems(api, batchId),
        freshStates().catch(() => null),
      ]);
      const shipmentIds = printableShipmentIds(workItems);
      if (shipmentIds.length === 0) {
        setNotice('인쇄할 박스가 없어요.');
        return;
      }
      const printed = states ? new Set(states.filter(wasPrinted).map((state) => state.shipmentId)) : null;
      const alreadyPrinted = printed ? shipmentIds.filter((id) => printed.has(id)).length : null;
      const retryable = states !== null && reprintTargets(states).length > 0;
      // 방금 시작한 배치라도 다른 기기가 뽑았거나 판정을 못 받았으면 묻는다 — 같은 번호 송장이 두 장 나오지 않게
      if (auto && alreadyPrinted === 0 && !readBatchPrintedAt(prefs, batchId)) direct = shipmentIds;
      else setPhase({ kind: 'confirm', shipmentIds, last: lastResult, retry: false, alreadyPrinted, retryable });
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      busy.current = false;
    }
    // 판정을 받는 동안 다른 배치로 옮겼으면 화면에 없는 배치의 송장을 뽑지 않는다
    if (direct && mounted.current) await start(direct, true);
  };

  const start = async (shipmentIds: string[], auto = false) => {
    const target = readLabelPrinter(prefs);
    if (!target || busy.current) return;
    if (!lock && disabled) return;
    // 다른 송장이 프린터를 쓰는 중이면 그 인쇄가 끝난 뒤 판정부터 다시 받는다
    if (lock && !lock.acquire()) {
      waitingFor.current = auto ? 'auto' : 'manual';
      setPhase({ kind: 'idle' });
      setNotice(PRINTER_BUSY_MESSAGE);
      return;
    }
    busy.current = true;
    stopRequested.current = false;
    setStopping(false);
    onRunningChange?.(true);
    setPhase({ kind: 'running', done: 0, total: shipmentIds.length });
    try {
      const result = await runBatchLabelPrint({
        shipmentIds,
        target,
        print,
        fetchLabel: (id) => fetchWaybillLabel(api, id),
        confirm: (id, fingerprint) => confirmLabelPrinted(api, id, fingerprint),
        onProgress: (done, total) => setPhase({ kind: 'running', done, total }),
        shouldStop: () => stopRequested.current,
      });
      // 한 장도 안 나왔으면 기록하지 않는다 — 다음 확인창이 「이미 인쇄」라고 거짓말하게 된다.
      if (result.printed.length > 0) writeBatchPrintedAt(prefs, batchId, now().toISOString());
      setPhase({ kind: 'done', result });
    } catch (error) {
      // 여기서 새면 phase 가 running 에 남아 화면 이동이 영영 막힌다.
      setPhase({ kind: 'idle' });
      setNotice(errorMessage(error));
    } finally {
      busy.current = false;
      lock?.release();
      onRunningChange?.(false);
      void queryClient.invalidateQueries({ queryKey: statesKey });
    }
  };

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (disabled || waitingFor.current === null) return;
    const auto = waitingFor.current === 'auto';
    waitingFor.current = null;
    void prepare(false, auto);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 막혔던 인쇄는 막힘이 풀릴 때 한 번
  }, [disabled]);

  // 한 번만 — 다시 그려져도(배치를 오갔다 돌아와도) 또 뽑지 않게 부모가 autoPrint 를 거둔다
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoPrint || autoStarted.current) return;
    autoStarted.current = true;
    onAutoPrintStarted?.();
    void prepare(false, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 그릴 때 한 번
  }, [autoPrint]);

  const printedAt = readBatchPrintedAt(prefs, batchId);
  const reprintCount = states ? reprintTargets(states).length : 0;
  // 아직 한 장도 안 나간 배치면 «다시» 는 «송장 인쇄» 와 같은 일이다 — 주 버튼을 하나로 둔다
  const showRetry = reprintCount > 0 && (states ?? []).some(wasPrinted) && phase.kind !== 'running';
  const skippedGroups = lastResult ? groupSkipped(lastResult) : [];
  const confirmMessage =
    phase.kind !== 'confirm'
      ? ''
      : phase.retry
        ? `바뀌었거나 인쇄되지 않은 ${phase.shipmentIds.length}건만 다시 보내요. 인쇄가 끝날 때까지 이 화면을 떠나지 마세요.`
        : phase.alreadyPrinted !== null && phase.alreadyPrinted > 0
          ? `이미 인쇄한 송장이 ${phase.alreadyPrinted}건 있어요. 같은 번호의 송장이 한 번 더 나와요.` +
            (phase.retryable ? ' 안 나온 것만 뽑으려면 취소하고 «바뀐·미출력 송장만 다시»를 눌러 주세요.' : '')
          : printedAt
            ? `이 기기에서 ${formatPrintedAt(printedAt)} 에 이미 인쇄했어요. 같은 번호의 송장이 한 번 더 나와요.`
            : phase.alreadyPrinted === null
              ? '이미 인쇄한 송장이 있는지 확인하지 못했어요. 같은 번호의 송장이 한 번 더 나올 수 있어요.'
              : '인쇄가 끝날 때까지 이 화면을 떠나지 마세요.';

  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          className={outline ? OUTLINE : showRetry ? SECONDARY : undefined}
          disabled={disabled || phase.kind === 'running'}
          onClick={() => void prepare()}
        >
          {outline ? <Printer className="h-4 w-4" aria-hidden /> : null}
          {phase.kind === 'running' ? `인쇄 중 ${phase.done}/${phase.total}` : label}
        </Button>
        {phase.kind === 'running' && (
          <Button
            type="button"
            className={SECONDARY}
            disabled={stopping}
            onClick={() => {
              stopRequested.current = true;
              setStopping(true);
            }}
          >
            중지
          </Button>
        )}
        {/* 서버 판정(바뀐 송장·안 나온 송장)이 있으면 이 기기에서 인쇄한 적이 없어도 보인다 — 다른 PC 의 출력,
            작업 중 바뀐 송장도 여기서 다시 뽑는다(스펙 §10.5). 대상은 누를 때 서버에서 새로 받는다. */}
        {showRetry && (
          <Button type="button" disabled={disabled} onClick={() => void prepare(true)}>
            바뀐·미출력 송장만 다시
          </Button>
        )}
        {showRetry && (
          <span className="self-center text-sm text-red-600">재출력 필요 {reprintCount}</span>
        )}
      </div>

      {notice !== null && (
        <p role="alert" className="text-sm">
          {notice}
        </p>
      )}

      {phase.kind === 'done' && (
        <div className="space-y-1 text-sm">
          <p role="status">
            보냄 {phase.result.printed.length} · 실패 {phase.result.skipped.length} · 미인쇄{' '}
            {phase.result.notAttempted.length}
          </p>
          {/* 스풀러가 받았다는 뜻일 뿐이다 — 꺼지거나 걸린 USB 프린터도 대개 작업을 받아 준다. */}
          {phase.result.printed.length > 0 && (
            <p className="text-xs text-gray-500">프린터에서 {phase.result.sheets}장이 나왔는지 확인해 주세요.</p>
          )}
          {/* 확인 기록만 실패한 송장도 종이는 나갔다(sheets 에 센다) */}
          {phase.result.sheets > 0 && afterPrinted !== undefined && (
            <p className="text-base font-semibold text-blue-700">{afterPrinted}</p>
          )}
          {phase.result.printerError !== undefined && (
            <p role="alert">
              {PRINTER_FAILURE_MESSAGE}
              <span className="block text-xs text-gray-500">{phase.result.printerError}</span>
            </p>
          )}
          {skippedGroups.length > 0 && (
            <ul>
              {skippedGroups.map(([message, count]) => (
                <li key={message}>
                  {message} ({count}건)
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ConfirmDialog
        open={phase.kind === 'confirm'}
        title={phase.kind === 'confirm' ? `송장 ${phase.shipmentIds.length}건을 인쇄할까요?` : ''}
        message={confirmMessage}
        confirmLabel="인쇄"
        onCancel={() =>
          setPhase(
            phase.kind === 'confirm' && phase.last
              ? { kind: 'done', result: phase.last }
              : { kind: 'idle' }
          )
        }
        onConfirm={() => {
          if (phase.kind === 'confirm') void start(phase.shipmentIds);
        }}
      />
    </div>
  );
}
