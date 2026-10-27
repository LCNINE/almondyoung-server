import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';

import { ReturnPrepayRejected } from '../../../../../../../workflows/orders/returns/prepay-order-return';
import { ReturnOrderNotFound } from '../../../../../../../workflows/orders/returns/request-order-return';
import { returnSettlementPreview } from '../../../../../../../workflows/orders/returns/return-settlement-preview';

/**
 * 반품 정산 미리보기(K8 PR6b N9) — 선환불 기본값과 보류 차감의 여지. 읽기만 한다.
 * 200 { itemValue, feeEstimate, defaultPrepayAmount, prepaidAmount } · 404 not_found ·
 * 400 code=return_prepay_rejected + reason(not_our_return·return_canceled·return_already_settled) = 선환불이 열리지 않는 반품.
 * GET /admin/orders/:id/returns/:return_id/settlement-preview
 */
export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  try {
    res.status(200).json(await returnSettlementPreview(req.scope, { orderId: req.params.id, returnId: req.params.return_id }));
  } catch (error) {
    if (error instanceof ReturnOrderNotFound) {
      res.status(404).json({ type: 'not_found', message: error.message });
      return;
    }
    if (error instanceof ReturnPrepayRejected) {
      res.status(400).json({ type: 'not_allowed', code: 'return_prepay_rejected', reason: error.reason, message: error.message });
      return;
    }
    throw error;
  }
};
