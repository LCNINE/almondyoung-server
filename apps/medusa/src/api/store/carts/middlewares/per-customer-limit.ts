import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../../../../modules/promotion-meta';
import { requiresIssuance } from '../../../admin/promotions/helpers';
import { isUsable, hasPolicyStarted } from '../../../../modules/promotion-meta/validity';
import { grantsFor, hasUsableGrant } from '../../../../modules/promotion-meta/grants';
import type { CouponGrantRow } from '../../../../modules/promotion-meta/service';

interface AddPromotionsBody {
  promo_codes?: string[];
}

export const perCustomerLimitMiddleware = async (req: any, res: any, next: any) => {
  const customerId = req.auth_context?.actor_id;

  const promoCodes: string[] = (req.body as AddPromotionsBody)?.promo_codes ?? [];
  if (promoCodes.length === 0) return next();

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const promotionMetaService = req.scope.resolve(PROMOTION_META_MODULE);

  // 발급된 «한 장»들을 한 번에 가져온다 — 프로모션(코드)마다 조회하지 않는다. 비인증
  // 카트(allowUnauthenticated)는 customerId 가 없으므로 조회 자체를 건너뛴다.
  const grants: CouponGrantRow[] = customerId ? await promotionMetaService.listGrantsForCustomer(customerId) : [];

  for (const rawCode of promoCodes) {
    // 코드는 대문자 저장이 규약 — preview(toUpperCase)와 게이트 조회를 일치시킨다.
    const code = rawCode.trim().toUpperCase();
    const { data: promotions } = await query.graph({
      entity: 'promotion',
      fields: ['id'],
      filters: { code },
    });

    if (!promotions?.length) continue;
    const promotion = promotions[0];

    const meta = await promotionMetaService.getByPromotionId(promotion.id);

    const mine = grantsFor(grants, promotion.id);
    const now = new Date();

    // 🔴 정책 시작(`starts_at`)은 **장 유무 분기 밖**이다 — 장을 가졌다고 시작 전 쿠폰을
    // 쓸 수 있는 것이 아니다. 분기 안에 두면 `hasUsableGrant` 가 정책을 모르므로 보유자에게만
    // `starts_at` 이 사라진다(강제 발급, 혹은 운영 중 시작일을 뒤로 미는 순간 전원 해당).
    // preview 는 같은 사유를 `COUPON_NOT_STARTED` 로 내보내므로 여기도 같은 토큰을 쓴다 —
    // 표시와 판정이 갈리면 `displayExpiresAt` 헤더 주석이 경고하는 그 실패가 된다.
    if (!hasPolicyStarted(meta, now)) {
      // message는 머신 토큰 — 스토어프론트가 로케일별 문구로 매핑한다.
      return res.status(400).json({ message: 'COUPON_NOT_STARTED', code: 'COUPON_NOT_STARTED' });
    }

    // 🔴 만료는 visibility 와 무관하다 — public 쿠폰도 대상이다.
    // 발급된 장이 있으면 그 장들이, 없으면(=발급 개념이 없는 public) 정책이 만료를 정한다.
    if (mine.length > 0) {
      if (!hasUsableGrant(mine, now)) {
        // 쓸 수 있는 장이 없다. 만료됐거나 다 썼거나 — 고객에겐 같은 얘기다.
        // message는 머신 토큰 — 스토어프론트가 로케일별 문구로 매핑한다.
        return res.status(400).json({ message: 'COUPON_EXPIRED', code: 'COUPON_EXPIRED' });
      }
    } else if (!isUsable(null, meta, now)) {
      // message는 머신 토큰 — 스토어프론트가 로케일별 문구로 매핑한다.
      return res.status(400).json({ message: 'COUPON_EXPIRED', code: 'COUPON_EXPIRED' });
    }

    // 메타가 없으면 «발급 필요» 다(닫힌 기본값 — #488 N7). 옛 코드는 undefined 라 게이트를 통과했다.
    if (requiresIssuance(meta)) {
      if (!customerId || mine.length === 0) {
        // message는 머신 토큰 — 스토어프론트가 로케일별 문구로 매핑한다.
        // (Medusa JS SDK FetchError는 code를 버리고 message만 보존하므로 message에 토큰을 싣는다.)
        return res.status(400).json({
          message: 'COUPON_NOT_ASSIGNED',
          code: 'COUPON_NOT_ASSIGNED',
        });
      }
      // 발급은 받았는데 쓸 장이 없는 경우는 위에서 이미 걸렀다.
    }
  }

  next();
};
