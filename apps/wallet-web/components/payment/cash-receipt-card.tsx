'use client';

import { useState } from 'react';
import { SectionCard } from '@/checkout-ui/domains/checkout/components/shared/section-card';
import { SheetSelect } from '@/components/ui/sheet-select';
import { Check } from 'lucide-react';
import { readCashReceiptPreference } from './cash-receipt';
import type { CashReceiptMethod, CashReceiptState, EvidenceType } from './cash-receipt';
import { DigitGroupInput } from './digit-group-input';

export * from './cash-receipt';

interface Props {
  value: CashReceiptState;
  onChange: (next: CashReceiptState) => void;
  /** 로그인 사용자의 휴대폰 — 소득공제 prefill 용. 숫자만. */
  userPhone: string;
  /** 로그인 사용자의 사업자번호 — 지출증빙 prefill 용. */
  userBizNumber: string;
}

const EVIDENCE_LABEL: Record<Exclude<EvidenceType, 'NONE'>, string> = {
  CASH_INCOME: '개인소득공제용',
  CASH_EXPENSE: '사업자지출증빙용(세금계산서 대용)',
};

const METHOD_LABEL: Record<CashReceiptMethod, string> = {
  PHONE: '휴대폰 번호',
  CARD: '현금영수증 카드번호',
};

export function CashReceiptCard({ value, onChange, userPhone, userBizNumber }: Props) {
  const requested = value.evidenceType !== 'NONE';
  const requestedType = value.evidenceType === 'CASH_EXPENSE' ? 'CASH_EXPENSE' : 'CASH_INCOME';
  const [editing, setEditing] = useState(false);

  function applyEvidence(next: EvidenceType) {
    if (next === 'NONE') {
      onChange({ ...value, evidenceType: 'NONE' });
      return;
    }
    const saved = readCashReceiptPreference();
    const useSaved = saved?.evidenceType === next;
    const method = useSaved ? saved.method : next === 'CASH_INCOME' ? 'PHONE' : value.method;
    const prefill = useSaved
      ? saved.number
      : next === 'CASH_INCOME'
        ? (method === 'PHONE' ? userPhone : '')
        : userBizNumber;
    onChange({ ...value, evidenceType: next, method, number: prefill, saveForNextTime: useSaved || value.saveForNextTime });
    setEditing(!prefill);
  }

  function applyMethod(method: CashReceiptMethod) {
    onChange({ ...value, method, number: method === 'PHONE' ? userPhone : '' });
  }

  const summaryNumberLabel = value.evidenceType === 'CASH_EXPENSE' ? '사업자등록번호' : METHOD_LABEL[value.method];

  return (
    <SectionCard
      title="현금영수증"
      headerRight={
        <div className="flex items-center gap-4">
          <RadioPill label="신청" checked={requested} onSelect={() => applyEvidence('CASH_INCOME')} />
          <RadioPill label="미신청" checked={!requested} onSelect={() => applyEvidence('NONE')} />
        </div>
      }
    >
      {!requested ? null : !editing ? (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[15px] font-bold text-gray-900">{EVIDENCE_LABEL[requestedType]}</p>
            <p className="mt-1 text-[13px] text-gray-600 lg:text-sm">
              {summaryNumberLabel} {formatDigits(value.number, value.evidenceType)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="shrink-0 rounded border border-gray-300 px-3 py-1.5 text-[13px] font-semibold text-gray-700 transition-colors hover:bg-gray-50"
          >
            변경
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-2">
            <RadioLine
              label={EVIDENCE_LABEL.CASH_INCOME}
              checked={value.evidenceType === 'CASH_INCOME'}
              onSelect={() => applyEvidence('CASH_INCOME')}
            />
            <RadioLine
              label={EVIDENCE_LABEL.CASH_EXPENSE}
              checked={value.evidenceType === 'CASH_EXPENSE'}
              onSelect={() => applyEvidence('CASH_EXPENSE')}
            />
          </div>

          {value.evidenceType === 'CASH_INCOME' && (
            <SheetSelect
              value={value.method}
              onChange={(v) => applyMethod(v as CashReceiptMethod)}
              title="현금영수증 신청"
              options={[
                { value: 'PHONE', label: METHOD_LABEL.PHONE },
                { value: 'CARD', label: METHOD_LABEL.CARD },
              ]}
              triggerClassName="flex h-11 w-full items-center justify-between rounded-md border border-gray-300 bg-white px-3 text-left text-[15px]"
            />
          )}

          <NumberField
            evidenceType={value.evidenceType}
            method={value.method}
            number={value.number}
            onNumberChange={(number) => onChange({ ...value, number })}
          />

          <SaveNextTimeCheckbox
            checked={value.saveForNextTime}
            onToggle={(checked) => onChange({ ...value, saveForNextTime: checked })}
          />

          <p className="text-[11px] text-gray-500 lg:text-xs">입금이 확인되면 현금영수증이 자동 발급됩니다.</p>
        </div>
      )}
    </SectionCard>
  );
}

function NumberField({
  evidenceType,
  method,
  number,
  onNumberChange,
}: {
  evidenceType: EvidenceType;
  method: CashReceiptMethod;
  number: string;
  onNumberChange: (value: string) => void;
}) {
  if (evidenceType === 'CASH_EXPENSE') {
    return <DigitGroupInput value={number} lengths={[3, 2, 5]} onChange={onNumberChange} ariaLabel="사업자등록번호" />;
  }

  if (method === 'PHONE') {
    return <DigitGroupInput value={number} lengths={[3, 4, 4]} onChange={onNumberChange} ariaLabel="휴대폰 번호" />;
  }

  return (
    <input
      inputMode="numeric"
      autoComplete="off"
      value={number}
      onChange={(e) => onNumberChange(e.target.value.replace(/[^0-9]/g, ''))}
      placeholder="현금영수증 카드번호"
      aria-label="현금영수증 카드번호"
      className="h-11 w-full rounded-md border border-gray-300 px-3 text-[15px] tabular-nums outline-none focus:border-gray-500"
    />
  );
}

function RadioPill({ label, checked, onSelect }: { label: string; checked: boolean; onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect} className="flex items-center gap-1.5" aria-pressed={checked}>
      <span
        className={`flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 ${
          checked ? 'border-[#ff6600]' : 'border-gray-300'
        }`}
      >
        {checked && <span className="h-2 w-2 rounded-full bg-[#ff6600]" />}
      </span>
      <span className={`text-[13px] ${checked ? 'font-semibold text-gray-900' : 'text-gray-500'}`}>{label}</span>
    </button>
  );
}

function RadioLine({ label, checked, onSelect }: { label: string; checked: boolean; onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect} className="flex w-full items-center gap-2 text-left" aria-pressed={checked}>
      <span
        className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 ${
          checked ? 'border-[#ff6600]' : 'border-gray-300'
        }`}
      >
        {checked && <span className="h-2 w-2 rounded-full bg-[#ff6600]" />}
      </span>
      <span className={`text-[14px] ${checked ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>{label}</span>
    </button>
  );
}

function SaveNextTimeCheckbox({ checked, onToggle }: { checked: boolean; onToggle: (checked: boolean) => void }) {
  return (
    <button type="button" onClick={() => onToggle(!checked)} className="flex items-center gap-2" aria-pressed={checked}>
      <span
        className={`flex h-[18px] w-[18px] items-center justify-center rounded-full ${
          checked ? 'bg-[#ff6600] text-white' : 'bg-gray-200 text-white'
        }`}
      >
        <Check className="h-3 w-3" strokeWidth={3} />
      </span>
      <span className={`text-[13px] ${checked ? 'text-gray-900' : 'text-gray-500'}`}>다음에도 사용할게요</span>
    </button>
  );
}

function formatDigits(digits: string, evidenceType: EvidenceType): string {
  if (!digits) return '-';
  const lengths = evidenceType === 'CASH_EXPENSE' ? [3, 2, 5] : [3, 4, 4];
  const parts: string[] = [];
  let offset = 0;
  for (const length of lengths) {
    const part = digits.slice(offset, offset + length);
    if (part) parts.push(part);
    offset += length;
  }
  const rest = digits.slice(offset);
  if (rest) parts.push(rest);
  return parts.join('-');
}
