import { MedusaError } from '@medusajs/framework/utils';

import { parseRefundMode, type RefundMode } from '../../../../../../../workflows/orders/settlement/refund-mode';

export type ReturnPrepayBody = {
  requestId: string;
  /** 없으면 선환불이 기본값(품목 값 − 택배비 예상)을 낸다 */
  amount?: number;
  /** 없으면 선환불이 auto 로 읽는다 */
  refundMode?: RefundMode;
  memo: string;
};

/** core 의 메모 칸과 같은 상한(@MaxLength(500)) */
const MEMO_MAX_LENGTH = 500;

/** 본문 모양만 본다. 금액이 품목 값을 넘는지는 선환불이 본다(prepay_exceeds_item_value). 메모는 요청 해시에 들어가므로 그대로 둔다. */
export function parseInput(body: unknown): ReturnPrepayBody {
  const b = (body ?? {}) as { requestId?: unknown; amount?: unknown; refundMode?: unknown; memo?: unknown };
  if (typeof b.requestId !== 'string' || b.requestId.trim() === '') {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'requestId 가 필요합니다');
  }
  if (typeof b.memo !== 'string' || !/\S/.test(b.memo) || b.memo.length > MEMO_MAX_LENGTH) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `memo 는 비어 있지 않은 ${MEMO_MAX_LENGTH}자 이하 문자열이어야 합니다`);
  }
  if (b.amount !== undefined && (typeof b.amount !== 'number' || !Number.isInteger(b.amount) || b.amount < 1)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `amount 는 1 이상 정수(원)여야 합니다: ${JSON.stringify(b.amount)}`);
  }
  return {
    requestId: b.requestId.trim(),
    ...(b.amount !== undefined ? { amount: b.amount } : {}),
    ...(b.refundMode !== undefined ? { refundMode: parseRefundMode(b.refundMode) } : {}),
    memo: b.memo,
  };
}
