import { useId, useState } from 'react';
import { Button } from '../../design/Button';
import { isCommandCode } from './commandPrefix';
import { useScanEmit } from './useScanner';
export function BarcodeInput({
  label = '바코드 입력',
  disabled,
  onSubmit,
}: {
  label?: string;
  disabled?: boolean;
  onSubmit: (code: string) => void;
}) {
  const [code, setCode] = useState('');
  const id = useId();
  const emit = useScanEmit();
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (disabled || !code.trim()) return;
        const value = code.trim();
        // 명령 바코드는 일반 구독자(onSubmit)가 아니라 셸로 간다 — 입력칸에 포커스가 있어도 같다(스펙 §5.3)
        if (isCommandCode(value)) emit({ code: value, source: 'hid', at: Date.now() });
        else onSubmit(value);
        setCode('');
      }}
    >
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block text-sm">
          {label}
        </label>
        <input
          id={id}
          value={code}
          disabled={disabled}
          autoComplete="off"
          onChange={(e) => setCode(e.target.value)}
          className="w-full rounded border px-3 py-2"
        />
      </div>
      <Button type="submit" disabled={disabled || !code.trim()}>
        입력
      </Button>
    </form>
  );
}
