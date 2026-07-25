import { useEffect, useState } from 'react';
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
  onSubmit,
  onCancel,
}: {
  item: PendingPlanItem;
  /** 부모가 스캔마다 더해 주는 누적 증가분. 0 이면 프리필만 쓴다. */
  scanBump: number;
  pending: boolean;
  onSubmit: (quantity: number) => void;
  onCancel: () => void;
}) {
  const [qty, setQty] = useState(item.pendingQty);

  // 스캔 누적: 부모가 올린 증가분을 그대로 더한다. 첫 스캔에서 프리필을 밀어내지
  // 않도록, bump 가 0 에서 처음 올라갈 때는 프리필을 버리고 스캔값만 센다.
  useEffect(() => {
    if (scanBump <= 0) return;
    setQty(scanBump);
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
      </div>
    </div>
  );
}
