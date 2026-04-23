import { cookies } from 'next/headers';
import { BillingChangeForm } from './billing-change-form';

interface Props {
  searchParams: Promise<{
    returnUrl?: string;
    agreementId?: string;
    provider?: string;
    fail?: string;
    msg?: string;
  }>;
}

export default async function BillingChangePage({ searchParams }: Props) {
  const { returnUrl, agreementId, provider, fail, msg } = await searchParams;

  const cookieStore = await cookies();
  const token = cookieStore.get('accessToken')?.value;
  let userId: string | undefined;
  if (token) {
    try {
      const [, payload] = token.split('.');
      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { sub?: string };
      userId = decoded.sub;
    } catch {}
  }

  const initialError =
    fail === '1' ? decodeURIComponent(msg ?? '카드 등록에 실패했습니다. 다시 시도해주세요.') : undefined;

  return (
    <BillingChangeForm
      returnUrl={returnUrl ? decodeURIComponent(returnUrl) : '/'}
      agreementId={agreementId}
      provider={provider}
      userId={userId}
      tossClientKey={process.env.TOSS_CLIENT_KEY ?? ''}
      initialError={initialError}
    />
  );
}
