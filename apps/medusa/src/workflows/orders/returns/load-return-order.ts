import type { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';

import { toNumber } from '../partial-cancel/amount';
import type { ReturnableOrderItem, ReturnRequestedBy } from './plan-return-request';

/** 반품 행 metadata 의 우리 기록 키. PR 6 정산이 feeBearer 를, 반품 취소(Task 5)가 fulfillmentTopUp 을 여기서 읽는다. */
export const RETURN_REQUEST_METADATA_KEY = 'almondReturn';

export type ReturnRequestRecord = {
  requestId: string;
  requestHash: string;
  requestedBy: ReturnRequestedBy;
  reasonValue: string;
  /** 반품 택배비 부담 주체 — 요청 때 확정한다(사유 표의 값, 기타면 CS 가 고른 값). 금액은 정산(PR 6)이 매긴다 */
  feeBearer: 'customer' | 'seller';
  /** CS 가 고객 기한을 넘겼을 때만 있다(D5) */
  windowOverride: { reason: string; actorId: string | null } | null;
  /** N1 — 이 반품 때문에 registerFulfillment 로 올린 출고 수량. 반품 취소가 같은 만큼 cancelFulfillment 로 되돌린다 */
  fulfillmentTopUp: Array<{ itemId: string; quantity: number }>;
  /** 반품 취소가 위 수량을 되돌렸다 — 끊긴 취소를 다시 부를 때 두 번 되돌리지 않게 */
  fulfillmentTopUpReverted?: boolean;
};

export type ReturnOrder = {
  id: string;
  status: string;
  customerId: string | null;
  items: ReturnableOrderItem[];
  returns: Array<{ id: string; status: string; record: ReturnRequestRecord | null }>;
};

const REQUESTED_BY: ReadonlySet<string> = new Set<ReturnRequestedBy>(['customer', 'operator']);
const FEE_BEARERS: ReadonlySet<string> = new Set(['customer', 'seller']);

/** 반품 metadata 에서 우리 기록을 읽는다. 없거나 모양이 다르면 null — Medusa 기본 경로나 대시보드가 만든 반품이다. */
export function readReturnRequestRecord(metadata: unknown): ReturnRequestRecord | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const raw = (metadata as Record<string, unknown>)[RETURN_REQUEST_METADATA_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.requestId !== 'string' || typeof r.requestHash !== 'string' || typeof r.reasonValue !== 'string')
    return null;
  if (typeof r.requestedBy !== 'string' || !REQUESTED_BY.has(r.requestedBy)) return null;
  if (typeof r.feeBearer !== 'string' || !FEE_BEARERS.has(r.feeBearer)) return null;
  if (!Array.isArray(r.fulfillmentTopUp)) return null;
  const fulfillmentTopUp = r.fulfillmentTopUp.flatMap((t: unknown) => {
    const { itemId, quantity } = (t ?? {}) as { itemId?: unknown; quantity?: unknown };
    return typeof itemId === 'string' && typeof quantity === 'number' ? [{ itemId, quantity }] : [];
  });
  // 되돌릴 수량을 하나라도 못 읽으면 기록 전체를 믿지 않는다 — 반만 되돌리는 것보다 «우리 기록 아님»으로 멈추는 편이 낫다
  if (fulfillmentTopUp.length !== r.fulfillmentTopUp.length) return null;
  const override = r.windowOverride as { reason?: unknown; actorId?: unknown } | null | undefined;
  const windowOverride =
    override && typeof override === 'object' && typeof override.reason === 'string'
      ? { reason: override.reason, actorId: typeof override.actorId === 'string' ? override.actorId : null }
      : null;

  return {
    requestId: r.requestId,
    requestHash: r.requestHash,
    requestedBy: r.requestedBy as ReturnRequestedBy,
    reasonValue: r.reasonValue,
    feeBearer: r.feeBearer as 'customer' | 'seller',
    windowOverride,
    fulfillmentTopUp,
    ...(r.fulfillmentTopUpReverted === true ? { fulfillmentTopUpReverted: true } : {}),
  };
}

type GraphOrder = {
  id: string;
  status: string;
  customer_id?: string | null;
  items?: Array<{
    id: string;
    quantity?: unknown;
    detail?: {
      quantity?: unknown;
      fulfilled_quantity?: unknown;
      return_requested_quantity?: unknown;
      return_received_quantity?: unknown;
      return_dismissed_quantity?: unknown;
    } | null;
  } | null> | null;
  returns?: Array<{ id: string; status: string; metadata?: Record<string, unknown> | null } | null> | null;
};

/**
 * 반품 판정에 필요한 주문 모양 — 줄별 수량 넷(N2: fulfilled·요청·수령·폐기)과 이 주문의 반품들.
 * 반품 metadata 의 requestId 로 멱등을 보고(N5), 반품 취소가 기록을 찾는다.
 */
export async function loadReturnOrder(container: MedusaContainer, orderId: string): Promise<ReturnOrder | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: 'order',
    fields: [
      'id',
      'status',
      'customer_id',
      'items.id',
      'items.detail.quantity',
      'items.detail.fulfilled_quantity',
      'items.detail.return_requested_quantity',
      'items.detail.return_received_quantity',
      'items.detail.return_dismissed_quantity',
      'returns.id',
      'returns.status',
      'returns.metadata',
    ],
    filters: { id: orderId },
  });
  // graph 결과 타입은 고른 필드를 좁혀 주지 않는다 — 경계에서 고른 모양으로 받는다(partial-cancel 의 productShippingProfiles 와 같은 관례)
  const [order] = data as GraphOrder[];
  if (!order) return null;

  const n = (v: unknown) => {
    const x = toNumber(v ?? 0);
    if (!Number.isFinite(x)) throw new Error(`주문 수량을 읽지 못했습니다: ${orderId}`);
    return x;
  };
  return {
    id: order.id,
    status: order.status,
    customerId: order.customer_id ?? null,
    items: (order.items ?? []).flatMap((i) =>
      i
        ? [
            {
              id: i.id,
              // 주문 줄의 «현재» 수량은 버전이 있는 order_item(detail)에 있다 — items.quantity 만 고르면 수량이 비어 온다(통합 테스트 실측)
              quantity: n(i.detail?.quantity ?? i.quantity),
              fulfilled: n(i.detail?.fulfilled_quantity),
              returnRequested: n(i.detail?.return_requested_quantity),
              returnReceived: n(i.detail?.return_received_quantity),
              returnDismissed: n(i.detail?.return_dismissed_quantity),
            },
          ]
        : [],
    ),
    returns: (order.returns ?? []).flatMap((r) =>
      r ? [{ id: r.id, status: r.status, record: readReturnRequestRecord(r.metadata) }] : [],
    ),
  };
}
