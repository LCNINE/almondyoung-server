import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { redirect } from 'next/navigation';
import { approveToss } from '@/lib/wallet-api';

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
    const result = await approveToss(intentId, paymentKey, orderId, Number(amount));
    console.log('[toss-complete] approveToss result:', result);
    if (result.returnUrl) {
      redirect(`${result.returnUrl}?payment_intent_id=${intentId}&status=succeeded`);
    }
    redirect(`/pay/${intentId}`);
  } catch (e) {
    if (isRedirectError(e)) throw e;
    console.error('[toss-complete] approveToss failed:', e);
    redirect(`/pay/${intentId}?toss_fail=1`);
  }
}
