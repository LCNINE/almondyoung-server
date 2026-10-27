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
};

/** `customer_returns.settlement_outcome` — 정산 결과(환불액·차감) */
export type CustomerReturnSettlementOutcome = {
  refundAmount: number;
  deduction: ReturnSettlementDeduction;
  feeNotAdjusted: boolean;
  refundMode: 'auto' | 'manual';
  settledAt: string;
};
