import { capturePaymentWorkflow } from '@medusajs/core-flows';
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from '@medusajs/framework/http';
import { ContainerRegistrationKeys, MedusaError } from '@medusajs/framework/utils';

type OrderWithPayments = {
  id: string;
  customer_id?: string | null;
  payment_status?: string | null;
  payment_collections?: Array<{
    payments?: Array<{ id: string }>;
  }>;
};

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const orderId = req.params.id;
  const customerId = req.auth_context?.actor_id;

  if (!customerId) {
    return res.status(401).json({
      message: 'Customer authentication required',
    });
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  const { data } = await query.graph({
    entity: 'order',
    fields: [
      'id',
      'customer_id',
      'payment_status',
      'payment_collections.id',
      'payment_collections.payments.id',
    ],
    filters: { id: orderId },
  });

  const order = data?.[0] as OrderWithPayments | undefined;

  if (!order) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Order ${orderId} was not found`,
    );
  }

  if (order.customer_id !== customerId) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      'You are not allowed to confirm purchase for this order',
    );
  }

  if (order.payment_status === 'captured') {
    return res.status(200).json({
      success: true,
      order: {
        id: order.id,
        payment_status: order.payment_status,
      },
      message: 'Order payment is already captured',
    });
  }

  if (order.payment_status !== 'authorized') {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Order payment status must be "authorized" to confirm purchase. Current: ${order.payment_status}`,
    );
  }

  const paymentIds = (
    order.payment_collections?.flatMap((collection) => collection.payments ?? []) ??
    []
  )
    .map((payment) => payment.id)
    .filter(Boolean);

  if (!paymentIds.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      'No capturable payment found for this order',
    );
  }

  for (const paymentId of paymentIds) {
    await capturePaymentWorkflow(req.scope).run({
      input: {
        payment_id: paymentId,
        captured_by: customerId,
      },
    });
  }

  const { data: refreshed } = await query.graph({
    entity: 'order',
    fields: ['id', 'payment_status'],
    filters: { id: orderId },
  });

  const updatedOrder = refreshed?.[0] as
    | { id: string; payment_status?: string | null }
    | undefined;

  return res.status(200).json({
    success: true,
    order: {
      id: updatedOrder?.id ?? orderId,
      payment_status: updatedOrder?.payment_status ?? 'captured',
    },
  });
};
