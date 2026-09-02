import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, Modules, MedusaError } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../../../../../modules/promotion-meta';
import type PromotionMetaModuleService from '../../../../../modules/promotion-meta/service';
import type { CouponGrantRow } from '../../../../../modules/promotion-meta/service';
import { usableGrants, nextExpiryAt } from '../../../../../modules/promotion-meta/grants';

interface RevokeBody {
  customer_ids: string[];
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * 값으로 고른다 — 배열 순서에 기대지 않는다. `listGrantsForPromotion` 은 `orderBy` 가 없어
 * 행 순서가 보장되지 않으므로, 위치(`mine[0]`/`mine[mine.length-1]`)로 「최초/최근」을 뽑으면
 * 여러 장을 가진 고객의 표시가 틀릴 수 있다(#488 Task 7 리뷰). `grants.ts` 의 `nextExpiryAt`
 * (reduce)·`selectGrantToConsume`(명시적 정렬 + id 동률 처리)와 같은 모양을 따른다.
 */
function earliestIssuedGrant(grants: CouponGrantRow[]): CouponGrantRow | undefined {
  return grants.reduce<CouponGrantRow | undefined>((min, g) => {
    if (!min) return g;
    const gt = toDate(g.issued_at)?.getTime() ?? 0;
    const mt = toDate(min.issued_at)?.getTime() ?? 0;
    if (gt !== mt) return gt < mt ? g : min;
    return g.id < min.id ? g : min; // 동률(같은 issued_at)은 id 로 결정적이게
  }, undefined);
}

function latestIssuedGrant(grants: CouponGrantRow[]): CouponGrantRow | undefined {
  return grants.reduce<CouponGrantRow | undefined>((max, g) => {
    if (!max) return g;
    const gt = toDate(g.issued_at)?.getTime() ?? 0;
    const mt = toDate(max.issued_at)?.getTime() ?? 0;
    if (gt !== mt) return gt > mt ? g : max;
    return g.id > max.id ? g : max;
  }, undefined);
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
      // 가장 최근 발급의 경로 — 어느 출처에서 왔는지 한눈에 보이게. 위치가 아니라 issued_at 값으로 고른다.
      issued_via: latestIssuedGrant(mine)?.issued_via ?? null,
      issued_at: earliestIssuedGrant(mine)?.issued_at ?? c.created_at,
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
