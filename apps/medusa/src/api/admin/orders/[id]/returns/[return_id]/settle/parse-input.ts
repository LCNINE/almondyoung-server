import { MedusaError } from '@medusajs/framework/utils';

import { parseRefundMode, type RefundMode } from '../../../../../../../workflows/orders/settlement/refund-mode';

export type ReturnSettleBody = {
  requestId: string;
  items: Array<{ itemId: string; received: number; dismissed: number }>;
  /** 없으면 정산이 auto 로 읽는다 */
  refundMode?: RefundMode;
};

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** 본문 모양만 본다. 품목·수량이 반품과 맞는지는 정산이 본다(items_mismatch). */
export function parseInput(body: unknown): ReturnSettleBody {
  const b = (body ?? {}) as { requestId?: unknown; items?: unknown; refundMode?: unknown };
  if (typeof b.requestId !== 'string' || b.requestId.trim() === '') {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'requestId 가 필요합니다');
  }
  if (!Array.isArray(b.items) || b.items.length === 0) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'items 가 비어 있습니다');
  }
  const items = b.items.map((raw, i) => {
    const it = (raw ?? {}) as { item_id?: unknown; received?: unknown; dismissed?: unknown };
    if (typeof it.item_id !== 'string' || it.item_id === '' || !isCount(it.received) || !isCount(it.dismissed)) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `items[${i}] 가 올바르지 않습니다`);
    }
    return { itemId: it.item_id, received: it.received, dismissed: it.dismissed };
  });
  return {
    requestId: b.requestId.trim(),
    items,
    ...(b.refundMode !== undefined ? { refundMode: parseRefundMode(b.refundMode) } : {}),
  };
}
