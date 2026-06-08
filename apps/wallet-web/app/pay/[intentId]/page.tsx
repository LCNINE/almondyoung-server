import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import {
  getPaymentIntent,
  getPaymentMethods,
  getPointsBalance,
  getBillingMethods,
  getAvailablePaymentMethods,
} from '@/lib/wallet-api';
import { buildReturnUrl } from '@/lib/return-url';
import { PayForm } from './pay-form';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { CheckCircle2, XCircle } from 'lucide-react';

interface Props {
  params: Promise<{ intentId: string }>;
  searchParams: Promise<{ region?: string }>;
}

export default async function PayPage({ params, searchParams }: Props) {
  const { intentId } = await params;
  const { region } = await searchParams;

  // 서버 컴포넌트에서 브라우저 쿠키를 wallet API로 직접 포워딩
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

  let intent;
  try {
    intent = await getPaymentIntent(intentId, cookieHeader);
  } catch {
    notFound();
  }

  const isRecurring = intent.metadata?.billingMode === 'recurring';

  const [methods, billingMethods, availableMethods] = await Promise.all([
    getPaymentMethods(cookieHeader).catch(() => []),
    isRecurring ? getBillingMethods(cookieHeader) : Promise.resolve([]),
    // region 미지정 → null (필터 미적용, 하위호환).
    // region 명시 → 가용 결제수단 목록. 조회 실패해도 [] 로 막아, 설정 안 된 리전에 다른 리전(KR) 수단이 새지 않게 한다.
    region
      ? getAvailablePaymentMethods(region, cookieHeader).catch(() => [])
      : Promise.resolve(null),
  ]);

  if (['AUTHORIZED', 'CAPTURED', 'SUCCEEDED'].includes(intent.status)) {
    const returnUrl = intent.returnUrl
      ? buildReturnUrl(intent.returnUrl, {
          payment_intent_id: intent.id,
          status: 'succeeded',
        })
      : null;
    return (
      <div className="min-h-screen bg-muted/40 flex items-center justify-center p-4">
        <Card className="w-full max-w-sm shadow-sm border border-border/60">
          <CardContent className="pt-10 pb-8 flex flex-col items-center gap-5 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
              <CheckCircle2 className="h-9 w-9 text-emerald-500" strokeWidth={1.5} />
            </div>
            <div className="space-y-1">
              <h1 className="text-xl font-semibold">결제가 완료되었어요</h1>
              <p className="text-sm text-muted-foreground">결제가 성공적으로 처리되었습니다.</p>
            </div>
            <Separator />
            {returnUrl ? (
              <Button asChild className="w-full h-10">
                <a href={returnUrl}>확인</a>
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">이 창을 닫아도 됩니다.</p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isRecurring && billingMethods.length === 0) {
    redirect(`/pay/${intentId}/billing-setup?mode=initial&returnUrl=${encodeURIComponent(`/pay/${intentId}`)}`);
  }
  const billingMethodsExist = isRecurring;

  const pointsBalance = await getPointsBalance(cookieHeader).catch(() => ({ confirmed: 0, reserved: 0, available: 0 }));

  if (intent.status === 'CANCELED') {
    return (
      <div className="min-h-screen bg-muted/40 flex items-center justify-center p-4">
        <Card className="w-full max-w-sm shadow-sm border border-border/60">
          <CardContent className="pt-10 pb-8 flex flex-col items-center gap-5 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
              <XCircle className="h-9 w-9 text-destructive" strokeWidth={1.5} />
            </div>
            <div className="space-y-1">
              <h1 className="text-xl font-semibold">결제가 취소되었어요</h1>
              <p className="text-sm text-muted-foreground">결제 요청이 취소되었습니다.</p>
            </div>
            <Separator />
            <p className="text-xs text-muted-foreground">이 창을 닫아도 됩니다.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <PayForm
      intent={intent}
      methods={methods}
      pointsBalance={pointsBalance}
      billingMethodsExist={billingMethodsExist}
      availableMethods={availableMethods}
      region={region ?? null}
    />
  );
}
