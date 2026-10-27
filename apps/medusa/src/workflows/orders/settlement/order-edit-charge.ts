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
 * 정산 청구만 담은 주문 수정을 연다 → 청구마다 배송 방법 추가 → 이름 바꾸기 → request → confirm.
 * 청구 여럿(반품 택배비·반품 차감)은 한 수정에 함께 들어간다 — 하나만 확정되고 끊기는 창이 없다. 0 원 몫은 건너뛰고,
 * 남는 청구가 없으면 수정을 열지 않는다.
 * 확정 전 실패는 열린 수정을 버려 주문을 원래대로 둔다. internal_note 의 태그로 끊긴 수정을 찾는다(ensureNoDanglingChange).
 */
export async function addSettlementCharge(
  container: MedusaContainer,
  input: {
    orderId: string;
    tag: string;
    shippingOptionId: string;
    charges: Array<{ name: string; amount: number }>;
    actorId?: string;
  },
): Promise<void> {
  const charges = input.charges.filter((c) => c.amount > 0);
  if (charges.length === 0) return;
  const { result: change } = await beginOrderEditOrderWorkflow(container).run({
    input: { order_id: input.orderId, created_by: input.actorId, internal_note: input.tag },
  });
  try {
    // 차례로 더한다 — 이름 바꾸기가 «방금 더한» 방법(마지막 SHIPPING_ADD)을 찾는다
    for (const c of charges) {
      await addChargeShippingMethod(container, {
        orderId: input.orderId,
        orderChangeId: change.id,
        shippingOptionId: input.shippingOptionId,
        amount: c.amount,
        name: c.name,
      });
    }
    await requestOrderEditRequestWorkflow(container).run({ input: { order_id: input.orderId, requested_by: input.actorId } });
    await confirmOrderEditRequestWorkflow(container).run({ input: { order_id: input.orderId, confirmed_by: input.actorId } });
  } catch (error) {
    await cancelOpenOrderEdit(container, input.orderId).catch(() => undefined);
    throw error instanceof Error ? error : new Error(`정산 청구 주문 수정 실패: ${describeError(error)}`);
  }
}

/**
 * 열린 주문 수정(pending·requested)을 버린다 — 그 수정이 더한 배송 방법을 먼저 지우고 cancelBeginOrderEditWorkflow 를 부른다.
 * Medusa 2.13.4 의 cancelBeginOrderEditWorkflow 는 SHIPPING_ADD «액션»의 id 를 배송 방법 id 자리에 넘겨 아무것도 지우지 않는다
 * (core-flows order-edit/cancel-begin-order-edit.js). 남은 방법은 다음 수정이 같은 버전으로 확정될 때 주문에 다시 나타난다
 * (K8 PR6b 실측: 끊긴 «반품 택배비»·«반품 차감»이 이어 간 수정 뒤 두 벌로 보였다). 지우기를 먼저 한다 — 버리기 뒤에 끊기면
 * 지울 id 를 다시 찾을 길이 없다. 버리기가 실패해도 수정은 열린 채라 다음 시도가 이 함수를 다시 탄다.
 */
export async function cancelOpenOrderEdit(container: MedusaContainer, orderId: string): Promise<void> {
  const orderModule = container.resolve(Modules.ORDER);
  const changes = await orderModule.listOrderChanges({ order_id: orderId }, { select: ['id', 'status'] });
  const open = changes.filter((ch) => ch.status === OrderChangeStatus.PENDING || ch.status === OrderChangeStatus.REQUESTED);
  const actions = open.length
    ? await orderModule.listOrderChangeActions({ order_change_id: open.map((ch) => ch.id) }, { select: ['id', 'action', 'reference_id'] })
    : [];
  const added = actions.flatMap((a) => (a.action === ChangeActionType.SHIPPING_ADD && a.reference_id ? [a.reference_id] : []));
  if (added.length > 0) await orderModule.softDeleteOrderShippingMethods(added);
  await cancelBeginOrderEditWorkflow(container).run({ input: { order_id: orderId } });
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
