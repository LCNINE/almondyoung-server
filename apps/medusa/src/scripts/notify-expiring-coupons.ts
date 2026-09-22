import type { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../modules/promotion-meta';
import type PromotionMetaModuleService from '../modules/promotion-meta/service';

const DAY_MS = 24 * 60 * 60 * 1000;
const SCAN_LIMIT = 500;

export type ExpiringCouponNotice = { userId: string; coupons: Array<{ name: string; expiresAt: string }> };

export function groupNotices(
  grants: Array<{ customer_id: string; promotion_id: string; expires_at: Date }>,
  userIdByCustomer: Map<string, string>,
  nameByPromotion: Map<string, string>,
): ExpiringCouponNotice[] {
  const byUser = new Map<string, ExpiringCouponNotice>();
  for (const grant of grants) {
    const userId = userIdByCustomer.get(grant.customer_id);
    if (!userId) continue;
    const notice = byUser.get(userId) ?? { userId, coupons: [] };
    notice.coupons.push({ name: nameByPromotion.get(grant.promotion_id) ?? '쿠폰', expiresAt: grant.expires_at.toISOString() });
    byUser.set(userId, notice);
  }
  return [...byUser.values()];
}

export async function notifyExpiringCoupons(container: MedusaContainer, now = new Date()): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const baseUrl = process.env.NOTIFICATION_SERVICE_URL;
  const internalKey = process.env.NOTIFICATION_INTERNAL_KEY;
  if (!baseUrl || !internalKey) {
    logger.warn('[coupon] NOTIFICATION_SERVICE_URL / NOTIFICATION_INTERNAL_KEY 가 없어 만료 예정 안내를 건너뛴다');
    return;
  }

  const days = Number(process.env.COUPON_EXPIRY_NOTICE_DAYS ?? 3);
  const service = container.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);
  const grants = await service.claimExpiringClaimedGrants(now, new Date(now.getTime() + days * DAY_MS), SCAN_LIMIT);
  if (grants.length === 0) return;

  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data: customers } = await query.graph({
    entity: 'customer',
    fields: ['id', 'metadata'],
    filters: { id: [...new Set(grants.map((g) => g.customer_id))] },
  });
  const userIdByCustomer = new Map<string, string>();
  for (const customer of customers as Array<{ id: string; metadata?: Record<string, unknown> | null }>) {
    const userId = customer.metadata?.almond_user_id;
    if (typeof userId === 'string' && userId) userIdByCustomer.set(customer.id, userId);
  }
  const metas = (await service.getByPromotionIds([...new Set(grants.map((g) => g.promotion_id))])) as Array<{
    promotion_id: string;
    name: string | null;
  }>;
  const nameByPromotion = new Map(metas.filter((m) => m.name).map((m) => [m.promotion_id, m.name as string]));

  let sent = 0;
  for (const notice of groupNotices(grants, userIdByCustomer, nameByPromotion)) {
    const ids = grants.filter((g) => userIdByCustomer.get(g.customer_id) === notice.userId).map((g) => g.id);
    try {
      const res = await fetch(`${baseUrl}/internal/notifications/coupon-expiry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${internalKey}` },
        body: JSON.stringify(notice),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      sent += 1;
    } catch (error) {
      await service.releaseExpiryNotice(ids);
      logger.warn(`[coupon] 만료 예정 안내 실패 userId=${notice.userId}: ${(error as Error).message} — 다음 회차에 다시 보낸다`);
    }
  }
  logger.info(`[coupon] 만료 예정 안내 ${sent}명 (대상 ${grants.length}장)`);
}
