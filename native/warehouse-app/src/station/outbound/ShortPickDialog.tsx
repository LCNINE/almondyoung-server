import { useCallback, useRef, useState } from 'react';
import { cn } from '../../core/design/cn';
import { useHumanKeys } from '../../core/hardware/scan/useScanner';
import { SHORT_PICK_REASON_KEYS, type ShortPickDraftLine, type ShortPickReason } from '../../domains/outbound/shortPick';
import { useDigitCommands } from '../ActionRegistry';
import { Kbd } from '../Kbd';

/**
 * F9 결품(스펙 §7.1). `locked` 는 결과를 모르는 결품을 다시 보낼 때 — 보낸 것을 그대로 보이고 수량·사유를 바꾸지 않는다. 두 단계(계획이 정함): ① 수량 — ↑↓ 줄, 숫자 덮어쓰기(줄을 고른 뒤 첫 숫자)·이어 치기(상한 = 남은 수량),
 * Backspace, Enter 다음 ② 사유 — 1 재고 부족(기본)·2 파손, Enter 보냄. Esc 는 한 단계 뒤로(①에서는 닫기).
 * 키는 사람 키 채널로만 받는다 — 스캐너의 Enter 가 창을 확정하지 않는다. aria-modal 이라 셸이 기능키·키 명령을 막는다.
 */
export function ShortPickDialog({
  lines,
  initialReason = 'inventory_shortage',
  locked = false,
  busy,
  onConfirm,
  onCancel,
}: {
  lines: readonly ShortPickDraftLine[];
  initialReason?: ShortPickReason;
  locked?: boolean;
  busy: boolean;
  onConfirm(lines: Array<{ shipmentLineId: string; qty: number }>, reason: ShortPickReason): void;
  onCancel(): void;
}) {
  const [rows, setRows] = useState(() => lines.map((line) => ({ ...line })));
  const [selected, setSelected] = useState(0);
  const [fresh, setFresh] = useState(true);
  const [step, setStep] = useState<'qty' | 'reason'>('qty');
  const [reason, setReason] = useState<ShortPickReason>(initialReason);
  const total = rows.reduce((sum, row) => sum + row.qty, 0);

  const typeDigit = (digit: number) => {
    if (busy || locked) return;
    if (step === 'reason') {
      const picked = SHORT_PICK_REASON_KEYS.find((option) => option.key === String(digit));
      if (picked) setReason(picked.reason);
      return;
    }
    setRows((list) =>
      list.map((row, i) => (i === selected ? { ...row, qty: Math.min(row.max, fresh ? digit : row.qty * 10 + digit) } : row))
    );
    setFresh(false);
  };
  const next = () => {
    if (busy) return;
    if (step === 'qty') {
      if (total > 0) setStep('reason');
      return;
    }
    onConfirm(
      rows.map((row) => ({ shipmentLineId: row.shipmentLineId, qty: row.qty })),
      reason
    );
  };
  const back = () => {
    if (busy) return;
    if (step === 'reason') setStep('qty');
    else onCancel();
  };
  useHumanKeys((key: string) => {
    if (/^\d$/.test(key)) typeDigit(Number(key));
    else if (key === 'Enter') next();
    else if (key === 'Escape') back();
    else if (step === 'qty' && !busy && !locked && (key === 'ArrowUp' || key === 'ArrowDown')) {
      setSelected((i) => Math.max(0, Math.min(rows.length - 1, i + (key === 'ArrowUp' ? -1 : 1))));
      setFresh(true);
    } else if (step === 'qty' && !busy && !locked && key === 'Backspace') {
      setRows((list) => list.map((row, i) => (i === selected ? { ...row, qty: Math.floor(row.qty / 10) } : row)));
      setFresh(false);
    }
  });
  // 숫자 명령(%91%N)도 같은 칸에 — 등록은 한 번, 실행은 늘 마지막 렌더의 것
  const typeRef = useRef(typeDigit);
  typeRef.current = typeDigit;
  useDigitCommands(useCallback((digit: number) => typeRef.current(digit), []));

  const keepFocus = (e: React.MouseEvent) => e.preventDefault(); // 마우스로 눌러도 단추에 포커스가 남아 Enter 가 두 번 돌지 않게
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <section role="dialog" aria-modal="true" aria-label="결품" className="w-[640px] space-y-4 rounded-xl bg-white p-6 shadow-xl">
        <h2 className="text-2xl font-bold">결품</h2>
        {step === 'qty' ? (
          <table className="w-full border-collapse text-lg">
            <thead>
              <tr className="text-left text-[13px] font-semibold text-[#535968]">
                <th className="py-2">상품</th>
                <th className="w-24 py-2 text-right">남은</th>
                <th className="w-24 py-2 text-right">결품</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={row.shipmentLineId}
                  data-selected={String(i === selected)}
                  className={cn('h-14 border-t border-[#E4E6EA]', i === selected && 'bg-[#FFF1C7]')}
                >
                  <td className="font-semibold">{row.name}</td>
                  <td className="text-right font-mono text-[#535968]">{row.max}</td>
                  <td aria-label={`${row.name} 결품`} className="text-right font-mono text-2xl font-semibold">
                    {row.qty}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <ul aria-label="사유" className="space-y-2">
            {SHORT_PICK_REASON_KEYS.map((option) => (
              <li
                key={option.reason}
                data-selected={String(option.reason === reason)}
                className={cn(
                  'flex h-14 items-center gap-3 rounded-md border px-4 text-lg',
                  option.reason === reason ? 'border-[#1D5BD8] bg-[#E3ECFC] font-semibold' : 'border-[#D5D8DE]'
                )}
              >
                <Kbd>{option.key}</Kbd>
                {option.label}
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onMouseDown={keepFocus}
            onClick={back}
            disabled={busy}
            className="flex h-10 items-center gap-2 rounded-md border border-[#D5D8DE] bg-white pl-2 pr-3.5 text-sm font-medium"
          >
            <Kbd tone="light">Esc</Kbd>
            {step === 'qty' ? '닫기' : '뒤로'}
          </button>
          <button
            type="button"
            onMouseDown={keepFocus}
            onClick={next}
            disabled={busy || total === 0}
            className="flex h-10 items-center gap-2 rounded-md bg-[#15171C] pl-2 pr-3.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            <Kbd tone="light">Enter</Kbd>
            {step === 'qty' ? '다음' : '보내기'}
          </button>
        </div>
      </section>
    </div>
  );
}
