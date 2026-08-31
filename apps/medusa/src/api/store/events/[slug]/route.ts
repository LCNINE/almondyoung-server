import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../../../../modules/promotion-meta';
import type PromotionMetaModuleService from '../../../../modules/promotion-meta/service';
import { resolveVisibility, meetsGroupRule, listIssuedLinks } from '../../../admin/promotions/helpers';
import { isUsable, issuanceWindowState } from '../../../../modules/promotion-meta/validity';

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

  // 로그인 고객 정보(발급 여부 + 그룹)
  const customerId: string | null = (req as any).auth_context?.actor_id ?? null;
  let assignedIds = new Set<string>();
  let customerGroupIds = new Set<string>();
  if (customerId) {
    const { data: customers } = await query.graph({
      entity: 'customer',
      fields: ['id', 'promotions.id', 'groups.id'],
      filters: { id: customerId },
    });
    const customer = customers?.[0];
    assignedIds = new Set<string>((customer?.promotions ?? []).map((p: any) => p.id));
    customerGroupIds = new Set<string>((customer?.groups ?? []).map((g: any) => g.id));
  }
  // 발급된 «한 장»들을 한 번에 가져온다 — 프로모션마다 조회하지 않는다.
  const linkByPromotionId = new Map(
    (customerId ? await listIssuedLinks(req.scope, customerId) : []).map((l) => [l.promotion_id, l]),
  );

  // 만료 시점: «링크 행이 있으면 링크 행», 없으면 정책(#488 결정 1). `?? meta?.ends_at` 로
  // 한 줄에 합치면 link.expires_at 이 정당하게 null(무기한)일 때 meta 쪽으로 새어버린다
  // (`??` 는 null 도 "없음"으로 취급) — 그래서 존재 여부를 명시적으로 분기한다.
  const expiresAtOf = (promotionId: string, meta: any): string | Date | null => {
    const link = linkByPromotionId.get(promotionId);
    return link ? link.expires_at : (meta?.ends_at ?? null);
  };

  // promotion → 발급 버튼 상태(kind/reason) 계산
  const resolveState = (promo: any, meta: any): { kind: string; reason?: string } => {
    if (!promo || promo.status !== 'active' || promo.is_automatic) {
      return { kind: 'blocked', reason: 'inactive' };
    }
    // «아직 시작 전」을 먼저 걸러낸다 — isUsable 도 정책 starts_at 을 보므로, 순서를 바꾸면
    // 시작 전 쿠폰이 (아직 발급 개념도 없는데) 'expired' 로 오분류된다.
    if (issuanceWindowState(meta, now) === 'not_started') {
      return { kind: 'blocked', reason: 'not_started' };
    }
    // 사용 가능 여부는 «링크 행이 있으면 링크 행» 이 정한다 (#488 결정 1).
    if (!isUsable(linkByPromotionId.get(promo.id) ?? null, meta, now)) {
      return { kind: 'blocked', reason: 'expired' };
    }

    // 메타가 없으면 닫힌 쪽이다(#488 N7) → not_assigned 로 막힌다.
    const visibility: string = resolveVisibility(meta);

    if (customerId && !meetsGroupRule(promo, customerGroupIds)) {
      return { kind: 'blocked', reason: 'group_restricted' };
    }
    if (assignedIds.has(promo.id)) return { kind: 'claimed' };

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
        expires_at: expiresAtOf(promo.id, meta),
        state: resolveState(promo, meta),
      };
    })
    .filter(Boolean);

  return res.status(200).json({ event: eventInfo, coupons });
}
