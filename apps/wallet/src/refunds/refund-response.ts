import type { Refund } from '../types';
import { RefundResponseDto, RefundListItemDto } from './dto';

/** 환불 행 → API 응답. manualConfirmable 은 결제수단을 아는 호출자(관리자 목록·상세)만 정한다. */
export function toRefundResponse(refund: Refund, manualConfirmable = false): RefundResponseDto {
  return {
    id: refund.id,
    chargeId: refund.chargeId,
    intentId: refund.intentId,
    status: refund.status,
    amount: refund.amount,
    currency: refund.currency,
    reasonCode: refund.reasonCode,
    reasonMessage: refund.reasonMessage,
    createdAt: refund.createdAt,
    manualConfirmable,
    execution: refund.execution,
    kind: refund.kind,
    failureCode: refund.failureCode,
    retryable: refund.failureRetryable,
  };
}

export function toRefundListItem(refund: Refund): RefundListItemDto {
  return {
    id: refund.id,
    chargeId: refund.chargeId,
    status: refund.status,
    amount: refund.amount,
    reasonCode: refund.reasonCode,
    execution: refund.execution,
    kind: refund.kind,
    createdAt: refund.createdAt,
  };
}
