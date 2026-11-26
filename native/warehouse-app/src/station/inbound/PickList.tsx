import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../core/design/cn';
import { useHumanKeys } from '../../core/hardware/scan/useScanner';
import { useDigitCommands } from '../ActionRegistry';

/**
 * 번호 붙은 고르기 목록(스펙 §5.3) — 상자 고르기와 «리스트에 없는 상자» 의 선적 고르기가 같이 쓴다.
 * 기본 선택 없음: 커서가 처음엔 어느 줄에도 없고 Enter 만 쳐서는 안 고른다. 숫자(·숫자 명령 바코드)·↑↓+Enter·클릭으로 고른다.
 * `disabled` 면 키·클릭을 받지 않는다(고른 뒤 보내는 중).
 */
export function PickList<T>({
  label,
  items,
  itemKey,
  render,
  onPick,
  disabled = false,
}: {
  label: string;
  items: readonly T[];
  itemKey(item: T): string;
  render(item: T): ReactNode;
  onPick(item: T): void;
  disabled?: boolean;
}) {
  const [cursor, setCursor] = useState(-1);
  const pick = useCallback(
    (index: number) => {
      const chosen = items[index];
      if (chosen) onPick(chosen);
    },
    [items, onPick]
  );
  const pickRef = useRef(pick);
  pickRef.current = pick;

  useHumanKeys(
    disabled
      ? null
      : (key: string) => {
          if (/^[1-9]$/.test(key)) pick(Number(key) - 1);
          else if (key === 'ArrowDown') setCursor(Math.min(cursor + 1, items.length - 1));
          else if (key === 'ArrowUp') setCursor(Math.max(cursor - 1, 0));
          else if (key === 'Enter' && cursor >= 0) pick(cursor);
        }
  );
  const digit = useCallback((n: number) => pickRef.current(n - 1), []);
  useDigitCommands(disabled ? null : digit);
  useEffect(() => setCursor(-1), [items]);

  return (
    <ul role="listbox" aria-label={label} className="min-h-0 flex-1 overflow-auto">
      {items.map((item, index) => (
        <li key={itemKey(item)} role="option" aria-selected={index === cursor}>
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setCursor(index);
              pick(index);
            }}
            className={cn(
              'grid w-full grid-cols-[48px_minmax(0,1fr)] items-center gap-3 border-b border-[#e4e4e7] px-4 py-3 text-left',
              index === cursor && 'bg-[#eff6ff]'
            )}
          >
            <span className="font-mono text-2xl font-semibold">{index + 1}</span>
            <span className="flex flex-col">{render(item)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
