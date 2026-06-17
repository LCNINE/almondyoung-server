import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { redirect } from 'next/navigation';
import { approveToss, getBillingMethods } from '@/lib/wallet-api';
import { getBackendAuthCookie } from '@/lib/auth/session-cookies';
import { buildReturnUrl } from '@/lib/return-url';

interface Props {
  params: Promise<{ intentId: string }>;
  searchParams: Promise<{ paymentKey?: string; orderId?: string; amount?: string; region?: string }>;
}

function buildPayPath(intentId: string, region?: string, extra?: Record<string, string>) {
  const params = new URLSearchParams(extra);
  if (region) params.set('region', region);
  const query = params.toString();
  return `/pay/${intentId}${query ? `?${query}` : ''}`;
}

export default async function TossCompletePage({ params, searchParams }: Props) {
  const { intentId } = await params;
  const { paymentKey, orderId, amount, region } = await searchParams;

  console.log('[toss-complete] params:', { intentId, paymentKey, orderId, amount });

  if (!paymentKey || !orderId || !amount) {
    console.log('[toss-complete] missing searchParams, redirecting to fail');
    redirect(buildPayPath(intentId, region, { toss_fail: '1' }));
  }

  try {
    const result = await approveToss(intentId, paymentKey, orderId, Number(amount));
    console.log('[toss-complete] approveToss result:', result);

    if (result.returnUrl) {
      const successUrl = buildReturnUrl(result.returnUrl, {
        payment_intent_id: intentId,
        status: 'succeeded',
      });
      if (result.metadata?.billingMode === 'recurring') {
        const billingMethods = await getBillingMethods(await getBackendAuthCookie());
        if (billingMethods.length === 0) {
          redirect(`/pay/${intentId}/billing-setup?provider=TOSS&returnUrl=${encodeURIComponent(successUrl)}`);
        }
      }
      redirect(successUrl);
    }
    redirect(buildPayPath(intentId, region));
  } catch (e) {
    if (isRedirectError(e)) throw e;
    console.error('[toss-complete] approveToss failed:', e);
    redirect(buildPayPath(intentId, region, { toss_fail: '1' }));
  }
}
