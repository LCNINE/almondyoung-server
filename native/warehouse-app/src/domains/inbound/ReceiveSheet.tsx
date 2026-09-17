import { type ReactNode } from 'react';
import { Button } from '../../core/design/Button';
import { QuantityInput, parseQuantity } from '../../core/design/QuantityInput';
import { NumberPad } from '../../core/design/NumberPad';
import { cn } from '../../core/design/cn';
import type { ExpectedArrivalLine } from './types';

/** 목록 선택은 잔량을 제안하고, 스캔으로 열면 실제 스캔 수량부터 센다. */
export function ReceiveSheet({
  item,
  quantityText,
  onQuantityChange,
  getQuantityText,
  pending = false,
  submitDisabled = false,
  inputDisabled = false,
  cancelDisabled = false,
  error,
  statusContent,
  recovery,
  onSubmit,
  onCancel,
}: {
  item: ExpectedArrivalLine;
  quantityText: string;
  onQuantityChange: (text: string) => void;
  getQuantityText?: () => string;
  pending?: boolean;
  submitDisabled?: boolean;
  inputDisabled?: boolean;
  cancelDisabled?: boolean;
  /** 직전 제출 실패 메시지. 시트가 화면 전체를 덮으므로 실패는 여기서 보여줘야
   *  보인다 — 뒤에 깔린 알림은 시트에 가려 작업자가 못 본다. */
  error?: string | null;
  /** 조회·복원 안내와 복구 조작. 입력 잠금 fieldset 밖에서 계속 조작할 수 있다. */
  statusContent?: ReactNode;
  /** 현재 스캔 오류 복구. 입력 잠금 fieldset 밖에서 계속 조작할 수 있다. */
  recovery?: ReactNode;
  onSubmit: (quantity: number) => void;
  onCancel: () => void;
}) {
  const qty = parseQuantity(quantityText, 1) ?? 0;
  const setQty = (next: number) => onQuantityChange(String(next));

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
            {quantityText}
          </div>
          <fieldset
            disabled={pending || inputDisabled}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                event.target instanceof HTMLInputElement
              ) {
                event.preventDefault();
                event.target.blur();
              }
            }}
          >
            <QuantityInput
              label="입고 수량 직접 입력"
              value={quantityText}
              onChange={onQuantityChange}
              min={1}
              max={item.outstandingQty}
            />
            <p className="mb-2 text-xs text-gray-500">
              직접 입력 후 Enter 또는 입력칸 밖을 눌러 스캔해 주세요.
            </p>
            <NumberPad
              value={qty}
              onChange={setQty}
              getValue={
                getQuantityText
                  ? () =>
                      parseQuantity(
                        getQuantityText(),
                        0,
                        Number.MAX_SAFE_INTEGER
                      ) ?? 0
                  : undefined
              }
            />
          </fieldset>
          {over ? (
            <p className="text-xs text-amber-700">
              남은 수량 {item.outstandingQty}개를 넘습니다. 발주 수량을 확인해
              주세요.
            </p>
          ) : null}
        </section>

        {error ? (
          <p role="alert" className="text-xs text-red-700">
            {error}
          </p>
        ) : null}

        {statusContent}

        {recovery}

        <div className="flex gap-2">
          <Button
            type="button"
            className="flex-1 border border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
            disabled={pending || cancelDisabled}
            onClick={onCancel}
          >
            취소
          </Button>
          <Button
            type="button"
            className="flex-1"
            disabled={qty < 1 || over || pending || submitDisabled}
            onClick={() => onSubmit(qty)}
          >
            입고
          </Button>
        </div>
      </div>
    </div>
  );
}
