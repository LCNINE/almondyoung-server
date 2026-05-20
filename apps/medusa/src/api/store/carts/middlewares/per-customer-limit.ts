import { ContainerRegistrationKeys } from '@medusajs/framework/utils';

interface AddPromotionsBody {
  promo_codes?: string[];
}

export const perCustomerLimitMiddleware = async (req: any, res: any, next: any) => {
  const customerId = req.auth_context?.actor_id;
  if (!customerId) return next();

  const promoCodes: string[] = (req.body as AddPromotionsBody)?.promo_codes ?? [];
  if (promoCodes.length === 0) return next();

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  for (const code of promoCodes) {
    const { data: promotions } = await query.graph({
      entity: 'promotion',
      fields: ['id', 'metadata'],
      filters: { code },
    });

    if (!promotions?.length) continue;
    const promotion = promotions[0];

    const maxUses = Number((promotion.metadata as Record<string, unknown>)?.max_uses_per_customer);
    if (!maxUses || maxUses <= 0) continue;

    // Fetch only enough records to decide — avoids loading entire order history.
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
