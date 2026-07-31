import { MedusaRequest, MedusaResponse, prepareRetrieveQuery } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { completeCartWorkflow } from '@medusajs/medusa/core-flows';
import { capturePaymentWorkflow } from '@medusajs/core-flows';
import { MedusaError } from '@medusajs/utils';
import { refetchCart } from '../../helpers';
import { defaultStoreCartFields } from '../../query-config';

/**
 * 주문 생성이 끝난 카트의 결제를 캡처한다.
 *
 * 지연 승인 흐름에서 PG 승인은 completeCartWorkflow 의 마지막 단계에서 일어나고, wallet 은 승인 직후
 * 자동 캡처하며 payment.intent.captured 웹훅을 쏜다. 그런데 그 웹훅은 워크플로가 아직 payment 행을
 * 만들기 전에 도착할 수 있어(카트 completed_at 은 이미 찍힌 상태) 캡처 투영이 유실될 수 있다.
 * 여기서 명시적으로 캡처를 돌려 Medusa 쪽 captured_at 을 결정적으로 만든다.
 *
 * 멱등: 이미 captured 면 skip 하고, wallet 캡처 API 도 CAPTURED intent 에 대해 no-op 이다.
 * 실패는 삼킨다 — 주문은 이미 생성됐고 결제도 이미 승인됐으므로 응답을 실패로 만들면 안 된다.
 * 놓친 캡처는 wallet 웹훅과 orphan-payment-reconcile 잡이 뒤늦게 맞춘다.
 */
async function capturePaymentForCart(scope: any, cartId: string, logger: any): Promise<void> {
  try {
    const query = scope.resolve(ContainerRegistrationKeys.QUERY);
    const { data: carts } = await query.graph({
      entity: 'cart',
      fields: ['id', 'payment_collection.payment_sessions.id'],
      filters: { id: cartId },
    });

    const sessionIds: string[] = (
      (carts[0] as any)?.payment_collection?.payment_sessions ?? []
    ).map((s: any) => s?.id).filter(Boolean);
    if (!sessionIds.length) return;

    const paymentModule = scope.resolve(Modules.PAYMENT);
    for (const sessionId of sessionIds) {
      const payments = await paymentModule.listPayments({ payment_session_id: sessionId }, {});
      const payment = payments[0];
      if (!payment || payment.captured_at || payment.canceled_at) continue;

      await capturePaymentWorkflow(scope).run({ input: { payment_id: payment.id } });
      logger.info(`[cart-complete] captured payment ${payment.id} for cart ${cartId}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[cart-complete] capture after completion failed for cart ${cartId}: ${msg}`);
  }
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const cart_id = req.params.id;

  const { errors, result } = await completeCartWorkflow(req.scope).run({
    input: { id: cart_id },
    context: { transactionId: cart_id },
    throwOnError: false,
  });

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  // 워크플로우에서 에러가 발생하면, 이는 주로 장바구니 유효성 검사, 결제,
  // 또는 재고 확인과 관련이 있습니다. 여기서는 소비자가 추가 조치를 취하고
  // 문제를 해결할 수 있도록 에러와 함께 장바구니를 반환합니다.
  if (errors?.[0]) {
    const error = errors[0].error;
    const statusOKErrors: string[] = [
      MedusaError.Types.PAYMENT_AUTHORIZATION_ERROR,
      MedusaError.Types.PAYMENT_REQUIRES_MORE_ERROR,
    ];

    // statusOKErrors 목록에 없는 에러가 발생하면, 이는 장바구니가 완료될 수 있는
    // 상태가 아니라는 의미입니다. 이런 경우에는 400 에러를 반환합니다.
    const cart = await refetchCart(
      cart_id,
      req.scope,
      (
        await prepareRetrieveQuery(
          {},
          {
            defaults: defaultStoreCartFields,
          },
        )
      ).remoteQueryConfig.fields,
    );

    if (!statusOKErrors.includes(error.type)) {
      throw error;
    }

    res.status(200).json({
      type: 'cart',
      cart,
      error: {
        message: error.message,
        name: error.name,
        type: error.type,
      },
    });
    return;
  }

  await capturePaymentForCart(req.scope, cart_id, req.scope.resolve(ContainerRegistrationKeys.LOGGER));

  const { data } = await query.graph({
    entity: 'order',
    fields: req.queryConfig.fields,
    filters: { id: result.id },
  });

  res.status(200).json({
    type: 'order',
    order: data[0],
  });
};
