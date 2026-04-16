import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { approveToss, getPaymentIntent } from '@/lib/wallet-api';
import { buildReturnUrl } from '@/lib/return-url';

interface Props {
  params: Promise<{ intentId: string }>;
  searchParams: Promise<{ paymentKey?: string; orderId?: string; amount?: string }>;
}

export default async function TossCompletePage({ params, searchParams }: Props) {
  const { intentId } = await params;
  const { paymentKey, orderId, amount } = await searchParams;

  console.log('[toss-complete] params:', { intentId, paymentKey, orderId, amount });

  if (!paymentKey || !orderId || !amount) {
    console.log('[toss-complete] missing searchParams, redirecting to fail');
    redirect(`/pay/${intentId}?toss_fail=1`);
  }

  try {
    const cookieStore = await cookies();
    const cookieHeader = cookieStore.toString();

    const [result, intent] = await Promise.all([
      approveToss(intentId, paymentKey, orderId, Number(amount)),
      getPaymentIntent(intentId, cookieHeader).catch(() => null),
    ]);
    console.log('[toss-complete] approveToss result:', result);

    if (result.returnUrl) {
      const successUrl = buildReturnUrl(result.returnUrl, {
        payment_intent_id: intentId,
        status: 'succeeded',
      });
      if (intent?.metadata?.billingMode === 'recurring') {
        redirect(`/pay/${intentId}/billing-setup?provider=TOSS&returnUrl=${encodeURIComponent(successUrl)}`);
      }
      redirect(successUrl);
    }
    redirect(`/pay/${intentId}`);
  } catch (e) {
    if (isRedirectError(e)) throw e;
    console.error('[toss-complete] approveToss failed:', e);
    redirect(`/pay/${intentId}?toss_fail=1`);
  }
}
