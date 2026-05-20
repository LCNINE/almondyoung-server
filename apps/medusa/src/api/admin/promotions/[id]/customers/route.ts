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
  const link = req.scope.resolve(ContainerRegistrationKeys.LINK);

  const limit = parseInt(req.query.limit as string) || 20;
  const offset = parseInt(req.query.offset as string) || 0;

  // customer-promotion 링크 테이블에서 customer ID 목록 조회
  // query.graph({ entity: 'promotion', fields: ['customers.*'] })는 MikroORM이
  // Promotion 엔티티에 customers relation이 없다고 오류를 낸다 — remote link는
  // LINK.getLinkModule().list()로 직접 조회해야 한다.
  const linkService = link.getLinkModule(Modules.CUSTOMER, 'customer_id', Modules.PROMOTION, 'promotion_id');
  const allLinks = await (linkService as any).list(
    { promotion_id: promotionId },
    { select: ['customer_id'] },
  );

  const customerIds = allLinks.map((l: any) => l.customer_id);
  const count = customerIds.length;

  const paginatedIds = customerIds.slice(offset, offset + limit);

  let customers: any[] = [];
  if (paginatedIds.length > 0) {
    const { data } = await query.graph({
      entity: 'customer',
      fields: ['id', 'email', 'first_name', 'last_name', 'created_at'],
      filters: { id: paginatedIds },
    });
    customers = data;
  }

  return res.status(200).json({
    promotion_id: promotionId,
    customers,
    count,
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
