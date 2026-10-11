import { MedusaError } from '@medusajs/framework/utils';

/** 정산 라우트의 환불 방식(#1016 36번 재설계 §6.1·§6.3). 없으면 auto — 옛 호출자(channel-adapter)는 이 칸을 모른다 */
export type RefundMode = 'auto' | 'manual';

export function parseRefundMode(value: unknown): RefundMode {
  if (value === undefined || value === null) return 'auto';
  if (value === 'auto' || value === 'manual') return value;
  throw new MedusaError(MedusaError.Types.INVALID_DATA, `refundMode 는 'auto' 또는 'manual' 이어야 합니다: ${JSON.stringify(value)}`);
}
