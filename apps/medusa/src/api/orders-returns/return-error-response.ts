import type { MedusaResponse } from '@medusajs/framework/http';

import { CoreEligibilityUnavailable } from '../../workflows/orders/returns/core-return-eligibility';
import { ReturnRequestRejected } from '../../workflows/orders/returns/plan-return-request';
import { ReturnOrderNotFound } from '../../workflows/orders/returns/request-order-return';

/**
 * 반품 라우트의 정해진 오류 → 응답 매핑 한 곳(N7). 처리했으면 true, 아니면 false — 호출자가 다시 던져 500 이 되게 한다.
 * 400 code=return_rejected + reason = 정해진 거절(재시도해도 같다). 404 = 없는 주문이거나 남의 주문(둘을 가르지 않는다).
 * 502 type=core_unavailable = core 가 «지금은 판정 불가» — 반품 불가가 아니라 나중에 다시 하면 된다.
 */
export function sendReturnError(res: MedusaResponse, error: unknown): boolean {
  if (error instanceof ReturnRequestRejected) {
    res.status(400).json({ type: 'not_allowed', code: 'return_rejected', reason: error.reason, message: error.message });
    return true;
  }
  if (error instanceof ReturnOrderNotFound) {
    res.status(404).json({ type: 'not_found', message: error.message });
    return true;
  }
  if (error instanceof CoreEligibilityUnavailable) {
    res.status(502).json({ type: 'core_unavailable', message: error.message });
    return true;
  }
  return false;
}
