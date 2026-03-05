import { capturePaymentWorkflow } from '@medusajs/core-flows';
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from '@medusajs/framework/http';
import { ContainerRegistrationKeys, MedusaError } from '@medusajs/framework/utils';

type OrderWithPayments = {
  id: string;
  customer_id?: string | null;
  payment_collections?: Array<{
    payments?: Array<{
      id: string;
      captures?: Array<{ id: string }>;
    }>;
  }>;
};

const getOrderPaymentRows = (order: OrderWithPayments) =>
  (order.payment_collections?.flatMap((collection) => collection.payments ?? []) ?? []).filter(
    (payment): payment is { id: string; captures?: Array<{ id: string }> } => !!payment?.id,
  );

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
      'payment_collections.id',
      'payment_collections.payments.id',
      'payment_collections.payments.captures.id',
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

  const payments = getOrderPaymentRows(order);

  if (!payments.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      'No capturable payment found for this order',
    );
  }

  const uncapturedPaymentIds = payments
    .filter((payment) => !(((payment.captures?.length ?? 0) > 0)))
    .map((payment) => payment.id);

  if (!uncapturedPaymentIds.length) {
    return res.status(200).json({
      success: true,
      order: {
        id: order.id,
        payment_status: 'captured',
      },
      message: 'Order payment is already captured',
    });
  }

  for (const paymentId of uncapturedPaymentIds) {
    await capturePaymentWorkflow(req.scope).run({
      input: {
        payment_id: paymentId,
        captured_by: customerId,
      },
    });
  }

  const { data: refreshed } = await query.graph({
    entity: 'order',
    fields: [
      'id',
      'payment_collections.id',
      'payment_collections.payments.id',
      'payment_collections.payments.captures.id',
    ],
    filters: { id: orderId },
  });

  const updatedOrder = refreshed?.[0] as OrderWithPayments | undefined;
  const refreshedPayments = updatedOrder ? getOrderPaymentRows(updatedOrder) : [];
  const isCaptured =
    refreshedPayments.length > 0 &&
    refreshedPayments.every((payment) => ((payment.captures?.length ?? 0) > 0));

  return res.status(200).json({
    success: true,
    order: {
      id: updatedOrder?.id ?? orderId,
      payment_status: isCaptured ? 'captured' : 'authorized',
    },
  });
};
