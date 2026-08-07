import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, MedusaError, Modules } from '@medusajs/framework/utils';
import { completeCartWorkflow } from '@medusajs/medusa/core-flows';
import { capturePaymentWorkflow } from '@medusajs/core-flows';
import {
  AWAITING_DEPOSIT_STATUS,
  fetchIntentStatus,
} from '../../../carts/middlewares/reject-awaiting-deposit-complete';

/**
 * intentId 로 결제 대상 카트를 서버사이드에서 찾아 주문을 완료한다.
 *
 * 스토어프론트 콜백은 보통 checkout cart id 를 들고 오지만, wallet 크로스도메인 리다이렉트로
 * sessionStorage 매핑이 유실되면 카트를 특정하지 못한다. 지연 승인 도입 전에는 그 경우
 * "wallet capture 웹훅이 주문을 만든다" 는 폴백이 있었지만, 지금은 승인 자체가 주문 생성
 * 시점에 일어나므로 아무도 카트를 완료하지 않으면 결제도 주문도 성립하지 않는다.
 * 이 엔드포인트가 그 폴백을 대체한다 — intent → payment_session → payment_collection → cart.
 *
 * 멱등: 이미 주문이 있으면 그 주문을 그대로 반환한다.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const intentId = req.params.intentId;
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const paymentModule = req.scope.resolve(Modules.PAYMENT);

  // 무통장 입금대기 주문은 이 경로로 완료하면 안 된다. almond-payment 가 AWAITING_DEPOSIT 을
  // 'authorized' 로 매핑하므로 완료 자체는 성공해버리고, 그러면 marker 없는 authorized 주문이 생겨
  // WMS 수집 게이트를 통과한다(미입금 출고). 정상 무통장 주문은 wallet 웹훅이 marker 와 함께
  // 선생성하므로 여기서 막아도 잃는 것이 없다. /store/carts/:id/complete 의 가드와 같은 정책.
  if ((await fetchIntentStatus(intentId, logger)) === AWAITING_DEPOSIT_STATUS) {
    res.status(409).json({
      message: '무통장 입금대기 주문은 입금 확인 후 자동으로 처리됩니다. 주문내역에서 확인해 주세요.',
      code: 'BANK_TRANSFER_AWAITING_DEPOSIT',
    });
    return;
  }

  const sessions = await paymentModule.listPaymentSessions({ data: { intentId } } as any, {
    select: ['id', 'payment_collection_id'],
  });
  const session = sessions[0];
  if (!session) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `No payment session for intent ${intentId}`);
  }

  const { data: collections } = await query.graph({
    entity: 'payment_collection',
    fields: ['id', 'cart.id', 'cart.completed_at'],
    filters: { id: (session as any).payment_collection_id },
  });
  const cartId = (collections[0] as any)?.cart?.id as string | undefined;
  if (!cartId) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `No cart for intent ${intentId}`);
  }
  const completedAt = (collections[0] as any)?.cart?.completed_at ?? null;

  const existingOrderId = await findOrderId(query, cartId);
  if (existingOrderId) {
    res.status(200).json({ type: 'order', order_id: existingOrderId, cart_id: cartId });
    return;
  }

  // 완료된 카트를 다시 완료하면 retrieveCart 가 비어 validate-cart-payments 가
  // `cart.payment_collection` 을 읽다 터진다. 그 에러가 그대로 나가면 결제·주문이 정상인데도
  // 스토어프론트가 실패 페이지를 띄운다. order_cart 링크는 주문 직후 레이스로 안 보일 수 있으므로
  // completed_at 을 같이 본다(이미 조회하고 있던 값이다).
  // order_id 없이 내려갈 수 있다(링크가 아직 안 보이는 순간). 성공 페이지는 intentId 로 주문을
  // 찾으므로 문제 없다 — 여기서 실패로 내리는 것보다 낫다.
  if (completedAt) {
    logger.info(
      `[store/payment-intents/complete] cart ${cartId} 는 이미 완료됨(${completedAt}) — 워크플로 재실행 없이 성공으로 응답한다`,
    );
    res.status(200).json({ type: 'order', cart_id: cartId });
    return;
  }

  const { errors, result } = await completeCartWorkflow(req.scope).run({
    input: { id: cartId },
    context: { transactionId: cartId },
    throwOnError: false,
  });

  if (errors?.[0]) {
    const error = errors[0].error as any;
    // 동시 호출(중복 콜백·capture 웹훅)이 먼저 완료시켰으면 주문은 이미 있다. 실패로 내려보내면
    // 정상 결제가 실패 페이지로 간다 — 주문이 생겼는지 다시 확인하고 있으면 성공으로 응답한다.
    const racedOrderId = await findOrderId(query, cartId);
    if (racedOrderId) {
      logger.info(
        `[store/payment-intents/complete] cart ${cartId} 완료 레이스 — 다른 호출이 만든 주문 ${racedOrderId} 을 반환한다`,
      );
      res.status(200).json({ type: 'order', order_id: racedOrderId, cart_id: cartId });
      return;
    }

    logger.warn(
      `[store/payment-intents/complete] completeCartWorkflow failed for cart ${cartId} intentId=${intentId}: ${error?.message}`,
    );
    res.status(200).json({
      type: 'error',
      cart_id: cartId,
      error: { message: error?.message, name: error?.name, type: error?.type },
    });
    return;
  }

  await captureCartPayment(req.scope, cartId, logger);

  res.status(200).json({ type: 'order', order_id: result.id, cart_id: cartId });
};

async function findOrderId(query: any, cartId: string): Promise<string | null> {
  const { data: links } = await query.graph({
    entity: 'order_cart',
    fields: ['cart_id', 'order_id'],
    filters: { cart_id: cartId },
  });
  return ((links[0] as any)?.order_id as string | undefined) ?? null;
}

/** 캡처 실패는 삼킨다 — 주문·승인은 이미 끝났고, 놓친 캡처는 웹훅/리컨실 잡이 맞춘다. */
async function captureCartPayment(scope: any, cartId: string, logger: any): Promise<void> {
  try {
    const query = scope.resolve(ContainerRegistrationKeys.QUERY);
    const { data: carts } = await query.graph({
      entity: 'cart',
      fields: ['id', 'payment_collection.payment_sessions.id'],
      filters: { id: cartId },
    });
    const sessionIds: string[] = ((carts[0] as any)?.payment_collection?.payment_sessions ?? [])
      .map((s: any) => s?.id)
      .filter(Boolean);

    const paymentModule = scope.resolve(Modules.PAYMENT);
    for (const sessionId of sessionIds) {
      const payment = (await paymentModule.listPayments({ payment_session_id: sessionId }, {}))[0];
      if (!payment || payment.captured_at || payment.canceled_at) continue;
      await capturePaymentWorkflow(scope).run({ input: { payment_id: payment.id } });
    }
  } catch (err) {
    logger.error(
      `[store/payment-intents/complete] capture failed for cart ${cartId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
