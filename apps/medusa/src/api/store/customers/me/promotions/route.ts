import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../../../../../modules/promotion-meta';
import PromotionMetaModuleService, { type CouponGrantRow } from '../../../../../modules/promotion-meta/service';
import {
  resolveVisibility,
  VISIBILITY_WHEN_META_MISSING,
} from '../../../../admin/promotions/helpers';
import { isIssuableToCustomer } from '../../../../../modules/promotion-meta/issuance-rules';
import {
  isUsable,
  issuanceWindowState,
  displayExpiresAt,
  hasPolicyStarted,
} from '../../../../../modules/promotion-meta/validity';
import { grantsFor, usableGrants, hasUsableGrant, nextExpiryAt } from '../../../../../modules/promotion-meta/grants';
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
  // 발급된 «장» 들을 한 번에 가져온다 — 프로모션마다 조회하지 않는다.
  const grants: CouponGrantRow[] = await promotionMetaService.listGrantsForCustomer(customerId);
  const grantsOf = (promotionId: string): CouponGrantRow[] => grantsFor(grants, promotionId);
  // 만료 표시는 «사용 가능한 장 중 가장 이른 만료» (#488 결정 1/Task 8). `displayExpiresAt`
  // 의 `?:` 분기를 지키기 위해 인스턴스 인자로 "가장 이른 사용 가능 장"을 합성해 넘긴다 —
  // `??` 로 합치면 발급된 무기한 장(`expires_at===null` 이 정당한 값)이 정책값으로 샌다.
  // 사용 가능한 장이 없으면(발급 자체가 없거나 전부 소모/만료) instance 없음으로 취급해
  // 정책으로 폴백한다.
  const expiresAtOf = (promotionId: string): string | Date | null => {
    const mine = grantsOf(promotionId);
    const usable = usableGrants(mine, now);
    const instance = usable.length > 0 ? { expires_at: nextExpiryAt(mine, now) } : null;
    return displayExpiresAt(instance, metaById.get(promotionId));
  };
  // W1: expires_at 이 null 인 이유(무기한 vs 미발급 validity_days)를 화면이 구분할 수 있게.
  const validityDaysOf = (promotionId: string): number | null => {
    const raw = metaById.get(promotionId)?.validity_days;
    return raw != null ? Number(raw) : null;
  };
  // visibility 는 promotion_meta 에서 온다. 호출부가 매번 조회하지 않도록 여기서 묶는다.
  // isAssigned 는 어느 버킷(assigned/expired vs public/claimable)에서 이 항목을 뽑았는지로
  // 정한다 — grants 존재 여부와 독립이다(format-promotion.ts 의 PromotionMetaView 주석 참고).
  const format = (promo: any, isAssigned: boolean) =>
    formatPromotion(
      promo,
      {
        visibility: visibilityOf(promo.id),
        maxDiscountAmount: maxDiscountById.get(promo.id) ?? null,
        expiresAt: expiresAtOf(promo.id),
        validityDays: validityDaysOf(promo.id),
        isAssigned,
      },
      grantsOf(promo.id),
      now,
    );
  // 발급 수량 소진된 claimable 쿠폰은 목록에서 제외 (발급받기 눌러도 실패)
  const isClaimExhausted = (promotionId: string): boolean => {
    const m = metaById.get(promotionId);
    if (!m || m.max_claims == null) return false;
    return Number(m.issued_count ?? 0) >= Number(m.max_claims);
  };

  // status/자동적용/유효기간 검증. 사용 가능 여부는 «사용 가능한 장이 있으면 그 장들, 없으면
  // (=발급 개념이 없는 public 이거나 아직 grant 없이 링크만 있는 구식 배정) 정책» 이 정한다
  // (#488 결정 1) — 카트 미들웨어(`per-customer-limit.ts`)·`complete-cart.ts` 훅과 같은 판정.
  // metaById·grants 에 의존하므로 그 아래에 있어야 한다.
  const isValidPromotion = (promo: any): boolean => {
    if (promo.status !== 'active') return false;
    if (promo.is_automatic) return false;
    const meta = metaById.get(promo.id);
    // 🔴 정책 시작(`starts_at`)은 **장 유무 분기 밖**이다 — `hasUsableGrant` 는 정책을 모르므로
    // 분기 안에 두면 장을 가진 고객에게만 `starts_at` 이 사라져, 아직 시작 전인 쿠폰이
    // 마이페이지 "사용 가능"에 뜨고 카트에도 붙는다(카트 게이트와 같은 판정이어야 한다).
    if (!hasPolicyStarted(meta, now)) return false;
    const mine = grantsOf(promo.id);
    return mine.length > 0 ? hasUsableGrant(mine, now) : isUsable(null, meta, now);
  };

  const assignedPromotionIds = new Set<string>();
  const customer = customers?.[0];

  // 사용 소진 쿠폰 제외 — 전역 usage 한도(전원 공통)만 남는다. per-customer 소진은 이제
  // `isValidPromotion` 의 grant 기반 판정(위)이 대신한다 — 「1장=1회」가 grant 로 강제되므로
  // 캠페인 예산의 use_by_attribute 축은 더 이상 쓰지 않는다(#488 결정 2). 옛 코드는 이 축을
  // 별도 조회(campaign budget usage)로 흉내 냈었다.
  const isUsageExhausted = (promo: any): boolean => {
    // 신규 쿠폰: 전역 한도가 campaign budget 이 아니라 promotion.limit 에 있다.
    if (promo.limit != null && Number(promo.used ?? 0) >= Number(promo.limit)) {
      return true;
    }

    const b = promo.campaign?.budget;
    if (!b || b.limit == null) return false;
    if (b.type === 'usage') return Number(b.used ?? 0) >= Number(b.limit);
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
      isIssuableToCustomer(promo.rules, customerGroupIds)
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
      isIssuableToCustomer(promo.rules, customerGroupIds)
    )
    .slice(0, CLAIMABLE_LIMIT)
    .map((promo: any) => format(promo, false));

  // 만료 쿠폰: 고객에게 발급됐던 쿠폰 중 만료가 지난 것, 최근 30일 이내. 최근 만료순, 최대 50개.
  // 만료일을 promo 마다 (promo, endsAt) 으로 한 번만 계산해 들고 다닌다 — sort 안에서
  // expiredEndsAtOf 를 다시 불러 `new Date(string | Date | null)` 을 `as any` 로 눌러 넘기지
  // 않기 위해서다(필터가 이미 null 이 아님을 보장하므로, 그 사실을 타입으로도 드러낸다).
  //
  // 🔴 여기서 `expiresAtOf` (usable_count 와 같은 «사용 가능한 장» 기준) 를 쓰면 안 된다 —
  // 다 쓰거나 만료된 장은 usableGrants 에서 걸러져 정책값으로 새므로(#488 결정 1 은 "사용
  // 가능한 장"만 다룬다), 정작 만료 목록에 넣어야 할 항목의 실제 만료일을 못 구한다. 장이
  // 있으면(mine.length>0) 그 장들의 원본 expires_at 중 가장 늦은 것(=가장 최근 만료)을,
  // 장이 없으면(순수 링크 배정) 정책 폴백인 expiresAtOf 를 그대로 쓴다.
  //
  // 🔴 (#488 Task 8 리뷰 Important #1) **지금 사용 가능한 장은 여기서 뺀다.** 같은
  // 프로모션에 만료된 장 A 와 무기한 미사용 장 B 를 같이 가진 고객은 `hasUsableGrant` 가
  // B 때문에 true 라 `assignedPromotions` 에 든다 — 그런데 이 함수가 살아있는 B 를 무시하고
  // 죽은 A 의 날짜만 보면, 같은 쿠폰이 "만료" 바구니에도 동시에 들어간다("사용 가능"과
  // "최근 만료"가 응답에 동시 노출). 아래 루프의 `assignedPromotionIds` 스킵과 이중 방어.
  const expiredEndsAtOf = (promotionId: string): Date | null => {
    const mine = grantsOf(promotionId);
    if (mine.length === 0) {
      const raw = expiresAtOf(promotionId);
      return raw ? new Date(raw) : null;
    }
    const usableIds = new Set(usableGrants(mine, now).map((g) => g.id));
    const dated = mine
      .filter((g) => !usableIds.has(g.id))
      .map((g) => (g.expires_at ? new Date(g.expires_at) : null))
      .filter((d): d is Date => d !== null && !Number.isNaN(d.getTime()));
    if (dated.length === 0) return null;
    return dated.reduce((max, d) => (d > max ? d : max));
  };
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const expiredCutoff = new Date(now.getTime() - THIRTY_DAYS_MS);
  const expiredCandidates: Array<{ promo: any; endsAt: Date }> = [];
  for (const promo of customer?.promotions ?? []) {
    if (promo.is_automatic) continue;
    // 이미 assignedPromotions 에 든 쿠폰은 건너뛴다 — 같은 쿠폰이 "사용 가능"과 "최근 만료"
    // 두 바구니에 동시에 뜨는 것을 막는 1차 방어(publicPromotions/claimablePromotions 와
    // 같은 패턴, #488 Task 8 리뷰 Important #1). expiredEndsAtOf 의 usable 제외와 이중 방어.
    if (assignedPromotionIds.has(promo.id)) continue;
    const endsAt = expiredEndsAtOf(promo.id);
    if (!endsAt) continue;
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
