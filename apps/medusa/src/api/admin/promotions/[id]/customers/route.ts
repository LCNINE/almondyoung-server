import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, Modules, MedusaError } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../../../../../modules/promotion-meta';
import type PromotionMetaModuleService from '../../../../../modules/promotion-meta/service';

interface RevokeBody {
  customer_ids: string[];
}

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const promotionId = req.params.id;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const link = req.scope.resolve(ContainerRegistrationKeys.LINK);

  const limit = parseInt(req.query.limit as string) || 20;
  const offset = parseInt(req.query.offset as string) || 0;

  const [{ data: promotions }, allLinks] = await Promise.all([
    query.graph({
      entity: 'promotion',
      fields: ['id', 'code', 'campaign.budget.type', 'campaign.budget.limit'],
      filters: { id: promotionId },
    }),
    // linkService에는 typed interface가 없어 any cast 불가피
    (link.getLinkModule(Modules.CUSTOMER, 'customer_id', Modules.PROMOTION, 'promotion_id') as any)
      .list({ promotion_id: promotionId }, { select: ['customer_id', 'created_at'] }) as Promise<any[]>,
  ]);

  const promotion = promotions?.[0];
  if (!promotion) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Promotion ${promotionId} not found`);
  }

  const budget = (promotion as any).campaign?.budget;
  const maxUsesPerCustomer = budget?.type === 'use_by_attribute' && budget?.limit != null
    ? Number(budget.limit)
    : null;

  const issuedAtMap = new Map<string, string>(
    (allLinks as any[]).map((l) => [l.customer_id, l.created_at]),
  );
  const customerIds = (allLinks as any[]).map((l) => l.customer_id);
  const count = customerIds.length;
  const paginatedIds = customerIds.slice(offset, offset + limit);

  let customers: any[] = [];
  let usageMap = new Map<string, number>();

  if (paginatedIds.length > 0) {
    // query.graph는 GROUP BY 집계를 지원하지 않으므로 레코드를 직접 가져와 앱에서 카운트.
    // take: 100_000 은 page 내 고객 수 * 주문 건수 상한을 커버하는 실용적 상한; 고량 프로모션엔 DB-side GROUP BY로 교체 필요.
    const orderTake = 100_000;

    const [{ data }, { data: orders }] = await Promise.all([
      query.graph({
        entity: 'customer',
        fields: ['id', 'email', 'first_name', 'last_name', 'created_at'],
        filters: { id: paginatedIds },
      }),
      query.graph({
        entity: 'order',
        fields: ['id', 'customer_id'],
        filters: { customer_id: paginatedIds, promotions: { id: promotionId } },
        pagination: { take: orderTake },
      }),
    ]);

    customers = data;
    for (const order of orders ?? []) {
      usageMap.set(order.customer_id, (usageMap.get(order.customer_id) ?? 0) + 1);
    }
  }

  const customersWithUsage = customers.map((c) => ({
    ...c,
    issued_at: issuedAtMap.get(c.id) ?? c.created_at,
    used_count: usageMap.get(c.id) ?? 0,
  }));

  return res.status(200).json({
    promotion_id: promotionId,
    promotion_code: promotion.code,
    max_uses_per_customer: maxUsesPerCustomer,
    customers: customersWithUsage,
    count,
    offset,
    limit,
  });
}


export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const promotionId = req.params.id;
  const { customer_ids } = req.body as RevokeBody;

  if (!customer_ids || !Array.isArray(customer_ids) || customer_ids.length === 0) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'customer_ids is required');
  }

  const link = req.scope.resolve(ContainerRegistrationKeys.LINK);
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.REMOTE_LINK);
  const promotionMetaService = req.scope.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);

  // 실제 연결된 고객만 — issued_count 과다 감소 방지.
  // 위 GET과 동일하게 promotion_id로만 조회하고 customer_ids는 앱에서 필터 (link module 배열 필터 미신뢰).
  const existingLinks = (await (link.getLinkModule(Modules.CUSTOMER, 'customer_id', Modules.PROMOTION, 'promotion_id') as any)
    .list({ promotion_id: promotionId }, { select: ['customer_id'] })) as any[];
  const linkedCustomerIds = new Set<string>(existingLinks.map((l) => l.customer_id));
  const toRemove = customer_ids.filter((id) => linkedCustomerIds.has(id));

  if (toRemove.length > 0) {
    await remoteLink.dismiss(
      toRemove.map((customerId) => ({
        [Modules.CUSTOMER]: { customer_id: customerId },
        [Modules.PROMOTION]: { promotion_id: promotionId },
      })),
    );
    // 회수한 링크 수만큼 발급 수량 카운트 원복 + 발급 로그 soft-delete(자동발급 재발급 허용)
    await Promise.all(
      toRemove.flatMap((customerId) => [
        promotionMetaService.releaseClaimSlot(promotionId).catch(() => {}),
        promotionMetaService.removeIssueLog(customerId, promotionId).catch(() => {}),
      ]),
    );
  }

  return res.status(200).json({
    success: true,
    message: `${toRemove.length} customer(s) revoked from promotion`,
    promotion_id: promotionId,
    customer_ids: toRemove,
  });
}
