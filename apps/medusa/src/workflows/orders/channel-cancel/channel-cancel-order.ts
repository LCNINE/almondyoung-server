import type { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, MedusaError, Modules, OrderStatus } from '@medusajs/framework/utils';
import { cancelOrderWorkflow, refundPaymentWorkflow } from '@medusajs/medusa/core-flows';

import { paymentRefundLockKey } from '../../../modules/almond-payment/refund-data';
import { toNumber } from '../partial-cancel/amount';
import { orderPaymentIds } from '../partial-cancel/partial-cancel-order';

/** 환불 + 취소가 넉넉히 들어가게 잡는다 — 레디스 잠금은 timeout 이 곧 만료다 */
const ORDER_LOCK_TIMEOUT_SECONDS = 120;
/** 부분취소·환불 투영과 같은 값. 이 잠금 안에서는 refundPaymentWorkflow 한 번만 돈다 */
const PAYMENT_LOCK_TIMEOUT_SECONDS = 30;

export type ChannelCancelInput = { orderId: string; actorId?: string };

/**
 * 채널 주문 전체취소 (#1016 36번 스펙 §4.6). 기본 /admin/orders/:id/cancel 은 환불 오류를 삼켜(core-flows refundPaymentsStep 의
 * .catch) 환불 없이 주문을 취소한다 — 여기선 환불을 «먼저», 오류가 올라오는 refundPaymentWorkflow 로 하고 그다음 기본 취소를 부른다.
 * 환불은 되돌릴 수 없으므로 취소가 거절될 주문은 환불 전에 거른다. 다시 부르면 남은 몫만 환불하고 취소를 이어 간다.
 */
export async function channelCancelOrder(container: MedusaContainer, input: ChannelCancelInput): Promise<void> {
  const locking = container.resolve(Modules.LOCKING);
  await locking.execute(`channel-cancel:${input.orderId}`, () => run(container, input), {
    timeout: ORDER_LOCK_TIMEOUT_SECONDS,
  });
}

async function run(container: MedusaContainer, input: ChannelCancelInput): Promise<void> {
  await assertCancelable(container, input.orderId);
  await refundRemaining(container, input.orderId, input.actorId);
  // 환불할 몫이 0 이라 그 안의 환불 단계는 아무것도 하지 않는다. 크레딧 라인은 위 환불이 이미 붙였다(빈 필터 → 0, 2026-10-11 실측)
  await cancelOrderWorkflow(container).run({ input: { order_id: input.orderId, canceled_by: input.actorId } });
}

async function assertCancelable(container: MedusaContainer, orderId: string): Promise<void> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: 'order',
    fields: ['id', 'status', 'fulfillments.canceled_at'],
    filters: { id: orderId },
  });
  // query.graph 의 링크 필드는 타입이 넓다 — 경계에서 필요한 칸으로만 좁힌다.
  const order = data[0] as { status?: string; fulfillments?: Array<{ canceled_at?: unknown } | null> } | undefined;
  if (!order) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order id not found: ${orderId}`);
  // 문장은 코어 throwIfOrderIsCancelled·cancelValidateOrder 와 같게 둔다 — channel-adapter 가 «이미 취소됨»을 이 문장으로 판정한다
  if (order.status === OrderStatus.CANCELED) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `Order with id ${orderId} has been canceled.`);
  }
  if ((order.fulfillments ?? []).some((f) => f !== null && !f.canceled_at)) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, 'All fulfillments must be canceled before canceling an order');
  }
}

/** 결제마다 «캡처 − 환불»을 돌려준다. 오류는 잡지 않는다 — 표지 붙은 MedusaError 는 400, 그 밖은 500 으로 나가고 취소는 시작하지 않는다 */
async function refundRemaining(container: MedusaContainer, orderId: string, actorId?: string): Promise<void> {
  const paymentModule = container.resolve(Modules.PAYMENT);
  const locking = container.resolve(Modules.LOCKING);
  for (const paymentId of await orderPaymentIds(container, orderId)) {
    await locking.execute(
      paymentRefundLockKey(paymentId),
      async () => {
        const p = await paymentModule.retrievePayment(paymentId, { relations: ['captures', 'refunds'] });
        if (p.canceled_at) return;
        const captured = (p.captures ?? []).reduce((s, x) => s + toNumber(x.amount), 0);
        const refunded = (p.refunds ?? []).reduce((s, x) => s + toNumber(x.amount), 0);
        const amount = captured - refunded;
        if (!(amount > 0)) return;
        await refundPaymentWorkflow(container).run({
          input: { payment_id: paymentId, amount, created_by: actorId, note: `channel-cancel:${orderId}` },
        });
      },
      { timeout: PAYMENT_LOCK_TIMEOUT_SECONDS },
    );
  }
}
