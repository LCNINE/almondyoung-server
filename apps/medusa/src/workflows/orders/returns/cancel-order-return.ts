import type { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { cancelFulfillmentWorkflow, cancelReturnWorkflow } from '@medusajs/medusa/core-flows';

import { toNumber } from '../partial-cancel/amount';
import { orderCancelLockKey } from '../settlement/order-payments';
import { loadReturnOrder, RETURN_REQUEST_METADATA_KEY, type ReturnRequestRecord } from './load-return-order';
import { ReturnRequestRejected, type ReturnRequestedBy } from './plan-return-request';
import { ReturnOrderNotFound } from './request-order-return';
import { remainingTopUp, revertTag } from './return-top-up-ledger';

export type CancelOrderReturnInput = {
  orderId: string;
  returnId: string;
  requestedBy: ReturnRequestedBy;
  /** requestedBy 가 customer 면 필수 — 주문 주인이 아니면 «없는 주문»으로 닫는다 */
  customerId?: string;
  actorId?: string;
};

export type CancelOrderReturnResult = { returnId: string; status: 'canceled' };

/** 반품 요청과 같은 잠금·같은 만료 — 한 주문에 열린 주문 변경은 하나뿐이다. */
const ORDER_LOCK_TIMEOUT_SECONDS = 60;

/**
 * 도착 전 반품 취소(K8 PR3). 순서가 곧 정확성이다 — 코어 cancelReturnWorkflow 는 반품 fulfillment 가 전부 취소돼 있어야 하고(① 먼저),
 * 올린 출고 수량은 반품이 끝난 «뒤»에 내린다(③): 반품의 열린 주문 변경이 남은 채 cancelFulfillment 가 새 주문 변경을 만들면 거절된다.
 * 각 단계는 다시 불러도 안전하다 — ①은 취소 안 된 것만, ②는 이미 canceled 면 건너뛰고, ③은 기록의 fulfillmentTopUpReverted 로 한 번만.
 */
export async function cancelOrderReturn(
  container: MedusaContainer,
  input: CancelOrderReturnInput,
): Promise<CancelOrderReturnResult> {
  const locking = container.resolve(Modules.LOCKING);
  return locking.execute(orderCancelLockKey(input.orderId), () => run(container, input), {
    timeout: ORDER_LOCK_TIMEOUT_SECONDS,
  });
}

async function run(container: MedusaContainer, input: CancelOrderReturnInput): Promise<CancelOrderReturnResult> {
  const order = await loadReturnOrder(container, input.orderId);
  if (!order || (input.requestedBy === 'customer' && (!input.customerId || order.customerId !== input.customerId))) {
    throw new ReturnOrderNotFound(`주문을 찾을 수 없습니다: ${input.orderId}`);
  }
  // 다른 주문의 반품 id 는 «없는 반품» — 존재 여부를 가르지 않는다
  const ret = order.returns.find((r) => r.id === input.returnId);
  if (!ret) throw new ReturnOrderNotFound(`반품을 찾을 수 없습니다: ${input.returnId}`);
  // Medusa 기본 경로나 대시보드가 만든 반품은 우리가 올린 출고 수량이 없다 — 되돌릴 근거가 없으니 건드리지 않는다
  const record = ret.record;
  if (!record) throw new ReturnRequestRejected('not_our_return', '이 반품은 취소할 수 없습니다');

  const result: CancelOrderReturnResult = { returnId: ret.id, status: 'canceled' };

  if (ret.status === 'canceled') {
    // ③ 직전에 끊긴 취소를 이어 받는다. 이미 되돌렸으면 아무것도 하지 않는다(멱등)
    if (record.fulfillmentTopUpReverted !== true) await revertTopUp(container, order.id, ret.id, record);
    return result;
  }

  const query = await readReturnState(container, ret.id);
  // 수령이 시작된 반품은 재고·환불 쪽 일이 벌어졌다 — 취소가 아니라 이후 흐름(PR 6)의 몫이다
  if (query.items.some((i) => i.receivedQuantity > 0)) {
    throw new ReturnRequestRejected('return_already_received', '이미 수령한 반품은 취소할 수 없습니다');
  }

  for (const f of query.fulfillments.filter((x) => !x.canceledAt)) {
    await cancelFulfillmentWorkflow(container).run({ input: { id: f.id } });
  }
  await cancelReturnWorkflow(container).run({ input: { return_id: ret.id, canceled_by: input.actorId } });
  await revertTopUp(container, order.id, ret.id, record);
  return result;
}

/** ③ — 올린 출고 수량을 같은 만큼 내리고, 내렸다는 표시를 반품 기록에 남긴다. */
async function revertTopUp(
  container: MedusaContainer,
  orderId: string,
  returnId: string,
  record: ReturnRequestRecord,
): Promise<void> {
  const orderModule = container.resolve(Modules.ORDER);
  // 플래그는 효과 «뒤»에 쓰므로 cancelFulfillment 와 플래그 사이에서 죽을 수 있다 — 주문 변경 이력이 정본이다.
  // 올림 − 되돌림 으로 남은 몫만 같은 표지로 내려, 끊긴 취소를 다시 불러도 두 번 내리지 않는다.
  const leftover = await remainingTopUp(container, orderId, record.requestId);
  if (leftover.length > 0) {
    await orderModule.cancelFulfillment({
      order_id: orderId,
      items: leftover,
      internal_note: revertTag(record.requestId),
    });
  }
  // updateReturns 는 metadata 를 통째로 바꾼다 — 다른 키를 잃지 않게 읽은 뒤 합친다
  const [row] = await orderModule.listReturns({ id: returnId }, { select: ['id', 'metadata'] });
  await orderModule.updateReturns([
    {
      selector: { id: returnId },
      data: {
        metadata: {
          ...(row?.metadata ?? {}),
          [RETURN_REQUEST_METADATA_KEY]: { ...record, fulfillmentTopUpReverted: true },
        },
      },
    },
  ]);
}

async function readReturnState(container: MedusaContainer, returnId: string) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: 'return',
    fields: ['id', 'items.received_quantity', 'fulfillments.id', 'fulfillments.canceled_at'],
    filters: { id: returnId },
  });
  const [row] = data as Array<{
    items?: Array<{ received_quantity?: unknown } | null> | null;
    fulfillments?: Array<{ id: string; canceled_at?: unknown } | null> | null;
  }>;
  return {
    items: (row?.items ?? []).flatMap((i) => (i ? [{ receivedQuantity: toNumber(i.received_quantity ?? 0) }] : [])),
    fulfillments: (row?.fulfillments ?? []).flatMap((f) =>
      f ? [{ id: f.id, canceledAt: f.canceled_at ?? null }] : [],
    ),
  };
}
