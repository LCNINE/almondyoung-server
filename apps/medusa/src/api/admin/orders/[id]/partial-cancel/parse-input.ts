import { MedusaError } from '@medusajs/framework/utils';

import { parseRefundMode, type RefundMode } from '../../../../../workflows/orders/settlement/refund-mode';

export type PartialCancelBody = {
  requestId: string;
  items: Array<{ itemId: string; quantity: number }>;
  alreadyRefunded?: number;
  /** #1016 36번 재설계 — 없으면 오케스트레이터가 auto 로 읽는다 */
  refundMode?: RefundMode;
  /** 취소 사유·요청 주체 — 무료배송이 깨질 때 택배비를 누가 내는지 정한다(K8). 없으면 판매자 사유로 본다 */
  reasonCode?: string;
  requestedBy?: string;
};

export function parseInput(body: unknown): PartialCancelBody {
  const b = (body ?? {}) as { requestId?: unknown; items?: unknown; already_refunded?: unknown; refundMode?: unknown; reasonCode?: unknown; requestedBy?: unknown };
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
  for (const key of ['reasonCode', 'requestedBy'] as const) {
    if (b[key] !== undefined && typeof b[key] !== 'string') {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `${key} 는 문자열이어야 합니다`);
    }
  }
  const a = b.already_refunded;
  if (a !== undefined && (typeof a !== 'number' || !Number.isInteger(a) || a < 0)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'already_refunded 는 0 이상 정수여야 합니다');
  }
  return {
    requestId: b.requestId.trim(),
    items,
    ...(a !== undefined ? { alreadyRefunded: a } : {}),
    ...(b.refundMode !== undefined ? { refundMode: parseRefundMode(b.refundMode) } : {}),
    ...(typeof b.reasonCode === 'string' ? { reasonCode: b.reasonCode } : {}),
    ...(typeof b.requestedBy === 'string' ? { requestedBy: b.requestedBy } : {}),
  };
}
