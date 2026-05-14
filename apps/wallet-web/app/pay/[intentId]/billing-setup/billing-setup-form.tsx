'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle2, RefreshCw, AlertCircle } from 'lucide-react';
import { CMS_BANKS } from '@/lib/cms-banks';

interface BillingSetupFormProps {
  returnUrl: string;
  initialError?: string;
  mode?: 'initial';
}

export function BillingSetupForm({ returnUrl, initialError, mode }: BillingSetupFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [done, setDone] = useState(false);

  const [paymentCompany, setPaymentCompany] = useState('');
  const [payerName, setPayerName] = useState('');
  const [payerNumber, setPayerNumber] = useState('');
  const [paymentNumber, setPaymentNumber] = useState('');

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/billing/cms-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ paymentCompany, payerName, payerNumber, paymentNumber }),
      });

      const data = await res.json().catch(() => ({})) as { error?: string };

      if (!res.ok) {
        setError(data.error ?? '계좌 등록에 실패했습니다. 정보를 다시 확인해주세요.');
        return;
      }

      setDone(true);
    } catch {
      setError('계좌 등록 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted/40 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">

        {mode !== 'initial' && !done && (
          <Card className="border-emerald-200 bg-emerald-50/50 shadow-sm">
            <CardContent className="flex items-start gap-3 p-4">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
              <div>
                <p className="text-sm font-semibold text-emerald-800">첫 달 결제가 완료되었습니다!</p>
                <p className="mt-0.5 text-xs text-emerald-700">
                  아래 계좌를 등록하면 다음 달부터 자동으로 출금됩니다.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {done ? (
          <Card className="border-emerald-200 bg-emerald-50/50 shadow-sm">
            <CardContent className="flex items-start gap-3 p-6">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
              <div>
                <p className="text-sm font-semibold text-emerald-800">계좌 등록이 접수되었습니다</p>
                <p className="mt-1 text-xs text-emerald-700">
                  효성 CMS 심사 후 1~2 영업일 내 최종 확정됩니다.
                  등록 완료 시 정기결제가 자동으로 시작됩니다.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="shadow-sm">
            <CardContent className="p-6">
              <div className="mb-5 flex items-center gap-2">
                <RefreshCw className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">자동이체 계좌 등록</h2>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="paymentCompany" className="text-xs text-muted-foreground">은행</Label>
                  <select
                    id="paymentCompany"
                    value={paymentCompany}
                    onChange={(e) => setPaymentCompany(e.target.value)}
                    required
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">은행 선택</option>
                    {CMS_BANKS.map((b) => (
                      <option key={b.code} value={b.code}>{b.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="payerName" className="text-xs text-muted-foreground">예금주명</Label>
                  <Input
                    id="payerName"
                    placeholder="홍길동"
                    value={payerName}
                    onChange={(e) => setPayerName(e.target.value)}
                    maxLength={15}
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="paymentNumber" className="text-xs text-muted-foreground">계좌번호</Label>
                  <Input
                    id="paymentNumber"
                    placeholder="숫자만 입력"
                    value={paymentNumber}
                    onChange={(e) => setPaymentNumber(e.target.value.replace(/\D/g, '').slice(0, 16))}
                    inputMode="numeric"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="payerNumber" className="text-xs text-muted-foreground">
                    생년월일 (개인 6자리) 또는 사업자번호 (법인 10자리)
                  </Label>
                  <Input
                    id="payerNumber"
                    placeholder="개인: YYMMDD · 법인: 사업자번호"
                    value={payerNumber}
                    onChange={(e) => setPayerNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    inputMode="numeric"
                    required
                  />
                </div>

                {error && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="text-xs">{error}</AlertDescription>
                  </Alert>
                )}

                <Button type="submit" disabled={loading} className="w-full h-11 font-semibold">
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      등록 중...
                    </span>
                  ) : (
                    '자동이체 계좌 등록하기'
                  )}
                </Button>
              </form>

              {mode !== 'initial' && (
                <button
                  type="button"
                  onClick={() => router.replace(returnUrl)}
                  disabled={loading}
                  className="mt-4 w-full text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline transition-colors disabled:opacity-50"
                >
                  나중에 등록하기 (건너뛰기)
                </button>
              )}
            </CardContent>
          </Card>
        )}

        {done && (
          <Button onClick={() => router.replace(returnUrl)} className="w-full h-11 font-semibold">
            확인
          </Button>
        )}

        <p className="text-center text-xs text-muted-foreground">
          계좌 정보는 암호화되어 효성 CMS에 안전하게 전송됩니다
        </p>
      </div>
    </div>
  );
}
