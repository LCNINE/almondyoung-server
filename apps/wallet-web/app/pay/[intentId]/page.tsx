import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { isAccessTokenUsable, selfOrigin } from '@/lib/auth/access-token';
import { SESSION_COOKIE_NAMES, backendAuthCookieFromToken } from '@/lib/auth/session-cookies';
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

  const cookieStore = await cookies();

  // 인증 가드 (구 Edge middleware 의 /pay 보호를 Node 런타임으로 이전).
  // access token 을 못 쓰면 /auth/ensure 로 보내 14일 refresh token 으로 먼저 갱신 시도한다.
  // (refresh 까지 죽었을 때만 ensure 가 /login silent SSO 로 떨어뜨린다.) Server Component 는
  // 쿠키를 못 바꾸므로 갱신은 Route Handler 인 ensure 가 수행. Node redirect 는 절대 URL Location
  // 을 유지해 iOS Chrome 에서도 정상 동작한다.
  const accessToken = cookieStore.get(SESSION_COOKIE_NAMES.ACCESS_TOKEN)?.value;
  if (!(await isAccessTokenUsable(accessToken))) {
    const internalPath = `/pay/${intentId}${region ? `?region=${region}` : ''}`;
    const ensurePath = `/auth/ensure?redirect_to=${encodeURIComponent(internalPath)}`;
    const origin = selfOrigin();
    redirect(origin ? `${origin}${ensurePath}` : ensurePath);
  }

  // 가드 통과 후: wallet-web 자기 access token 만 백엔드로 전달 (스토어프론트 부모도메인 쿠키 회피).
  const cookieHeader = backendAuthCookieFromToken(accessToken);

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
    region ? getAvailablePaymentMethods(region, cookieHeader).catch(() => []) : Promise.resolve(null),
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
