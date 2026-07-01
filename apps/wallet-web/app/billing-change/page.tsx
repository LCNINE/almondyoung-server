import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getBillingMethods } from '@/lib/wallet-api';
import { isAccessTokenUsable, selfOrigin } from '@/lib/auth/access-token';
import { SESSION_COOKIE_NAMES, getBackendAuthCookie } from '@/lib/auth/session-cookies';
import { BillingChangeForm } from './billing-change-form';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{
    returnUrl?: string;
    fail?: string;
    msg?: string;
  }>;
}

export default async function BillingChangePage({ searchParams }: Props) {
  const { returnUrl, fail, msg } = await searchParams;

  // 인증 가드 (pay/[intentId] 페이지와 동일 패턴). wallet_at access token 을 못 쓰면 /auth/ensure 로
  // 보내 14일 refresh token 으로 먼저 갱신한다 (refresh 까지 죽으면 ensure 가 /login silent SSO 로).
  // 이게 없으면 세션 없이 폼이 떠버려 제출 시 백엔드가 "Missing or invalid JWT cookie" 로 거부한다.
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(SESSION_COOKIE_NAMES.ACCESS_TOKEN)?.value;
  if (!(await isAccessTokenUsable(accessToken))) {
    const selfPath = `/billing-change${returnUrl ? `?returnUrl=${encodeURIComponent(returnUrl)}` : ''}`;
    const ensurePath = `/auth/ensure?redirect_to=${encodeURIComponent(selfPath)}`;
    const origin = selfOrigin();
    redirect(origin ? `${origin}${ensurePath}` : ensurePath);
  }

  const methods = await getBillingMethods(await getBackendAuthCookie());
  const cmsBillingMethod = methods.find((m) => m.providerType === 'CMS_BATCH' && m.status === 'ACTIVE');

  const initialError =
    fail === '1' ? decodeURIComponent(msg ?? '계좌 변경에 실패했습니다. 다시 시도해주세요.') : undefined;

  return (
    <BillingChangeForm
      returnUrl={returnUrl ? decodeURIComponent(returnUrl) : '/'}
      billingMethodId={cmsBillingMethod?.id}
      initialError={initialError}
    />
  );
}
