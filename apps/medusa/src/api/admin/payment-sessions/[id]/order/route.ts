import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, MedusaError, Modules } from '@medusajs/framework/utils';

/**
 * 결제 세션으로 만들어진 주문이 있는가. 어드민 결제 상세가 결제는 됐는데 주문이 안 생긴 결제를 가려
 * 환불을 열 때 쓴다. 세션 id(wallet intent metadata.medusaSessionId)로 기본키·링크만 따라가므로
 * intentId 로 payment_session.data 를 훑는 경로(resolveOrderIdForIntent)보다 가볍다.
 */
export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const paymentModule = req.scope.resolve(Modules.PAYMENT);
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  const [session] = await paymentModule.listPaymentSessions(
    { id: req.params.id },
    { select: ['id', 'payment_collection_id'] },
  );
  if (!session) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Payment session ${req.params.id} not found`);

  const { data: collections } = await query.graph({
    entity: 'payment_collection',
    fields: ['id', 'cart.id', 'cart.completed_at'],
    filters: { id: session.payment_collection_id },
  });
  const cart = collections[0]?.cart;
  if (!cart) {
    res.json({ orderId: null, cartCompleted: false });
    return;
  }

  const { data: links } = await query.graph({
    entity: 'order_cart',
    fields: ['order_id'],
    filters: { cart_id: cart.id },
  });
  // 링크는 주문 직후 잠깐 안 보일 수 있다. completed_at 이 있으면 주문이 있는 것으로 본다
  res.json({ orderId: links[0]?.order_id ?? null, cartCompleted: cart.completed_at != null });
};
