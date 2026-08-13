'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

export type AccountHolderType = 'personal' | 'business';

interface PayerNumberFieldProps {
  holderType: AccountHolderType;
  onHolderTypeChange: (next: AccountHolderType) => void;
  value: string;
  onChange: (next: string) => void;
}

const MAX_LENGTH: Record<AccountHolderType, number> = { personal: 6, business: 10 };

export function PayerNumberField({ holderType, onHolderTypeChange, value, onChange }: PayerNumberFieldProps) {
  const isPersonal = holderType === 'personal';

  return (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">계좌 명의</Label>
        <RadioGroup
          value={holderType}
          onValueChange={(next) => {
            onHolderTypeChange(next as AccountHolderType);
            onChange('');
          }}
          className="grid grid-cols-2 gap-2"
        >
          {(['personal', 'business'] as const).map((type) => (
            <Label
              key={type}
              htmlFor={`holderType-${type}`}
              className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2.5 text-sm ${
                holderType === type ? 'border-primary bg-primary/5 font-medium' : 'border-input'
              }`}
            >
              <RadioGroupItem id={`holderType-${type}`} value={type} />
              {type === 'personal' ? '개인 명의' : '사업자 명의'}
            </Label>
          ))}
        </RadioGroup>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="payerNumber" className="text-xs text-muted-foreground">
          {isPersonal ? '예금주 생년월일 6자리' : '사업자등록번호 10자리'}
        </Label>
        <Input
          id="payerNumber"
          placeholder={isPersonal ? 'YYMMDD (예: 940124)' : '0000000000'}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, MAX_LENGTH[holderType]))}
          inputMode="numeric"
          required
        />
        <p className="min-h-[2.25rem] text-[11px] leading-relaxed text-muted-foreground">
          {isPersonal
            ? '주민등록번호 앞 6자리입니다. 사업자등록번호를 넣으면 은행 조회에서 거절됩니다.'
            : '계좌가 사업자(상호) 명의일 때만 선택하세요. 대표자 개인 계좌라면 ‘개인 명의’를 고르세요.'}
        </p>
      </div>
    </>
  );
}
