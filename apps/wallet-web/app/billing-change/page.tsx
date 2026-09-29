import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getBillingMethods, getMyBusinessLicense } from '@/lib/wallet-api';
import { isAccessTokenUsable, selfOrigin } from '@/lib/auth/access-token';
import { SESSION_COOKIE_NAMES, getBackendAuthCookie } from '@/lib/auth/session-cookies';
import { STOREFRONT_ORIGIN, isSubscribeReturnUrl, safeReturnUrl } from '@/lib/return-url';
import { BillingChangeForm } from './billing-change-form';
import { PendingSignupResume } from './pending-signup-resume';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{
    returnUrl?: string;
    fail?: string;
    msg?: string;
    /** '1' 이면 심사 중 계좌가 있어도 새 계좌 등록 폼을 연다(고객이 직접 고른 경우). */
    register?: string;
  }>;
}

export default async function BillingChangePage({ searchParams }: Props) {
  const { returnUrl, fail, msg, register } = await searchParams;

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

  const safeReturn = safeReturnUrl(returnUrl, STOREFRONT_ORIGIN);
  const subscribeFlow = isSubscribeReturnUrl(safeReturn);

  // 가입 도중엔 심사 중 계좌도 본다 — 기본 조회는 승인된 계좌만 줘서, 계좌만 등록하고 떠났던 고객이
  // 다시 오면 같은 사람이 은행 심사를 한 번 더 걸게 됐다. 계좌 변경 화면은 조회를 바꾸지 않는다.
  const [methods, profile] = await Promise.all([
    getBillingMethods(await getBackendAuthCookie(), { includePendingMandate: subscribeFlow }),
    getMyBusinessLicense(accessToken),
  ]);
  const activeCms = methods.filter((m) => m.providerType === 'CMS_BATCH' && m.status === 'ACTIVE');
  const cmsBillingMethod = activeCms.find((m) => m.cmsMemberStatus !== 'PENDING');
  // 심사 중 계좌가 여럿이면 가장 최근에 등록한 것으로 잇는다.
  const pendingCmsMethod = activeCms
    .filter((m) => m.cmsMemberStatus === 'PENDING')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  if (subscribeFlow && !cmsBillingMethod && pendingCmsMethod && register !== '1') {
    return (
      <PendingSignupResume
        returnUrl={safeReturn}
        billingMethodId={pendingCmsMethod.id}
        displayName={pendingCmsMethod.displayName}
      />
    );
  }

  const initialError =
    fail === '1' ? decodeURIComponent(msg ?? '계좌 변경에 실패했습니다. 다시 시도해주세요.') : undefined;

  return (
    <BillingChangeForm
      returnUrl={safeReturn}
      billingMethodId={cmsBillingMethod?.id}
      initialPhone={profile?.phoneNumber ?? ''}
      initialError={initialError}
    />
  );
}
