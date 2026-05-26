import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../../../../modules/promotion-meta';
import type PromotionMetaModuleService from '../../../../modules/promotion-meta/service';
import { toMetadataShape, meetsGroupRule } from '../../../admin/promotions/helpers';

/**
 * GET /store/coupons/preview?code=CODE123
 *
 * 쿠폰 코드를 체크아웃에 적용하기 전 미리보기. 인증 선택 사항.
 * - 비인증: 쿠폰 기본 정보 + public 여부만 반환
 * - 인증: 발급 여부, 그룹 조건 충족 여부, 적용 가능성까지 반환
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const code = req.query.code as string | undefined;
  if (!code?.trim()) {
    return res.status(400).json({ message: 'code 파라미터가 필요합니다.' });
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const promotionMetaService = req.scope.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);

  const { data: promotions } = await query.graph({
    entity: 'promotion',
    fields: [
      'id', 'code', 'status', 'is_automatic',
      'campaign.starts_at', 'campaign.ends_at',
      'application_method.type', 'application_method.value',
      'application_method.target_type', 'application_method.currency_code',
      'rules.attribute', 'rules.operator', 'rules.values.value',
    ],
    filters: { code: code.trim().toUpperCase() },
  });

  const promotion = promotions?.[0];
  if (!promotion) {
    return res.status(404).json({
      valid: false,
      reason: 'COUPON_NOT_FOUND',
      message: '존재하지 않는 쿠폰 코드입니다.',
    });
  }

  if (promotion.status !== 'active' || promotion.is_automatic) {
    return res.status(200).json({
      valid: false,
      reason: 'COUPON_INACTIVE',
      message: '사용할 수 없는 쿠폰입니다.',
    });
  }

  const now = new Date();
  if (promotion.campaign) {
    const startsAt = promotion.campaign.starts_at ? new Date(promotion.campaign.starts_at) : null;
    const endsAt = promotion.campaign.ends_at ? new Date(promotion.campaign.ends_at) : null;
    if (startsAt && now < startsAt) {
      return res.status(200).json({
        valid: false,
        reason: 'COUPON_NOT_STARTED',
        message: '아직 사용 기간이 아닌 쿠폰입니다.',
      });
    }
    if (endsAt && now > endsAt) {
      return res.status(200).json({
        valid: false,
        reason: 'COUPON_EXPIRED',
        message: '기간이 만료된 쿠폰입니다.',
        expired_at: endsAt.toISOString(),
      });
    }
  }

  const meta = await promotionMetaService.getByPromotionId(promotion.id);
  const metaShape = toMetadataShape(meta);
  const visibility = (metaShape?.visibility as string) ?? 'public';

  const customerId: string | null = (req as any).auth_context?.actor_id ?? null;

  // 비인증 고객이 비공개 쿠폰을 조회하는 경우 — 존재 노출 자체를 막을 필요는 없음
  // (코드를 알고 있다는 것은 이미 정보가 전달된 것)

  const baseInfo = {
    id: promotion.id,
    code: promotion.code,
    visibility,
    discount: promotion.application_method
      ? {
          type: promotion.application_method.type,
          value: promotion.application_method.value,
          target_type: promotion.application_method.target_type,
          currency_code: promotion.application_method.currency_code,
        }
      : null,
    expires_at: promotion.campaign?.ends_at ?? null,
  };

  if (!customerId) {
    const hasGroupRule = (promotion.rules ?? []).some(
      (r: any) => r.attribute === 'customer.groups.id',
    );
    if (visibility !== 'public' || hasGroupRule) {
      return res.status(200).json({
        valid: false,
        reason: 'LOGIN_REQUIRED',
        message: '로그인 후 확인 가능한 쿠폰입니다.',
        promotion: baseInfo,
      });
    }
    return res.status(200).json({
      valid: true,
      claimable: false,
      promotion: baseInfo,
    });
  }

  // 인증된 고객 — 발급 여부 + 그룹 조건 확인
  const { data: customers } = await query.graph({
    entity: 'customer',
    fields: ['id', 'promotions.id', 'groups.id'],
    filters: { id: customerId },
  });

  const customer = customers?.[0];
  const customerGroupIds = new Set<string>((customer?.groups ?? []).map((g: any) => g.id));
  const isAssigned = (customer?.promotions ?? []).some((p: any) => p.id === promotion.id);

  if (!meetsGroupRule(promotion, customerGroupIds)) {
    return res.status(200).json({
      valid: false,
      reason: 'COUPON_GROUP_RESTRICTED',
      message: '이 쿠폰은 대상 고객만 사용할 수 있습니다.',
      promotion: baseInfo,
    });
  }

  if (visibility === 'assigned_only' && !isAssigned) {
    return res.status(200).json({
      valid: false,
      reason: 'COUPON_NOT_ASSIGNED',
      message: '발급된 고객만 사용할 수 있는 쿠폰입니다.',
      promotion: baseInfo,
    });
  }

  if (visibility === 'claimable' && !isAssigned) {
    return res.status(200).json({
      valid: true,
      claimable: true,
      message: '발급받기 버튼으로 먼저 쿠폰을 발급받아야 사용할 수 있습니다.',
      promotion: { ...baseInfo, promotion_id_to_claim: promotion.id },
    });
  }

  return res.status(200).json({
    valid: true,
    claimable: false,
    is_assigned: isAssigned,
    promotion: baseInfo,
  });
}
