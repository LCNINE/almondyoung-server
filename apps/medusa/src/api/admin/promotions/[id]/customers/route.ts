import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, Modules, MedusaError } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../../../../../modules/promotion-meta';
import type PromotionMetaModuleService from '../../../../../modules/promotion-meta/service';
import type { CouponGrantRow } from '../../../../../modules/promotion-meta/service';
import { usableGrants, nextExpiryAt } from '../../../../../modules/promotion-meta/grants';

interface RevokeBody {
  customer_ids: string[];
}

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const promotionId = req.params.id;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const promotionMetaService = req.scope.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);

  const limit = parseInt(req.query.limit as string) || 20;
  const offset = parseInt(req.query.offset as string) || 0;

  const [{ data: promotions }, grants] = await Promise.all([
    query.graph({
      entity: 'promotion',
      fields: ['id', 'code'],
      filters: { id: promotionId },
    }),
    promotionMetaService.listGrantsForPromotion(promotionId),
  ]);

  const promotion = promotions?.[0];
  if (!promotion) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Promotion ${promotionId} not found`);
  }

  const now = new Date();

  const byCustomer = new Map<string, CouponGrantRow[]>();
  for (const g of grants) {
    const list = byCustomer.get(g.customer_id) ?? [];
    list.push(g);
    byCustomer.set(g.customer_id, list);
  }

  const customerIds = [...byCustomer.keys()];
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

  const customersWithUsage = customers.map((c) => {
    const mine = byCustomer.get(c.id) ?? [];
    const usable = usableGrants(mine, now);
    return {
      ...c,
      granted_count: mine.length,
      used_count: mine.filter((g) => g.used_at != null).length,
      usable_count: usable.length,
      next_expires_at: nextExpiryAt(mine, now),
      // 가장 최근 발급의 경로 — 어느 출처에서 왔는지 한눈에 보이게.
      issued_via: mine[mine.length - 1]?.issued_via ?? null,
      issued_at: mine[0]?.issued_at ?? c.created_at,
    };
  });

  return res.status(200).json({
    promotion_id: promotionId,
    promotion_code: promotion.code,
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
  const promotionMetaService = req.scope.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);

  const removed: { customer_id: string; grants: number }[] = [];
  for (const cid of customer_ids) {
    const n = await promotionMetaService.revokeGrants(promotionId, cid);
    if (n === 0) continue;
    removed.push({ customer_id: cid, grants: n });

    // 회수한 장수만큼 발급 카운트를 되돌린다 — 1회 고정이면 여러 장 회수 시 카운터가 남는다.
    for (let i = 0; i < n; i++) {
      await promotionMetaService.releaseClaimSlot(promotionId).catch(() => {});
    }

    // 남은 장이 없으면 표시용 링크도 걷는다.
    await link
      .dismiss([
        {
          [Modules.CUSTOMER]: { customer_id: cid },
          [Modules.PROMOTION]: { promotion_id: promotionId },
        },
      ])
      .catch(() => {});
  }

  return res.status(200).json({
    success: true,
    message: `${removed.length} customer(s) revoked from promotion`,
    promotion_id: promotionId,
    customer_ids: removed.map((r) => r.customer_id),
    revoked_grants: removed.reduce((s, r) => s + r.grants, 0),
  });
}
