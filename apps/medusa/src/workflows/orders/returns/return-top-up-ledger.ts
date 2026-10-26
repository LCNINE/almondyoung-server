import type { MedusaContainer } from '@medusajs/framework/types';
import { ChangeActionType, ContainerRegistrationKeys, Modules, OrderChangeStatus } from '@medusajs/framework/utils';

import { toNumber } from '../partial-cancel/amount';
import { loadReturnOrder } from './load-return-order';
import type { ReturnableOrderItem } from './plan-return-request';

/** 주문 변경(change)의 internal_note 표지 — registerFulfillment·cancelFulfillment 는 이 값을 주문 변경 행에 싣는다(services/actions/*-fulfillment.js). */
export const topUpTag = (requestId: string) => `return-request:${requestId}`;
/** 반품 취소와 요청 실패 되돌리기가 같은 표지를 써야 «올림 − 되돌림» 이력이 맞는다 */
export const revertTag = (requestId: string) => `return-request-revert:${requestId}`;

/**
 * 이 requestId 로 올린 출고 수량 중 아직 안 내린 몫 — 줄별로 «올림 표지 FULFILL_ITEM 합 − 되돌림 표지 CANCEL_ITEM_FULFILLMENT 합».
 * 무엇을 실제로 올리고 내렸는지는 metadata 플래그가 아니라 주문 변경 이력이 정본이다: 플래그는 효과 «뒤»에 쓰므로
 * 그 사이에 죽으면 거짓말을 한다. 되돌림도 이력에 남으므로 다시 불러도 두 번 내리지 않는다. 0 이하인 줄은 뺀다.
 */
export async function remainingTopUp(
  container: MedusaContainer,
  orderId: string,
  requestId: string,
): Promise<Array<{ id: string; quantity: number }>> {
  const orderModule = container.resolve(Modules.ORDER);
  // internal_note 는 모델에는 있는데 OrderChangeDTO 타입에 빠져 있다 — 고른 필드만 담은 모양으로 좁힌다(partial-cancel 의 ensureNoDanglingEdit 와 같은 관례).
  const changes = (await orderModule.listOrderChanges(
    { order_id: orderId, status: OrderChangeStatus.CONFIRMED },
    { select: ['id', 'status', 'internal_note'], relations: ['actions'] },
  )) as Array<{
    internal_note?: string | null;
    actions?: Array<{ action: string; details?: { reference_id?: unknown; quantity?: unknown } | null }> | null;
  }>;
  const net = new Map<string, number>();
  const add = (tag: string, action: string, sign: 1 | -1) => {
    for (const ch of changes.filter((c) => c.internal_note === tag)) {
      for (const a of (ch.actions ?? []).filter((x) => x.action === action)) {
        const itemId = a.details?.reference_id;
        const qty = toNumber(a.details?.quantity);
        if (typeof itemId !== 'string' || !Number.isFinite(qty)) {
          throw new Error(`반품 요청 출고 이력을 읽지 못했습니다: orderId=${orderId} requestId=${requestId}`);
        }
        net.set(itemId, (net.get(itemId) ?? 0) + sign * qty);
      }
    }
  };
  add(topUpTag(requestId), ChangeActionType.FULFILL_ITEM, 1);
  add(revertTag(requestId), ChangeActionType.CANCEL_ITEM_FULFILLMENT, -1);
  return [...net].filter(([, q]) => q > 0).map(([id, quantity]) => ({ id, quantity }));
}

/**
 * 되돌릴 몫을 «지금 어느 반품도 잡지 않은 출고 수량» — fulfilled − (요청 + 수령 + 폐기) — 으로 자른다. 부수효과 없음.
 * 이력의 남은 몫이 곧 내려도 되는 몫은 아니다: 끊긴 취소(②와 ③ 사이)가 남긴 출고 수량 위에 다른 requestId 의 반품이 올림 0 으로
 * 앉을 수 있다(그 반품은 남은 수량을 «이미 출고됨»으로 본다). 그때 이력대로 다 내리면 fulfilled 가 그 반품의 요청 수량 아래로 떨어져
 * 부분취소 하한(5a)이 그 수량을 못 지킨다 — 반품 중인 단위가 취소되고, 정산(PR 6)이 두 번 환불한다.
 * short 면 다 못 내린 것이다 — 호출자는 «다 되돌렸다»고 적지 않는다(그 반품이 끝난 뒤 다시 부르면 마저 내린다).
 */
export function capRevertToUnheld(
  leftover: Array<{ id: string; quantity: number }>,
  items: ReturnableOrderItem[],
): { items: Array<{ id: string; quantity: number }>; short: boolean } {
  let short = false;
  const capped = leftover.flatMap((l) => {
    const item = items.find((i) => i.id === l.id);
    const unheld = item ? Math.max(0, item.fulfilled - (item.returnRequested + item.returnReceived + item.returnDismissed)) : 0;
    const quantity = Math.min(l.quantity, unheld);
    if (quantity < l.quantity) short = true;
    return quantity > 0 ? [{ id: l.id, quantity }] : [];
  });
  return { items: capped, short };
}

/**
 * 이 requestId 몫의 출고 수량을 되돌림 표지로 내린다 — 주문을 «지금» 다시 읽어 capRevertToUnheld 로 자른 만큼만.
 * 반품 취소·끊긴 요청 치우기·요청 실패 되돌리기가 모두 이걸 쓴다. 반환값 short 는 capRevertToUnheld 와 같다.
 */
export async function lowerUnheldTopUp(
  container: MedusaContainer,
  orderId: string,
  requestId: string,
  leftover: Array<{ id: string; quantity: number }>,
): Promise<{ short: boolean }> {
  if (leftover.length === 0) return { short: false };
  const order = await loadReturnOrder(container, orderId);
  if (!order) throw new Error(`출고 수량을 되돌릴 주문을 찾지 못했습니다: ${orderId}`);
  const { items, short } = capRevertToUnheld(leftover, order.items);
  if (short) {
    container
      .resolve(ContainerRegistrationKeys.LOGGER)
      .warn(
        `[return-request] 다른 반품이 잡고 있어 출고 수량을 다 못 되돌린다: orderId=${orderId} requestId=${requestId} ` +
          `남은 몫=${JSON.stringify(leftover)} 내림=${JSON.stringify(items)}`,
      );
  }
  if (items.length > 0) {
    await container
      .resolve(Modules.ORDER)
      .cancelFulfillment({ order_id: orderId, items, internal_note: revertTag(requestId) });
  }
  return { short };
}
