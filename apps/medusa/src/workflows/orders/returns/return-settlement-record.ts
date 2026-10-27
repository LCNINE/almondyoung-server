import { createHash } from 'crypto';
import type { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';

import type { ReturnSettlementDeduction } from './plan-return-fees';

/** 반품 행 metadata 의 정산 진행 기록 키. 요청 기록(almondReturn)과 다르다 — 요청 기록 읽기가 그대로 남는다. */
export const RETURN_SETTLEMENT_METADATA_KEY = 'almondReturnSettlement';

export type ReturnSettlementStage = 'received' | 'charged' | 'refunded';

export type ReturnSettlementRecord = {
  /** 정산 요청 키(core customer_returns.id) — 정산 관측이 core 에 돌려준다 */
  requestId: string;
  /** items 정렬 해시 — 같은 requestId 다른 품목은 거절 */
  requestHash: string;
  stage: ReturnSettlementStage;
  items: Array<{ itemId: string; received: number; dismissed: number }>;
  /** 수령이 만든 «돌려줄 차액»(원, 반올림) */
  owed: number;
  deduction: ReturnSettlementDeduction;
  feeNotAdjusted: boolean;
  /** owed − deduction 합 */
  refundAmount: number;
  /** 이 정산 뒤 그룹 요금 — 부분취소 기록과 주문 버전 순으로 겹친다 */
  groupFees: Record<string, number>;
  /** 수령 확정 뒤 주문 버전 */
  orderVersion: number;
  receivedAt: string;
  /** «반품 택배비» 방법을 붙일 배송 옵션 — 수령 때 정한다(이 반품이 닿은 첫 그룹의 원래 방법). 차감 0 이면 null */
  chargeShippingOptionId: string | null;
  refundedAt?: string;
  refundMode?: string;
};

const isStage = (v: unknown): v is ReturnSettlementStage => v === 'received' || v === 'charged' || v === 'refunded';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** 반품 metadata 에서 정산 기록을 읽는다. 모양이 하나라도 어긋나면 null — 반만 믿고 돈을 움직이지 않는다. */
export function readReturnSettlementRecord(metadata: unknown): ReturnSettlementRecord | null {
  if (!isObj(metadata)) return null;
  const r = metadata[RETURN_SETTLEMENT_METADATA_KEY];
  if (!isObj(r)) return null;
  if (typeof r.requestId !== 'string' || r.requestId === '' || typeof r.requestHash !== 'string' || !isStage(r.stage)) return null;
  if (!Array.isArray(r.items)) return null;
  const items: ReturnSettlementRecord['items'] = [];
  for (const i of r.items) {
    if (!isObj(i) || typeof i.itemId !== 'string' || !isNum(i.received) || !isNum(i.dismissed)) return null;
    items.push({ itemId: i.itemId, received: i.received, dismissed: i.dismissed });
  }
  const d = r.deduction;
  if (!isObj(d) || !isNum(d.returnShipping) || !isNum(d.freeShippingBreak) || !isNum(d.roundTrip)) return null;
  if (!isNum(r.owed) || !isNum(r.refundAmount) || !isNum(r.orderVersion)) return null;
  if (typeof r.feeNotAdjusted !== 'boolean' || typeof r.receivedAt !== 'string') return null;
  if (!isObj(r.groupFees)) return null;
  const groupFees: Record<string, number> = {};
  for (const [k, v] of Object.entries(r.groupFees)) {
    if (!isNum(v)) return null;
    groupFees[k] = v;
  }
  if (r.chargeShippingOptionId !== null && typeof r.chargeShippingOptionId !== 'string') return null;
  if (r.refundedAt !== undefined && typeof r.refundedAt !== 'string') return null;
  if (r.refundMode !== undefined && typeof r.refundMode !== 'string') return null;
  return {
    requestId: r.requestId,
    requestHash: r.requestHash,
    stage: r.stage,
    items,
    owed: r.owed,
    deduction: { returnShipping: d.returnShipping, freeShippingBreak: d.freeShippingBreak, roundTrip: d.roundTrip },
    feeNotAdjusted: r.feeNotAdjusted,
    refundAmount: r.refundAmount,
    groupFees,
    orderVersion: r.orderVersion,
    receivedAt: r.receivedAt,
    chargeShippingOptionId: r.chargeShippingOptionId,
    ...(r.refundedAt !== undefined ? { refundedAt: r.refundedAt } : {}),
    ...(r.refundMode !== undefined ? { refundMode: r.refundMode } : {}),
  };
}

/**
 * 정산 요청 해시. requestId 를 넣는다 — 반품 하나에 정산 요청은 하나(core customer_returns.id)라, 다른 requestId 는
 * 같은 품목이어도 «다른 요청»이다. 품목 순서는 무관하다.
 */
export function hashReturnSettlement(requestId: string, items: ReturnSettlementRecord['items']): string {
  const sorted = [...items]
    .map((i) => ({ itemId: i.itemId, received: i.received, dismissed: i.dismissed }))
    .sort((a, b) => a.itemId.localeCompare(b.itemId));
  return createHash('sha256').update(JSON.stringify({ requestId, items: sorted })).digest('hex');
}

/**
 * 수령은 됐는데 택배비 청구 전에 멈춘 정산(stage received)이 있으면 부분취소를 막는다 — 일반 Error 라 500(일시, 재시도)이다.
 * 그 사이 부분취소가 무료배송 깨짐을 받으면, 이어 가는 반품 정산이 같은 깨짐을 또 받는다.
 */
export function assertNoReturnAwaitingCharge(records: ReturnSettlementRecord[]): void {
  if (records.some((r) => r.stage === 'received')) {
    throw new Error('수령까지 끝나고 택배비 청구 전에 멈춘 반품 정산이 있습니다 — 그 정산이 끝난 뒤 다시 시도하세요');
  }
}

/** 쓰기 전에 본다: 읽기(readReturnSettlementRecord)가 버릴 모양이면 겹치기가 이 기록을 조용히 빼므로 쓰지 않고 멈춘다. */
export function assertReadableSettlementRecord(record: ReturnSettlementRecord): void {
  if (!readReturnSettlementRecord({ [RETURN_SETTLEMENT_METADATA_KEY]: record })) {
    throw new Error(`반품 정산 기록의 모양이 어긋납니다: ${JSON.stringify(record)}`);
  }
}

type GraphOrderReturns = { returns?: Array<{ metadata?: Record<string, unknown> | null } | null> | null };

/** 이 주문 반품들의 정산 기록 중 읽히는 것. */
export async function loadReturnSettlementRecords(container: MedusaContainer, orderId: string): Promise<ReturnSettlementRecord[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: 'order',
    fields: ['id', 'returns.id', 'returns.metadata'],
    filters: { id: orderId },
  });
  // graph 결과 타입은 고른 필드를 좁혀 주지 않는다 — 경계에서 고른 모양으로 받는다(load-return-order 와 같은 관례)
  const [order] = data as GraphOrderReturns[];
  return (order?.returns ?? []).flatMap((r) => {
    const rec = r ? readReturnSettlementRecord(r.metadata) : null;
    return rec ? [rec] : [];
  });
}
