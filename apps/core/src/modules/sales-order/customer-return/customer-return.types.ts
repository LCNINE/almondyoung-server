import type { InferSelectModel } from 'drizzle-orm';
import type { ReturnSettlementDeduction } from '@packages/event-contracts/streams/orders.stream';
import {
  customerReturnArrivals,
  customerReturnItems,
  customerReturnLines,
  customerReturnReasonEnum,
  customerReturns,
  customerReturnStatusEnum,
} from '../../inventory/schema/inventory.schema';

export type CustomerReturnStatus = (typeof customerReturnStatusEnum.enumValues)[number];
export type CustomerReturnReason = (typeof customerReturnReasonEnum.enumValues)[number];
export type CustomerReturn = InferSelectModel<typeof customerReturns>;
export type CustomerReturnLine = InferSelectModel<typeof customerReturnLines>;
export type CustomerReturnItem = InferSelectModel<typeof customerReturnItems>;
export type CustomerReturnArrival = InferSelectModel<typeof customerReturnArrivals>;

/** `customer_returns.settlement` — 정산 명령의 진행과 마지막 실패 사실(K8 PR6) */
export type CustomerReturnSettlement = {
  state: 'in_progress' | 'refused' | 'stalled' | 'done';
  refundMode: 'auto' | 'manual';
  startedAt: string;
  lastIssuedAt: string;
  attempts: number;
  lastFailure: { code: string; message: string; retryable: boolean; received: boolean; at: string } | null;
  /** 명령 멱등 키의 세대 — PR 6 행엔 없다(읽는 곳은 `issues ?? attempts`) */
  issues?: number;
  /** 이 정산이 발행한 명령의 CS 입력 — PR 6 행엔 없다(읽는 곳은 `command ?? {}`) */
  command?: {
    holdDeduction?: { amount: number; memo: string };
    alreadyRefundedAmount?: number;
    closesMissing?: boolean;
  };
};

/** `customer_returns.settlement_outcome` — 정산 결과(환불액·차감) */
export type CustomerReturnSettlementOutcome = {
  refundAmount: number;
  deduction: ReturnSettlementDeduction;
  feeNotAdjusted: boolean;
  refundMode: 'auto' | 'manual';
  settledAt: string;
  prepaidAmount?: number;
  externalRefundApplied?: number;
};

/** `customer_returns.prepayment` — 선환불(수령 없이 RETURN 환불)의 진행과 결과(K8 PR6b) */
export type CustomerReturnPrepayment = {
  state: 'in_progress' | 'refused' | 'stalled' | 'done' | 'superseded';
  refundMode: 'auto' | 'manual';
  requestedAmount: number | null;
  memo: string;
  requestedBy: string;
  startedAt: string;
  lastIssuedAt: string;
  attempts: number;
  issues: number;
  lastFailure: { code: string; message: string; retryable: boolean; at: string } | null;
  outcome: { amount: number; refundMode: 'auto' | 'manual'; prepaidAt: string } | null;
};

/** `customer_returns.cs_resolution` — CS 가 내린 결정(미도착 닫기·보류 차감, K8 PR6b) */
export type CustomerReturnCsResolution = {
  missing?: { memo: string; by: string; at: string };
  hold?: { deduction: number; memo: string; by: string; at: string };
};
