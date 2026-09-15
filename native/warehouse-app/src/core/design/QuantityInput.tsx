import { useId } from 'react';
export function parseQuantity(
  text: string,
  min: number,
  max = 2147483647
): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) && value >= min && value <= max
    ? value
    : null;
}
export function QuantityInput({
  label,
  value,
  onChange,
  min,
  max,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min: 0 | 1;
  max?: number;
  disabled?: boolean;
}) {
  const id = useId();
  const invalid = parseQuantity(value, min, max) === null;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">
        {label} (낱개)
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        value={value}
        disabled={disabled}
        aria-invalid={invalid}
        aria-describedby={invalid ? `${id}-error` : undefined}
        className="w-full rounded border border-gray-300 px-3 py-2 text-lg"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.preventDefault();
        }}
      />
      {invalid && (
        <p id={`${id}-error`} className="text-sm text-amber-700">
          {min} 이상{max !== undefined ? ` ${max} 이하` : ''}의 정수를 입력해
          주세요.
        </p>
      )}
    </div>
  );
}
