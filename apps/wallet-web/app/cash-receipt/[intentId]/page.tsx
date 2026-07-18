import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { isAccessTokenUsable, selfOrigin } from '@/lib/auth/access-token';
import { SESSION_COOKIE_NAMES, backendAuthCookieFromToken } from '@/lib/auth/session-cookies';
import { getCashReceipts, getPaymentIntent } from '@/lib/wallet-api';
import { CashReceiptForm } from './cash-receipt-form';

// 쿠키 기반 인증 가드 + 주문별 데이터라 정적 프리렌더/ISR 캐시 금지 (404 캐시 방지).
export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ intentId: string }>;
}

export default async function CashReceiptPage({ params }: Props) {
  const { intentId } = await params;
  const cookieStore = await cookies();

  // /pay 와 동일한 인증 가드: access token 못 쓰면 /auth/ensure 로 refresh 우선.
  const accessToken = cookieStore.get(SESSION_COOKIE_NAMES.ACCESS_TOKEN)?.value;
  if (!(await isAccessTokenUsable(accessToken))) {
    const ensurePath = `/auth/ensure?redirect_to=${encodeURIComponent(`/cash-receipt/${intentId}`)}`;
    const origin = selfOrigin();
    redirect(origin ? `${origin}${ensurePath}` : ensurePath);
  }

  const cookieHeader = backendAuthCookieFromToken(accessToken);

  let intent;
  try {
    intent = await getPaymentIntent(intentId, cookieHeader);
  } catch {
    notFound();
  }

  const receipts = await getCashReceipts(intentId, cookieHeader);
  const active = receipts.find((r) => r.status === 'ISSUED') ?? null;

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="mb-1 text-xl font-semibold">현금영수증 발급</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        결제금액 {intent.payableAmount.toLocaleString()}원 ({intent.currency})
      </p>
      <CashReceiptForm intentId={intentId} active={active} />
    </main>
  );
}
