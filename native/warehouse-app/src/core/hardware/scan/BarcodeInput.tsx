import { useId, useState } from 'react';
import { Button } from '../../design/Button';
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
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (disabled || !code.trim()) return;
        onSubmit(code.trim());
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
