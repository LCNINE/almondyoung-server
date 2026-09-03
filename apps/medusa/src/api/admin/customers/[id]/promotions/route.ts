import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, MedusaError } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../../../../../modules/promotion-meta';
import type PromotionMetaModuleService from '../../../../../modules/promotion-meta/service';
import type { CouponGrantRow } from '../../../../../modules/promotion-meta/service';
import { toMetadataShape, resolveVisibility } from '../../../promotions/helpers';
import { evaluateIssuanceRules } from '../../../../../modules/promotion-meta/issuance-rules';
import { computeExpiresAt, issuanceWindowState } from '../../../../../modules/promotion-meta/validity';
import { usableGrants, nextExpiryAt } from '../../../../../modules/promotion-meta/grants';
import { issueCouponGrantWorkflow } from '../../../../../workflows/coupons/workflows/issue-coupon-grant-workflow';

interface AssignPromotionsBody {
  promotion_ids: string[];
  /** true = 정책 검증 우회. 감사 로그에 admin_force로 기록됩니다. */
  force?: boolean;
  /**
   * 이 «제출» 의 식별자. 같은 제출이 재도착하면(따닥·타임아웃 재시도) 한 장만 남는다.
   * **필수다** — 형제(쿠폰축) 라우트와 같다. 서버가 만들어 주면 매 요청이 새 키라
   * 따닥이 곧 두 배 발급이다.
   */
  submit_id: string;
  /** 1인당 발급 장수. 기본 1. */
  quantity?: number;
}

interface RemovePromotionsBody {
  promotion_ids: string[];
}

/**
 * GET /admin/customers/:id/promotions
 * 특정 고객에게 할당된 프로모션 목록을 조회합니다.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const customerId = req.params.id;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const promotionMetaService = req.scope.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);

  // Query parameters for pagination
  const limit = parseInt(req.query.limit as string) || 20;
  const offset = parseInt(req.query.offset as string) || 0;

  // customer 조회는 존재 확인(404)용으로만 남긴다 — 「이 고객이 가진 쿠폰」의 정본은
  // grant 다(설계 결정 2). grant 가 0건인 것과 고객이 없는 것은 다른 사건이라 이 조회를
  // 지우지 않는다.
  const [{ data: customers }, grants] = await Promise.all([
    query.graph({ entity: 'customer', fields: ['id', 'email'], filters: { id: customerId } }),
    promotionMetaService.listGrantsForCustomer(customerId),
  ]);

  if (!customers || customers.length === 0) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, 'Customer not found');
  }

  // 「이 고객이 가진 쿠폰」의 정본은 grant 다 (설계 결정 2). 링크는 읽지 않는다.
  const grantedPromotionIds = [...new Set(grants.map((g) => g.promotion_id))];
  const { data: promotions } =
    grantedPromotionIds.length > 0
      ? await query.graph({
          entity: 'promotion',
          fields: [
            'id',
            'code',
            'type',
            'status',
            'is_automatic',
            'campaign_id',
            'campaign.campaign_identifier',
            'application_method.id',
            'application_method.type',
            'application_method.value',
            'application_method.target_type',
          ],
          filters: { id: grantedPromotionIds },
        })
      : { data: [] as any[] };

  const now = new Date();
  const byPromotion = new Map<string, CouponGrantRow[]>();
  for (const g of grants) {
    const list = byPromotion.get(g.promotion_id) ?? [];
    list.push(g);
    byPromotion.set(g.promotion_id, list);
  }

  // 이제 목록이 grant 조회 순서를 따르므로(customer.promotions 링크 순서가 아니다) 페이지
  // 사이 순서가 안 흔들리도록 id 오름차순으로 고정한 뒤 slice 한다 (Task 8 발견 6 과 같은 부류).
  const sorted = [...promotions].sort((a: any, b: any) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const paginatedPromotions = sorted.slice(offset, offset + limit).map((p: any) => {
    const mine = byPromotion.get(p.id) ?? [];
    const usable = usableGrants(mine, now);
    return {
      ...p,
      granted_count: mine.length,
      used_count: mine.filter((g) => g.used_at != null).length,
      usable_count: usable.length,
      next_expires_at: nextExpiryAt(mine, now),
    };
  });

  return res.status(200).json({
    customer_id: customerId,
    promotions: paginatedPromotions,
    count: promotions.length,
    offset,
    limit,
  });
}

/**
 * POST /admin/customers/:id/promotions
 * 고객에게 쿠폰(Promotion)을 발급합니다.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const customerId = req.params.id;
  const { promotion_ids, force = false, submit_id, quantity: rawQuantity } = req.body as AssignPromotionsBody;

  if (!promotion_ids || !Array.isArray(promotion_ids) || promotion_ids.length === 0) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'promotion_ids is required and must be a non-empty array');
  }
  if (!submit_id) {
    // 🔴 서버가 만들어 주면 재도착마다 새 키라 따닥이 곧 두 배 발급이다. 재시도가 «같은»
    //    값을 보낼 수 있는 쪽은 클라이언트뿐이다 — 형제(쿠폰축) 라우트와 같은 계약이다.
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'submit_id is required');
  }

  // 🔴 입력 상한은 **아무것도 조회하기 전에** 본다. 형제(쿠폰축) 라우트가 그 순서인데
  // 이쪽은 가드만 복사하고 위치를 안 옮겨서, 10만 개짜리 promotion_ids 가 400 을 받기 전에
  // `getByPromotionIds` 와 `query.graph` 의 `IN (10만)` 두 방을 먼저 맞았다.
  const rawQty = Number(rawQuantity ?? 1);
  // 🔴 클램프 전에 걸러야 한다 — `Number('abc')` 는 NaN 이고, NaN 과의 모든 비교는
  //    false 라 발급 루프가 한 번도 안 돈다. 그러면 전원이 조용히 `granted:0` 이 돼
  //    `issued`·`skipped` 둘 다 비고, 사유 없는 `200` 이 나간다(#488 Task 9 리뷰).
  // 🔴 `isInteger` 다. `isFinite` 만 보면 2.7 이 통과해 루프에서 조용히 2 로 잘리고,
  //    응답 어디에도 「요청한 수량을 지키지 못했다」는 표시가 없다.
  if (!Number.isInteger(rawQty)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'quantity must be an integer');
  }
  const quantity = Math.max(1, Math.min(rawQty, 50));

  // 🔴 두 상한을 **따로** 두면 곱이 안 막힌다 — 형제(쿠폰축) 라우트가 이미 이 가드를 갖고
  // 있는데 이쪽만 빠져 있었다. 1000개 쿠폰 × 50장 = 50,000 회의 순차 발급이고, 어떤 프록시
  // 타임아웃보다 길다. 클라이언트가 끊긴 뒤에도 루프는 서버에서 계속 돌아 「응답은 실패인데
  // 발급은 됐다」가 된다.
  if (promotion_ids.length > 500) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'promotion_ids must be 500 or fewer');
  }
  if (promotion_ids.length * quantity > 1000) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `promotion_ids × quantity must be 1000 or fewer (got ${promotion_ids.length} × ${quantity})`,
    );
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const promotionMetaService = req.scope.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);

  const [{ data: customers }, metaRecords] = await Promise.all([
    query.graph({
      entity: 'customer',
      fields: ['id', 'groups.id'],
      filters: { id: customerId },
    }),
    promotionMetaService.getByPromotionIds(promotion_ids),
  ]);

  if (!customers || customers.length === 0) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, 'Customer not found');
  }

  const { data: promotions } = await query.graph({
    entity: 'promotion',
    fields: [
      'id', 'code', 'status', 'is_automatic',
      'rules.attribute', 'rules.operator', 'rules.values.value',
    ],
    filters: { id: promotion_ids },
  });

  if (!promotions || promotions.length !== promotion_ids.length) {
    const foundIds = promotions?.map((p: any) => p.id) || [];
    const missingIds = promotion_ids.filter((id) => !foundIds.includes(id));
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Promotions not found: ${missingIds.join(', ')}`);
  }

  const customerGroupIds = new Set<string>(
    (customers[0].groups ?? []).map((g: any) => g.id as string),
  );

  const issueTrigger = force ? 'admin_force' : 'admin_manual';
  const now = new Date();
  const submitId = submit_id;
  const issued: string[] = [];
  const skipped: { promotion_id: string; reason: string }[] = [];

  for (const promo of promotions as any[]) {
    const meta = metaRecords.find((m: any) => m.promotion_id === promo.id);
    const metaShape = toMetadataShape(meta);

    // 🔴 `public` 거절은 **`!force` 밖**이다 (#488 A2). 아래 검사들은 전부 「지금은 정책상
    // 발급이 안 되는 상태」라 운영자가 정당하게 넘어설 수 있는 것들이지만, `public` 은
    // 그게 아니라 「이 쿠폰엔 1인 발급 개념 자체가 없다」이다. 넘어서면 카트 게이트가
    // 「장이 있으면 장이 정한다」로 갈리는 탓에 **발급받은 그 고객만** 장 수만큼 제한되고
    // 나머지 전원은 계속 자유롭게 쓴다 — 선의가 정확히 반대로 작동한다. 강제 발급으로
    // 결함을 찍어낼 수 있게 두지 않는다. (`grants.ts` 의 `grantsGovernUsage` 가 이미
    // 발급된 뒤 visibility 가 바뀌는 경로를 게이트 쪽에서 받는다.)
    if (resolveVisibility(meta) === 'public') {
      skipped.push({ promotion_id: promo.id, reason: 'public_promotion' });
      continue;
    }

    // 검증 실패는 throw 대신 skip — 배치의 다른 쿠폰까지 막지 않는다. force로 우회 가능.
    if (!force) {
      if (promo.status !== 'active') {
        skipped.push({ promotion_id: promo.id, reason: 'inactive' });
        continue;
      }
      if (promo.is_automatic) {
        skipped.push({ promotion_id: promo.id, reason: 'automatic' });
        continue;
      }
      // 발급 창은 캠페인이 아니라 promotion_meta 가 정한다 (#488 결정 1).
      const window = issuanceWindowState(meta, now);
      if (window === 'not_started') {
        skipped.push({ promotion_id: promo.id, reason: 'not_started' });
        continue;
      }
      if (window === 'ended') {
        skipped.push({ promotion_id: promo.id, reason: 'expired' });
        continue;
      }
      // 분류표 밖 룰은 fail-closed (#488 1-5). `force` 는 여전히 이 게이트를 넘는다 —
      // 새 조건을 화면에 추가한 사람이 발급 로직을 고칠 때까지 운영이 막히지 않게 하는
      // 탈출구이고, 그 탈출은 `issued_via='admin_force'` 로 링크 행에 기록된다.
      const eligibility = evaluateIssuanceRules(promo.rules, customerGroupIds);
      if (!eligibility.eligible) {
        if (eligibility.reason === 'unsupported_rule') {
          logger.warn(
            `[coupon] 수동발급 skip — 발급 시점에 평가할 수 없는 룰 (promotion_id=${promo.id}, ` +
              `attribute=${eligibility.attribute}, operator=${eligibility.operator}, ` +
              `customer_id=${customerId}). force 로 우회할 수 있으나, ` +
              'modules/promotion-meta/issuance-rules.ts 의 분류표를 채우는 것이 정답이다.',
          );
        }
        skipped.push({ promotion_id: promo.id, reason: eligibility.reason });
        continue;
      }
    }

    const maxClaims = metaShape?.max_claims != null ? Number(metaShape.max_claims) : null;

    // 발급은 워크플로다 (ADR-0034 결정 1) — 표시용 링크 스텝은 Task 7 로 사라졌다(정본이
    // grant 하나로 좁혀지며 아무도 링크를 안 읽으니 지킬 이유도 없다). 실패는 `grant_error`
    // 하나로 정직하게 나간다.
    const issueKeys = Array.from({ length: quantity }, (_, i) => `${submitId}:${i + 1}`);

    let outcome: { created: string[]; duplicated: string[]; exhausted: boolean };
    try {
      const { result } = await issueCouponGrantWorkflow(req.scope).run({
        input: {
          promotion_id: promo.id,
          customer_id: customerId,
          issue_keys: issueKeys,
          issued_via: issueTrigger,
          expires_at: computeExpiresAt(meta, now)?.toISOString() ?? null,
          max_claims: maxClaims,
          enforce_cap: !force,
        },
      });
      outcome = result;
    } catch (e: any) {
      // 🔴 원인을 반드시 남긴다 — 사유만 `grant_error` 로 돌려주면 진단할 근거가 없다.
      logger.error(
        `[coupon] 수동발급 grant_error (promotion_id=${promo.id}, customer_id=${customerId}, ` +
          `submit_id=${submitId}): ${e?.message ?? e}`,
      );
      skipped.push({ promotion_id: promo.id, reason: 'grant_error' });
      continue;
    }

    // 상한에 걸려 «일부만» 발급된 경우가 있으므로 두 보고는 배타적이지 않다 — 옛 루프도
    // granted>0 이면서 max_claims_exceeded 를 함께 올렸다.
    if (outcome.exhausted) {
      skipped.push({ promotion_id: promo.id, reason: 'max_claims_exceeded' });
    }
    if (outcome.created.length > 0) {
      issued.push(promo.id);
    } else if (!outcome.exhausted) {
      // 🔴 모든 키가 'duplicate' 로 끝났다 — 같은 submit_id 로 이미 전량 발급된 재시도다.
      // 이 branch 가 없으면 그 프로모션이 `issued` 에도 `skipped` 에도 없는 「응답에 없는
      // 항목」이 되어, 클라이언트가 조용히 '발급할 수 없습니다' 로 잘못 표시한다.
      skipped.push({ promotion_id: promo.id, reason: 'already_issued' });
    }
  }

  return res.status(200).json({
    success: true,
    message: `${issued.length} promotion(s) assigned to customer`,
    customer_id: customerId,
    issued,
    skipped,
    force,
  });
}

/**
 * DELETE /admin/customers/:id/promotions
 * 고객에게서 쿠폰(Promotion)을 제거합니다.
 */
export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const customerId = req.params.id;
  const { promotion_ids } = req.body as RemovePromotionsBody;

  if (!promotion_ids || !Array.isArray(promotion_ids) || promotion_ids.length === 0) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'promotion_ids is required and must be a non-empty array');
  }

  const promotionMetaService = req.scope.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);

  const removed: { promotion_id: string; grants: number }[] = [];
  for (const pid of promotion_ids) {
    const { revoked } = await promotionMetaService.revokeGrants(pid, customerId);

    // 회수(soft delete)된 장은 그 순간부터 `countIssuedGrants` 에서 빠진다 — 슬롯을 별도로
    // 반환할 필요가 없다(옛 `releaseClaimSlot` 루프가 하던 일). 이미 쓴 장은 회수 대상이
    // 아니고 그 슬롯은 실제로 소비됐으므로 여전히 세어진다.

    // 링크가 없으므로 「지웠다고 보고했는데 안 지워졌다」가 성립하지 않는다 (Task 7, 리뷰
    // 발견 5). 옛 코드는 링크 유무로 `dismissed` 를 «먼저» 계산해 두고 그 dismiss 호출의
    // 실패를 `.catch(() => {})` 로 삼켰다 — `removed` 는 이제 `revokeGrants` 의 실제
    // 결과만 반영한다.
    if (revoked > 0) {
      removed.push({ promotion_id: pid, grants: revoked });
    }
  }

  return res.status(200).json({
    success: true,
    message: `${removed.length} promotion(s) removed from customer`,
    customer_id: customerId,
    removed,
    promotion_ids: removed.map((r) => r.promotion_id),
    revoked_grants: removed.reduce((s, r) => s + r.grants, 0),
  });
}
