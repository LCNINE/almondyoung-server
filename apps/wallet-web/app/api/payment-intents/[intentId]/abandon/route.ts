import { createWebLogger } from '@packages/web-observability';
import { proxyPaymentIntentAction } from '../proxy';

const logger = createWebLogger({
  component: 'wallet-web.payment-intent-proxy',
  route: '/api/payment-intents/[intentId]/abandon',
});

export async function POST(request: Request, { params }: { params: Promise<{ intentId: string }> }) {
  const { intentId } = await params;
  const failure = await request.json().catch(() => null);

  // 토스 결제창이 리다이렉트 없이 오류를 던지고 끝난 경우(PC 결제창 닫기 등) 그 사유는 여기서만 남는다.
  if (failure && typeof failure === 'object') {
    logger.warn('wallet.toss_checkout.failed', {
      attributes: {
        intent_id: intentId,
        code: typeof failure.code === 'string' ? failure.code : null,
        toss_message: typeof failure.message === 'string' ? failure.message : null,
        user_agent: request.headers.get('User-Agent'),
      },
    });
  }

  return proxyPaymentIntentAction(request, intentId, 'abandon');
}
