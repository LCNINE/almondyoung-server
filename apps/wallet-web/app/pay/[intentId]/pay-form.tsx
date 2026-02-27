'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { confirmPaymentIntent, cancelPaymentIntent } from '@/lib/wallet-api';
import type { PaymentIntent, PaymentMethod } from '@/lib/wallet-api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Lock,
  CreditCard,
  Smartphone,
  Wallet,
  AlertCircle,
  ShoppingBag,
  ChevronRight,
} from 'lucide-react';

interface Props {
  intent: PaymentIntent;
  methods: PaymentMethod[];
}

function getMethodIcon(type: string): ReactNode {
  switch (type) {
    case 'TOSS':
      return <Smartphone className="h-5 w-5" />;
    case 'CARD':
      return <CreditCard className="h-5 w-5" />;
    case 'BALANCE':
      return <Wallet className="h-5 w-5" />;
    default:
      return <CreditCard className="h-5 w-5" />;
  }
}

function formatAmount(amount: number, currency: string): string {
  if (currency === 'KRW') {
    return `${amount.toLocaleString('ko-KR')}원`;
  }
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
}

export function PayForm({ intent, methods }: Props) {
  const router = useRouter();
  const [selectedMethodId, setSelectedMethodId] = useState<string>(methods[0]?.id ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    if (!selectedMethodId) {
      setError('결제 수단을 선택해주세요.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await confirmPaymentIntent(intent.id, selectedMethodId);

      if (result.status === 'REQUIRES_ACTION' && result.nextAction?.type === 'TOSS_CHECKOUT') {
        const na = result.nextAction;
        const { loadTossPayments } = await import('@tosspayments/tosspayments-sdk');
        const tossPayments = await loadTossPayments(na.clientKey as string);
        const payment = tossPayments.payment({ customerKey: `user-${intent.userId}` });
        await payment.requestPayment({
          method: 'CARD',
          orderId: na.orderId as string,
          orderName: na.orderName as string,
          amount: { currency: 'KRW', value: na.amount as number },
          successUrl: `${window.location.origin}/pay/${intent.id}/toss-complete`,
          failUrl: `${window.location.origin}/pay/${intent.id}?toss_fail=1`,
        });
        return; // requestPayment redirects
      }

      if (result.returnUrl) {
        router.replace(`${result.returnUrl}?payment_intent_id=${intent.id}&status=succeeded`);
      } else {
        router.replace(`/pay/${intent.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '결제에 실패했어요.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel() {
    setLoading(true);
    setError(null);
    try {
      await cancelPaymentIntent(intent.id);
      if (intent.returnUrl) {
        router.replace(`${intent.returnUrl}?payment_intent_id=${intent.id}&status=canceled`);
      } else {
        router.replace(`/pay/${intent.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '취소에 실패했어요.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-muted/40">
      {/* 상단 보안 바 */}
      <div className="border-b bg-card">
        <div className="flex items-center justify-center gap-1.5 py-2.5">
          <Lock className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">안전한 결제</span>
        </div>
      </div>

      {/* 메인 콘텐츠 */}
      <div className="max-w-4xl mx-auto px-4 py-8 md:py-16">
        <div className="flex flex-col md:flex-row gap-6 md:gap-8 md:items-start">
          {/* 좌측 패널: 주문 요약 */}
          <div className="w-full md:w-[380px] md:shrink-0">
            <Card className="shadow-sm border border-border/60">
              <CardContent className="p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <ShoppingBag className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground font-mono">
                    #{intent.id.slice(-8).toUpperCase()}
                  </span>
                </div>
                <Separator />
                <div>
                  <p className="text-xs text-muted-foreground mb-1">결제 금액</p>
                  <p className="text-3xl font-bold">
                    {formatAmount(intent.payableAmount, intent.currency)}
                  </p>
                </div>
                {intent.expiresAt && (
                  <p className="text-xs text-muted-foreground">
                    만료: {new Date(intent.expiresAt).toLocaleString('ko-KR')}
                  </p>
                )}
                <div className="flex items-center gap-1.5 pt-1">
                  <Lock className="h-3 w-3 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">SSL 암호화로 보호됩니다</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 우측 패널: 결제수단 + CTA */}
          <div className="flex-1 space-y-4">
            {/* 결제수단 선택 카드 */}
            <Card className="shadow-sm border border-border/60">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-sm font-semibold">결제 수단 선택</span>
                  <Badge variant="secondary" className="text-xs">
                    {methods.length}
                  </Badge>
                </div>
                {methods.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-8 text-center">
                    <CreditCard className="h-8 w-8 text-muted-foreground/50" />
                    <p className="text-sm text-muted-foreground">
                      사용 가능한 결제 수단이 없습니다.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {methods.map((m) => {
                      const isSelected = selectedMethodId === m.id;
                      return (
                        <button
                          key={m.id}
                          onClick={() => setSelectedMethodId(m.id)}
                          className={[
                            'w-full flex items-center gap-3 rounded-lg border px-4 py-3.5 text-left transition-colors',
                            isSelected
                              ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                              : 'border-border bg-background hover:bg-accent/50',
                          ].join(' ')}
                        >
                          {/* 커스텀 라디오 점 */}
                          <div
                            className={[
                              'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                              isSelected ? 'border-primary' : 'border-muted-foreground/40',
                            ].join(' ')}
                          >
                            {isSelected && (
                              <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                            )}
                          </div>
                          {/* 아이콘 박스 */}
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                            {getMethodIcon(m.type)}
                          </div>
                          {/* 이름 */}
                          <span className="flex-1 text-sm font-medium">
                            {m.displayName || m.type}
                          </span>
                          {/* 선택 시 chevron */}
                          {isSelected && <ChevronRight className="h-4 w-4 text-primary" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 에러 */}
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* CTA */}
            <div className="space-y-2">
              <Button
                onClick={handleConfirm}
                disabled={loading || methods.length === 0}
                className="w-full h-12 text-sm font-semibold"
              >
                {loading ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    처리 중...
                  </>
                ) : (
                  <>
                    <Lock className="h-4 w-4" />
                    {formatAmount(intent.payableAmount, intent.currency)} 결제하기
                  </>
                )}
              </Button>
              <div className="flex justify-center">
                <button
                  onClick={handleCancel}
                  disabled={loading}
                  className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline transition-colors disabled:opacity-50"
                >
                  취소하기
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
