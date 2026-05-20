import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, Modules, MedusaError } from '@medusajs/framework/utils';

interface RevokeBody {
  customer_ids: string[];
}

// GET /admin/promotions/:id/customers
// 특정 쿠폰을 발급받은 고객 목록 조회

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const promotionId = req.params.id;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  const limit = parseInt(req.query.limit as string) || 20;
  const offset = parseInt(req.query.offset as string) || 0;

  const { data: promotions } = await query.graph({
    entity: 'promotion',
    fields: [
      'id',
      'customers.id',
      'customers.email',
      'customers.first_name',
      'customers.last_name',
      'customers.created_at',
    ],
    filters: { id: promotionId },
  });

  if (!promotions || promotions.length === 0) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, 'Promotion not found');
  }

  const allCustomers = (promotions[0].customers as any[]) ?? [];
  const paginatedCustomers = allCustomers.slice(offset, offset + limit);

  return res.status(200).json({
    promotion_id: promotionId,
    customers: paginatedCustomers,
    count: allCustomers.length,
    offset,
    limit,
  });
}


// DELETE /admin/promotions/:id/customers
// 특정 쿠폰을 고객에게서 회수

export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const promotionId = req.params.id;
  const { customer_ids } = req.body as RevokeBody;

  if (!customer_ids || !Array.isArray(customer_ids) || customer_ids.length === 0) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'customer_ids is required');
  }

  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.REMOTE_LINK);

  const links = customer_ids.map((customerId) => ({
    [Modules.CUSTOMER]: { customer_id: customerId },
    [Modules.PROMOTION]: { promotion_id: promotionId },
  }));

  await remoteLink.dismiss(links);

  return res.status(200).json({
    success: true,
    message: `${customer_ids.length} customer(s) revoked from promotion`,
    promotion_id: promotionId,
    customer_ids,
  });
}
