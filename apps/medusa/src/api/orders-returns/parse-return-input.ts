import { MedusaError } from '@medusajs/framework/utils';

import type { RequestOrderReturnInput } from '../../workflows/orders/returns/request-order-return';

export type ParsedReturnRequest = Omit<RequestOrderReturnInput, 'orderId' | 'requestedBy' | 'customerId' | 'actorId' | 'now'>;

const invalid = (message: string) => new MedusaError(MedusaError.Types.INVALID_DATA, message);

/**
 * 반품 요청 본문(snake_case, 기존 라우트 관례) → 워크플로 입력. store·admin 이 같이 쓴다.
 * fee_bearer·window_override_reason 은 CS 만의 권한이다 — store 범위에서 오면 조용히 버리지 않고 거절한다.
 * 무시하면 고객이 «통했다»고 믿고, 나중에 검증이 느슨해질 때 그대로 권한 상승이 된다.
 */
export function parseReturnRequestBody(body: unknown, scope: 'store' | 'admin'): ParsedReturnRequest {
  const b = (body ?? {}) as Record<string, unknown>;

  if (typeof b.request_id !== 'string' || b.request_id.trim() === '') throw invalid('request_id 가 필요합니다');
  if (!Array.isArray(b.items) || b.items.length === 0) throw invalid('items 가 비어 있습니다');

  const seen = new Set<string>();
  const items = b.items.map((raw, i) => {
    const it = (raw ?? {}) as { item_id?: unknown; quantity?: unknown };
    if (typeof it.item_id !== 'string' || it.item_id === '' || typeof it.quantity !== 'number' || !Number.isInteger(it.quantity) || it.quantity <= 0) {
      throw invalid(`items[${i}] 가 올바르지 않습니다`);
    }
    // 같은 줄이 둘이면 수량 판정이 줄 단위라 합쳐 보지 않으면 상한을 우회한다
    if (seen.has(it.item_id)) throw invalid(`items 에 같은 item_id 가 두 번 있습니다: ${it.item_id}`);
    seen.add(it.item_id);
    return { itemId: it.item_id, quantity: it.quantity };
  });

  if (typeof b.reason !== 'string' || b.reason.trim() === '') throw invalid('reason 이 필요합니다');
  if (b.note !== undefined && typeof b.note !== 'string') throw invalid('note 는 문자열이어야 합니다');

  if (b.kind !== undefined && b.kind !== 'return' && b.kind !== 'exchange') throw invalid("kind 는 'return' 또는 'exchange' 여야 합니다");

  const adminOnly = { feeBearer: b.fee_bearer, windowOverrideReason: b.window_override_reason };
  if (scope === 'store') {
    if (adminOnly.feeBearer !== undefined || adminOnly.windowOverrideReason !== undefined) {
      throw invalid('fee_bearer·window_override_reason 은 사용할 수 없습니다');
    }
  } else {
    if (adminOnly.feeBearer !== undefined && adminOnly.feeBearer !== 'customer' && adminOnly.feeBearer !== 'seller') {
      throw invalid("fee_bearer 는 'customer' 또는 'seller' 여야 합니다");
    }
    if (adminOnly.windowOverrideReason !== undefined && typeof adminOnly.windowOverrideReason !== 'string') {
      throw invalid('window_override_reason 은 문자열이어야 합니다');
    }
  }

  return {
    requestId: b.request_id.trim(),
    items,
    reasonValue: b.reason.trim(),
    ...(b.kind === 'exchange' ? { kind: 'exchange' as const } : {}),
    ...(typeof b.note === 'string' ? { note: b.note } : {}),
    ...(adminOnly.feeBearer !== undefined ? { operatorFeeBearer: adminOnly.feeBearer as 'customer' | 'seller' } : {}),
    ...(typeof adminOnly.windowOverrideReason === 'string' ? { windowOverrideReason: adminOnly.windowOverrideReason } : {}),
  };
}
