import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../../../../../modules/promotion-meta';
import PromotionMetaModuleService from '../../../../../modules/promotion-meta/service';
import {
  resolveVisibility,
  meetsGroupRule,
  VISIBILITY_WHEN_META_MISSING,
  listIssuedLinks,
} from '../../../../admin/promotions/helpers';
import { isUsable, issuanceWindowState, displayExpiresAt } from '../../../../../modules/promotion-meta/validity';
import { formatPromotion } from './format-promotion';

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
  const promotionMetaService = req.scope.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);

  const limit = parseInt(req.query.limit as string) || 20;
  const offset = parseInt(req.query.offset as string) || 0;

  const promotionFields = [
    'id',
    'code',
    'type',
    'status',
    'is_automatic',
    // 신규 쿠폰(Medusa 2.12.0+)의 전역 사용 한도. campaign.budget 과 독립적으로 검사된다.
    'limit',
    'used',
    'campaign_id',
    'campaign.campaign_identifier',
    'campaign.budget.id',
    'campaign.budget.type',
    'campaign.budget.limit',
    'campaign.budget.used',
    'campaign.budget.attribute',
    'application_method.id',
    'application_method.type',
    'application_method.value',
    'application_method.target_type',
    'application_method.max_quantity',
    'application_method.currency_code',
    'rules.attribute',
    'rules.operator',
    'rules.values.value',
  ];

  //  고객에게 직접 발급된 프로모션 조회 (groups.id로 그룹 rule 검증에 활용)
  const { data: customers } = await query.graph({
    entity: 'customer',
    fields: ['id', 'email', 'groups.id', ...promotionFields.map((f) => `promotions.${f}`)],
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

  // 모든 프로모션의 visibility 일괄 조회
  const allPromoIds = [
    ...(customers?.[0]?.promotions ?? []).map((p: any) => p.id),
    ...(allPromotions ?? []).map((p: any) => p.id),
  ];
  const metas = allPromoIds.length > 0
    ? await promotionMetaService.getByPromotionIds([...new Set(allPromoIds)])
    : [];
  const visibilityById = new Map<string, string>(
    metas.map((m: any) => [m.promotion_id, resolveVisibility(m) as string])
  );
  // 정률 캡(#488 A4)도 같은 메타 조회에서 나온다 — 프로모션마다 재조회하지 않는다.
  const maxDiscountById = new Map<string, number>(
    metas
      .filter((m: any) => m.max_discount_amount != null && Number.isFinite(Number(m.max_discount_amount)))
      .map((m: any) => [m.promotion_id, Number(m.max_discount_amount)])
  );
  // 메타 행이 아예 없는 프로모션은 맵에 키가 없다 → 닫힌 기본값으로 떨어진다(#488 N7).
  const visibilityOf = (promotionId: string): string =>
    visibilityById.get(promotionId) ?? VISIBILITY_WHEN_META_MISSING;
  const metaById = new Map<string, any>(metas.map((m: any) => [m.promotion_id, m]));
  // 발급된 «한 장»들을 한 번에 가져온다 — 프로모션마다 조회하지 않는다.
  const issuedLinks = await listIssuedLinks(req.scope, customerId);
  const linkByPromotionId = new Map(issuedLinks.map((l) => [l.promotion_id, l]));
  const expiresAtOf = (promotionId: string): string | Date | null =>
    displayExpiresAt(linkByPromotionId.get(promotionId) ?? null, metaById.get(promotionId));
  // visibility 는 promotion_meta 에서 온다. 호출부가 매번 조회하지 않도록 여기서 묶는다.
  const format = (promo: any, isAssigned: boolean) =>
    formatPromotion(promo, isAssigned, {
      visibility: visibilityOf(promo.id),
      maxDiscountAmount: maxDiscountById.get(promo.id) ?? null,
      expiresAt: expiresAtOf(promo.id),
    });
  // 발급 수량 소진된 claimable 쿠폰은 목록에서 제외 (발급받기 눌러도 실패)
  const isClaimExhausted = (promotionId: string): boolean => {
    const m = metas.find((r: any) => r.promotion_id === promotionId);
    if (!m || m.max_claims == null) return false;
    return Number(m.issued_count ?? 0) >= Number(m.max_claims);
  };

  // status/자동적용/유효기간 검증. 사용 가능 여부는 «링크 행이 있으면 링크 행» 이 정한다
  // (#488 결정 1) — metaById·linkByPromotionId 에 의존하므로 그 두 맵보다 아래에 있어야 한다.
  const isValidPromotion = (promo: any): boolean => {
    if (promo.status !== 'active') return false;
    if (promo.is_automatic) return false;
    return isUsable(linkByPromotionId.get(promo.id) ?? null, metaById.get(promo.id), now);
  };

  const assignedPromotionIds = new Set<string>();
  const customer = customers?.[0];

  // 사용 소진 쿠폰 제외 — 전역 usage 한도 소진(전원) + per-customer use_by_attribute 소진(본인).
  // 이미 다 쓴 쿠폰이 "사용 가능"으로 목록에 남지 않도록 한다.
  const customerEmail = customer?.email as string | undefined;
  const attrBudgetIds = new Set<string>();
  for (const p of [...(customer?.promotions ?? []), ...(allPromotions ?? [])]) {
    const b = (p as any).campaign?.budget;
    if (b?.id && b.type === 'use_by_attribute') attrBudgetIds.add(b.id);
  }
  const usedByBudgetId = new Map<string, number>();
  if (attrBudgetIds.size > 0) {
    const promotionModule = req.scope.resolve<any>(Modules.PROMOTION);
    const attributeValues = [customerId, customerEmail].filter(Boolean) as string[];
    const usages = await promotionModule.listCampaignBudgetUsages({
      budget_id: [...attrBudgetIds],
      attribute_value: attributeValues,
    });
    for (const u of usages) {
      usedByBudgetId.set(
        u.budget_id,
        Math.max(usedByBudgetId.get(u.budget_id) ?? 0, Number(u.used ?? 0)),
      );
    }
  }
  const isUsageExhausted = (promo: any): boolean => {
    // 신규 쿠폰: 전역 한도가 campaign budget 이 아니라 promotion.limit 에 있다.
    if (promo.limit != null && Number(promo.used ?? 0) >= Number(promo.limit)) {
      return true;
    }

    const b = promo.campaign?.budget;
    if (!b || b.limit == null) return false;
    const limit = Number(b.limit);
    if (b.type === 'usage') return Number(b.used ?? 0) >= limit;
    if (b.type === 'use_by_attribute') return (usedByBudgetId.get(b.id) ?? 0) >= limit;
    return false;
  };

  const assignedPromotions = (customer?.promotions || [])
    .filter((promo: any) => isValidPromotion(promo) && !isUsageExhausted(promo))
    .map((promo: any) => {
      assignedPromotionIds.add(promo.id);
      return format(promo, true);
    });

  const customerGroupIds = new Set<string>((customers?.[0]?.groups ?? []).map((g: any) => g.id));

  // visibility에 따라 분류: assigned_only/claimable(발급된 것)은 목록 제외, public만 공개 목록
  const publicPromotions = (allPromotions || [])
    .filter((promo: any) =>
      !assignedPromotionIds.has(promo.id) &&
      isValidPromotion(promo) &&
      !isUsageExhausted(promo) &&
      visibilityOf(promo.id) === 'public' &&
      meetsGroupRule(promo, customerGroupIds)
    )
    .map((promo: any) => format(promo, false));

  // claimable: 아직 발급받지 않은 활성 claimable 쿠폰 (최대 50개 고정; 대량 운영 시 별도 pagination 필요)
  const CLAIMABLE_LIMIT = 50;
  const claimablePromotions = (allPromotions || [])
    .filter((promo: any) =>
      !assignedPromotionIds.has(promo.id) &&
      isValidPromotion(promo) &&
      visibilityById.get(promo.id) === 'claimable' &&
      issuanceWindowState(metaById.get(promo.id), now) === 'ok' &&
      !isClaimExhausted(promo.id) &&
      !isUsageExhausted(promo) &&
      meetsGroupRule(promo, customerGroupIds)
    )
    .slice(0, CLAIMABLE_LIMIT)
    .map((promo: any) => format(promo, false));

  // 만료 쿠폰: 고객에게 발급됐던 쿠폰 중 만료가 지난 것, 최근 30일 이내. 최근 만료순, 최대 50개.
  // 만료일을 promo 마다 (promo, endsAt) 으로 한 번만 계산해 들고 다닌다 — sort 안에서
  // expiresAtOf 를 다시 불러 `new Date(string | Date | null)` 을 `as any` 로 눌러 넘기지
  // 않기 위해서다(필터가 이미 null 이 아님을 보장하므로, 그 사실을 타입으로도 드러낸다).
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const expiredCutoff = new Date(now.getTime() - THIRTY_DAYS_MS);
  const expiredCandidates: Array<{ promo: any; endsAt: Date }> = [];
  for (const promo of customer?.promotions ?? []) {
    if (promo.is_automatic) continue;
    const raw = expiresAtOf(promo.id);
    if (!raw) continue;
    const endsAt = new Date(raw);
    if (endsAt < now && endsAt >= expiredCutoff) {
      expiredCandidates.push({ promo, endsAt });
    }
  }
  const expiredPromotions = expiredCandidates
    .sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime())
    .slice(0, 50)
    .map(({ promo }) => format(promo, true));

  // 합치기: 직접 발급된 것 먼저, 그 다음 일반 프로모션
  const combinedPromotions = [...assignedPromotions, ...publicPromotions];

  // Apply pagination
  const paginatedPromotions = combinedPromotions.slice(offset, offset + limit);

  return res.status(200).json({
    promotions: paginatedPromotions,
    claimable_promotions: claimablePromotions,
    expired_promotions: expiredPromotions,
    count: combinedPromotions.length,
    offset,
    limit,
  });
}
