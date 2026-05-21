import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../../../../modules/promotion-meta';

interface AddPromotionsBody {
  promo_codes?: string[];
}

export const perCustomerLimitMiddleware = async (req: any, res: any, next: any) => {
  const customerId = req.auth_context?.actor_id;
  if (!customerId) return next();

  const promoCodes: string[] = (req.body as AddPromotionsBody)?.promo_codes ?? [];
  if (promoCodes.length === 0) return next();

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const promotionMetaService = req.scope.resolve(PROMOTION_META_MODULE);

  for (const code of promoCodes) {
    const { data: promotions } = await query.graph({
      entity: 'promotion',
      fields: ['id'],
      filters: { code },
    });

    if (!promotions?.length) continue;
    const promotion = promotions[0];

    const meta = await promotionMetaService.getByPromotionId(promotion.id);
    const maxUses = meta?.max_uses_per_customer ? Number(meta.max_uses_per_customer) : 0;
    if (!maxUses || maxUses <= 0) continue;

    // cart-add 시점 선제 차단; order-complete 시점에 complete-cart hook에서 재검증으로 race window 차단.
    const { data: orders } = await query.graph({
      entity: 'order',
      fields: ['id'],
      filters: {
        customer_id: customerId,
        promotions: { id: promotion.id },
      },
      pagination: { take: maxUses },
    });

    if ((orders?.length ?? 0) >= maxUses) {
      return res.status(400).json({
        message: `이 쿠폰은 1인당 ${maxUses}회까지 사용할 수 있습니다.`,
        code: 'COUPON_LIMIT_EXCEEDED',
      });
    }
  }

  next();
};
