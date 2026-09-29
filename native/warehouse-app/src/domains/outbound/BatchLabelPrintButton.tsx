import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../core/design/Button';
import { ConfirmDialog } from '../../core/design/ConfirmDialog';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { localStoragePrefs, type DevicePrefs } from '../../core/data/devicePrefs';
import { errorMessage } from '../../core/data/errorMessage';
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
  type BatchPrintResult,
} from './waybillLabel';

type Phase =
  | { kind: 'idle' }
  // retry: 「실패·미인쇄만 다시」 — 대상이 한 번도 안 나온 건뿐이라 중복 경고를 띄우지 않는다.
  | { kind: 'confirm'; shipmentIds: string[]; last: BatchPrintResult | null; retry: boolean }
  | { kind: 'running'; done: number; total: number }
  | { kind: 'done'; result: BatchPrintResult };

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
}: {
  batchId: string;
  prefs?: DevicePrefs;
  print?: PrintRaw;
  now?: () => Date;
  /** 다른 배치가 인쇄 중이면 부모가 막는다 — 프린터가 한 대라 라벨이 섞인다. */
  disabled?: boolean;
  onRunningChange?: (running: boolean) => void;
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
  useUnsavedWork(phase.kind === 'running');

  const lastResult = phase.kind === 'done' ? phase.result : null;

  const prepare = async (retry = false) => {
    if (busy.current || disabled) return;
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
        const fresh = reprintTargets(
          await queryClient.fetchQuery({
            queryKey: statesKey,
            queryFn: () => fetchBatchLabelStates(api, batchId),
            staleTime: 0,
          })
        );
        if (fresh.length === 0) {
          setNotice('다시 인쇄할 송장이 없어요.');
          return;
        }
        setPhase({ kind: 'confirm', shipmentIds: fresh, last: lastResult, retry: true });
        return;
      }
      const shipmentIds = printableShipmentIds(await fetchBatchWorkItems(api, batchId));
      if (shipmentIds.length === 0) {
        setNotice('인쇄할 박스가 없어요.');
        return;
      }
      setPhase({ kind: 'confirm', shipmentIds, last: lastResult, retry: false });
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      busy.current = false;
    }
  };

  const start = async (shipmentIds: string[]) => {
    const target = readLabelPrinter(prefs);
    if (!target || busy.current || disabled) return;
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
      onRunningChange?.(false);
      void queryClient.invalidateQueries({ queryKey: statesKey });
    }
  };

  const printedAt = readBatchPrintedAt(prefs, batchId);
  const reprintCount = states ? reprintTargets(states).length : 0;
  const skippedGroups = lastResult ? groupSkipped(lastResult) : [];
  const confirmMessage =
    phase.kind !== 'confirm'
      ? ''
      : phase.retry
        ? `인쇄되지 않은 ${phase.shipmentIds.length}건만 다시 보내요. 인쇄가 끝날 때까지 이 화면을 떠나지 마세요.`
        : printedAt
          ? `이 기기에서 ${formatPrintedAt(printedAt)} 에 이미 인쇄했어요. 같은 번호의 송장이 한 번 더 나와요.`
          : '인쇄가 끝날 때까지 이 화면을 떠나지 마세요.';

  return (
    <div className="mt-2 space-y-1">
      <div className="flex gap-2">
        <Button
          type="button"
          className="border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
          disabled={disabled || phase.kind === 'running'}
          onClick={() => void prepare()}
        >
          {phase.kind === 'running' ? `인쇄 중 ${phase.done}/${phase.total}` : '송장 인쇄'}
        </Button>
        {phase.kind === 'running' && (
          <Button
            type="button"
            className="border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            disabled={stopping}
            onClick={() => {
              stopRequested.current = true;
              setStopping(true);
            }}
          >
            중지
          </Button>
        )}
        {phase.kind === 'done' && reprintCount > 0 && (
          <Button type="button" disabled={disabled} onClick={() => void prepare(true)}>
            실패·미인쇄만 다시
          </Button>
        )}
        {reprintCount > 0 && phase.kind !== 'running' && (
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
