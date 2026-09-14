import { useEffect, useRef, useState } from 'react';
import { Button } from '../../core/design/Button';
import { NumberPad } from '../../core/design/NumberPad';
import { cn } from '../../core/design/cn';
import type { ExpectedArrivalLine } from './types';

/** 목록 선택은 잔량을 제안하고, 스캔으로 열면 실제 스캔 수량부터 센다. */
export function ReceiveSheet({
  item,
  scanBump,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  item: ExpectedArrivalLine;
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
}) {
  const [qty, setQty] = useState(scanBump > 0 ? scanBump : item.outstandingQty);

  const baselineRef = useRef(scanBump);
  useEffect(() => {
    if (scanBump > baselineRef.current) {
      setQty(scanBump);
    }
  }, [scanBump]);

  const over = qty > item.outstandingQty;

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
            발주 {item.orderedQty} · 입고 {item.receivedQty} · 남은{' '}
            {item.outstandingQty}
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
          <fieldset disabled={pending}>
            <NumberPad value={qty} onChange={setQty} />
          </fieldset>
          {over ? (
            <p className="text-xs text-amber-700">
              남은 수량 {item.outstandingQty}개를 넘습니다 — 넘는 분량은
              간편입고로 받으세요
            </p>
          ) : null}
        </section>

        {error ? (
          <p role="alert" className="text-xs text-red-700">
            {error}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button
            type="button"
            className="flex-1 border border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
            disabled={pending}
            onClick={onCancel}
          >
            취소
          </Button>
          <Button
            type="button"
            className="flex-1"
            disabled={qty < 1 || over || pending}
            onClick={() => onSubmit(qty)}
          >
            입고
          </Button>
        </div>
      </div>
    </div>
  );
}
