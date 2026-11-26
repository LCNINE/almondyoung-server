import { useEffect, useId, useRef } from 'react';
import { Button } from '../../core/design/Button';
import { NumberPad } from '../../core/design/NumberPad';
import { parseQuantity } from '../../core/design/QuantityInput';
import type { WaitingOrders } from './waitingOrders';
import { WaitingOrdersNote } from './WaitingOrdersNote';

// 스캐너는 글자를 수 ms 간격으로 몰아 보낸다 — ScanProvider 의 판정 간격과 같다.
const SCAN_GAP_MS = 50;
const SCAN_MIN_LENGTH = 3;

/**
 * 간편입고에서 상품을 고르면 뜨는 수량 창. 열리자마자 수량칸에 포커스가 있어 숫자를 치고
 * Enter 로 담고 Esc 로 닫는다. 수량칸에 포커스가 있으면 스캐너 글자가 칸으로 들어오므로,
 * 몰아 들어온 글자 끝의 Enter 는 담기가 아니라 스캔으로 보고 칸을 스캔 전 값으로 되돌린다.
 */
export function QuickQuantitySheet({
  skuName,
  skuCode,
  waiting,
  value,
  onChange,
  saving,
  notice,
  onSave,
  onCancel,
  onScanBlocked,
}: {
  skuName: string;
  skuCode: string;
  waiting: WaitingOrders | null;
  value: string;
  onChange: (value: string) => void;
  saving: boolean;
  notice: string | null;
  onSave: () => void;
  onCancel: () => void;
  onScanBlocked: () => void;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const burst = useRef({ at: -Infinity, length: 0, before: value });
  const quantity = parseQuantity(value, 1);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const add = (step: number) =>
    onChange(String((parseQuantity(value, 0) ?? 0) + step));

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-[#18181b55] p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={`${skuName} 입고 수량`}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        const at = event.timeStamp;
        if (event.key.length === 1) {
          if (at - burst.current.at > SCAN_GAP_MS)
            burst.current = { at, length: 0, before: value };
          burst.current.length += 1;
          burst.current.at = at;
          return;
        }

        if (event.key === 'Escape') {
          event.preventDefault();
          if (!saving) onCancel();
          return;
        }

        if (event.key !== 'Enter') return;
        event.preventDefault();
        const scanned =
          burst.current.length >= SCAN_MIN_LENGTH &&
          at - burst.current.at <= SCAN_GAP_MS;
        const before = burst.current.before;
        burst.current = { at: -Infinity, length: 0, before: value };
        if (scanned) {
          onChange(before);
          onScanBlocked();
          return;
        }

        if (quantity !== null && !saving) onSave();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-[440px] space-y-4 overflow-y-auto rounded-2xl border border-[#e4e4e7] bg-white p-7 text-[#27272a] shadow-[0_20px_80px_#18181b30] max-[600px]:p-[23px]">
        <div>
          <div className="text-xl font-bold text-[#27272a]">{skuName}</div>
          <div className="mt-1 font-mono text-xs text-[#71717a]">{skuCode}</div>
          <WaitingOrdersNote waiting={waiting} />
        </div>

        {notice ? (
          <p
            role="alert"
            className="rounded-[10px] border border-[#f0dcb4] bg-[#fffaf0] px-4 py-3 text-[13px] text-[#9a681c]"
          >
            {notice}
          </p>
        ) : null}

        <div className="space-y-1">
          <label htmlFor={id} className="block text-[13px] text-[#71717a]">
            입고 수량 직접 입력 (낱개)
          </label>
          <input
            ref={inputRef}
            id={id}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={value}
            disabled={saving}
            aria-invalid={quantity === null}
            className="w-full rounded-lg border border-[#e4e4e7] px-3 py-2.5 text-right text-2xl font-bold tabular-nums outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20"
            onChange={(e) => onChange(e.target.value)}
          />
          {quantity === null ? (
            <p className="text-[13px] text-[#9a681c]">1 이상의 정수를 입력해 주세요.</p>
          ) : null}
        </div>

        {/* 버튼이 포커스를 가져가지 않게 한다 — 누른 뒤에도 수량칸에 바로 칠 수 있다. */}
        <fieldset
          disabled={saving}
          className="space-y-2"
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className="rounded-lg border border-[#e4e4e7] bg-white py-2.5 text-sm font-semibold text-[#27272a] hover:bg-[#eff6ff]"
              onClick={() => add(1)}
            >
              +1
            </button>
            <button
              type="button"
              className="rounded-lg border border-[#e4e4e7] bg-white py-2.5 text-sm font-semibold text-[#27272a] hover:bg-[#eff6ff]"
              onClick={() => add(10)}
            >
              +10
            </button>
          </div>
          <NumberPad
            value={parseQuantity(value, 0) ?? 0}
            onChange={(next) => onChange(String(next))}
          />
        </fieldset>

        <div className="grid grid-cols-3 gap-2">
          <Button
            type="button"
            className="border border-[#e4e4e7] bg-white py-[13px] text-[#27272a] hover:bg-[#eff6ff] hover:brightness-100"
            disabled={saving}
            onClick={onCancel}
          >
            취소
          </Button>
          <Button
            type="button"
            className="col-span-2 py-[13px]"
            disabled={saving || quantity === null}
            onClick={onSave}
          >
            {quantity === null ? '담기' : `${quantity}개 담기`}
          </Button>
        </div>
      </div>
    </div>
  );
}
