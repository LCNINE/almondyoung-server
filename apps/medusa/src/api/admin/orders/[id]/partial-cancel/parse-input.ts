import { MedusaError } from '@medusajs/framework/utils';

import { parseRefundMode, type RefundMode } from '../../../../../workflows/orders/settlement/refund-mode';

export type PartialCancelBody = {
  requestId: string;
  items: Array<{ itemId: string; quantity: number }>;
  alreadyRefunded?: number;
  /** #1016 36번 재설계 — 없으면 오케스트레이터가 auto 로 읽는다 */
  refundMode?: RefundMode;
};

export function parseInput(body: unknown): PartialCancelBody {
  const b = (body ?? {}) as { requestId?: unknown; items?: unknown; already_refunded?: unknown; refundMode?: unknown };
  if (typeof b.requestId !== 'string' || b.requestId.trim() === '') {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'requestId 가 필요합니다');
  }
  if (!Array.isArray(b.items) || b.items.length === 0) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'items 가 비어 있습니다');
  }
  const items = b.items.map((raw, i) => {
    const it = (raw ?? {}) as { item_id?: unknown; quantity?: unknown };
    if (typeof it.item_id !== 'string' || it.item_id === '' || typeof it.quantity !== 'number' || !Number.isInteger(it.quantity) || it.quantity <= 0) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `items[${i}] 가 올바르지 않습니다`);
    }
    return { itemId: it.item_id, quantity: it.quantity };
  });
  const a = b.already_refunded;
  if (a !== undefined && (typeof a !== 'number' || !Number.isInteger(a) || a < 0)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'already_refunded 는 0 이상 정수여야 합니다');
  }
  return {
    requestId: b.requestId.trim(),
    items,
    ...(a !== undefined ? { alreadyRefunded: a } : {}),
    ...(b.refundMode !== undefined ? { refundMode: parseRefundMode(b.refundMode) } : {}),
  };
}
