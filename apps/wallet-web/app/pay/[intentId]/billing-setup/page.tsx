import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { isAccessTokenUsable, selfOrigin } from '@/lib/auth/access-token';
import { SESSION_COOKIE_NAMES } from '@/lib/auth/session-cookies';
import { BillingSetupForm } from './billing-setup-form';

interface Props {
  params: Promise<{ intentId: string }>;
  searchParams: Promise<{ returnUrl?: string; fail?: string; msg?: string; mode?: string }>;
}

export default async function BillingSetupPage({ params, searchParams }: Props) {
  const { intentId } = await params;
  const { returnUrl, fail, msg, mode } = await searchParams;

  // 인증 가드 (구 Edge middleware 의 /pay 보호 이전). 로그인 후 /pay/{intentId} 로 복귀하면
  // 메인 page 가 recurring 을 판단해 billing-setup 으로 자동 재진입한다.
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(SESSION_COOKIE_NAMES.ACCESS_TOKEN)?.value;
  if (!(await isAccessTokenUsable(accessToken))) {
    const loginPath = `/login?redirect_to=${encodeURIComponent(`/pay/${intentId}`)}`;
    const origin = selfOrigin();
    redirect(origin ? `${origin}${loginPath}` : loginPath);
  }

  const initialError =
    fail === '1' ? decodeURIComponent(msg ?? '카드 등록에 실패했습니다. 다시 시도해주세요.') : undefined;

  return (
    <BillingSetupForm
      returnUrl={returnUrl ? decodeURIComponent(returnUrl) : '/'}
      initialError={initialError}
      mode={mode === 'initial' ? 'initial' : undefined}
    />
  );
}
