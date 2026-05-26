import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';

/**
 * GET /store/customers/me/promotions
 * 인증된 고객의 사용 가능한 쿠폰(Promotion) 목록을 조회합니다.
 *
 * 반환 대상:
 * 1. 고객에게 직접 발급된 프로모션 (Customer-Promotion 링크)
 * 2. 일반적으로 사용 가능한 프로모션 (전체 공개 쿠폰)
 *
 * 필터링 조건:
 * - active 상태의 프로모션만 반환
 * - campaign 기간 내의 프로모션만 반환
 * - is_automatic=false인 프로모션만 반환 (코드 입력 필요한 쿠폰)
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const customerId = req.auth_context?.actor_id;

  if (!customerId) {
    return res.status(401).json({
      message: 'Customer authentication required',
    });
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  // Query parameters for pagination
  const limit = parseInt(req.query.limit as string) || 20;
  const offset = parseInt(req.query.offset as string) || 0;

  const promotionFields = [
    'id',
    'code',
    'type',
    'status',
    'is_automatic',
    'metadata',
    'campaign_id',
    'campaign.campaign_identifier',
    'campaign.starts_at',
    'campaign.ends_at',
    'application_method.id',
    'application_method.type',
    'application_method.value',
    'application_method.target_type',
    'application_method.max_quantity',
    'application_method.currency_code',
  ];

  //  고객에게 직접 발급된 프로모션 조회
  const { data: customers } = await query.graph({
    entity: 'customer',
    fields: ['id', ...promotionFields.map((f) => `promotions.${f}`)],
    filters: { id: customerId },
  });

  //  일반적으로 사용 가능한 모든 프로모션 조회 (전체 공개 쿠폰)
  const { data: allPromotions } = await query.graph({
    entity: 'promotion',
    fields: promotionFields,
    filters: {
      status: 'active',
      is_automatic: false,
    },
  });

  const now = new Date();

  const isValidPromotion = (promo: any): boolean => {
    // status가 active가 아니면 제외
    if (promo.status !== 'active') {
      return false;
    }

    // 자동 적용 프로모션은 제외 (코드 입력 필요한 것만)
    if (promo.is_automatic) {
      return false;
    }

    // 캠페인 기간 검증
    if (promo.campaign) {
      const startsAt = promo.campaign.starts_at ? new Date(promo.campaign.starts_at) : null;
      const endsAt = promo.campaign.ends_at ? new Date(promo.campaign.ends_at) : null;

      if (startsAt && now < startsAt) {
        return false;
      }
      if (endsAt && now > endsAt) {
        return false;
      }
    }

    return true;
  };

  const formatPromotion = (promo: any, isAssigned: boolean) => ({
    id: promo.id,
    code: promo.code,
    type: promo.type,
    status: promo.status,
    is_automatic: promo.is_automatic,
    is_assigned: isAssigned,
    metadata: promo.metadata ?? null,
    application_method: promo.application_method
      ? {
          id: promo.application_method.id,
          type: promo.application_method.type,
          value: promo.application_method.value,
          target_type: promo.application_method.target_type,
          max_quantity: promo.application_method.max_quantity,
          currency_code: promo.application_method.currency_code,
        }
      : null,
    campaign: promo.campaign
      ? {
          campaign_identifier: promo.campaign.campaign_identifier,
          starts_at: promo.campaign.starts_at,
          ends_at: promo.campaign.ends_at,
        }
      : null,
  });

  // 직접 발급된 프로모션 ID Set (중복 제거용)
  const assignedPromotionIds = new Set<string>();
  const customer = customers?.[0];
  const assignedPromotions = (customer?.promotions || []).filter(isValidPromotion).map((promo: any) => {
    assignedPromotionIds.add(promo.id);
    return formatPromotion(promo, true);
  });

  // 일반 프로모션 (직접 발급된 것 제외, 중복 방지)
  const publicPromotions = (allPromotions || [])
    .filter((promo: any) => !assignedPromotionIds.has(promo.id) && isValidPromotion(promo))
    .map((promo: any) => formatPromotion(promo, false));

  // 합치기: 직접 발급된 것 먼저, 그 다음 일반 프로모션
  const combinedPromotions = [...assignedPromotions, ...publicPromotions];

  // Apply pagination
  const paginatedPromotions = combinedPromotions.slice(offset, offset + limit);

  return res.status(200).json({
    promotions: paginatedPromotions,
    count: combinedPromotions.length,
    offset,
    limit,
  });
}
