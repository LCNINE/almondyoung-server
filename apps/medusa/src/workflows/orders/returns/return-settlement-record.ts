import type { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';

import type { ReturnSettlementDeduction } from './plan-return-fees';

/** 반품 행 metadata 의 정산 진행 기록 키. 요청 기록(almondReturn)과 다르다 — 요청 기록 읽기가 그대로 남는다. */
export const RETURN_SETTLEMENT_METADATA_KEY = 'almondReturnSettlement';

export type ReturnSettlementStage = 'received' | 'charged' | 'refunded';

export type ReturnSettlementRecord = {
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
  refundedAt?: string;
  refundMode?: string;
};

const STAGES: ReadonlySet<string> = new Set<ReturnSettlementStage>(['received', 'charged', 'refunded']);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** 반품 metadata 에서 정산 기록을 읽는다. 모양이 하나라도 어긋나면 null — 반만 믿고 돈을 움직이지 않는다. */
export function readReturnSettlementRecord(metadata: unknown): ReturnSettlementRecord | null {
  if (!isObj(metadata)) return null;
  const r = metadata[RETURN_SETTLEMENT_METADATA_KEY];
  if (!isObj(r)) return null;
  if (typeof r.requestHash !== 'string' || typeof r.stage !== 'string' || !STAGES.has(r.stage)) return null;
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
  if (r.refundedAt !== undefined && typeof r.refundedAt !== 'string') return null;
  if (r.refundMode !== undefined && typeof r.refundMode !== 'string') return null;
  return {
    requestHash: r.requestHash,
    stage: r.stage as ReturnSettlementStage,
    items,
    owed: r.owed,
    deduction: { returnShipping: d.returnShipping, freeShippingBreak: d.freeShippingBreak, roundTrip: d.roundTrip },
    feeNotAdjusted: r.feeNotAdjusted,
    refundAmount: r.refundAmount,
    groupFees,
    orderVersion: r.orderVersion,
    receivedAt: r.receivedAt,
    ...(r.refundedAt !== undefined ? { refundedAt: r.refundedAt } : {}),
    ...(r.refundMode !== undefined ? { refundMode: r.refundMode } : {}),
  };
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
