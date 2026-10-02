import { useEffect, useRef, useState, type RefObject } from 'react';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type { DevicePrefs } from '../../core/data/devicePrefs';
import { errorMessage } from '../../core/data/errorMessage';
import { ApiError } from '../../core/data/httpClient';
import { cn } from '../../core/design/cn';
import { useWorkScanQueue } from '../../core/hardware/scan/useWorkScanQueue';
import type { ShipmentByWaybill, WithdrawalRemoval } from '../../domains/outbound/types';
import { removeToReturnBin, withdrawalRows } from '../../domains/outbound/withdraw';
import { isReturnBinCode, readReturnBin } from '../../domains/returns/returnBin';
import type { BoxWorkHandle } from './InspectWork';
import type { Alert } from './model';
import { BigPanel, BoxCard, QueueTrouble, RecentList, WorkGrid } from './panels';
import type { RecentEntry } from './recent';
import { INTAKE_BLOCKED_MESSAGE } from './useInspectionBox';

const ALREADY_EXITED_MESSAGE = '이미 다 뺀 박스예요 — 이 상품은 바구니에 넣지 마세요.';
const NO_BIN_MESSAGE = '설정에서 이 기기의 되돌림 바구니를 먼저 지정해 주세요.';

/**
 * 뺄 상품(스펙 §6.2 withdrawing) — 담은 상품을 찍어 되돌림 바구니로. 다 빼면 «빠진 박스».
 * 서버 경로·스캔 한 번 = 하나·멱등 키는 지금의 WithdrawBoxScreen 과 같다. 박스마다 새로 마운트된다(key).
 */
export function WithdrawWork({
  box,
  handleRef,
  prefs,
  warehouseId,
  alert,
  recent,
  onAlert,
  onRemoved,
  onDone,
}: {
  box: ShipmentByWaybill;
  handleRef: RefObject<BoxWorkHandle | null>;
  prefs: DevicePrefs;
  warehouseId: string;
  alert: Alert | null;
  recent: readonly RecentEntry[];
  onAlert(message: string, detail?: string): void;
  onRemoved(barcode: string): void;
  onDone(box: ShipmentByWaybill): void;
}) {
  const api = useApiClient();
  const bin = readReturnBin(prefs, warehouseId);
  const [removals, setRemovals] = useState<WithdrawalRemoval[]>(box.removals);
  const done = useRef(false);
  const queue = useWorkScanQueue<{ barcode: string; returnBinBarcode: string }>(async (input, id) => {
    // 박스를 다 뺀 스캔 뒤에 줄 서 있던 스캔 — 보내지 않되, 손에 든 상품을 바구니에 넣지 않게 알린다
    if (done.current) {
      onAlert(ALREADY_EXITED_MESSAGE, input.barcode);
      return;
    }
    try {
      const result = await removeToReturnBin(api, { shipmentId: box.shipmentId, ...input, idempotencyKey: id });
      setRemovals(result.removals);
      onRemoved(input.barcode);
      if (result.exited) {
        done.current = true;
        onDone(box);
      }
    } catch (error) {
      onAlert(errorMessage(error, 'outbound'), input.barcode);
      if (!(error instanceof ApiError && error.outcome === 'rejected')) throw error;
    }
  }, `withdraw:${box.shipmentId}`);
  const rows = withdrawalRows(removals);
  const cartOnly = rows.length > 0 && rows.every((row) => row.onCart);

  // 부모가 상품 스캔·내려놓기에 쓰는 손잡이(InspectWork 와 같은 규칙 — 커밋 뒤에 건다)
  useEffect(() => {
    const own: BoxWorkHandle = {
      accept(code) {
        if (!bin) return onAlert(NO_BIN_MESSAGE);
        if (done.current) return onAlert(ALREADY_EXITED_MESSAGE, code);
        // 앞 스캔의 결과를 모르는 채 같은 상품을 또 찍으면 한 개가 두 번 빠진다
        if (!queue.ready || queue.error()) return onAlert(INTAKE_BLOCKED_MESSAGE, code);
        if (isReturnBinCode(code)) return onAlert('바구니 바코드예요 — 뺄 상품을 찍어 주세요.', code);
        if (cartOnly) return onAlert('박스에서 뺄 상품은 없어요. 카트 몫은 분류대에서 빠져요.', code);
        queue.enqueue({ barcode: code, returnBinBarcode: bin });
      },
      disarm: () => {},
      settle: () => queue.settle(),
    };
    handleRef.current = own;
    return () => {
      if (handleRef.current === own) handleRef.current = null;
    };
  });

  return (
    <WorkGrid
      intake={queue.ready && !queue.error() ? 'open' : 'blocked'}
      left={
        <>
          <BoxCard trackingNo={box.trackingNo} recipient={box.recipientMasked} deliveryNote={box.deliveryNote} />
          <BigPanel
            content={alert ? { kind: 'alert', ...alert } : { kind: 'notice', title: '뺄 상품', message: bin ? `바구니 ${bin}` : undefined }}
          />
          {!bin ? (
            <p role="alert" className="shrink-0 rounded-[10px] border-2 border-[#C8202F] bg-[#FDE8EA] p-3 font-semibold text-[#9E1320]">
              {NO_BIN_MESSAGE}
            </p>
          ) : null}
          {queue.error() ? (
            <QueueTrouble storage={!!queue.storageError()} onRetry={() => void queue.retryHead().catch(() => {})} />
          ) : null}
        </>
      }
      right={
        <>
          <ul aria-label="뺄 상품" className="min-h-0 flex-1 overflow-auto rounded-[10px] border border-[#D5D8DE] bg-white">
            {rows.map((row) => (
              <li
                key={row.key}
                className={cn(
                  'flex h-[72px] items-center justify-between border-b border-[#E4E6EA] px-4 text-[17px]',
                  row.onCart && 'text-[#6B717D]'
                )}
              >
                <span className="font-semibold">
                  {row.label}
                  {row.onCart ? <span className="ml-2 rounded bg-[#E2E4E8] px-2 py-0.5 text-sm font-medium">카트</span> : null}
                </span>
                <span className="font-mono text-2xl font-semibold">{row.qty}</span>
              </li>
            ))}
          </ul>
          <RecentList entries={recent} />
        </>
      }
    />
  );
}
