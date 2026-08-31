import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../../../../modules/promotion-meta';
import { requiresIssuance } from '../../../admin/promotions/helpers';
import { isUsable } from '../../../../modules/promotion-meta/validity';
import { listIssuedLinks, type IssuedLinkRow } from '../../../../modules/promotion-meta/issued-link';

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
  const issuedLinks = customerId ? await listIssuedLinks(req.scope, customerId) : [];
  const linkByPromotionId = new Map<string, IssuedLinkRow>(
    issuedLinks.map((l) => [l.promotion_id, l]),
  );

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

    // 🔴 만료는 visibility 와 무관하다 — public 쿠폰도 대상이다.
    //
    // 캠페인 날짜를 안 쓰기 시작하면서 엔진의 `listActivePromotions_` 가 해주던 만료 차단이
    // 사라졌다(#488 결정 1). 그 방어선을 여기서 넘겨받는다. `requiresIssuance` 안에 두면
    // public 쿠폰이 영원히 안 죽는다.
    //
    // 발급된 «한 장»이면 그 행의 expires_at 이, 아니면 정책의 ends_at 이 기준이다.
    const issuedLink = linkByPromotionId.get(promotion.id) ?? null;
    if (!isUsable(issuedLink, meta, new Date())) {
      // message는 머신 토큰 — 스토어프론트가 로케일별 문구로 매핑한다.
      return res.status(400).json({ message: 'COUPON_EXPIRED', code: 'COUPON_EXPIRED' });
    }

    // 메타가 없으면 «발급 필요» 다(닫힌 기본값 — #488 N7). 옛 코드는 undefined 라 게이트를 통과했다.
    if (requiresIssuance(meta)) {
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
