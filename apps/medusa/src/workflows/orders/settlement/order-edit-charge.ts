import type { MedusaContainer } from '@medusajs/framework/types';
import { ChangeActionType, Modules, OrderChangeStatus } from '@medusajs/framework/utils';
import {
  beginOrderEditOrderWorkflow,
  cancelBeginOrderEditWorkflow,
  confirmOrderEditRequestWorkflow,
  createOrderEditShippingMethodWorkflow,
  requestOrderEditRequestWorkflow,
} from '@medusajs/medusa/core-flows';

import { describeError } from '../../../utils/describe-error';

/**
 * 정산이 주문에 남기는 청구 — 열린 주문 수정 안에 배송 방법(custom_amount)을 더하고 이름을 바꾼다.
 * 이름이 «정산 청구»(SETTLEMENT_CHARGE_NAMES)라 다음 배송비 판정이 이 방법을 그룹의 원래 방법에서 뺀다.
 * 주문 수정을 열고 닫는 건 호출자다(부분취소는 수량 변경과 한 수정에 넣는다).
 */
export async function addChargeShippingMethod(
  container: MedusaContainer,
  input: { orderId: string; orderChangeId: string; shippingOptionId: string; amount: number; name: string },
): Promise<void> {
  await createOrderEditShippingMethodWorkflow(container).run({
    input: { order_id: input.orderId, shipping_option_id: input.shippingOptionId, custom_amount: input.amount },
  });
  await renameAddedShippingMethod(container, input.orderChangeId, input.name);
}

/**
 * 청구 하나만 담은 주문 수정을 연다 → 배송 방법 추가 → 이름 바꾸기 → request → confirm.
 * 확정 전 실패는 열린 수정을 버려 주문을 원래대로 둔다. internal_note 의 태그로 끊긴 수정을 찾는다(ensureNoDanglingChange).
 */
export async function addSettlementCharge(
  container: MedusaContainer,
  input: { orderId: string; tag: string; shippingOptionId: string; amount: number; name: string; actorId?: string },
): Promise<void> {
  const { result: change } = await beginOrderEditOrderWorkflow(container).run({
    input: { order_id: input.orderId, created_by: input.actorId, internal_note: input.tag },
  });
  try {
    await addChargeShippingMethod(container, {
      orderId: input.orderId,
      orderChangeId: change.id,
      shippingOptionId: input.shippingOptionId,
      amount: input.amount,
      name: input.name,
    });
    await requestOrderEditRequestWorkflow(container).run({ input: { order_id: input.orderId, requested_by: input.actorId } });
    await confirmOrderEditRequestWorkflow(container).run({ input: { order_id: input.orderId, confirmed_by: input.actorId } });
  } catch (error) {
    await cancelBeginOrderEditWorkflow(container)
      .run({ input: { order_id: input.orderId } })
      .catch(() => undefined);
    throw error instanceof Error ? error : new Error(`정산 청구 주문 수정 실패: ${describeError(error)}`);
  }
}

/**
 * 이 태그(internal_note)로 연 주문 변경이 남아 있는지 본다.
 * - 열린 채(pending/requested) 남았으면 앞선 시도가 확정 전에 끊긴 것 — onOpen 으로 버리고 새로 한다.
 * - 확정됐는데 진행 기록이 없으면 확정과 기록 사이에 끊긴 것 — 다시 하면 두 번 빠지므로 멈춘다(사람이 확인).
 */
export async function ensureNoDanglingChange(
  container: MedusaContainer,
  orderId: string,
  tag: string,
  onOpen: () => Promise<void>,
): Promise<void> {
  const orderModule = container.resolve(Modules.ORDER);
  // internal_note 는 모델에는 있는데 OrderChangeDTO 타입에 빠져 있다 — 고른 필드만 담은 모양으로 좁힌다.
  const changes = (await orderModule.listOrderChanges(
    { order_id: orderId },
    { select: ['id', 'status', 'internal_note'] },
  )) as Array<{ id: string; status: string; internal_note?: string | null }>;
  const mine = changes.filter((ch) => ch.internal_note === tag);
  if (mine.some((ch) => ch.status === OrderChangeStatus.CONFIRMED)) {
    throw new Error(`주문 변경 ${tag} 은 확정됐는데 진행 기록이 없습니다 — 다시 하면 두 번 빠지므로 멈춥니다. 수동 확인이 필요합니다`);
  }
  if (mine.some((ch) => ch.status === OrderChangeStatus.PENDING || ch.status === OrderChangeStatus.REQUESTED)) {
    await onOpen();
  }
}

/** createOrderEditShippingMethodWorkflow 는 이름을 받지 않는다 — 이 주문 수정이 방금 더한 방법의 이름을 바꾼다. */
async function renameAddedShippingMethod(container: MedusaContainer, orderChangeId: string, name: string) {
  const orderModule = container.resolve(Modules.ORDER);
  const actions = await orderModule.listOrderChangeActions(
    { order_change_id: orderChangeId },
    { select: ['id', 'action', 'reference_id', 'ordering'] },
  );
  const added = actions.filter((a) => a.action === ChangeActionType.SHIPPING_ADD).sort((a, b) => a.ordering - b.ordering);
  const id = added[added.length - 1]?.reference_id;
  if (!id) throw new Error(`방금 더한 배송 방법을 찾지 못했습니다: ${orderChangeId}`);
  await orderModule.updateOrderShippingMethods([{ id, name }]);
}
