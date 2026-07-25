import { useEffect, useRef, useState } from 'react';
import { Button } from '../../core/design/Button';
import { NumberPad } from '../../core/design/NumberPad';
import { cn } from '../../core/design/cn';
import type { PendingPlanItem } from './types';

/**
 * 예정 항목 하나의 실입고 수량을 확정한다.
 *
 * 초기값은 잔여수량이다 — 예정대로 다 온 경우가 가장 흔하므로 바로 [입고] 를
 * 누르면 끝난다. 같은 바코드를 다시 스캔하면 부모가 scanBump 를 올려 주고,
 * 이 시트는 그만큼 수량을 더한다(전수 검수 흐름).
 */
export function ReceiveSheet({
  item,
  scanBump,
  pending,
  error,
  onSubmit,
  onCancel,
  actionsHidden = false,
}: {
  item: PendingPlanItem;
  /**
   * 부모가 스캔마다 더해 주는 누적치. 시트를 스캔으로 열었다면 그 스캔 자체가
   * 이미 1 회로 반영된 값(예: packingUnit)으로 도착하고, 목록의 [입고] 버튼으로
   * 열었다면 0 으로 도착한다.
   */
  scanBump: number;
  pending: boolean;
  /** 직전 제출 실패 메시지. 시트가 화면 전체를 덮으므로 실패는 여기서 보여줘야
   *  보인다 — 뒤에 깔린 알림은 시트에 가려 작업자가 못 본다. */
  error?: string | null;
  onSubmit: (quantity: number) => void;
  onCancel: () => void;
  /** 위에 확인 다이얼로그가 떠 있는 동안 true. 다이얼로그도 [취소]/[입고] 를
   *  쓰므로, 이 시트의 버튼을 감춰 접근성 이름 충돌과 배경 조작을 동시에 막는다. */
  actionsHidden?: boolean;
}) {
  const [qty, setQty] = useState(item.pendingQty);

  // 마운트 시점의 scanBump 를 기준선으로 잡는다. 시트를 스캔으로 열었으면 이
  // 값이 이미 0 보다 크지만(그 스캔이 첫 개수), 프리필을 밀어내면 안 되므로
  // "기준선과 같다" 는 무시한다. 기준선을 넘어서는 변화(재스캔)만 실카운트로
  // 반영한다 — 안 그러면 시트를 연 스캔 자체가 안 세져 N 번 스캔에 N-1 개만
  // 입고되는 조용한 과소입고가 생긴다.
  const baselineRef = useRef(scanBump);
  useEffect(() => {
    if (scanBump > baselineRef.current) {
      setQty(scanBump);
    }
  }, [scanBump]);

  const over = qty > item.pendingQty;

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="입고 수량"
    >
      <div className="max-h-[90vh] w-full max-w-sm space-y-4 overflow-y-auto rounded-xl bg-white p-5 shadow-lg">
        <div>
          <div className="font-semibold text-gray-800">{item.skuName}</div>
          <div className="font-mono text-xs text-gray-500">{item.skuCode}</div>
          <div className="mt-1 text-xs text-gray-500">
            예정 {item.expectedQty} · 입고 {item.receivedQty} · 잔여 {item.pendingQty}
          </div>
        </div>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-700">입고 수량</h3>
          <div
            className={cn(
              'rounded-lg border p-2 text-center text-2xl font-semibold',
              qty >= 1 && !over
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : over
                  ? 'border-amber-500 bg-amber-50 text-amber-700'
                  : 'border-gray-200 bg-white text-gray-400'
            )}
          >
            {qty}
          </div>
          <NumberPad value={qty} onChange={setQty} />
          {over ? (
            <p className="text-xs text-amber-700">
              잔여({item.pendingQty})보다 {qty - item.pendingQty}개 많아요.
            </p>
          ) : null}
        </section>

        {error ? (
          <p role="alert" className="text-xs text-red-700">
            {error}
          </p>
        ) : null}

        {actionsHidden ? null : (
          <div className="flex gap-2">
            <Button
              type="button"
              className="flex-1 border border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
              onClick={onCancel}
            >
              취소
            </Button>
            <Button type="button" className="flex-1" disabled={qty < 1 || pending} onClick={() => onSubmit(qty)}>
              입고
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
