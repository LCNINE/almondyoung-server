import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, Modules, MedusaError } from '@medusajs/framework/utils';

interface AssignPromotionsBody {
  promotion_ids: string[];
}

interface RemovePromotionsBody {
  promotion_ids: string[];
}

/**
 * GET /admin/customers/:id/promotions
 * 특정 고객에게 할당된 프로모션 목록을 조회합니다.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const customerId = req.params.id;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  // Query parameters for pagination
  const limit = parseInt(req.query.limit as string) || 20;
  const offset = parseInt(req.query.offset as string) || 0;

  // Customer와 연결된 Promotions 조회
  const { data: customers } = await query.graph({
    entity: 'customer',
    fields: [
      'id',
      'email',
      'promotions.id',
      'promotions.code',
      'promotions.type',
      'promotions.status',
      'promotions.is_automatic',
      'promotions.campaign_id',
      'promotions.campaign.campaign_identifier',
      'promotions.campaign.starts_at',
      'promotions.campaign.ends_at',
      'promotions.application_method.id',
      'promotions.application_method.type',
      'promotions.application_method.value',
      'promotions.application_method.target_type',
    ],
    filters: { id: customerId },
  });

  if (!customers || customers.length === 0) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, 'Customer not found');
  }

  const customer = customers[0];
  const promotions = customer.promotions || [];

  // Apply pagination
  const paginatedPromotions = promotions.slice(offset, offset + limit);

  return res.status(200).json({
    customer_id: customerId,
    promotions: paginatedPromotions,
    count: promotions.length,
    offset,
    limit,
  });
}

/**
 * POST /admin/customers/:id/promotions
 * 고객에게 쿠폰(Promotion)을 발급합니다.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const customerId = req.params.id;
  const { promotion_ids } = req.body as AssignPromotionsBody;

  if (!promotion_ids || !Array.isArray(promotion_ids) || promotion_ids.length === 0) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'promotion_ids is required and must be a non-empty array');
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.REMOTE_LINK);

  // Verify customer exists
  const { data: customers } = await query.graph({
    entity: 'customer',
    fields: ['id'],
    filters: { id: customerId },
  });

  if (!customers || customers.length === 0) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, 'Customer not found');
  }

  // Verify promotions exist
  const { data: promotions } = await query.graph({
    entity: 'promotion',
    fields: ['id', 'code'],
    filters: { id: promotion_ids },
  });

  if (!promotions || promotions.length !== promotion_ids.length) {
    const foundIds = promotions?.map((p: any) => p.id) || [];
    const missingIds = promotion_ids.filter((id) => !foundIds.includes(id));
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Promotions not found: ${missingIds.join(', ')}`);
  }

  // Create links between customer and promotions
  const links = promotion_ids.map((promotionId) => ({
    [Modules.CUSTOMER]: { customer_id: customerId },
    [Modules.PROMOTION]: { promotion_id: promotionId },
  }));

  await remoteLink.create(links);

  return res.status(200).json({
    success: true,
    message: `${promotion_ids.length} promotion(s) assigned to customer`,
    customer_id: customerId,
    promotion_ids,
  });
}

/**
 * DELETE /admin/customers/:id/promotions
 * 고객에게서 쿠폰(Promotion)을 제거합니다.
 */
export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const customerId = req.params.id;
  const { promotion_ids } = req.body as RemovePromotionsBody;

  if (!promotion_ids || !Array.isArray(promotion_ids) || promotion_ids.length === 0) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'promotion_ids is required and must be a non-empty array');
  }

  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.REMOTE_LINK);

  // Dismiss links between customer and promotions
  const links = promotion_ids.map((promotionId) => ({
    [Modules.CUSTOMER]: { customer_id: customerId },
    [Modules.PROMOTION]: { promotion_id: promotionId },
  }));

  await remoteLink.dismiss(links);

  return res.status(200).json({
    success: true,
    message: `${promotion_ids.length} promotion(s) removed from customer`,
    customer_id: customerId,
    promotion_ids,
  });
}
