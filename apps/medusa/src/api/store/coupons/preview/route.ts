import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../../../../modules/promotion-meta';
import type PromotionMetaModuleService from '../../../../modules/promotion-meta/service';
import type { CouponGrantRow } from '../../../../modules/promotion-meta/service';
import { resolveVisibility } from '../../../admin/promotions/helpers';
import {
  isIssuableToCustomer,
  requiresCustomerContext,
} from '../../../../modules/promotion-meta/issuance-rules';
import { isUsable, issuanceWindowState, displayExpiresAt } from '../../../../modules/promotion-meta/validity';
import { grantsFor, hasUsableGrant, nextExpiryAt, grantsGovernUsage } from '../../../../modules/promotion-meta/grants';

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

  const meta = await promotionMetaService.getByPromotionId(promotion.id);
  // 메타가 없으면 닫힌 쪽이다(#488 N7).
  const visibility: string = resolveVisibility(meta);

  const customerId: string | null = (req as any).auth_context?.actor_id ?? null;

  const now = new Date();
  // 발급된 «장» 들을 한 번에 가져온다. 「보유 여부」는 이제 링크가 아니라 사용 가능한 장이
  // 정한다(#488 Task 8 결정 3) — 링크는 「가진 적 있다」만 말해 다 쓴 쿠폰도 통과시킨다.
  const grants: CouponGrantRow[] = customerId
    ? await promotionMetaService.listGrantsForCustomer(customerId)
    : [];
  const mine = grantsFor(grants, promotion.id);
  const usableMine = hasUsableGrant(mine, now);
  // 만료 표시는 «사용 가능한 장 중 가장 이른 만료» (#488 결정 1). displayExpiresAt 의 `?:`
  // 분기를 지키려고 인스턴스 인자로 그 장을 합성해 넘긴다 — `??` 로 합치지 않는다.
  const expiresAtInstance = usableMine ? { expires_at: nextExpiryAt(mine, now) } : null;
  const expiresAt = displayExpiresAt(expiresAtInstance, meta);

  // 발급 여부와 무관하게 검사한다 — isUsable 도 정책 starts_at 은 발급 여부와 상관없이 보므로,
  // 여기서 건너뛰면 이미 발급받은 고객에게 같은 사유가 EXPIRED 로 오분류된다(리뷰에서 발견된
  // 회귀 — events/:slug 라우트와 라벨이 갈렸었다).
  if (issuanceWindowState(meta, now) === 'not_started') {
    return res.status(200).json({
      valid: false,
      reason: 'COUPON_NOT_STARTED',
      message: '아직 사용 기간이 아닌 쿠폰입니다.',
    });
  }
  // 사용 가능 여부는 «장이 정하는 쿠폰이면 그 장들, 아니면 정책» 이 정한다 (#488 결정 1).
  //
  // 🔴 `mine.length > 0` 이 아니라 `grantsGovernUsage` 다. 둘은 `public` 쿠폰에서 갈린다 —
  // `assigned_only` 로 발급한 뒤 visibility 를 `public` 으로 바꾸면 발급받은 고객에게만 장이
  // 있고, 옛 분기는 그 고객의 장이 소진됐다는 이유로 `COUPON_EXPIRED` 를 돌려줬다. 그런데
  // 카트 게이트(`per-customer-limit`·`complete-cart`)는 같은 상황에서 `grantsGovernUsage` 를
  // 써서 정책으로 갈리므로 쿠폰을 받아준다. 결과는 「체크아웃 패널은 못 쓴다는데 실제로는
  // 적용되는」 쿠폰이었다. 판정은 한 곳에서만 온다.
  const usable = grantsGovernUsage(mine, visibility) ? usableMine : isUsable(null, meta, now);
  if (!usable) {
    return res.status(200).json({
      valid: false,
      reason: 'COUPON_EXPIRED',
      message: '기간이 만료된 쿠폰입니다.',
      expired_at: expiresAt ? new Date(expiresAt).toISOString() : null,
    });
  }

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
          // 정률 캡(#488 A4). 클레임 화면이 「10%」만 보여주면 캡을 모르는 채로 받게 된다.
          max_discount_amount:
            meta?.max_discount_amount != null ? Number(meta.max_discount_amount) : null,
        }
      : null,
    expires_at: expiresAt,
    // W1: expires_at 이 null 인 이유(무기한 vs 미발급 validity_days)를 화면이 구분할 수 있게.
    validity_days: meta?.validity_days != null ? Number(meta.validity_days) : null,
  };

  if (!customerId) {
    // 고객이 누구인지 알아야 판정되는 룰이 하나라도 있으면 로그인부터 받는다.
    // 분류표 밖 룰도 여기서 흡수된다 — 로그인하면 아래에서 COUPON_GROUP_RESTRICTED 로 떨어진다.
    if (visibility !== 'public' || requiresCustomerContext(promotion.rules)) {
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

  // 인증된 고객 — 발급 여부 + 그룹 조건 확인. 그룹 룰 평가에 쓰는 groups.id 만 조회하고
  // promotions.id 는 빼둔다(#488 Task 8 결정 3) — 「보유 여부」는 아래에서 grant 로 정한다.
  const { data: customers } = await query.graph({
    entity: 'customer',
    fields: ['id', 'groups.id'],
    filters: { id: customerId },
  });

  const customer = customers?.[0];
  const customerGroupIds = new Set<string>((customer?.groups ?? []).map((g: any) => g.id));
  // «보유 여부» 는 사용 가능한 장이 있는가로 정한다 (#488 Task 8 결정 3).
  const isAssigned = usableMine;

  if (!isIssuableToCustomer(promotion.rules, customerGroupIds)) {
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
