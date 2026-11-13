import { useEffect, useRef, useState, type RefObject } from 'react';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { errorMessage } from '../../core/data/errorMessage';
import { ApiError } from '../../core/data/httpClient';
import { cn } from '../../core/design/cn';
import { BarcodeInput } from '../../core/hardware/scan/BarcodeInput';
import { useWorkScanQueue } from '../../core/hardware/scan/useWorkScanQueue';
import type { ShipmentByWaybill, WithdrawalRemoval } from '../../domains/outbound/types';
import { removeToReturnBin, withdrawalRows } from '../../domains/outbound/withdraw';
import { isReturnBinCode } from '../../domains/returns/returnBin';
import type { Alert, BoxWorkHandle, WithdrawCause } from './model';
import { BigPanel, BoxCard, QueueTrouble, RecentList, WorkGrid } from './panels';
import type { RecentEntry } from './recent';
import { INTAKE_BLOCKED_MESSAGE } from './useInspectionBox';

const ALREADY_EXITED_MESSAGE = '이미 다 뺀 박스예요 — 이 상품은 바구니에 넣지 마세요.';

export function WithdrawWork({
  box,
  seq,
  handleRef,
  cause,
  alert,
  recent,
  onAlert,
  onRemoved,
  onDone,
}: {
  box: ShipmentByWaybill;
  /** 부모가 이 화면에 붙인 번호 — 손잡이에 싣는다 */
  seq: number;
  handleRef: RefObject<BoxWorkHandle | null>;
  cause?: WithdrawCause;
  alert: Alert | null;
  recent: readonly RecentEntry[];
  onAlert(message: string, detail?: string): void;
  /** 최근 목록에 적을 것 — 서버가 알려 준 상품 이름, 옛 core 면 찍은 바코드 */
  onRemoved(label: string): void;
  onDone(box: ShipmentByWaybill, exitTo: ShipmentByWaybill['exitTo']): void;
}) {
  const api = useApiClient();
  const [removals, setRemovals] = useState<WithdrawalRemoval[]>(box.removals);
  const done = useRef(false);
  const queue = useWorkScanQueue<{ barcode: string }>(async (input, id) => {
    // 박스를 다 뺀 스캔 뒤에 줄 서 있던 스캔 — 보내지 않되, 손에 든 상품을 바구니에 넣지 않게 알린다
    if (done.current) {
      onAlert(ALREADY_EXITED_MESSAGE, input.barcode);
      return;
    }
    try {
      const result = await removeToReturnBin(api, { shipmentId: box.shipmentId, ...input, idempotencyKey: id });
      setRemovals(result.removals);
      onRemoved(result.removedSkuName ?? input.barcode);
      if (result.exited) {
        done.current = true;
        onDone(box, result.exitTo);
      }
    } catch (error) {
      onAlert(errorMessage(error, 'outbound'), input.barcode);
      if (!(error instanceof ApiError && error.outcome === 'rejected')) throw error;
    }
  }, `withdraw:${box.shipmentId}`);
  const rows = withdrawalRows(removals);
  const cartOnly = rows.length > 0 && rows.every((row) => row.onCart);

  const take = (code: string) => {
    if (done.current) return onAlert(ALREADY_EXITED_MESSAGE, code);
    // 앞 스캔의 결과를 모르는 채 같은 상품을 또 찍으면 한 개가 두 번 빠진다
    if (!queue.ready || queue.error()) return onAlert(INTAKE_BLOCKED_MESSAGE, code);
    if (isReturnBinCode(code)) return onAlert('바구니 바코드예요 — 뺄 상품을 찍어 주세요.', code);
    if (cartOnly) return onAlert('박스에서 뺄 상품은 없어요. 카트 몫은 분류대에서 빠져요.', code);
    queue.enqueue({ barcode: code });
  };

  // 부모가 상품 스캔·내려놓기에 쓰는 손잡이(InspectWork 와 같은 규칙 — 커밋 뒤에 건다)
  useEffect(() => {
    const own: BoxWorkHandle = {
      shipmentId: box.shipmentId,
      seq,
      accept: take,
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
            content={
              alert
                ? { kind: 'alert', ...alert }
                : cause === 'short-pick'
                  ? {
                      kind: 'notice',
                      title: '결품을 등록했어요',
                      message: '이 상자는 배치에서 빠져요. 담은 상품을 꺼내 찍고 되돌림 바구니에 넣어 주세요.',
                    }
                  : {
                      kind: 'notice',
                      title: '뺄 상품을 찍어 주세요',
                      message: '꺼낸 상품을 찍고 되돌림 바구니에 넣어 주세요.',
                    }
            }
          />
          <BarcodeInput label="상품 바코드 직접 입력" onSubmit={take} />
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
