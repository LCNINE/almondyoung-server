import { createHash } from 'crypto';
import type { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';

import type { ReturnSettlementDeduction } from './plan-return-fees';

/** 반품 행 metadata 의 정산 진행 기록 키. 요청 기록(almondReturn)과 다르다 — 요청 기록 읽기가 그대로 남는다. */
export const RETURN_SETTLEMENT_METADATA_KEY = 'almondReturnSettlement';

/** exchanged = 교환 정산의 끝(K8 PR11 N3) — refunded 의 자리. 환불 대신 대체 품목 줄을 넣었다 */
export type ReturnSettlementStage = 'received' | 'charged' | 'refunded' | 'exchanged';

/** 교환 대체 품목 줄 하나 — 원래 품목(sourceItemId)을 대신하는 새 주문 품목(itemId). channel-adapter 가 core 에 잇는다 */
export type ReturnExchangeItem = { sourceItemId: string; itemId: string; quantity: number };

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
  /** owed − 상계 적용액(prepaidApplied·externalRefundApplied) − deduction 합 */
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
  // ── PR 6b 칸 — 전부 선택. 없으면 PR 6 기록이다(보류 차감·상계·미도착 닫기 없음) ──
  /** CS 가 요청한 보류 차감(요청액 그대로). 적용액은 deduction.hold */
  hold?: { requested: number; memo: string };
  /** 선환불(`return-prepay:<requestId>` 메모 환불 합)에서 이 정산이 덜 낸 몫 */
  prepaidApplied?: number;
  /** CS 가 적은 외부 환불에서 이 정산이 덜 낸 몫 — 다음 판정의 «품목에 연결 안 된 외부 환불»에서 빠진다 */
  externalRefundApplied?: number;
  /** 미도착 수량을 닫고 정산했다(items 가 반품 품목보다 적을 수 있다) */
  closesMissing?: boolean;
  /**
   * 넣을(넣은) 상계 음수 크레딧 라인의 크기(원, 양수) — 수령 «전» 차액으로만 셀 수 있어 수령 때 정해 둔다.
   * 이어 가는 청구 단계가 이 값으로 넣는다(reference 'return-offset'). 없으면 0
   */
  offsetCreditLine?: number;
  // ── PR 11 칸 — 교환 정산(stage exchanged)일 때만 둘 다 있다. refundAmount 는 0 ──
  /** 대체 품목 줄 주문 수정을 확정하고 차액 0 을 확인한 때 */
  exchangedAt?: string;
  exchangeItems?: ReturnExchangeItem[];
};

const isStage = (v: unknown): v is ReturnSettlementStage =>
  v === 'received' || v === 'charged' || v === 'refunded' || v === 'exchanged';
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
  const deduction = readDeduction(r.deduction);
  if (!deduction) return null;
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
  let hold: ReturnSettlementRecord['hold'];
  if (r.hold !== undefined) {
    const h = r.hold;
    if (!isObj(h) || !isNum(h.requested) || typeof h.memo !== 'string') return null;
    hold = { requested: h.requested, memo: h.memo };
  }
  if (r.prepaidApplied !== undefined && !isNum(r.prepaidApplied)) return null;
  if (r.externalRefundApplied !== undefined && !isNum(r.externalRefundApplied)) return null;
  if (r.closesMissing !== undefined && typeof r.closesMissing !== 'boolean') return null;
  if (r.offsetCreditLine !== undefined && !isNum(r.offsetCreditLine)) return null;
  if (r.exchangedAt !== undefined && typeof r.exchangedAt !== 'string') return null;
  let exchangeItems: ReturnExchangeItem[] | undefined;
  if (r.exchangeItems !== undefined) {
    exchangeItems = readExchangeItems(r.exchangeItems) ?? undefined;
    if (!exchangeItems) return null;
  }
  // 교환 단계는 두 칸이 다 있어야 한다 — channel-adapter 가 대체 품목 id 를 core 에 잇는다
  if (r.stage === 'exchanged' && (r.exchangedAt === undefined || !exchangeItems)) return null;
  return {
    requestId: r.requestId,
    requestHash: r.requestHash,
    stage: r.stage,
    items,
    owed: r.owed,
    deduction,
    feeNotAdjusted: r.feeNotAdjusted,
    refundAmount: r.refundAmount,
    groupFees,
    orderVersion: r.orderVersion,
    receivedAt: r.receivedAt,
    chargeShippingOptionId: r.chargeShippingOptionId,
    ...(r.refundedAt !== undefined ? { refundedAt: r.refundedAt } : {}),
    ...(r.refundMode !== undefined ? { refundMode: r.refundMode } : {}),
    ...(hold !== undefined ? { hold } : {}),
    ...(r.prepaidApplied !== undefined ? { prepaidApplied: r.prepaidApplied } : {}),
    ...(r.externalRefundApplied !== undefined ? { externalRefundApplied: r.externalRefundApplied } : {}),
    ...(r.closesMissing !== undefined ? { closesMissing: r.closesMissing } : {}),
    ...(r.offsetCreditLine !== undefined ? { offsetCreditLine: r.offsetCreditLine } : {}),
    ...(r.exchangedAt !== undefined ? { exchangedAt: r.exchangedAt } : {}),
    ...(exchangeItems !== undefined ? { exchangeItems } : {}),
  };
}

/** 교환 대체 품목 줄 목록 — 1개 이상, 수량은 양의 정수(계약 ChannelReturnSettled.exchangeItems 와 같다). 어긋나면 null */
function readExchangeItems(v: unknown): ReturnExchangeItem[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const out: ReturnExchangeItem[] = [];
  for (const i of v) {
    if (!isObj(i) || typeof i.sourceItemId !== 'string' || typeof i.itemId !== 'string') return null;
    if (!isNum(i.quantity) || !Number.isInteger(i.quantity) || i.quantity <= 0) return null;
    out.push({ sourceItemId: i.sourceItemId, itemId: i.itemId, quantity: i.quantity });
  }
  return out;
}

/** 차감 세 몫(+ PR 6b 의 보류 차감, 선택). 하나라도 어긋나면 null. 선환불 기록의 택배비 예상도 이것으로 읽는다. */
export function readDeduction(d: unknown): ReturnSettlementDeduction | null {
  if (!isObj(d) || !isNum(d.returnShipping) || !isNum(d.freeShippingBreak) || !isNum(d.roundTrip)) return null;
  if (d.hold !== undefined && !isNum(d.hold)) return null;
  return {
    returnShipping: d.returnShipping,
    freeShippingBreak: d.freeShippingBreak,
    roundTrip: d.roundTrip,
    ...(d.hold !== undefined ? { hold: d.hold } : {}),
  };
}

/** 요청 해시에 드는 CS 칸(K8 PR6b). 보류 차감은 금액만 — 메모는 해시 밖이다. */
export type ReturnSettlementHashFields = {
  holdDeductionAmount?: number;
  alreadyRefundedAmount?: number;
  closesMissing?: boolean;
};

/**
 * 정산 요청 해시. requestId 를 넣는다 — 반품 하나에 정산 요청은 하나(core customer_returns.id)라, 다른 requestId 는
 * 같은 품목이어도 «다른 요청»이다. 품목 순서는 무관하다.
 * CS 칸은 «있을 때만» 넣는다 — 칸이 없는 요청은 PR 6 과 바이트까지 같은 해시여야 PR 6 기록이 이어 간다.
 * closesMissing false 는 칸이 없는 것과 같은 요청이라 넣지 않는다.
 */
export function hashReturnSettlement(
  requestId: string,
  items: ReturnSettlementRecord['items'],
  cs: ReturnSettlementHashFields = {},
): string {
  const sorted = [...items]
    .map((i) => ({ itemId: i.itemId, received: i.received, dismissed: i.dismissed }))
    .sort((a, b) => a.itemId.localeCompare(b.itemId));
  const body = {
    requestId,
    items: sorted,
    ...(cs.holdDeductionAmount !== undefined ? { holdDeductionAmount: cs.holdDeductionAmount } : {}),
    ...(cs.alreadyRefundedAmount !== undefined ? { alreadyRefundedAmount: cs.alreadyRefundedAmount } : {}),
    ...(cs.closesMissing === true ? { closesMissing: true } : {}),
  };
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
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
  // 환불액·차감·상계 적용액은 반올림한 원이다 — channel-adapter 의 정산 관측이 정수만 받으므로 소수를 쓰면 관측이 영영 막힌다
  const { returnShipping, freeShippingBreak, roundTrip, hold = 0 } = record.deduction;
  const { prepaidApplied = 0, externalRefundApplied = 0, offsetCreditLine = 0 } = record;
  const amounts = [record.refundAmount, returnShipping, freeShippingBreak, roundTrip, hold, prepaidApplied, externalRefundApplied, offsetCreditLine];
  if (!amounts.every(Number.isInteger)) {
    throw new Error(`반품 정산 기록의 환불액·차감이 정수 원이 아닙니다: ${JSON.stringify(record)}`);
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
