import { ContainerRegistrationKeys } from '@medusajs/framework/utils';

// 무통장 입금대기(AWAITING_DEPOSIT) intent 의 cart 를 HTTP 로 complete 하는 것을 막는다.
//
// 배경: almond-payment 가 AWAITING_DEPOSIT 을 'authorized' 로 매핑하므로, 이 상태에서
// /store/carts/:id/complete 가 그대로 성공하면 marker(metadata.bank_transfer_status='awaiting_deposit')
// 없는 authorized 주문이 만들어진다. channel-adapter 의 WMS 수집 게이트는 'authorized + marker' 로만
// 미입금 주문을 거르므로, marker 없는 authorized 주문은 게이트를 통과해 미입금 출고로 샌다.
//
// 정상 무통장 주문은 wallet 의 awaiting_deposit 웹훅이 cart.metadata 에 marker 를 심은 뒤
// completeCartWorkflow 를 in-process 로 실행해 선생성한다 — HTTP 라우트를 거치지 않으므로 이
// 미들웨어에 절대 도달하지 않는다. 따라서 'HTTP 로 들어온 complete 인데 intent 가 AWAITING_DEPOSIT'
// 이면 비정상(직접 호출 / 레이스)이므로 거부해도 정상 흐름에 영향이 없다(주문은 웹훅이 만든다).
// 카드 intent 는 AWAITING_DEPOSIT 이 아니므로 항상 통과한다.

const AWAITING_DEPOSIT_STATUS = 'AWAITING_DEPOSIT';

/**
 * wallet 에서 intent 의 실시간 상태를 조회한다. Medusa 의 payment_session.status 는 complete 전엔
 * 아직 authorize 가 안 돼 'pending' 일 수 있고, authorize 후엔 AWAITING_DEPOSIT 과 카드-authorized 가
 * 모두 'authorized' 로 보여 구별되지 않는다. 권위 있는 출처는 wallet intent 뿐이다.
 *
 * 조회 실패는 null 을 돌려 fail-open 한다(카드 결제 정상 완료를 막지 않기 위함 — storefront 의
 * isAwaitingDepositIntent 와 동일 정책).
 */
async function fetchIntentStatus(intentId: string): Promise<string | null> {
  const base = process.env.WALLET_BASE_URL;
  const key = process.env.WALLET_API_KEY;
  if (!base || !key) return null;

  try {
    const res = await fetch(`${base}/v1/payment-intents/${intentId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { status?: string };
    return body?.status ?? null;
  } catch {
    return null;
  }
}

export const rejectAwaitingDepositCompleteMiddleware = async (req: any, res: any, next: any) => {
  const cartId = req.params?.id as string | undefined;
  if (!cartId) return next();

  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
    const { data: carts } = await query.graph({
      entity: 'cart',
      fields: ['id', 'payment_collection.payment_sessions.provider_id', 'payment_collection.payment_sessions.data'],
      filters: { id: cartId },
    });

    const sessions = (carts?.[0] as any)?.payment_collection?.payment_sessions ?? [];
    const intentId: string | undefined = sessions
      .filter((s: any) => typeof s?.provider_id === 'string' && s.provider_id.includes('almond-payment'))
      .map((s: any) => s?.data?.intentId)
      .find((id: unknown): id is string => typeof id === 'string' && id.length > 0);

    if (!intentId) return next();

    const status = await fetchIntentStatus(intentId);
    if (status === AWAITING_DEPOSIT_STATUS) {
      return res.status(409).json({
        message: '무통장 입금대기 주문은 입금 확인 후 자동으로 처리됩니다. 주문내역에서 확인해 주세요.',
        code: 'BANK_TRANSFER_AWAITING_DEPOSIT',
      });
    }
  } catch {
    // cart/세션 조회 자체가 실패하면 fail-open: 카드 등 정상 결제 완료를 막지 않는다.
    // (카드 intent 는 AWAITING_DEPOSIT 이 아니므로 marker 없는 미입금 주문이 생기지 않는다.)
  }

  return next();
};
