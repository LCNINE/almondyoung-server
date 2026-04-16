'use client';

// NicePay 빌링 등록 orderId는 결제 orderId(chargeId 기반)와 구분하기 위해 'B' 접미사 사용
const BILLING_REGIST_ORDER_SUFFIX = 'B';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { CheckCircle2, CreditCard, AlertCircle, RefreshCw, Smartphone } from 'lucide-react';

interface BillingSetupFormProps {
  intentId: string;
  returnUrl: string;
  provider?: string;
  userId?: string;
  tossClientKey: string;
  initialError?: string;
}

export function BillingSetupForm({ intentId, returnUrl, provider, userId, tossClientKey, initialError }: BillingSetupFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  // provider가 URL로 고정된 경우 탭 전환 불가, 미지정 시 사용자가 선택
  const lockedProvider = provider === 'TOSS' || provider === 'NICEPAY' ? provider : null;
  const [activeProvider, setActiveProvider] = useState<'TOSS' | 'NICEPAY'>(lockedProvider ?? 'TOSS');
  const effectiveProvider = lockedProvider ?? activeProvider;

  const [cardNo, setCardNo] = useState('');
  const [expYear, setExpYear] = useState('');
  const [expMonth, setExpMonth] = useState('');
  const [idNo, setIdNo] = useState('');
  const [cardPw, setCardPw] = useState('');

  const handleSkip = () => {
    router.replace(returnUrl);
  };

  const handleTossBillingAuth = async () => {
    setLoading(true);
    setError(null);
    try {
      const { loadTossPayments } = await import('@tosspayments/tosspayments-sdk');
      const tossPayments = await loadTossPayments(tossClientKey);
      // customerKey는 사용자별 고정 식별자 — userId 기반으로 일관성 유지
      const payment = tossPayments.payment({ customerKey: `user-${userId ?? intentId}` });
      const origin = window.location.origin;
      await payment.requestBillingAuth({
        method: 'CARD',
        successUrl: `${origin}/pay/${intentId}/billing-setup/toss-complete?returnUrl=${encodeURIComponent(returnUrl)}`,
        failUrl: `${origin}/pay/${intentId}/billing-setup?provider=TOSS&returnUrl=${encodeURIComponent(returnUrl)}&fail=1`,
      });
      // requestBillingAuth는 리다이렉트하므로 여기 도달하지 않음
    } catch {
      setError('토스페이먼츠 빌링 인증 중 오류가 발생했습니다. 다시 시도해주세요.');
      setLoading(false);
    }
  };

  const handleNicepaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const orderId = `${intentId.replace(/-/g, '').slice(0, 63 - BILLING_REGIST_ORDER_SUFFIX.length)}${BILLING_REGIST_ORDER_SUFFIX}`;

    try {
      const res = await fetch('/api/billing/nicepay-regist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ cardNo, expYear, expMonth, idNo, cardPw, orderId }),
      });

      const data = await res.json().catch(() => ({})) as { error?: string };

      if (!res.ok) {
        setError(data.error ?? '카드 등록에 실패했습니다. 카드 정보를 다시 확인해주세요.');
        return;
      }

      router.replace(returnUrl);
    } catch {
      setError('카드 등록 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted/40 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">

        {/* 결제 완료 알림 */}
        <Card className="border-emerald-200 bg-emerald-50/50 shadow-sm">
          <CardContent className="flex items-start gap-3 p-4">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
            <div>
              <p className="text-sm font-semibold text-emerald-800">첫 달 결제가 완료되었습니다!</p>
              <p className="mt-0.5 text-xs text-emerald-700">
                아래 카드를 등록하면 다음 달부터 자동으로 결제됩니다.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* 정기결제 안내 */}
        <Card className="border-amber-100 bg-amber-50/40 shadow-sm">
          <CardContent className="flex items-start gap-2.5 p-4">
            <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p className="text-xs text-amber-700">
              정기결제 카드를 등록하면 매월 같은 날 자동으로 결제됩니다.
              언제든지 마이페이지에서 해지할 수 있으며, 해지 시 남은 기간은 그대로 이용 가능합니다.
            </p>
          </CardContent>
        </Card>

        {/* 카드 등록 섹션 */}
        <Card className="shadow-sm">
          <CardContent className="p-6">
            <div className="mb-5 flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">자동결제 카드 등록</h2>
            </div>

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
                <Button
                  onClick={handleTossBillingAuth}
                  disabled={loading}
                  className="w-full h-11 font-semibold"
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      처리 중...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Smartphone className="h-4 w-4" />
                      토스페이먼츠로 카드 등록하기
                    </span>
                  )}
                </Button>
              </div>
            ) : (
              <form onSubmit={handleNicepaySubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="cardNo" className="text-xs text-muted-foreground">
                    카드번호
                  </Label>
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
                    <Label htmlFor="expYear" className="text-xs text-muted-foreground">
                      유효기간 (년)
                    </Label>
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
                    <Label htmlFor="expMonth" className="text-xs text-muted-foreground">
                      유효기간 (월)
                    </Label>
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
                  <Label htmlFor="cardPw" className="text-xs text-muted-foreground">
                    카드 비밀번호 앞 2자리
                  </Label>
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
                    '자동결제 카드 등록하기'
                  )}
                </Button>
              </form>
            )}

            <Separator className="my-4" />

            <button
              onClick={handleSkip}
              disabled={loading}
              className="w-full text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline disabled:opacity-50"
            >
              나중에 등록하기 (지금은 건너뛰기)
            </button>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          카드 정보는 암호화되어 안전하게 전송됩니다
        </p>
      </div>
    </div>
  );
}
