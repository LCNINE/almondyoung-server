'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** 만원 단위 입력값을 "3,000만원" 처럼 즉시 환산해 보여준다 — 0 하나 더/덜 친 걸 바로 알아채라고 */
function previewManwon(raw: string): string | null {
  const manwon = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(manwon) || manwon <= 0) return null;

  if (manwon < 10_000) return `${manwon.toLocaleString('ko-KR')}만원`;

  const eok = Math.floor(manwon / 10_000);
  const rest = manwon % 10_000;
  return rest === 0
    ? `${eok}억원`
    : `${eok}억 ${rest.toLocaleString('ko-KR')}만원`;
}

type Props = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** 만원 단위 환산 표시 여부. 평수처럼 금액이 아닌 값은 false */
  money?: boolean;
  unit?: string;
};

export function MoneyInput({
  id,
  label,
  value,
  onChange,
  placeholder,
  disabled,
  money = true,
  unit,
}: Props) {
  const preview = money ? previewManwon(value) : null;

  return (
    <div className="grid gap-1">
      <Label htmlFor={id} className="text-muted-foreground text-xs font-normal">
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          type="number"
          min={0}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className={unit ? 'pr-10' : undefined}
        />
        {unit && (
          <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs">
            {unit}
          </span>
        )}
      </div>
      <p className="text-primary min-h-[1rem] text-xs">
        {preview ?? (money && value.trim() === '' ? '협의로 표시돼요' : '')}
      </p>
    </div>
  );
}
