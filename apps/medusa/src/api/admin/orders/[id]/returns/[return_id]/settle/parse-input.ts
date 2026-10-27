import { MedusaError } from '@medusajs/framework/utils';

import { parseRefundMode, type RefundMode } from '../../../../../../../workflows/orders/settlement/refund-mode';

export type ReturnSettleBody = {
  requestId: string;
  items: Array<{ itemId: string; received: number; dismissed: number }>;
  /** 없으면 정산이 auto 로 읽는다 */
  refundMode?: RefundMode;
  /** CS 보류 차감(K8 PR6b N2) — 금액 1 이상 정수(원), 메모 비어 있지 않은 500자 이하 */
  holdDeduction?: { amount: number; memo: string };
  /** CS 가 적은 «이미 환불한 외부 환불»(원, 0 이상 정수) */
  alreadyRefundedAmount?: number;
  /** core 가 미도착 수량을 닫았다 — true 일 때만 칸이 있다(false 는 없는 것과 같은 요청) */
  closesMissing?: true;
};

/** core 의 메모 칸과 같은 상한(@MaxLength(500)) */
const MEMO_MAX_LENGTH = 500;

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const invalid = (message: string) => new MedusaError(MedusaError.Types.INVALID_DATA, message);

/**
 * 본문 모양만 본다. 품목·수량이 반품과 맞는지는 정산이 본다(items_mismatch). 품목 칸·PR 6b 칸은 snake_case
 * (`item_id`, `hold_deduction`, `already_refunded_amount`, `closes_missing`) — 부분취소의 `already_refunded` 와 같은 관례다.
 */
export function parseInput(body: unknown): ReturnSettleBody {
  const b = (body ?? {}) as {
    requestId?: unknown;
    items?: unknown;
    refundMode?: unknown;
    hold_deduction?: unknown;
    already_refunded_amount?: unknown;
    closes_missing?: unknown;
  };
  if (typeof b.requestId !== 'string' || b.requestId.trim() === '') throw invalid('requestId 가 필요합니다');
  if (!Array.isArray(b.items) || b.items.length === 0) throw invalid('items 가 비어 있습니다');
  const items = b.items.map((raw, i) => {
    const it = (raw ?? {}) as { item_id?: unknown; received?: unknown; dismissed?: unknown };
    if (typeof it.item_id !== 'string' || it.item_id === '' || !isCount(it.received) || !isCount(it.dismissed)) {
      throw invalid(`items[${i}] 가 올바르지 않습니다`);
    }
    return { itemId: it.item_id, received: it.received, dismissed: it.dismissed };
  });
  const holdDeduction = b.hold_deduction === undefined ? undefined : parseHoldDeduction(b.hold_deduction);
  if (b.already_refunded_amount !== undefined && !isCount(b.already_refunded_amount)) {
    throw invalid(`already_refunded_amount 는 0 이상 정수(원)여야 합니다: ${JSON.stringify(b.already_refunded_amount)}`);
  }
  if (b.closes_missing !== undefined && typeof b.closes_missing !== 'boolean') {
    throw invalid(`closes_missing 은 boolean 이어야 합니다: ${JSON.stringify(b.closes_missing)}`);
  }
  return {
    requestId: b.requestId.trim(),
    items,
    ...(b.refundMode !== undefined ? { refundMode: parseRefundMode(b.refundMode) } : {}),
    ...(holdDeduction ? { holdDeduction } : {}),
    ...(b.already_refunded_amount !== undefined ? { alreadyRefundedAmount: b.already_refunded_amount } : {}),
    ...(b.closes_missing === true ? { closesMissing: true as const } : {}),
  };
}

function parseHoldDeduction(raw: unknown): { amount: number; memo: string } {
  const h = (raw ?? {}) as { amount?: unknown; memo?: unknown };
  if (typeof h.amount !== 'number' || !Number.isInteger(h.amount) || h.amount < 1) {
    throw invalid(`hold_deduction.amount 는 1 이상 정수(원)여야 합니다: ${JSON.stringify(h.amount)}`);
  }
  if (typeof h.memo !== 'string' || !/\S/.test(h.memo) || h.memo.length > MEMO_MAX_LENGTH) {
    throw invalid(`hold_deduction.memo 는 비어 있지 않은 ${MEMO_MAX_LENGTH}자 이하 문자열이어야 합니다`);
  }
  return { amount: h.amount, memo: h.memo };
}
