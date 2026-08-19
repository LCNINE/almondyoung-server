'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { CashReceiptMethod, CashReceiptState, EvidenceType } from './cash-receipt';

export * from './cash-receipt';

interface Props {
  value: CashReceiptState;
  onChange: (next: CashReceiptState) => void;
  /** 로그인 사용자의 휴대폰 — 소득공제 prefill 용. 숫자만. */
  userPhone: string;
  /** 로그인 사용자의 사업자번호 — 지출증빙 prefill 용. */
  userBizNumber: string;
}

export function CashReceiptCard({ value, onChange, userPhone, userBizNumber }: Props) {
  // 증빙 종류 선택 시 번호 prefill: 소득공제·휴대폰 → 사용자 휴대폰, 지출증빙 → 사업자번호.
  function handleEvidenceChange(next: EvidenceType) {
    if (next === 'CASH_INCOME') {
      onChange({ evidenceType: next, method: 'PHONE', number: userPhone });
    } else if (next === 'CASH_EXPENSE') {
      onChange({ evidenceType: next, method: value.method, number: userBizNumber });
    } else {
      onChange({ evidenceType: next, method: value.method, number: '' });
    }
  }

  // 소득공제 발급방법 변경: 휴대폰 → 사용자 휴대폰 prefill, 현금영수증카드 → 비움(수동 입력).
  function handleMethodChange(method: CashReceiptMethod) {
    onChange({ ...value, method, number: method === 'PHONE' ? userPhone : '' });
  }

  return (
    <Card className="border shadow-sm border-border/60">
      <CardContent className="p-6">
        <span className="block mb-4 text-sm font-semibold">증빙 신청 (선택)</span>

        <div className="flex items-center gap-3">
          <label className="w-20 text-sm shrink-0 text-muted-foreground">증빙</label>
          <Select value={value.evidenceType} onValueChange={(v) => handleEvidenceChange(v as EvidenceType)}>
            <SelectTrigger className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NONE">신청 안 함</SelectItem>
              <SelectItem value="CASH_INCOME">현금영수증 (개인소득공제용)</SelectItem>
              <SelectItem value="CASH_EXPENSE">현금영수증 (사업자지출증빙용)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {value.evidenceType === 'CASH_INCOME' && (
          <div className="mt-3 space-y-3">
            <div className="flex items-center gap-3">
              <label className="w-20 text-sm shrink-0 text-muted-foreground">발급방법</label>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="cashMethod"
                    checked={value.method === 'PHONE'}
                    onChange={() => handleMethodChange('PHONE')}
                  />
                  휴대폰
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="cashMethod"
                    checked={value.method === 'CARD'}
                    onChange={() => handleMethodChange('CARD')}
                  />
                  현금영수증카드
                </label>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <label className="w-20 text-sm shrink-0 text-muted-foreground">
                {value.method === 'PHONE' ? '휴대폰' : '카드번호'}
              </label>
              <input
                inputMode="numeric"
                autoComplete="off"
                value={value.number}
                onChange={(e) => onChange({ ...value, number: e.target.value })}
                placeholder={value.method === 'PHONE' ? '01012345678' : '현금영수증 카드번호'}
                className="flex-1 px-3 py-2 text-sm border rounded-md"
              />
            </div>
            <p className="text-xs text-muted-foreground">입금이 확인되면 현금영수증이 자동 발급됩니다.</p>
          </div>
        )}

        {value.evidenceType === 'CASH_EXPENSE' && (
          <div className="mt-3 space-y-3">
            <div className="flex items-center gap-3">
              <label className="w-20 text-sm shrink-0 text-muted-foreground">사업자번호</label>
              <input
                inputMode="numeric"
                autoComplete="off"
                value={value.number}
                onChange={(e) => onChange({ ...value, number: e.target.value })}
                placeholder="사업자등록번호 (1234567890)"
                className="flex-1 px-3 py-2 text-sm border rounded-md"
              />
            </div>
            <p className="text-xs text-muted-foreground">입금이 확인되면 현금영수증이 자동 발급됩니다.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
