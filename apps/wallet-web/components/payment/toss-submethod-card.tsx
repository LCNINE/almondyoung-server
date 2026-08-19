'use client';

import { Card, CardContent } from '@/components/ui/card';

// 토스페이먼츠는 카드결제만 사용한다. (휴대폰/계좌이체/가상계좌 비노출)
export const TOSS_SUB_METHODS = [
  { value: 'CARD' as const, label: '카드 / 간편결제', desc: '카드, 카카오페이, 네이버페이, 토스페이 등' },
] as const;

export type TossSubMethod = (typeof TOSS_SUB_METHODS)[number]['value'];

interface Props {
  value: TossSubMethod;
  onChange: (value: TossSubMethod) => void;
}

export function TossSubMethodCard({ value, onChange }: Props) {
  // 선택지가 하나뿐이면 고를 게 없다.
  if (TOSS_SUB_METHODS.length <= 1) return null;

  return (
    <Card className="border shadow-sm border-border/60">
      <CardContent className="p-6">
        <span className="block mb-4 text-sm font-semibold">결제 방식 선택</span>
        <div className="space-y-2">
          {TOSS_SUB_METHODS.map(({ value: optionValue, label, desc }) => {
            const isSelected = value === optionValue;
            return (
              <button
                key={optionValue}
                type="button"
                onClick={() => onChange(optionValue)}
                className={[
                  'w-full flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors',
                  isSelected
                    ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                    : 'border-border bg-background hover:bg-accent/50',
                ].join(' ')}
              >
                <div
                  className={[
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                    isSelected ? 'border-primary' : 'border-muted-foreground/40',
                  ].join(' ')}
                >
                  {isSelected && <div className="h-1.5 w-1.5 rounded-full bg-primary" />}
                </div>
                <div>
                  <span className="text-sm font-medium">{label}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{desc}</span>
                </div>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
