import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../../../../modules/promotion-meta';
import { toMetadataShape } from '../../../admin/promotions/helpers';

interface AddPromotionsBody {
  promo_codes?: string[];
}

export const perCustomerLimitMiddleware = async (req: any, res: any, next: any) => {
  const customerId = req.auth_context?.actor_id;

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
    const metaShape = toMetadataShape(meta);

    if (metaShape?.visibility === 'assigned_only' || metaShape?.visibility === 'claimable') {
      if (!customerId) {
        // message는 머신 토큰 — 스토어프론트가 로케일별 문구로 매핑한다.
        // (Medusa JS SDK FetchError는 code를 버리고 message만 보존하므로 message에 토큰을 싣는다.)
        return res.status(400).json({
          message: 'COUPON_NOT_ASSIGNED',
          code: 'COUPON_NOT_ASSIGNED',
        });
      }
      const { data: customers } = await query.graph({
        entity: 'customer',
        fields: ['id', 'promotions.id'],
        filters: { id: customerId },
      });
      const isAssigned = (customers?.[0]?.promotions ?? []).some((p: any) => p.id === promotion.id);
      if (!isAssigned) {
        // message는 머신 토큰 — 스토어프론트가 로케일별 문구로 매핑한다.
        // (Medusa JS SDK FetchError는 code를 버리고 message만 보존하므로 message에 토큰을 싣는다.)
        return res.status(400).json({
          message: 'COUPON_NOT_ASSIGNED',
          code: 'COUPON_NOT_ASSIGNED',
        });
      }
    }

  }

  next();
};
