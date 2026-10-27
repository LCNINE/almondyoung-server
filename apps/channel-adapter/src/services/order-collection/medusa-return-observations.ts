import { CUSTOMER_RETURN_REASONS, type CustomerReturnReason } from '@packages/event-contracts/streams';
import type { MedusaOrder, MedusaReturn } from '../../adapters/medusa/medusa.client';
import type { LifecycleObservation } from './channel-order-source.interface';

export type SkippedReturn = { returnId: string; reason: 'unconfirmed' | 'no_record' | 'no_items' };

interface AlmondReturnRecord {
  requestId: string;
  reason: CustomerReturnReason;
  feeBearer: 'customer' | 'seller';
  requestedBy: 'customer' | 'operator';
  windowOverrideReason?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isReason(value: unknown): value is CustomerReturnReason {
  return CUSTOMER_RETURN_REASONS.some((reason) => reason === value);
}

/**
 * `return.metadata.almondReturn` 을 읽는다. 모양은 Medusa 쪽 `load-return-order.ts` 가 정한다 —
 * channel-adapter 는 Medusa 코드를 import 하지 않으므로 필요한 칸만 직접 검증한다.
 * 하나라도 빠졌거나 어긋나면 null (이 반품은 우리 접수 경로를 거치지 않았다).
 */
function readRecord(metadata: MedusaReturn['metadata']): AlmondReturnRecord | null {
  const raw = metadata?.almondReturn;
  if (!isRecord(raw)) return null;
  const { requestId, reasonValue, feeBearer, requestedBy, windowOverride } = raw;
  if (typeof requestId !== 'string' || requestId === '') return null;
  if (!isReason(reasonValue)) return null;
  if (feeBearer !== 'customer' && feeBearer !== 'seller') return null;
  if (requestedBy !== 'customer' && requestedBy !== 'operator') return null;
  const overrideReason =
    isRecord(windowOverride) && typeof windowOverride.reason === 'string' ? windowOverride.reason : undefined;
  return {
    requestId,
    reason: reasonValue,
    feeBearer,
    requestedBy,
    ...(overrideReason ? { windowOverrideReason: overrideReason } : {}),
  };
}

/**
 * Medusa 주문의 `returns` → 반품 확정·취소 관측 (K8 PR5). 순수 함수다.
 *
 * 확정은 `requested_at` 이 있는 것이다(`open` 반품엔 없다). 확정된 반품은 이후 상태와 무관하게 requested 를 내고,
 * `canceled` 면 이어서 cancelled 를 낸다 — 이미 취소된 채 처음 보여도 core 가 접수→취소 순서를 볼 수 있게.
 * 건너뛴 반품은 호출자가 warn 으로 남긴다.
 */
export function medusaReturnObservations(order: MedusaOrder): {
  observations: LifecycleObservation[];
  skipped: SkippedReturn[];
} {
  const observations: LifecycleObservation[] = [];
  const skipped: SkippedReturn[] = [];

  const confirmed: Array<{ ret: MedusaReturn; returnId: string; requestedAt: string }> = [];
  for (const ret of order.returns ?? []) {
    if (!ret.id) continue;
    if (!ret.requested_at) {
      skipped.push({ returnId: ret.id, reason: 'unconfirmed' });
      continue;
    }
    confirmed.push({ ret, returnId: ret.id, requestedAt: ret.requested_at });
  }
  confirmed.sort((a, b) => Date.parse(a.requestedAt) - Date.parse(b.requestedAt));

  for (const { ret, returnId, requestedAt } of confirmed) {
    const record = readRecord(ret.metadata);
    if (!record) {
      skipped.push({ returnId, reason: 'no_record' });
      continue;
    }
    const items = (ret.items ?? []).flatMap((item) =>
      item.item_id && typeof item.quantity === 'number' && item.quantity > 0
        ? [{ channelOrderItemId: item.item_id, quantity: item.quantity }]
        : [],
    );
    if (items.length === 0) {
      skipped.push({ returnId, reason: 'no_items' });
      continue;
    }

    observations.push({
      eventType: 'ChannelReturnRequested',
      eventKey: `return:${returnId}:requested`,
      payload: {
        returnId,
        requestId: record.requestId,
        reason: record.reason,
        feeBearer: record.feeBearer,
        requestedBy: record.requestedBy,
        ...(record.windowOverrideReason ? { windowOverrideReason: record.windowOverrideReason } : {}),
        requestedAt,
        items,
      },
      rawEvent: { externalOrderId: order.id, returnId, status: ret.status },
    });

    if (ret.status === 'canceled') {
      observations.push({
        eventType: 'ChannelReturnCancelled',
        eventKey: `return:${returnId}:cancelled`,
        payload: { returnId, cancelledAt: ret.canceled_at ?? order.updated_at ?? requestedAt },
        rawEvent: { externalOrderId: order.id, returnId, status: ret.status },
      });
    }
  }

  return { observations, skipped };
}
