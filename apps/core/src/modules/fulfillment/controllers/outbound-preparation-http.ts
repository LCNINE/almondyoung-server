import { ConflictException } from '@nestjs/common';
import { isPreparationBlocked, PreparedOutboundResult } from '../services/outbound-preparation-result';
/** HTTP boundary only: the service transaction must have returned before calling this. */
export function unwrapPreparedOutbound<T>(value: PreparedOutboundResult<T>): T {
  if (isPreparationBlocked(value))
    throw new ConflictException({
      code: value.code,
      error: value.code,
      message:
        value.recovery === 'retry_preparation'
          ? '출고 가능한 재고를 확인하거나 보충한 뒤 준비를 다시 시도해 주세요.'
          : '배치와 송장 상태를 관리자와 확인해 주세요.',
      details: { reasonCode: value.reasonCode, recovery: value.recovery },
    });
  return value;
}
