/**
 * 반품 완료가 리뷰 자격·적립에 무엇을 하는지 정하는 순수 판정.
 *
 * 취소와 두 곳이 다르다.
 * - **라인 매칭이 필수다.** 반품은 부분이 기본이고 전량이 특수 케이스다. 주문 전체를 회수하면
 *   반품하지 않은 라인의 자격까지 죽는다.
 * - **수량이 있다.** 3개 중 1개만 반품한 고객은 여전히 그 상품을 갖고 있다 — 회수하면 과회수다.
 *   전량 반품(누적 반품 수량 = 주문 수량)일 때만 회수하고, 나머지는 사유를 남겨 «센다».
 *
 * 판정 불가를 「회수 0건」으로 뭉개지 않는 것이 이 파일의 목적이다.
 */

export type ReturnReasonCode =
  | 'defective'
  | 'not_as_described'
  | 'change_of_mind'
  | 'wrong_item'
  | 'damaged_in_shipping'
  | 'other';

export type ReturnRevokeReason = 'ORDER_RETURNED' | 'ORDER_RETURNED_NOT_USER_FAULT';

/**
 * 판매자 귀책 반품. 1인당 한도를 돌려준다 — 불량품을 받아 반품한 고객이 리뷰 기회까지 잃는 것은
 * 취소 쪽에서 이미 내린 결정(`OUT_OF_STOCK`·`PAYMENT_FAILED` 는 기회를 돌려준다)과 어긋난다.
 * `other` 는 판정 근거가 없으므로 고객 귀책 쪽에 둔다 — 반대로 두면 사유를 「기타」로 적는 것이
 * 한도를 무한히 되돌리는 창구가 된다.
 */
const NOT_USER_FAULT_REASONS: readonly ReturnReasonCode[] = [
  'defective',
  'not_as_described',
  'wrong_item',
  'damaged_in_shipping',
];

export const resolveReturnRevokeReason = (reason: ReturnReasonCode): ReturnRevokeReason =>
  NOT_USER_FAULT_REASONS.includes(reason) ? 'ORDER_RETURNED_NOT_USER_FAULT' : 'ORDER_RETURNED';

export interface ReturnedLineInput {
  salesOrderLineId: string;
  /** Medusa 라인 item id = `review_eligibilities.order_line_id`. 없으면 자격을 찾을 축이 없다. */
  channelOrderItemId?: string;
  orderedQuantity: number;
  /** 완료된 반품의 누적 수량(이 건 포함). core 가 계산해 싣는다. */
  returnedQuantity: number;
}

export interface ReturnInput {
  channelOrderId?: string;
  reason: ReturnReasonCode;
  returnedLines: ReturnedLineInput[];
}

export type ReturnLineSkipReason = 'NO_CHANNEL_ORDER_ITEM_ID' | 'PARTIAL_QUANTITY';
export type ReturnSkipReason = 'NO_CHANNEL_ORDER_ID' | 'NO_REVOCABLE_LINES';

export interface SkippedReturnLine {
  salesOrderLineId: string;
  skipReason: ReturnLineSkipReason;
}

export type ReturnPlan =
  | {
      action: 'REVOKE_LINES';
      channelOrderId: string;
      revokeReason: ReturnRevokeReason;
      /** 회수 대상 자격의 `order_line_id` 목록 (= Medusa 라인 item id). */
      orderLineIds: string[];
      skippedLines: SkippedReturnLine[];
    }
  | { action: 'SKIP'; skipReason: ReturnSkipReason; skippedLines: SkippedReturnLine[] };

export const planReturn = (input: ReturnInput): ReturnPlan => {
  const skippedLines: SkippedReturnLine[] = [];
  const orderLineIds: string[] = [];

  for (const line of input.returnedLines) {
    if (!line.channelOrderItemId) {
      skippedLines.push({ salesOrderLineId: line.salesOrderLineId, skipReason: 'NO_CHANNEL_ORDER_ITEM_ID' });
      continue;
    }
    if (line.returnedQuantity < line.orderedQuantity) {
      skippedLines.push({ salesOrderLineId: line.salesOrderLineId, skipReason: 'PARTIAL_QUANTITY' });
      continue;
    }
    orderLineIds.push(line.channelOrderItemId);
  }

  if (!input.channelOrderId) {
    return { action: 'SKIP', skipReason: 'NO_CHANNEL_ORDER_ID', skippedLines };
  }
  if (orderLineIds.length === 0) {
    return { action: 'SKIP', skipReason: 'NO_REVOCABLE_LINES', skippedLines };
  }

  return {
    action: 'REVOKE_LINES',
    channelOrderId: input.channelOrderId,
    revokeReason: resolveReturnRevokeReason(input.reason),
    orderLineIds,
    skippedLines,
  };
};
