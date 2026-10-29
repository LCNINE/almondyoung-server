import { parseServerError, record } from '@/lib/api/server-error';
import { RETURN_REASON_OPTIONS } from './customer-return-labels';
import type {
  CustomerReturnKind,
  CustomerReturnReason,
  OrderReturnable,
  RequestOrderReturnBody,
  ReturnRejectReason,
} from '@/lib/types/dto/customer-returns';

export type ReturnRequestForm = {
  /** 반품·교환 (K8 PR11b N14) */
  kind: CustomerReturnKind;
  /** order item id → 반품 수량 (0 이면 고르지 않은 줄) */
  quantities: Record<string, number>;
  reason: string;
  note: string;
  feeBearer: 'customer' | 'seller' | null;
  windowOverrideReason: string;
};

export type BuildReturnRequestResult =
  | { ok: true; body: RequestOrderReturnBody }
  | { ok: false; error: string };

export function isCustomerReturnReason(value: string): value is CustomerReturnReason {
  return RETURN_REASON_OPTIONS.some((o) => o.value === value);
}

export function isReturnRejectReason(value: unknown): value is ReturnRejectReason {
  return typeof value === 'string' && Object.hasOwn(RETURN_REJECT_MESSAGES, value);
}

/**
 * 교환은 판매자 잘못 사유만 받는다 — Medusa `exchange_requires_seller_fault` 와 같은 판정. 고객 잘못 사유는 단순 변심
 * 하나이고, 기타는 부담 주체를 판매자로 고정해 보낸다.
 */
export function reasonOptionsFor(kind: CustomerReturnKind): typeof RETURN_REASON_OPTIONS {
  return kind === 'exchange' ? RETURN_REASON_OPTIONS.filter((o) => o.value !== 'change_of_mind') : RETURN_REASON_OPTIONS;
}

/** 종류를 바꾼다 — 교환으로 바꾸면 고를 수 없는 사유와 교환 못 하는 줄의 수량을 비운다 */
export function withKind(form: ReturnRequestForm, kind: CustomerReturnKind, returnable: OrderReturnable): ReturnRequestForm {
  if (kind === 'return') return { ...form, kind };
  const blocked = new Set(returnable.items.filter((i) => !i.exchangeable).map((i) => i.item_id));
  const quantities = Object.fromEntries(Object.entries(form.quantities).filter(([id]) => !blocked.has(id)));
  const reason = reasonOptionsFor(kind).some((o) => o.value === form.reason) ? form.reason : '';
  return { ...form, kind, quantities, reason };
}

const chosenQty = (form: ReturnRequestForm, itemId: string) => form.quantities[itemId] ?? 0;

/** Medusa 와 같은 판정: 고른 줄 중 하나라도 기한이 지났으면 사유가 필요하다 */
export function windowOverrideNeeded(form: ReturnRequestForm, returnable: OrderReturnable, now: Date): boolean {
  return returnable.items.some(
    (it) =>
      chosenQty(form, it.item_id) > 0 &&
      it.window_ends_at !== null &&
      new Date(it.window_ends_at).getTime() < now.getTime()
  );
}

export function buildReturnRequestBody(
  form: ReturnRequestForm,
  returnable: OrderReturnable,
  requestId: string,
  now: Date
): BuildReturnRequestResult {
  const byId = new Map(returnable.items.map((i) => [i.item_id, i]));
  const items: Array<{ item_id: string; quantity: number }> = [];
  for (const [itemId, quantity] of Object.entries(form.quantities)) {
    if (!quantity) continue;
    const line = byId.get(itemId);
    if (!line) return { ok: false, error: '반품할 수 없는 품목입니다' };
    if (!Number.isInteger(quantity) || quantity < 0) return { ok: false, error: '수량은 0 이상의 정수여야 합니다' };
    if (quantity > line.returnable_quantity) {
      return { ok: false, error: `반품 가능 수량(${line.returnable_quantity})을 넘었습니다` };
    }
    if (form.kind === 'exchange' && !line.exchangeable) {
      return { ok: false, error: RETURN_REJECT_MESSAGES.exchange_item_unsupported };
    }
    items.push({ item_id: itemId, quantity });
  }
  if (items.length === 0) return { ok: false, error: '반품할 품목의 수량을 입력하세요' };

  const reason = form.reason.trim();
  if (!reason || !isCustomerReturnReason(reason)) return { ok: false, error: '반품 사유를 고르세요' };
  const exchange = form.kind === 'exchange';
  if (exchange && !reasonOptionsFor('exchange').some((o) => o.value === reason)) {
    return { ok: false, error: '교환은 판매자 잘못 사유만 접수할 수 있습니다' };
  }

  const body: RequestOrderReturnBody = {
    request_id: requestId,
    items,
    reason,
  };

  const note = form.note.trim();
  if (note) body.note = note;

  if (reason === 'other' && exchange) {
    body.fee_bearer = 'seller';
  } else if (reason === 'other') {
    if (!form.feeBearer) return { ok: false, error: '기타 사유는 배송비 부담 주체를 고르세요' };
    body.fee_bearer = form.feeBearer;
  }

  if (windowOverrideNeeded(form, returnable, now)) {
    const override = form.windowOverrideReason.trim();
    if (!override) return { ok: false, error: '반품 기한이 지난 품목은 기한을 넘기는 사유가 필요합니다' };
    body.window_override_reason = override;
  }

  if (exchange) body.kind = 'exchange';

  return { ok: true, body };
}

export const RETURN_REJECT_MESSAGES: Record<ReturnRejectReason, string> = {
  order_canceled: '취소된 주문은 반품할 수 없습니다',
  item_not_in_order: '이 주문에 없는 품목입니다',
  not_delivered: '아직 배송 완료되지 않은 품목입니다',
  quantity_exceeds_returnable: '반품 가능 수량을 넘었습니다. 화면을 새로 열어 다시 확인하세요',
  window_closed: '반품 가능 기한이 지났습니다',
  window_override_reason_required: '기한이 지난 품목은 기한을 넘기는 사유가 필요합니다',
  reason_not_found: '반품 사유를 찾을 수 없습니다',
  reason_not_selectable: '이 사유는 접수에 쓸 수 없습니다',
  fee_bearer_required: '기타 사유는 배송비 부담 주체를 정해야 합니다',
  request_id_conflict: '이 접수는 이미 처리됐습니다 — 다시 접수하지 말고 반품 목록(5분 안에 나타납니다)을 확인하세요',
  return_option_missing: '반품 배송 방법이 설정되어 있지 않습니다',
  return_already_received: '이미 입고 처리된 반품입니다',
  not_our_return: '이 주문의 반품이 아닙니다',
  return_arrived: '이미 도착한 반품이라 취소할 수 없습니다',
  return_prepaid: '선환불이 나간 반품이라 취소할 수 없습니다',
  return_picked_up: '한진 기사가 이미 회수한 반품이라 취소할 수 없습니다',
  exchange_requires_seller_fault: '교환은 판매자 잘못 사유(하자·오배송·파손 등)일 때만 접수할 수 있습니다',
  exchange_released: '교환품이 이미 출발해 취소할 수 없습니다',
  exchange_item_unsupported: '인쇄(디자인) 상품은 교환할 수 없습니다 — 반품으로 접수하세요',
};

const CORE_UNAVAILABLE = '주문 확인이 잠시 안 됩니다. 잠시 뒤 다시 시도하세요';

export function returnRejectMessage(error: unknown): string {
  const root = record(error);
  const response = record(root?.response);
  const data = record(response?.data) ?? response;
  const status = response?.status ?? root?.statusCode;

  if (status === 502 && data?.type === 'core_unavailable') return CORE_UNAVAILABLE;

  const reason = data?.reason;
  if (isReturnRejectReason(reason)) {
    return RETURN_REJECT_MESSAGES[reason];
  }
  return parseServerError(error).message;
}
