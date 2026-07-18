import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { redirect } from 'next/navigation';
import { approveToss, getBillingMethods } from '@/lib/wallet-api';
import { getBackendAuthCookie } from '@/lib/auth/session-cookies';
import { buildReturnUrl } from '@/lib/return-url';
import { createWebLogger } from '@packages/web-observability';

// 쿠키 기반 + 동적 승인 처리라 CloudFront/Next 캐시 금지 (stale HTML/청크 방지).
export const dynamic = 'force-dynamic';

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

const logger = createWebLogger({
  component: 'wallet-web.payment.toss-complete',
  route: '/pay/[intentId]/toss-complete',
});

export default async function TossCompletePage({ params, searchParams }: Props) {
  const { intentId } = await params;
  const { paymentKey, orderId, amount, region } = await searchParams;

  logger.info('wallet.toss_complete.received', {
    attributes: {
      intent_id: intentId,
      order_id: orderId ?? null,
      amount: amount ?? null,
      region: region ?? null,
      has_payment_key: Boolean(paymentKey),
    },
  });

  if (!paymentKey || !orderId || !amount) {
    logger.warn('wallet.toss_complete.missing_params', {
      attributes: {
        intent_id: intentId,
        has_payment_key: Boolean(paymentKey),
        has_order_id: Boolean(orderId),
        has_amount: Boolean(amount),
      },
    });
    redirect(buildPayPath(intentId, region, { toss_fail: '1' }));
  }

  try {
    const result = await approveToss(intentId, paymentKey, orderId, Number(amount));
    logger.info('wallet.toss_complete.approved', {
      attributes: {
        intent_id: intentId,
        order_id: orderId,
        has_return_url: Boolean(result.returnUrl),
        billing_mode: result.metadata?.billingMode ?? null,
      },
    });

    if (result.returnUrl) {
      const successUrl = buildReturnUrl(result.returnUrl, {
        payment_intent_id: intentId,
        status: 'succeeded',
      });
      if (result.metadata?.billingMode === 'recurring') {
        // 승인은 이미 끝났다. billing-method 조회 실패가 결제 성공을 뒤집으면 안 되므로
        // 조회 오류는 삼키고 successUrl 로 진행한다 (billing-setup 은 재진입에서 처리 가능).
        try {
          const billingMethods = await getBillingMethods(await getBackendAuthCookie());
          if (billingMethods.length === 0) {
            logger.info('wallet.toss_complete.billing_setup_required', {
              attributes: {
                intent_id: intentId,
                order_id: orderId,
              },
            });
            redirect(`/pay/${intentId}/billing-setup?provider=TOSS&returnUrl=${encodeURIComponent(successUrl)}`);
          }
        } catch (e) {
          if (isRedirectError(e)) throw e;
          logger.error('wallet.toss_complete.billing_methods_lookup_failed', {
            error: e,
            attributes: { intent_id: intentId, order_id: orderId },
          });
        }
      }
      redirect(successUrl);
    }
    redirect(buildPayPath(intentId, region));
  } catch (e) {
    if (isRedirectError(e)) throw e;
    logger.error('wallet.toss_complete.approve_failed', {
      error: e,
      attributes: {
        intent_id: intentId,
        order_id: orderId,
      },
    });
    redirect(buildPayPath(intentId, region, { toss_fail: '1' }));
  }
}
