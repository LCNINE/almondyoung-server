import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, Modules, MedusaError } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../../../../../modules/promotion-meta';
import type PromotionMetaModuleService from '../../../../../modules/promotion-meta/service';
import type { CouponGrantRow } from '../../../../../modules/promotion-meta/service';
import { toMetadataShape, resolveVisibility } from '../../../promotions/helpers';
import { evaluateIssuanceRules } from '../../../../../modules/promotion-meta/issuance-rules';
import { computeExpiresAt, issuanceWindowState } from '../../../../../modules/promotion-meta/validity';
import { usableGrants, nextExpiryAt } from '../../../../../modules/promotion-meta/grants';

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

  // Customer와 연결된 Promotions 조회
  const [{ data: customers }, grants] = await Promise.all([
    query.graph({
      entity: 'customer',
      fields: [
        'id',
        'email',
        'promotions.id',
        'promotions.code',
        'promotions.type',
        'promotions.status',
        'promotions.is_automatic',
        'promotions.campaign_id',
        'promotions.campaign.campaign_identifier',
        'promotions.application_method.id',
        'promotions.application_method.type',
        'promotions.application_method.value',
        'promotions.application_method.target_type',
      ],
      filters: { id: customerId },
    }),
    promotionMetaService.listGrantsForCustomer(customerId),
  ]);

  if (!customers || customers.length === 0) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, 'Customer not found');
  }

  const customer = customers[0];
  const promotions = customer.promotions || [];

  const now = new Date();
  const byPromotion = new Map<string, CouponGrantRow[]>();
  for (const g of grants) {
    const list = byPromotion.get(g.promotion_id) ?? [];
    list.push(g);
    byPromotion.set(g.promotion_id, list);
  }

  // Apply pagination
  const paginatedPromotions = promotions.slice(offset, offset + limit).map((p: any) => {
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

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const link = req.scope.resolve(ContainerRegistrationKeys.LINK);
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
  const rawQty = Number(rawQuantity ?? 1);
  if (!Number.isFinite(rawQty)) {
    // 🔴 클램프 전에 걸러야 한다 — `Number('abc')` 는 NaN 이고, NaN 과의 모든 비교는
    //    false 라 발급 루프가 한 번도 안 돈다. 그러면 전원이 조용히 `granted:0` 이 돼
    //    `issued`·`skipped` 둘 다 비고, 사유 없는 `200` 이 나간다(#488 Task 9 리뷰).
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'quantity must be a finite number');
  }
  const quantity = Math.max(1, Math.min(rawQty, 50));
  const submitId = submit_id;
  const issued: string[] = [];
  const skipped: { promotion_id: string; reason: string }[] = [];

  /**
   * 표시용 링크를 보장한다. 성공 여부를 **돌려준다** — 삼키면 안 된다.
   *
   * 🔴 링크가 없는 grant 는 「고객이 가지고 있고 코드를 치면 쓸 수 있는데, 마이페이지에도
   * (`/store/customers/me/promotions` 가 링크 행으로 열거한다) 이 라우트의 `GET` 에도
   * **안 보이는**」 쿠폰이다. 옛 코드는 `link_error` 로 보고했는데 `.catch(() => {})` 가
   * 그것을 「발급됨」+무로그로 바꿔놨다(2026-09-02 전체 리뷰).
   */
  async function ensureLink(promotionId: string): Promise<boolean> {
    try {
      await (link as any).create([{
        [Modules.CUSTOMER]: { customer_id: customerId },
        [Modules.PROMOTION]: { promotion_id: promotionId },
      }]);
      return true;
    } catch (e: any) {
      logger.warn(
        `[coupon] 수동발급 link_error — 장은 만들어졌으나 표시용 링크 생성 실패 ` +
          `(promotion_id=${promotionId}, customer_id=${customerId}, submit_id=${submitId}): ` +
          `${e?.message ?? e}. 이 고객은 쿠폰을 «가지고 있지만 목록에 안 보인다» — 재시도하면 ` +
          `링크만 다시 만든다(장은 issue_key 로 멱등하다).`,
      );
      return false;
    }
  }

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

    let granted = 0;
    // 이 프로모션이 안쪽 n-루프에서 이미 skipped 에 등재됐는지 — 아래 「전량 duplicate」
    // 판정이 그 위에 또 등재해 이중화하지 않도록 추적한다(쿠폰축 라우트와 같은 모양).
    let skippedInLoop = false;
    for (let n = 1; n <= quantity; n++) {
      const issueKey = `${submitId}:${n}`;

      // 슬롯 예약·되돌리기·force 보정은 전부 모듈의 한 트랜잭션 안에 있다 (ADR-0034 결정 1).
      // 여기서 손으로 짝지을 것이 없고, 중복이 소진 판정보다 먼저 결정된다.
      let result: 'created' | 'duplicate' | 'exhausted';
      try {
        result = await promotionMetaService.issueGrantWithSlot({
          promotion_id: promo.id,
          customer_id: customerId,
          issue_key: issueKey,
          issued_via: issueTrigger,
          expires_at: computeExpiresAt(meta, now),
          now,
          max_claims: maxClaims,
          enforce_cap: !force,
        });
      } catch (e: any) {
        // 🔴 원인을 반드시 남긴다 — 사유만 `grant_error` 로 돌려주면 진단할 근거가 없다.
        logger.error(
          `[coupon] 수동발급 grant_error (promotion_id=${promo.id}, customer_id=${customerId}, ` +
            `n=${n}, submit_id=${submitId}): ${e?.message ?? e}`,
        );
        skipped.push({ promotion_id: promo.id, reason: 'grant_error' });
        skippedInLoop = true;
        break;
      }

      if (result === 'exhausted') {
        skipped.push({ promotion_id: promo.id, reason: 'max_claims_exceeded' });
        skippedInLoop = true;
        break;
      }

      if (result === 'duplicate') {
        // 같은 제출의 재도착이다. 슬롯 증가는 트랜잭션과 함께 되감겼다.
        continue;
      }

      granted++;
    }

    // 링크는 표시 조인용으로만 유지한다 — `data` 는 싣지 않는다(만료·사용의 정본은 grant 다).
    if (granted > 0) {
      if (await ensureLink(promo.id)) {
        issued.push(promo.id);
      } else {
        skipped.push({ promotion_id: promo.id, reason: 'link_error' });
      }
    } else if (!skippedInLoop) {
      // 🔴 모든 n 이 'duplicate' 로 끝났다 — 같은 submit_id 로 이미 전량 발급된 재시도다.
      // 이 branch 가 없으면 그 프로모션이 `issued` 에도 `skipped` 에도 없는 「응답에 없는
      // 항목」이 되어, 클라이언트가 조용히 '발급할 수 없습니다' 로 잘못 표시한다. 형제
      // (쿠폰축) 라우트는 Task 12 리뷰에서 이 수정을 받았는데 이쪽은 빠져 있었다.
      // 링크는 여기서도 보장한다 — 직전 시도가 `link_error` 였다면 그 재시도는 전량
      // duplicate 로 떨어지므로, 이 자리가 링크의 유일한 복구 경로다.
      if (await ensureLink(promo.id)) {
        skipped.push({ promotion_id: promo.id, reason: 'already_issued' });
      } else {
        skipped.push({ promotion_id: promo.id, reason: 'link_error' });
      }
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

  const link = req.scope.resolve(ContainerRegistrationKeys.LINK);
  const promotionMetaService = req.scope.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);

  const removed: { promotion_id: string; grants: number }[] = [];
  for (const pid of promotion_ids) {
    const { revoked, remaining } = await promotionMetaService.revokeGrants(pid, customerId);

    // 회수한 장수만큼 발급 카운트를 되돌린다 — 1회 고정이면 여러 장 회수 시 카운터가 남는다.
    // 이미 쓴 장은 회수 대상이 아니고 그 슬롯은 실제로 소비됐으므로 여기서 세지 않는다.
    for (let i = 0; i < revoked; i++) {
      await promotionMetaService.releaseClaimSlot(pid).catch(() => {});
    }

    // 🔴 링크는 「남은 장이 없을 때만」 걷는다. 두 방향 다 틀리면 사고다:
    //  - 쓴 장이 남았는데 걷으면 마이페이지의 「사용완료」가 사라진다(링크 행으로 열거한다).
    //  - 회수할 장이 0개라고 건너뛰면(옛 `if (n === 0) continue`), 링크만 있고 장이 없는 쌍
    //    — 백필 이전 배정, 또는 장은 생겼는데 링크만 남은 재시도 — 을 **영원히 못 끊는다**.
    //    응답은 `0 promotion(s) removed` 인데 쿠폰은 고객 화면에 계속 남아 있었다.
    const dismissed = remaining === 0;
    if (dismissed) {
      await link
        .dismiss([
          {
            [Modules.CUSTOMER]: { customer_id: customerId },
            [Modules.PROMOTION]: { promotion_id: pid },
          },
        ])
        .catch(() => {});
    }

    if (revoked > 0 || dismissed) {
      removed.push({ promotion_id: pid, grants: revoked });
    }
  }

  return res.status(200).json({
    success: true,
    message: `${removed.length} promotion(s) removed from customer`,
    customer_id: customerId,
    promotion_ids: removed.map((r) => r.promotion_id),
    revoked_grants: removed.reduce((s, r) => s + r.grants, 0),
  });
}
