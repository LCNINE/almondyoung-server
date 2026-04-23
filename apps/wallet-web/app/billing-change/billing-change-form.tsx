'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CreditCard, AlertCircle, Smartphone } from 'lucide-react';

const BILLING_CHANGE_ORDER_SUFFIX = 'C';

interface BillingChangeFormProps {
  returnUrl: string;
  agreementId?: string;
  provider?: string;
  userId?: string;
  tossClientKey: string;
  initialError?: string;
}

export function BillingChangeForm({
  returnUrl,
  agreementId,
  provider,
  userId,
  tossClientKey,
  initialError,
}: BillingChangeFormProps) {
  const router = useRouter();
  const [sessionId] = useState(() => crypto.randomUUID().replace(/-/g, ''));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  const lockedProvider = provider === 'TOSS' || provider === 'NICEPAY' ? provider : null;
  const [activeProvider, setActiveProvider] = useState<'TOSS' | 'NICEPAY'>(lockedProvider ?? 'TOSS');
  const effectiveProvider = lockedProvider ?? activeProvider;

  const [cardNo, setCardNo] = useState('');
  const [expYear, setExpYear] = useState('');
  const [expMonth, setExpMonth] = useState('');
  const [idNo, setIdNo] = useState('');
  const [cardPw, setCardPw] = useState('');

  const handleTossBillingAuth = async () => {
    setLoading(true);
    setError(null);
    try {
      const { loadTossPayments } = await import('@tosspayments/tosspayments-sdk');
      const tossPayments = await loadTossPayments(tossClientKey);
      const payment = tossPayments.payment({ customerKey: `user-${userId ?? sessionId}` });
      const origin = window.location.origin;
      const failParams = new URLSearchParams({ provider: 'TOSS', returnUrl, fail: '1' });
      if (agreementId) failParams.set('agreementId', agreementId);
      const successParams = new URLSearchParams({ returnUrl });
      if (agreementId) successParams.set('agreementId', agreementId);
      await payment.requestBillingAuth({
        method: 'CARD',
        successUrl: `${origin}/billing-change/toss-complete?${successParams}`,
        failUrl: `${origin}/billing-change?${failParams}`,
      });
    } catch {
      setError('토스페이먼츠 빌링 인증 중 오류가 발생했습니다. 다시 시도해주세요.');
      setLoading(false);
    }
  };

  const handleNicepaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const orderId = `${sessionId.slice(0, 63 - BILLING_CHANGE_ORDER_SUFFIX.length)}${BILLING_CHANGE_ORDER_SUFFIX}`;

    try {
      const res = await fetch('/api/billing/nicepay-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ cardNo, expYear, expMonth, idNo, cardPw, orderId, agreementId }),
      });

      const data = await res.json().catch(() => ({})) as { error?: string };

      if (!res.ok) {
        setError(data.error ?? '카드 등록에 실패했습니다. 카드 정보를 다시 확인해주세요.');
        return;
      }

      router.replace(`${returnUrl}${returnUrl.includes('?') ? '&' : '?'}cardChanged=1`);
    } catch {
      setError('카드 등록 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted/40 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">
        <Card className="shadow-sm">
          <CardContent className="p-6">
            <div className="mb-5 flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">정기결제 카드 변경</h2>
            </div>
            <p className="mb-5 text-xs text-muted-foreground">
              새로 등록한 카드로 다음 결제부터 자동 청구됩니다.
            </p>

            {!lockedProvider && (
              <div className="mb-5 flex rounded-lg border bg-muted p-1 gap-1">
                <button
                  type="button"
                  onClick={() => { setActiveProvider('TOSS'); setError(null); }}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 rounded-md py-2 text-xs font-medium transition-colors',
                    activeProvider === 'TOSS'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Smartphone className="h-3.5 w-3.5" />
                  토스페이먼츠
                </button>
                <button
                  type="button"
                  onClick={() => { setActiveProvider('NICEPAY'); setError(null); }}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 rounded-md py-2 text-xs font-medium transition-colors',
                    activeProvider === 'NICEPAY'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <CreditCard className="h-3.5 w-3.5" />
                  직접 카드 입력
                </button>
              </div>
            )}

            {effectiveProvider === 'TOSS' ? (
              <div className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  토스페이먼츠 안전 페이지에서 카드 정보를 입력합니다.
                  카드 정보가 당사 서버를 거치지 않아 더 안전합니다.
                </p>
                {error && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="text-xs">{error}</AlertDescription>
                  </Alert>
                )}
                <Button onClick={handleTossBillingAuth} disabled={loading} className="w-full h-11 font-semibold">
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      처리 중...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Smartphone className="h-4 w-4" />
                      토스페이먼츠로 카드 변경하기
                    </span>
                  )}
                </Button>
              </div>
            ) : (
              <form onSubmit={handleNicepaySubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="cardNo" className="text-xs text-muted-foreground">카드번호</Label>
                  <Input
                    id="cardNo"
                    placeholder="숫자만 입력 (16자리)"
                    value={cardNo}
                    onChange={(e) => setCardNo(e.target.value.replace(/\D/g, '').slice(0, 16))}
                    inputMode="numeric"
                    autoComplete="cc-number"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="expYear" className="text-xs text-muted-foreground">유효기간 (년)</Label>
                    <Input
                      id="expYear"
                      placeholder="YY"
                      value={expYear}
                      onChange={(e) => setExpYear(e.target.value.replace(/\D/g, '').slice(0, 2))}
                      inputMode="numeric"
                      autoComplete="cc-exp-year"
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="expMonth" className="text-xs text-muted-foreground">유효기간 (월)</Label>
                    <Input
                      id="expMonth"
                      placeholder="MM"
                      value={expMonth}
                      onChange={(e) => setExpMonth(e.target.value.replace(/\D/g, '').slice(0, 2))}
                      inputMode="numeric"
                      autoComplete="cc-exp-month"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="idNo" className="text-xs text-muted-foreground">
                    생년월일 (개인) / 사업자번호 (법인)
                  </Label>
                  <Input
                    id="idNo"
                    placeholder="개인: YYMMDD (6자리)  ·  법인: 사업자번호 (10자리)"
                    value={idNo}
                    onChange={(e) => setIdNo(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    inputMode="numeric"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="cardPw" className="text-xs text-muted-foreground">카드 비밀번호 앞 2자리</Label>
                  <Input
                    id="cardPw"
                    type="password"
                    placeholder="••"
                    value={cardPw}
                    onChange={(e) => setCardPw(e.target.value.replace(/\D/g, '').slice(0, 2))}
                    inputMode="numeric"
                    autoComplete="cc-csc"
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
                    '카드 변경하기'
                  )}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          카드 정보는 암호화되어 안전하게 전송됩니다
        </p>
      </div>
    </div>
  );
}
