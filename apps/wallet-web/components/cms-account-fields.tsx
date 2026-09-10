'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertCircle, CheckCircle2, Loader2, Search } from 'lucide-react';
import { CMS_BANKS } from '@/lib/cms-banks';
import { AccountHolderType, PayerNumberField } from '@/components/payer-number-field';
import { isValidPayerNumber } from '@/lib/payer-number';

export interface CmsAccountDetails {
  paymentCompany: string;
  payerName: string;
  paymentNumber: string;
  phone: string;
  holderType: AccountHolderType;
  payerNumber: string;
}

/** idle = 아직 확인 안 함, verified = 은행 확인 완료, unavailable = 실시간 확인 불가(등록은 진행 가능) */
export type CmsAccountCheckState = 'idle' | 'verified' | 'unavailable';

export const emptyCmsAccountDetails: CmsAccountDetails = {
  paymentCompany: '',
  payerName: '',
  paymentNumber: '',
  phone: '',
  holderType: 'personal',
  payerNumber: '',
};

interface CmsAccountFieldsProps {
  value: CmsAccountDetails;
  onChange: (next: CmsAccountDetails) => void;
  checkState: CmsAccountCheckState;
  onCheckStateChange: (next: CmsAccountCheckState) => void;
}

export function CmsAccountFields({ value, onChange, checkState, onCheckStateChange }: CmsAccountFieldsProps) {
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  const canCheck =
    value.paymentCompany.length === 3 && value.paymentNumber.length >= 4 && isValidPayerNumber(value.payerNumber);
  const isPayerNameLocked = checkState === 'verified' && Boolean(value.payerName);

  // 계좌를 특정하는 세 값 중 하나라도 바뀌면 직전 확인 결과는 무효다.
  const patch = (next: Partial<CmsAccountDetails>) => {
    const invalidates = 'paymentCompany' in next || 'paymentNumber' in next || 'payerNumber' in next;
    if (invalidates && checkState !== 'idle') {
      onCheckStateChange('idle');
      setCheckError(null);
    }
    onChange({ ...value, ...next });
  };

  const handleCheck = async () => {
    setChecking(true);
    setCheckError(null);
    try {
      const res = await fetch('/api/billing/cms-check-account', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentCompany: value.paymentCompany,
          paymentNumber: value.paymentNumber,
          payerNumber: value.payerNumber,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        verified?: boolean;
        payerName?: string | null;
        reason?: 'MISMATCH' | 'UNAVAILABLE' | null;
        message?: string | null;
      };
      if (!res.ok) {
        // 호출 상한(429)·인증·장애 — 어느 쪽도 «계좌가 틀렸다»는 확답이 아니므로 등록을 막지 않는다.
        setCheckError(data.error ?? '계좌 확인에 실패했습니다.');
        onCheckStateChange('unavailable');
        return;
      }
      if (data.verified) {
        onChange({ ...value, payerName: data.payerName ?? value.payerName });
        onCheckStateChange('verified');
        return;
      }
      setCheckError(data.message ?? '계좌를 확인하지 못했습니다.');
      onCheckStateChange(data.reason === 'UNAVAILABLE' ? 'unavailable' : 'idle');
    } catch {
      setCheckError('계좌 확인 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
      onCheckStateChange('unavailable');
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="paymentCompany" className="text-xs text-muted-foreground">
          은행
        </Label>
        <select
          id="paymentCompany"
          value={value.paymentCompany}
          onChange={(e) => patch({ paymentCompany: e.target.value })}
          required
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">은행 선택</option>
          {CMS_BANKS.map((b) => (
            <option key={b.code} value={b.code}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="paymentNumber" className="text-xs text-muted-foreground">
          계좌번호
        </Label>
        <Input
          id="paymentNumber"
          placeholder="숫자만 입력"
          value={value.paymentNumber}
          onChange={(e) => patch({ paymentNumber: e.target.value.replace(/\D/g, '').slice(0, 16) })}
          inputMode="numeric"
          required
        />
      </div>

      <PayerNumberField
        holderType={value.holderType}
        onHolderTypeChange={(holderType) => patch({ holderType, payerNumber: '' })}
        value={value.payerNumber}
        onChange={(payerNumber) => patch({ payerNumber })}
      />

      {checkState === 'verified' ? (
        <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <div>
            <p className="font-semibold text-emerald-900">계좌가 확인되었습니다</p>
            <p className="mt-0.5">
              {value.payerName ? (
                <>
                  예금주 <strong>{value.payerName}</strong> 님의 계좌입니다. 이대로 등록하면 은행 확인 단계에서 거절되지
                  않습니다.
                </>
              ) : (
                <>예금주명만 조회되지 않았습니다. 계좌의 실제 예금주 성함을 아래에 직접 입력해주세요.</>
              )}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full font-semibold"
            disabled={!canCheck || checking}
            onClick={handleCheck}
          >
            {checking ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                은행에 확인하는 중...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Search className="h-4 w-4" />
                계좌 확인하기
              </span>
            )}
          </Button>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            등록 전에 은행에 실시간으로 조회해 예금주를 확인합니다. 여기서 확인해두면 1~2 영업일 뒤에 거절되는 일을 막을
            수 있습니다.
          </p>
          {checkError && (
            <div
              className={`flex items-start gap-2 rounded-md border p-3 text-xs ${
                checkState === 'unavailable'
                  ? 'border-amber-200 bg-amber-50 text-amber-800'
                  : 'border-destructive/30 bg-destructive/5 text-destructive'
              }`}
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p>{checkError}</p>
                {checkState === 'unavailable' && (
                  <p className="mt-1">확인 없이도 계속 등록할 수 있지만, 정보가 다르면 1~2 영업일 뒤에 거절됩니다.</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="payerName" className="text-xs text-muted-foreground">
          예금주명
        </Label>
        <Input
          id="payerName"
          placeholder="홍길동"
          value={value.payerName}
          onChange={(e) => onChange({ ...value, payerName: e.target.value })}
          maxLength={15}
          // 조회로 «채워졌을 때만» 잠근다. 계좌는 확인됐는데 이름만 못 받아온 경우까지 잠그면
          // 빈 값 + readOnly + required 가 되어 등록이 아예 막힌다.
          readOnly={isPayerNameLocked}
          className={isPayerNameLocked ? 'bg-muted text-muted-foreground' : undefined}
          required
        />
        {isPayerNameLocked && <p className="text-[11px] text-muted-foreground">은행 조회로 확인된 예금주명입니다.</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="phone" className="text-xs text-muted-foreground">
          연락처
        </Label>
        <Input
          id="phone"
          placeholder="01012345678"
          value={value.phone}
          onChange={(e) => onChange({ ...value, phone: e.target.value.replace(/\D/g, '').slice(0, 20) })}
          inputMode="tel"
          required
        />
      </div>

      {checkState !== 'verified' && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <p className="mb-1 font-semibold text-amber-900">등록 전에 꼭 확인하세요</p>
          <p>
            자동이체는 은행에 등록된 <strong>계좌주 본인 정보로만</strong> 등록됩니다.
          </p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
            <li>예금주 성함이 신청 계좌의 실제 예금주와 같아야 합니다.</li>
            <li>생년월일(개인) 또는 사업자등록번호(법인)가 그 계좌 등록정보와 일치해야 합니다.</li>
            <li>본인 명의가 아닌 계좌(가족 계좌 등)로는 등록되지 않습니다.</li>
          </ul>
          <p className="mt-1.5">
            정보가 다르면 은행 확인 단계에서 <strong>등록이 거절</strong>되며, 다시 등록하셔야 합니다.
          </p>
        </div>
      )}
    </>
  );
}
