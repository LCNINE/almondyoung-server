import { requestRefundPaymentWorkFlow } from '@medusa/workflows/payments/workflows/request-refund-payment';
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from '@medusajs/framework/http';
import { HttpTypes } from '@medusajs/framework/types';
import { refetchPayment } from '../../helpers';
import { AdminCreatePaymentRefundType } from '../../validators';

/**
 * 관리자 환불 요청
 */
export const POST = async (
  req: AuthenticatedMedusaRequest<AdminCreatePaymentRefundType>,
  res: MedusaResponse<HttpTypes.AdminPaymentResponse>,
) => {
  const { id } = req.params;

  await requestRefundPaymentWorkFlow(req.scope).run({
    input: {
      payment_id: id,
      created_by: req.auth_context.actor_id,
      ...req.validatedBody,
    },
  });

  const payment = await refetchPayment(id, req.scope, req.queryConfig.fields);

  res.status(200).json({ payment });
};
