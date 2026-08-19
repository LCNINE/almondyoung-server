import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { redirect } from 'next/navigation';
import { createWebLogger } from '@packages/web-observability';

import { approveToss } from '@/lib/wallet-api';
import { getCheckoutRegion } from '@/lib/auth/session-cookies';

import { finalizeOrder } from '../finalize';

// 승인 → 주문 확정을 그 자리에서 처리한다. 캐시되면 안 된다.
export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ intent?: string; paymentKey?: string; orderId?: string; amount?: string }>;
}

const logger = createWebLogger({
  component: 'wallet-web.checkout.toss-complete',
  route: '/checkout/toss-complete',
});

export default async function CheckoutTossCompletePage({ searchParams }: Props) {
  const { intent: intentId, paymentKey, orderId, amount } = await searchParams;
  const region = (await getCheckoutRegion()) ?? 'kr';
  const storefrontOrigin = process.env.STOREFRONT_ORIGIN ?? '';

  if (!intentId || !paymentKey || !orderId || !amount) {
    logger.warn('wallet.checkout_toss_complete.missing_params', {
      attributes: { intent_id: intentId ?? null, has_payment_key: Boolean(paymentKey) },
    });
    redirect(`/checkout?toss_fail=1${intentId ? `&intent=${intentId}` : ''}`);
  }

  try {
    // Idempotency-Key 가 결정론적(toss-approve:{intentId}:{paymentKey})이라 재진입해도 안전하다.
    await approveToss(intentId, paymentKey, orderId, Number(amount));
  } catch (e) {
    if (isRedirectError(e)) throw e;
    logger.error('wallet.checkout_toss_complete.approve_failed', {
      error: e,
      attributes: { intent_id: intentId, order_id: orderId },
    });
    redirect(`/checkout?toss_fail=1&intent=${intentId}`);
  }

  // 승인은 아직 staging 단계다(지연승인). 여기서 주문을 만들어야 실제 출금까지 확정된다 —
  // 재고가 모자라면 주문 생성이 실패하고 돈도 빠지지 않는다.
  const finalized = await finalizeOrder(intentId);

  if (finalized.type === 'error') {
    logger.error('wallet.checkout_toss_complete.finalize_failed', {
      attributes: { intent_id: intentId, message: finalized.message },
    });
    redirect(`/checkout/failed?intent=${intentId}`);
  }

  // 무통장은 이 경로로 오지 않지만, 방어적으로 주문내역으로 보낸다.
  if (finalized.type === 'awaiting_deposit') {
    redirect(`${storefrontOrigin}/${region}/mypage/order/list?justOrdered=1`);
  }

  const successUrl = `${storefrontOrigin}/${region}/checkout/success/${intentId}${
    finalized.orderId ? `?orderId=${encodeURIComponent(finalized.orderId)}` : ''
  }`;
  redirect(successUrl);
}
