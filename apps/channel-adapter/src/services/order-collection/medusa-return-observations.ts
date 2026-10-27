import {
  CHANNEL_CANCEL_REFUND_MODES,
  CUSTOMER_RETURN_REASONS,
  type ChannelCancelRefundMode,
  type ChannelReturnPrepaidPayload,
  type ChannelReturnSettledPayload,
  type CustomerReturnReason,
} from '@packages/event-contracts/streams';
import type { MedusaOrder, MedusaReturn } from '../../adapters/medusa/medusa.client';
import type { LifecycleObservation } from './channel-order-source.interface';

export type SkippedReturn = { returnId: string; reason: 'unconfirmed' | 'no_record' | 'no_items' | 'no_settlement_record' | 'no_prepay_record' };

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

type SettlementRecord = Omit<ChannelReturnSettledPayload, 'orderId' | 'salesChannel' | 'externalOrderId' | 'returnId'>;

const isNonNegativeInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

function isRefundMode(value: unknown): value is ChannelCancelRefundMode {
  return CHANNEL_CANCEL_REFUND_MODES.some((mode) => mode === value);
}

/**
 * `return.metadata.almondReturnSettlement` 중 환불까지 끝난(`stage === 'refunded'`) 기록을 읽는다. 모양은 Medusa 쪽
 * `return-settlement-record.ts` 가 정한다 — 필요한 칸만 직접 검증한다. 아직 끝나지 않았으면 undefined, 끝났다는데
 * 모양이 어긋나면 null (돈을 지어내지 않는다).
 */
function readSettlement(metadata: MedusaReturn['metadata']): SettlementRecord | null | undefined {
  const raw = metadata?.almondReturnSettlement;
  if (raw === undefined || raw === null) return undefined;
  if (!isRecord(raw)) return null;
  if (raw.stage !== 'refunded') return undefined;
  const { requestId, items, deduction, feeNotAdjusted, refundAmount, refundedAt, refundMode } = raw;
  if (typeof requestId !== 'string' || requestId === '') return null;
  if (!Array.isArray(items) || items.length === 0) return null;
  const lines: SettlementRecord['items'] = [];
  for (const item of items) {
    if (!isRecord(item) || typeof item.itemId !== 'string' || item.itemId === '') return null;
    if (!isNonNegativeInt(item.received) || !isNonNegativeInt(item.dismissed)) return null;
    lines.push({ channelOrderItemId: item.itemId, received: item.received, dismissed: item.dismissed });
  }
  if (!isRecord(deduction)) return null;
  const { returnShipping, freeShippingBreak, roundTrip, hold } = deduction;
  if (!isNonNegativeInt(returnShipping) || !isNonNegativeInt(freeShippingBreak) || !isNonNegativeInt(roundTrip)) {
    return null;
  }
  // K8 PR6b 의 새 칸 — 없으면 칸을 생략하고(옛 기록), 있는데 모양이 어긋나면 돈을 지어내지 않는다
  if (hold !== undefined && !isNonNegativeInt(hold)) return null;
  const { prepaidApplied, externalRefundApplied } = raw;
  if (prepaidApplied !== undefined && !isNonNegativeInt(prepaidApplied)) return null;
  if (externalRefundApplied !== undefined && !isNonNegativeInt(externalRefundApplied)) return null;
  if (typeof feeNotAdjusted !== 'boolean' || !isNonNegativeInt(refundAmount)) return null;
  if (typeof refundedAt !== 'string' || Number.isNaN(Date.parse(refundedAt))) return null;
  if (!isRefundMode(refundMode)) return null;
  return {
    requestId,
    refundAmount,
    deduction: { returnShipping, freeShippingBreak, roundTrip, ...(hold !== undefined ? { hold } : {}) },
    feeNotAdjusted,
    refundMode,
    settledAt: new Date(refundedAt).toISOString(),
    items: lines,
    ...(prepaidApplied !== undefined ? { prepaidAmount: prepaidApplied } : {}),
    ...(externalRefundApplied !== undefined ? { externalRefundApplied } : {}),
  };
}

type PrepayRecord = Omit<ChannelReturnPrepaidPayload, 'orderId' | 'salesChannel' | 'externalOrderId' | 'returnId'>;

/**
 * `return.metadata.almondReturnPrepay` 중 환불까지 끝난(`stage === 'refunded'`) 기록을 읽는다. 모양은 Medusa 쪽
 * `return-prepay-record.ts` 가 정한다. 아직 요청 단계면 undefined, 끝났다는데 모양이 어긋나면 null.
 * 기록의 amount 는 «이번에 선환불할(한) 금액»이다 — 이 관측이 곧 그 금액의 사실이다.
 */
function readPrepay(metadata: MedusaReturn['metadata']): PrepayRecord | null | undefined {
  const raw = metadata?.almondReturnPrepay;
  if (raw === undefined || raw === null) return undefined;
  if (!isRecord(raw)) return null;
  if (raw.stage !== 'refunded') return undefined;
  const { requestId, amount, refundedAt, refundMode } = raw;
  if (typeof requestId !== 'string' || requestId === '') return null;
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1) return null;
  if (typeof refundedAt !== 'string' || Number.isNaN(Date.parse(refundedAt))) return null;
  if (!isRefundMode(refundMode)) return null;
  return { requestId, amount, refundMode, prepaidAt: new Date(refundedAt).toISOString() };
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

    // 선환불 끝 — requested 뒤, settled 앞. 정산 전에 나간 돈이라 반품 status 와 무관하게 읽는다.
    const prepay = readPrepay(ret.metadata);
    if (prepay === null) {
      skipped.push({ returnId, reason: 'no_prepay_record' });
    } else if (prepay) {
      observations.push({
        eventType: 'ChannelReturnPrepaid',
        eventKey: `return:${returnId}:prepaid`,
        payload: { returnId, ...prepay },
        rawEvent: { externalOrderId: order.id, returnId, status: ret.status },
      });
    }

    if (ret.status === 'canceled') {
      observations.push({
        eventType: 'ChannelReturnCancelled',
        eventKey: `return:${returnId}:cancelled`,
        payload: { returnId, cancelledAt: ret.canceled_at ?? order.updated_at ?? requestedAt },
        rawEvent: { externalOrderId: order.id, returnId, status: ret.status },
      });
    }

    // 정산 끝(환불까지) — 같은 반품의 requested 뒤에 낸다. 수령 단계(received·partially_received)에서만 읽는다.
    if (ret.status === 'received' || ret.status === 'partially_received') {
      const settlement = readSettlement(ret.metadata);
      if (settlement === null) {
        skipped.push({ returnId, reason: 'no_settlement_record' });
      } else if (settlement) {
        observations.push({
          eventType: 'ChannelReturnSettled',
          eventKey: `return:${returnId}:settled`,
          payload: { returnId, ...settlement },
          rawEvent: { externalOrderId: order.id, returnId, status: ret.status },
        });
      }
    }
  }

  return { observations, skipped };
}
