import type { MedusaContainer } from '@medusajs/framework/types';
import { Modules, OrderChangeStatus } from '@medusajs/framework/utils';
import {
  beginOrderEditOrderWorkflow,
  confirmOrderEditRequestWorkflow,
  orderEditAddNewItemWorkflow,
  requestOrderEditRequestWorkflow,
} from '@medusajs/medusa/core-flows';

import { describeError } from '../../../utils/describe-error';
import { toNumber } from '../partial-cancel/amount';
import { EXCHANGE_LINE_METADATA_KEY, loadOrderView, type OrderView } from '../settlement/load-order-view';
import { cancelOpenOrderEdit } from '../settlement/order-edit-charge';
import type { ReturnExchangeItem } from './return-settlement-record';

export type ExchangeReplacement = {
  sourceItemId: string;
  title: string;
  /** 원래 품목의 variant — 대체 줄에는 붙이지 않고 metadata 에만 남긴다(설계 E2: Medusa 재고 검사·예약을 피한다) */
  variantId: string | null;
  quantity: number;
  /** 원래 품목의 «할인 뒤» 단가. 원 단위로 자르지 않는다 — 수령이 돌려준 몫과 정확히 같아야 차액이 0 으로 돌아온다 */
  unitPrice: number;
};

/** 대체 품목 줄 주문 수정의 태그(internal_note) — 끊긴 수정·확정된 수정을 이것으로 찾는다 */
export const exchangeTag = (requestId: string) => `return-exchange:${requestId}`;

/**
 * 교환 대체 품목 줄 계획(K8 PR11 N4) — 품목마다 수량 = 수령 + 폐기, 단가 = (단가 × q − 그 q 몫의 할인) ÷ q.
 * 할인 몫은 줄 할인 합 × q ÷ 줄 수량이다(Task 1 실측: 수령·폐기가 돌려주는 차액이 이 값 — 30,000 × 3 에 5,000 이면
 * 1개가 28,333.33…). cancelledAdjustmentShare 는 남는 몫을 원 단위로 반올림해 1,667 을 내므로 쓰지 않는다 — 0.33 원이
 * 남는다. 수량 0 품목은 뺀다. 같은 품목이 여러 행으로 오면 합친다.
 */
export function planExchangeReplacements(
  lines: OrderView['lines'],
  items: Array<{ itemId: string; received: number; dismissed: number }>,
): ExchangeReplacement[] {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const quantities = new Map<string, number>();
  for (const i of items) quantities.set(i.itemId, (quantities.get(i.itemId) ?? 0) + i.received + i.dismissed);

  const out: ExchangeReplacement[] = [];
  for (const [itemId, q] of quantities) {
    const line = byId.get(itemId);
    if (!line) throw new Error(`교환 품목이 주문 줄에 없습니다: ${itemId}`);
    if (!Number.isFinite(q) || q < 0 || q > line.quantity) {
      throw new Error(`교환 수량이 줄 수량을 벗어납니다: ${itemId} ${q}/${line.quantity}`);
    }
    if (q === 0) continue;
    const adjustmentTotal = line.adjustments.reduce((s, a) => s + a.amount, 0);
    const share = (adjustmentTotal * q) / line.quantity;
    const unitPrice = (line.unitPrice * q - share) / q;
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error(`교환 대체 줄 단가를 셀 수 없습니다: ${itemId} ${unitPrice}`);
    out.push({ sourceItemId: itemId, title: line.title, variantId: line.variantId, quantity: q, unitPrice });
  }
  return out;
}

/**
 * 대체 품목 줄을 주문 수정 하나로 넣는다(N4·N5) — begin(태그) → 품목 추가(variant 없음) → request → confirm. 멱등:
 * - 같은 태그의 «확정된» 수정이 있으면(확정과 기록 사이에 끊김) 다시 넣지 않고 그 줄을 읽는다.
 * - 열린 채 남았으면(확정 전에 끊김) 버리고 새로 넣는다.
 * 확정 뒤 차액의 절댓값이 1 이상이면 일반 Error(일시) — 기록을 쓰지 않으므로 다시 불러도 같은 판정을 받고,
 * channel-adapter 의 재시도가 다하면 core 가 stalled 로 사람에게 넘긴다.
 */
export async function addExchangeReplacements(
  container: MedusaContainer,
  input: { orderId: string; requestId: string; replacements: ExchangeReplacement[]; actorId?: string },
): Promise<ReturnExchangeItem[]> {
  if (input.replacements.length === 0) throw new Error(`넣을 교환 대체 품목이 없습니다: ${input.requestId}`);
  const tag = exchangeTag(input.requestId);
  const changes = await taggedChanges(container, input.orderId, tag);
  if (!changes.some((ch) => ch.status === OrderChangeStatus.CONFIRMED)) {
    if (changes.some((ch) => ch.status === OrderChangeStatus.PENDING || ch.status === OrderChangeStatus.REQUESTED)) {
      await cancelOpenOrderEdit(container, input.orderId);
    }
    await addReplacementLines(container, input, tag);
  }

  const order = await loadOrderView(container, input.orderId);
  if (!order) throw new Error(`주문을 찾을 수 없습니다: ${input.orderId}`);
  if (Math.abs(order.pendingDifference) >= 1) {
    throw new Error(`교환 대체 품목 줄을 넣은 뒤 차액이 0 이 아닙니다(${order.pendingDifference}): ${input.orderId} ${tag} — 수동 확인이 필요합니다`);
  }
  const added = await replacementItems(container, input.orderId, input.requestId);
  if (added.length === 0) throw new Error(`확정된 교환 주문 수정에 대체 품목 줄이 없습니다: ${input.orderId} ${tag}`);
  return added;
}

async function addReplacementLines(
  container: MedusaContainer,
  input: { orderId: string; requestId: string; replacements: ExchangeReplacement[]; actorId?: string },
  tag: string,
): Promise<void> {
  await beginOrderEditOrderWorkflow(container).run({
    input: { order_id: input.orderId, created_by: input.actorId, internal_note: tag },
  });
  try {
    await orderEditAddNewItemWorkflow(container).run({
      input: {
        order_id: input.orderId,
        // variant_id 를 넣지 않는다 — 넣으면 Medusa 가 재고를 검사하고 확정이 예약을 만든다(설계 E2)
        items: input.replacements.map((r) => ({
          title: r.title,
          quantity: r.quantity,
          unit_price: r.unitPrice,
          metadata: {
            [EXCHANGE_LINE_METADATA_KEY]: { requestId: input.requestId, sourceItemId: r.sourceItemId, variantId: r.variantId },
          },
        })),
      },
    });
    await requestOrderEditRequestWorkflow(container).run({ input: { order_id: input.orderId, requested_by: input.actorId } });
    await confirmOrderEditRequestWorkflow(container).run({ input: { order_id: input.orderId, confirmed_by: input.actorId } });
  } catch (error) {
    // 확정 전 실패 — 열린 수정을 버려 주문을 원래대로 둔다
    await cancelOpenOrderEdit(container, input.orderId).catch(() => undefined);
    throw error instanceof Error ? error : new Error(`교환 대체 품목 주문 수정 실패: ${describeError(error)}`);
  }
}

async function taggedChanges(container: MedusaContainer, orderId: string, tag: string): Promise<Array<{ id: string; status: string }>> {
  // internal_note 는 모델에는 있는데 OrderChangeDTO 타입에 빠져 있다 — 고른 필드만 담은 모양으로 좁힌다(ensureNoDanglingChange 와 같다)
  const changes = (await container
    .resolve(Modules.ORDER)
    .listOrderChanges({ order_id: orderId }, { select: ['id', 'status', 'internal_note'] })) as Array<{
    id: string;
    status: string;
    internal_note?: string | null;
  }>;
  return changes.filter((ch) => ch.internal_note === tag);
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** 이 requestId 의 대체 품목 줄(현재 버전) → exchangeItems. 원래 품목 id 순 */
async function replacementItems(container: MedusaContainer, orderId: string, requestId: string): Promise<ReturnExchangeItem[]> {
  const [o] = await container.resolve(Modules.ORDER).listOrders({ id: orderId }, { select: ['id', 'version'], relations: ['items'] });
  const out: ReturnExchangeItem[] = [];
  for (const i of o?.items ?? []) {
    const mark: unknown = i.metadata?.[EXCHANGE_LINE_METADATA_KEY];
    if (!isObj(mark) || mark.requestId !== requestId) continue;
    if (typeof mark.sourceItemId !== 'string') throw new Error(`교환 대체 품목 줄의 표지가 어긋납니다: ${i.id}`);
    const quantity = toNumber(i.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) throw new Error(`교환 대체 품목 줄 수량을 읽지 못했습니다: ${i.id}`);
    out.push({ sourceItemId: mark.sourceItemId, itemId: i.id, quantity });
  }
  return out.sort((a, b) => a.sourceItemId.localeCompare(b.sourceItemId) || a.itemId.localeCompare(b.itemId));
}
