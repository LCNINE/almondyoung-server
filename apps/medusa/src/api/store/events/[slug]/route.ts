import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../../../../modules/promotion-meta';
import type PromotionMetaModuleService from '../../../../modules/promotion-meta/service';
import type { CouponGrantRow } from '../../../../modules/promotion-meta/service';
import { resolveVisibility } from '../../../admin/promotions/helpers';
import { isIssuableToCustomer } from '../../../../modules/promotion-meta/issuance-rules';
import { isUsable, issuanceWindowState, displayExpiresAt } from '../../../../modules/promotion-meta/validity';
import { grantsFor, hasUsableGrant, nextExpiryAt } from '../../../../modules/promotion-meta/grants';

/**
 * GET /store/events/:slug
 * 쿠폰 이벤트(배너용 쿠폰 묶음) 상세 — 이벤트 정보 + 담긴 쿠폰들의 고객별 발급 상태.
 * 인증 선택(비로그인도 조회 가능). 로그인 시 발급 여부/그룹 조건까지 반영.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const slug = req.params.slug;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const service = req.scope.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);

  const event = await service.getEventBySlug(slug);
  if (!event || event.status === 'draft') {
    return res.status(404).json({ message: '존재하지 않는 이벤트입니다.' });
  }

  const now = new Date();
  const eventStarts = event.starts_at ? new Date(event.starts_at) : null;
  const eventEnds = event.ends_at ? new Date(event.ends_at) : null;
  const eventActive = (!eventStarts || now >= eventStarts) && (!eventEnds || now <= eventEnds);

  const items = await service.listEventItems(event.id);
  const promotionIds = items.map((i: any) => i.promotion_id);

  const eventInfo = {
    slug: event.slug,
    title: event.title,
    description: event.description,
    banner_image_url: event.banner_image_url,
    starts_at: event.starts_at,
    ends_at: event.ends_at,
    active: eventActive,
  };

  if (promotionIds.length === 0) {
    return res.status(200).json({ event: eventInfo, coupons: [] });
  }

  const { data: promotions } = await query.graph({
    entity: 'promotion',
    fields: [
      'id', 'code', 'status', 'is_automatic',
      'application_method.type', 'application_method.value',
      'application_method.target_type', 'application_method.currency_code',
      'rules.attribute', 'rules.operator', 'rules.values.value',
    ],
    filters: { id: promotionIds },
  });
  const promoById = new Map((promotions as any[]).map((p) => [p.id, p]));

  const metas = await service.getByPromotionIds(promotionIds);
  const metaById = new Map((metas as any[]).map((m: any) => [m.promotion_id, m]));

  // 로그인 고객 정보(발급 여부 + 그룹). «보유 여부» 는 이제 링크가 아니라 사용 가능한 장이
  // 정한다(#488 Task 8 결정 3) — 링크는 「가진 적 있다」만 말해 다 쓴 쿠폰도 통과시킨다.
  // 그룹 룰 평가에 쓰는 groups.id 만 남기고 promotions.id 는 뺀다.
  const customerId: string | null = (req as any).auth_context?.actor_id ?? null;
  let customerGroupIds = new Set<string>();
  // 발급된 «장» 들을 한 번에 가져온다 — 프로모션마다 조회하지 않는다.
  let grants: CouponGrantRow[] = [];
  if (customerId) {
    const { data: customers } = await query.graph({
      entity: 'customer',
      fields: ['id', 'groups.id'],
      filters: { id: customerId },
    });
    const customer = customers?.[0];
    customerGroupIds = new Set<string>((customer?.groups ?? []).map((g: any) => g.id));
    grants = await service.listGrantsForCustomer(customerId);
  }

  // promotion → 발급 버튼 상태(kind/reason) 계산
  const resolveState = (promo: any, meta: any, mine: CouponGrantRow[]): { kind: string; reason?: string } => {
    if (!promo || promo.status !== 'active' || promo.is_automatic) {
      return { kind: 'blocked', reason: 'inactive' };
    }
    // «아직 시작 전」을 먼저 걸러낸다 — isUsable 도 정책 starts_at 을 보므로, 순서를 바꾸면
    // 시작 전 쿠폰이 (아직 발급 개념도 없는데) 'expired' 로 오분류된다.
    if (issuanceWindowState(meta, now) === 'not_started') {
      return { kind: 'blocked', reason: 'not_started' };
    }
    // 사용 가능 여부는 «사용 가능한 장이 있으면 그 장들, 없으면(=발급 개념이 없는 public)
    // 정책» 이 정한다 (#488 결정 1 — 카트 미들웨어·complete-cart 훅과 같은 판정).
    const usable = mine.length > 0 ? hasUsableGrant(mine, now) : isUsable(null, meta, now);
    if (!usable) {
      return { kind: 'blocked', reason: 'expired' };
    }

    // 메타가 없으면 닫힌 쪽이다(#488 N7) → not_assigned 로 막힌다.
    const visibility: string = resolveVisibility(meta);

    if (customerId && !isIssuableToCustomer(promo.rules, customerGroupIds)) {
      return { kind: 'blocked', reason: 'group_restricted' };
    }
    // «보유 여부» 는 사용 가능한 장이 있는가로 정한다 (#488 Task 8 결정 3).
    if (hasUsableGrant(mine, now)) return { kind: 'claimed' };

    if (visibility === 'claimable') {
      const max = meta?.max_claims != null ? Number(meta.max_claims) : null;
      if (max != null && Number(meta?.issued_count ?? 0) >= max) {
        return { kind: 'blocked', reason: 'exhausted' };
      }
      return { kind: 'claimable' };
    }
    if (visibility === 'assigned_only') {
      return { kind: 'blocked', reason: 'not_assigned' };
    }
    return { kind: 'usable' };
  };

  const coupons = items
    .map((item: any) => {
      const promo = promoById.get(item.promotion_id);
      if (!promo) return null;
      const meta = metaById.get(item.promotion_id);
      const am = promo.application_method;
      const mine = grantsFor(grants, promo.id);
      const usableMine = hasUsableGrant(mine, now);
      // 만료 표시는 «사용 가능한 장 중 가장 이른 만료» (#488 결정 1). displayExpiresAt 의
      // `?:` 분기를 지키려고 인스턴스 인자로 그 장을 합성해 넘긴다 — `??` 로 합치지 않는다.
      const instance = usableMine ? { expires_at: nextExpiryAt(mine, now) } : null;
      return {
        promotion_id: promo.id,
        code: promo.code,
        discount: am
          ? {
              type: am.type,
              value: am.value,
              target_type: am.target_type,
              currency_code: am.currency_code,
              // 정률 캡(#488 A4). 이벤트 페이지도 쿠폰을 받는 자리다.
              max_discount_amount:
                meta?.max_discount_amount != null ? Number(meta.max_discount_amount) : null,
            }
          : null,
        expires_at: displayExpiresAt(instance, meta),
        // W1: expires_at 이 null 인 이유(무기한 vs 미발급 validity_days)를 화면이 구분할 수 있게.
        validity_days: meta?.validity_days != null ? Number(meta.validity_days) : null,
        state: resolveState(promo, meta, mine),
      };
    })
    .filter(Boolean);

  return res.status(200).json({ event: eventInfo, coupons });
}
