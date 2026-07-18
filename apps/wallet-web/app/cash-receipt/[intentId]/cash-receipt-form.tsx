'use client';

import { useState } from 'react';
import { issueCashReceipt, type CashReceipt, type CashReceiptType } from '@/lib/wallet-api';
import { isWalletSessionExpiredError, redirectToWalletLogin } from '@/lib/auth-expired';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface Props {
  intentId: string;
  active: CashReceipt | null;
}

export function CashReceiptForm({ intentId, active }: Props) {
  const [issued, setIssued] = useState<CashReceipt | null>(active);
  const [type, setType] = useState<CashReceiptType>('소득공제');
  const [number, setNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (issued) {
    return (
      <Alert>
        <AlertDescription>
          현금영수증이 발급되었습니다 ({issued.type}).{' '}
          {issued.receiptUrl && (
            <a href={issued.receiptUrl} target="_blank" rel="noreferrer" className="underline">
              영수증 보기
            </a>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    // 숫자만 (하이픈 제거) — 휴대폰번호/사업자번호 공통
    const digits = number.replace(/[^0-9]/g, '');
    if (digits.length < 8) {
      setError(type === '소득공제' ? '휴대폰번호를 정확히 입력해 주세요.' : '사업자등록번호를 정확히 입력해 주세요.');
      return;
    }
    setLoading(true);
    try {
      const receipt = await issueCashReceipt(intentId, type, digits);
      setIssued(receipt);
    } catch (err) {
      if (isWalletSessionExpiredError(err)) {
        redirectToWalletLogin();
        return;
      }
      setError(err instanceof Error ? err.message : '발급에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">발급 용도</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="type" checked={type === '소득공제'} onChange={() => setType('소득공제')} />
          소득공제 (개인 — 휴대폰번호)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="type" checked={type === '지출증빙'} onChange={() => setType('지출증빙')} />
          지출증빙 (사업자 — 사업자등록번호)
        </label>
      </fieldset>

      <div className="space-y-1">
        <label htmlFor="cr-number" className="text-sm font-medium">
          {type === '소득공제' ? '휴대폰번호' : '사업자등록번호'}
        </label>
        <input
          id="cr-number"
          inputMode="numeric"
          autoComplete="off"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          placeholder={type === '소득공제' ? '01012345678' : '1234567890'}
          className="w-full rounded-md border px-3 py-2 text-sm"
        />
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? '발급 중…' : '현금영수증 발급'}
      </Button>
    </form>
  );
}
