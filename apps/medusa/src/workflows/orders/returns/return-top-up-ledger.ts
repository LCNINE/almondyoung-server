import type { MedusaContainer } from '@medusajs/framework/types';
import { ChangeActionType, Modules, OrderChangeStatus } from '@medusajs/framework/utils';

import { toNumber } from '../partial-cancel/amount';

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
