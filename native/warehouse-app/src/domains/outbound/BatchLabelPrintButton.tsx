import { useRef, useState } from 'react';
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
  fetchBatchWorkItems,
  fetchWaybillLabel,
  printableShipmentIds,
  readBatchPrintedAt,
  retryTargets,
  runBatchLabelPrint,
  writeBatchPrintedAt,
  type BatchPrintResult,
} from './waybillLabel';

type Phase =
  | { kind: 'idle' }
  | { kind: 'confirm'; shipmentIds: string[]; last: BatchPrintResult | null }
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
 * 배치 일괄 인쇄(#913). 출고작업 진입점이 운송장 스캔이라 박스를 열기 전에 라벨이 붙어 있어야 한다.
 * 같은 배치를 두 번 찍으면 같은 번호 라벨이 두 장 생긴다 — 재출력이 정당한 사용이라 막지 않고 알린다.
 */
export function BatchLabelPrintButton({
  batchId,
  prefs = localStoragePrefs,
  print = printRaw,
  now = () => new Date(),
}: {
  batchId: string;
  prefs?: DevicePrefs;
  print?: PrintRaw;
  now?: () => Date;
}) {
  const api = useApiClient();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [notice, setNotice] = useState<string | null>(null);
  // 조회·인쇄 중 연타 방지. state 는 다음 렌더에야 보이므로 ref 로 막는다.
  const busy = useRef(false);
  useUnsavedWork(phase.kind === 'running');

  const lastResult = phase.kind === 'done' ? phase.result : null;

  const prepare = async (retryIds?: string[]) => {
    if (busy.current) return;
    setNotice(null);
    if (!readLabelPrinter(prefs)) {
      setNotice(NO_PRINTER_MESSAGE);
      return;
    }
    if (retryIds) {
      setPhase({ kind: 'confirm', shipmentIds: retryIds, last: lastResult });
      return;
    }
    busy.current = true;
    try {
      const shipmentIds = printableShipmentIds(await fetchBatchWorkItems(api, batchId));
      if (shipmentIds.length === 0) {
        setNotice('인쇄할 박스가 없어요.');
        return;
      }
      setPhase({ kind: 'confirm', shipmentIds, last: lastResult });
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      busy.current = false;
    }
  };

  const start = async (shipmentIds: string[]) => {
    const target = readLabelPrinter(prefs);
    if (!target || busy.current) return;
    busy.current = true;
    setPhase({ kind: 'running', done: 0, total: shipmentIds.length });
    try {
      const result = await runBatchLabelPrint({
        shipmentIds,
        target,
        print,
        fetchLabel: (id) => fetchWaybillLabel(api, id),
        onProgress: (done, total) => setPhase({ kind: 'running', done, total }),
      });
      // 한 장도 안 나왔으면 기록하지 않는다 — 다음 확인창이 「이미 인쇄」라고 거짓말하게 된다.
      if (result.printed.length > 0) writeBatchPrintedAt(prefs, batchId, now().toISOString());
      setPhase({ kind: 'done', result });
    } finally {
      busy.current = false;
    }
  };

  const printedAt = readBatchPrintedAt(prefs, batchId);
  const retry = lastResult ? retryTargets(lastResult) : [];

  return (
    <div className="mt-2 space-y-1">
      <div className="flex gap-2">
        <Button
          type="button"
          className="border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
          disabled={phase.kind === 'running'}
          onClick={() => void prepare()}
        >
          {phase.kind === 'running' ? `인쇄 중 ${phase.done}/${phase.total}` : '라벨 인쇄'}
        </Button>
        {phase.kind === 'done' && retry.length > 0 && (
          <Button type="button" onClick={() => void prepare(retry)}>
            실패·미인쇄만 다시
          </Button>
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
            인쇄 {phase.result.printed.length} · 실패 {phase.result.skipped.length} · 미인쇄{' '}
            {phase.result.notAttempted.length}
          </p>
          {phase.result.printerError !== undefined && (
            <p role="alert">
              {PRINTER_FAILURE_MESSAGE}
              <span className="block text-xs text-gray-500">{phase.result.printerError}</span>
            </p>
          )}
          <ul>
            {groupSkipped(phase.result).map(([message, count]) => (
              <li key={message}>
                {message} ({count}건)
              </li>
            ))}
          </ul>
        </div>
      )}

      <ConfirmDialog
        open={phase.kind === 'confirm'}
        title={phase.kind === 'confirm' ? `라벨 ${phase.shipmentIds.length}장을 인쇄할까요?` : ''}
        message={
          printedAt
            ? `이 기기에서 ${formatPrintedAt(printedAt)} 에 이미 인쇄했어요. 같은 번호의 라벨이 한 장씩 더 나와요.`
            : '인쇄가 끝날 때까지 이 화면을 떠나지 마세요.'
        }
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
