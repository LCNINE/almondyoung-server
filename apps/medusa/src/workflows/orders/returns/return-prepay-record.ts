import { createHash } from 'crypto';

import { toNumber } from '../partial-cancel/amount';
import type { ReturnSettlementDeduction } from './plan-return-fees';
import { readDeduction } from './return-settlement-record';

/** 반품 행 metadata 의 선환불 진행 기록 키(K8 PR6b N4). 요청 기록(almondReturn)·정산 기록(almondReturnSettlement)과 다르다. */
export const RETURN_PREPAY_METADATA_KEY = 'almondReturnPrepay';

/** 선환불 환불의 메모. 선환불한 금액의 정본은 이 메모를 단 Medusa 환불 행이다(N6) — 기록의 amount 가 아니다. */
export const prepayNote = (requestId: string): string => `return-prepay:${requestId}`;

export type ReturnPrepayStage = 'requested' | 'refunded';

export type ReturnPrepayRecord = {
  /** 선환불 요청 키(core customer_returns.id) */
  requestId: string;
  /** hashReturnPrepay — 같은 requestId 다른 금액·메모는 거절 */
  requestHash: string;
  stage: ReturnPrepayStage;
  /** 이번에 선환불할(한) 금액(원) — CS 가 주지 않았으면 기본값(품목 값 − 택배비 예상) */
  amount: number;
  /** 반품 품목 값 V(N5) — 금액 상한 */
  itemValue: number;
  /** 택배비 예상 F(N5) */
  feeEstimate: ReturnSettlementDeduction;
  memo: string;
  requestedAt: string;
  refundedAt?: string;
  refundMode?: string;
};

const isStage = (v: unknown): v is ReturnPrepayStage => v === 'requested' || v === 'refunded';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** 반품 metadata 에서 선환불 기록을 읽는다. 모양이 하나라도 어긋나면 null — 반만 믿고 돈을 움직이지 않는다. */
export function readReturnPrepayRecord(metadata: unknown): ReturnPrepayRecord | null {
  if (!isObj(metadata)) return null;
  const r = metadata[RETURN_PREPAY_METADATA_KEY];
  if (!isObj(r)) return null;
  if (typeof r.requestId !== 'string' || r.requestId === '' || typeof r.requestHash !== 'string' || !isStage(r.stage)) return null;
  if (!isNum(r.amount) || !isNum(r.itemValue)) return null;
  const feeEstimate = readDeduction(r.feeEstimate);
  if (!feeEstimate) return null;
  if (typeof r.memo !== 'string' || typeof r.requestedAt !== 'string') return null;
  if (r.refundedAt !== undefined && typeof r.refundedAt !== 'string') return null;
  if (r.refundMode !== undefined && typeof r.refundMode !== 'string') return null;
  return {
    requestId: r.requestId,
    requestHash: r.requestHash,
    stage: r.stage,
    amount: r.amount,
    itemValue: r.itemValue,
    feeEstimate,
    memo: r.memo,
    requestedAt: r.requestedAt,
    ...(r.refundedAt !== undefined ? { refundedAt: r.refundedAt } : {}),
    ...(r.refundMode !== undefined ? { refundMode: r.refundMode } : {}),
  };
}

/**
 * 선환불 요청 해시. 금액 null(기본값)과 지정 금액은 다른 요청이다. refundMode 는 넣지 않는다 —
 * 자동 거절 뒤 같은 요청을 수동으로 다시 보낸다(정산과 같다).
 */
export function hashReturnPrepay(requestId: string, amount: number | null, memo: string): string {
  return createHash('sha256').update(JSON.stringify({ requestId, amount, memo })).digest('hex');
}

/** 이 요청의 선환불 메모를 단 환불 합(P, N6). 금액을 못 읽으면 던진다 — 모르는 금액을 0 으로 두면 정산이 그만큼 더 낸다. */
export function prepaidTotal(refunds: Array<{ amount: unknown; note?: string | null }>, requestId: string): number {
  const note = prepayNote(requestId);
  return refunds
    .filter((r) => r.note === note)
    .reduce((s, r) => {
      const n = toNumber(r.amount);
      if (!Number.isFinite(n)) throw new Error(`선환불 환불 금액을 읽지 못했습니다: ${note}`);
      return s + n;
    }, 0);
}
