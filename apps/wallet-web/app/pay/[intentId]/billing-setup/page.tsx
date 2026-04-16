import { cookies } from 'next/headers';
import { getPaymentIntent } from '@/lib/wallet-api';
import { BillingSetupForm } from './billing-setup-form';

interface Props {
  params: Promise<{ intentId: string }>;
  searchParams: Promise<{ returnUrl?: string; provider?: string; fail?: string; msg?: string }>;
}

export default async function BillingSetupPage({ params, searchParams }: Props) {
  const { intentId } = await params;
  const { returnUrl, provider, fail, msg } = await searchParams;

  const cookieStore = await cookies();
  const intent = await getPaymentIntent(intentId, cookieStore.toString()).catch(() => null);

  const initialError =
    fail === '1' ? decodeURIComponent(msg ?? '카드 등록에 실패했습니다. 다시 시도해주세요.') : undefined;

  return (
    <BillingSetupForm
      intentId={intentId}
      returnUrl={returnUrl ? decodeURIComponent(returnUrl) : '/'}
      provider={provider}
      userId={intent?.userId}
      tossClientKey={process.env.TOSS_CLIENT_KEY ?? ''}
      initialError={initialError}
    />
  );
}
