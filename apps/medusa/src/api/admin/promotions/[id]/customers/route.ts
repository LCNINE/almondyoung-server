import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, Modules, MedusaError } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../../../../../modules/promotion-meta';
import type PromotionMetaModuleService from '../../../../../modules/promotion-meta/service';
import type { CouponGrantRow } from '../../../../../modules/promotion-meta/service';
import { usableGrants, nextExpiryAt } from '../../../../../modules/promotion-meta/grants';
import { evaluateIssuanceRules } from '../../../../../modules/promotion-meta/issuance-rules';
import { computeExpiresAt, issuanceWindowState } from '../../../../../modules/promotion-meta/validity';
import { resolveVisibility } from '../../helpers';

interface RevokeBody {
  customer_ids: string[];
}

interface BulkIssueBody {
  customer_ids: string[];
  quantity?: number;
  /** 이 «제출» 의 식별자. 재도착(따닥·타임아웃 재시도)이 장수를 늘리지 않게 한다. */
  submit_id: string;
  force?: boolean;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * 값으로 고른다 — 배열 순서에 기대지 않는다. `listGrantsForPromotion` 은 `orderBy` 가 없어
 * 행 순서가 보장되지 않으므로, 위치(`mine[0]`/`mine[mine.length-1]`)로 「최초/최근」을 뽑으면
 * 여러 장을 가진 고객의 표시가 틀릴 수 있다(#488 Task 7 리뷰). `grants.ts` 의 `nextExpiryAt`
 * (reduce)·`selectGrantToConsume`(명시적 정렬 + id 동률 처리)와 같은 모양을 따른다.
 */
function earliestIssuedGrant(grants: CouponGrantRow[]): CouponGrantRow | undefined {
  return grants.reduce<CouponGrantRow | undefined>((min, g) => {
    if (!min) return g;
    const gt = toDate(g.issued_at)?.getTime() ?? 0;
    const mt = toDate(min.issued_at)?.getTime() ?? 0;
    if (gt !== mt) return gt < mt ? g : min;
    return g.id < min.id ? g : min; // 동률(같은 issued_at)은 id 로 결정적이게
  }, undefined);
}

function latestIssuedGrant(grants: CouponGrantRow[]): CouponGrantRow | undefined {
  return grants.reduce<CouponGrantRow | undefined>((max, g) => {
    if (!max) return g;
    const gt = toDate(g.issued_at)?.getTime() ?? 0;
    const mt = toDate(max.issued_at)?.getTime() ?? 0;
    if (gt !== mt) return gt > mt ? g : max;
    return g.id > max.id ? g : max;
  }, undefined);
}

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const promotionId = req.params.id;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const promotionMetaService = req.scope.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);

  const limit = parseInt(req.query.limit as string) || 20;
  const offset = parseInt(req.query.offset as string) || 0;

  const [{ data: promotions }, grants] = await Promise.all([
    query.graph({
      entity: 'promotion',
      fields: ['id', 'code'],
      filters: { id: promotionId },
    }),
    promotionMetaService.listGrantsForPromotion(promotionId),
  ]);

  const promotion = promotions?.[0];
  if (!promotion) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Promotion ${promotionId} not found`);
  }

  const now = new Date();

  const byCustomer = new Map<string, CouponGrantRow[]>();
  for (const g of grants) {
    const list = byCustomer.get(g.customer_id) ?? [];
    list.push(g);
    byCustomer.set(g.customer_id, list);
  }

  const customerIds = [...byCustomer.keys()];
  const count = customerIds.length;
  const paginatedIds = customerIds.slice(offset, offset + limit);

  let customers: any[] = [];

  if (paginatedIds.length > 0) {
    const { data } = await query.graph({
      entity: 'customer',
      fields: ['id', 'email', 'first_name', 'last_name', 'created_at'],
      filters: { id: paginatedIds },
    });
    customers = data;
  }

  const customersWithUsage = customers.map((c) => {
    const mine = byCustomer.get(c.id) ?? [];
    const usable = usableGrants(mine, now);
    return {
      ...c,
      granted_count: mine.length,
      used_count: mine.filter((g) => g.used_at != null).length,
      usable_count: usable.length,
      next_expires_at: nextExpiryAt(mine, now),
      // 가장 최근 발급의 경로 — 어느 출처에서 왔는지 한눈에 보이게. 위치가 아니라 issued_at 값으로 고른다.
      issued_via: latestIssuedGrant(mine)?.issued_via ?? null,
      issued_at: earliestIssuedGrant(mine)?.issued_at ?? c.created_at,
    };
  });

  return res.status(200).json({
    promotion_id: promotionId,
    promotion_code: promotion.code,
    customers: customersWithUsage,
    count,
    offset,
    limit,
  });
}

/**
 * POST /admin/promotions/:id/customers
 * 쿠폰 하나를 여러 고객에게 발급합니다 — 고객축(`/admin/customers/:id/promotions`)의 반대 방향.
 * 쿠폰 축 검증(상태·발급창)은 루프 밖에서 한 번만 한다 — 고객마다 같은 답이 나온다.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const promotionId = req.params.id;
  const { customer_ids, quantity = 1, submit_id, force = false } = req.body as BulkIssueBody;

  if (!Array.isArray(customer_ids) || customer_ids.length === 0) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'customer_ids is required');
  }
  if (!submit_id) {
    // 🔴 없으면 따닥이 곧 두 배 발급이다. 서버가 만들어 주지 않는다 — 재시도가 같은 값을
    //    보낼 수 있는 쪽은 클라이언트뿐이다.
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'submit_id is required');
  }
  const rawQty = Number(quantity);
  if (!Number.isFinite(rawQty)) {
    // 🔴 클램프 전에 걸러야 한다 — `Number('abc')` 는 NaN 이고, NaN 과의 모든 비교는
    //    false 라 `for (n=1; n<=qty; n++)` 가 한 번도 안 돈다. 그러면 전원이 조용히
    //    `granted:0` 이 돼 `issued`·`skipped` 둘 다 비고, 사유 없는 `200` 이 나간다.
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'quantity must be a finite number');
  }
  const qty = Math.max(1, Math.min(rawQty, 50));
  if (customer_ids.length > 500) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'customer_ids must be 500 or fewer');
  }
  // 🔴 두 상한을 **따로** 두면 곱이 안 막힌다 — 500명 × 50장 = 25,000 회의 순차 INSERT 다.
  // 어떤 프록시 타임아웃보다 길고, 클라이언트가 끊긴 뒤에도 루프는 서버에서 계속 돌아
  // 「응답은 실패인데 발급은 됐다」가 된다. 그래서 곱 자체를 막는다.
  if (customer_ids.length * qty > 1000) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `customer_ids × quantity must be 1000 or fewer (got ${customer_ids.length} × ${qty})`,
    );
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const link = req.scope.resolve(ContainerRegistrationKeys.LINK);
  const promotionMetaService = req.scope.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);

  const { data: promotions } = await query.graph({
    entity: 'promotion',
    fields: ['id', 'code', 'status', 'is_automatic', 'rules.attribute', 'rules.operator', 'rules.values.value'],
    filters: { id: promotionId },
  });
  const promo = promotions?.[0];
  if (!promo) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Promotion ${promotionId} not found`);
  }

  const meta = await promotionMetaService.getByPromotionId(promotionId);
  const now = new Date();
  const issueTrigger = force ? 'admin_force' : 'admin_manual';

  const issued: { customer_id: string; granted: number }[] = [];
  const skipped: { customer_id: string; reason: string }[] = [];

  /**
   * 표시용 링크를 보장한다. 성공 여부를 **돌려준다** — 삼키면 안 된다.
   *
   * 🔴 링크가 없는 grant 는 「고객이 가지고 있고 코드를 치면 쓸 수 있는데, 마이페이지에도
   * (`/store/customers/me/promotions` 가 링크 행으로 열거한다) 어드민 고객 상세에도
   * (`GET /admin/customers/:id/promotions`) **안 보이는**」 쿠폰이다. 옛 코드는 이 실패를
   * `link_error` 로 보고하고 슬롯을 되돌렸는데, `.catch(() => {})` 로 바뀌면서 «발급됨» 이라고
   * 보고하고 로그에도 아무것도 남기지 않게 됐다(2026-09-02 전체 리뷰).
   */
  async function ensureLink(customerId: string): Promise<boolean> {
    try {
      await (link as any).create([{
        [Modules.CUSTOMER]: { customer_id: customerId },
        [Modules.PROMOTION]: { promotion_id: promotionId },
      }]);
      return true;
    } catch (e: any) {
      logger.warn(
        `[coupon] 대량발급 link_error — 장은 만들어졌으나 표시용 링크 생성 실패 ` +
          `(promotion_id=${promotionId}, customer_id=${customerId}, submit_id=${submit_id}): ` +
          `${e?.message ?? e}. 이 고객은 쿠폰을 «가지고 있지만 목록에 안 보인다» — 재시도하면 ` +
          `링크만 다시 만든다(장은 issue_key 로 멱등하다).`,
      );
      return false;
    }
  }

  // 쿠폰 축 검증은 루프 밖에서 한 번만 — 고객마다 같은 답이 나온다.
  //
  // 🔴 이 조기 반환들도 성공 응답과 **같은 모양**이어야 한다. admin-web 의 `BulkIssueResult`
  // 는 `promotion_id`·`force` 를 required 로 선언하는데, 두 트리 사이엔 타입 검사가 없어
  // (admin-web 은 medusa 를 import 하지 못한다) 빠뜨려도 아무 게이트가 안 잡는다.
  const couponAxisSkip = (reason: string) =>
    res.status(200).json({
      promotion_id: promotionId,
      issued: [],
      skipped: customer_ids.map((id) => ({ customer_id: id, reason })),
      force,
    });

  // 🔴 `public` 거절은 **`!force` 밖**이다 (#488 A2). 아래 검사들은 「지금은 정책상 발급이
  // 안 되는 상태」라 운영자가 넘어설 수 있지만, `public` 은 「이 쿠폰엔 1인 발급 개념 자체가
  // 없다」이다. 넘어서면 발급받은 그 고객«만» 카트 게이트에서 장 수만큼 제한되고 나머지는
  // 자유롭게 쓴다 — 형제(고객축) 라우트와 같은 판단이다.
  if (resolveVisibility(meta) === 'public') {
    return couponAxisSkip('public_promotion');
  }

  if (!force) {
    if (promo.status !== 'active') {
      return couponAxisSkip('inactive');
    }
    // 형제(고객축) 라우트와 같은 검사 — 자동적용 프로모션은 개별 grant 발급 대상이 아니다.
    if (promo.is_automatic) {
      return couponAxisSkip('automatic');
    }
    const window = issuanceWindowState(meta, now);
    if (window !== 'ok') {
      return couponAxisSkip(window === 'not_started' ? 'not_started' : 'expired');
    }
  }

  const maxClaims = meta?.max_claims != null ? Number(meta.max_claims) : null;

  // 🔴 고객 조회는 루프 «밖» 한 번이다 — 안에 두면 500명에 500번의 순차 `query.graph` 가
  // 발급 INSERT 위에 얹힌다. 위 `GET` 핸들러가 이미 같은 모양(`filters: { id: [...] }`)을
  // 쓴다. 이 조회가 통째로 실패하면 500 으로 크게 터지는 것이 맞다 — 「전원 조용히 스킵」보다
  // 낫고, 아직 아무것도 발급하지 않은 시점이라 부분 반영도 없다.
  const { data: foundCustomers } = await query.graph({
    entity: 'customer',
    fields: ['id', 'groups.id'],
    filters: { id: customer_ids },
  });
  const customerById = new Map<string, any>((foundCustomers ?? []).map((c: any) => [c.id, c]));

  for (const customerId of customer_ids) {
    const customer = customerById.get(customerId);
    if (!customer) {
      skipped.push({ customer_id: customerId, reason: 'customer_not_found' });
      continue;
    }

    if (!force) {
      const groupIds = new Set<string>((customer.groups ?? []).map((g: any) => g.id));
      const eligibility = evaluateIssuanceRules(promo.rules, groupIds);
      if (!eligibility.eligible) {
        if (eligibility.reason === 'unsupported_rule') {
          logger.warn(
            `[coupon] 대량발급 skip — 발급 시점에 평가할 수 없는 룰 (promotion_id=${promotionId}, ` +
              `attribute=${eligibility.attribute}, operator=${eligibility.operator}, ` +
              `customer_id=${customerId}). issuance-rules.ts 의 분류표를 채우는 것이 정답이다.`,
          );
        }
        skipped.push({ customer_id: customerId, reason: eligibility.reason });
        continue;
      }
    }

    let granted = 0;
    // 이 고객이 이 customerId 이터레이션 안에서 이미 skipped 에 등재됐는지 — 아래 「전량
    // duplicate」 판정이 그 위에 또 등재해 이중화하지 않도록 추적한다.
    let skippedInLoop = false;
    for (let n = 1; n <= qty; n++) {
      let slotReserved = false;
      if (!force && maxClaims !== null) {
        const slot = await promotionMetaService.reserveClaimSlot(promotionId, maxClaims);
        if (slot === 'exhausted') {
          skipped.push({ customer_id: customerId, reason: 'max_claims_exceeded' });
          skippedInLoop = true;
          break;
        }
        slotReserved = true;
      }

      let result: 'created' | 'duplicate';
      try {
        result = await promotionMetaService.issueGrant({
          promotion_id: promotionId,
          customer_id: customerId,
          issue_key: `${submit_id}:${n}`,
          issued_via: issueTrigger,
          expires_at: computeExpiresAt(meta, now),
          now,
        });
      } catch (e: any) {
        if (slotReserved) await promotionMetaService.releaseClaimSlot(promotionId).catch(() => {});
        // 🔴 원인을 반드시 남긴다 — 500명 배치에서 사유만 `grant_error` 로 돌려주면 화면엔
        // 진단 불가능한 실패의 벽이 서고 로그엔 아무것도 없다.
        logger.error(
          `[coupon] 대량발급 grant_error (promotion_id=${promotionId}, customer_id=${customerId}, ` +
            `n=${n}, submit_id=${submit_id}): ${e?.message ?? e}`,
        );
        // 배치 resilient — 한 고객의 장애가 나머지를 막지 않는다.
        skipped.push({ customer_id: customerId, reason: 'grant_error' });
        skippedInLoop = true;
        break;
      }

      if (result === 'duplicate') {
        if (slotReserved) await promotionMetaService.releaseClaimSlot(promotionId).catch(() => {});
        continue;
      }
      if (force && maxClaims !== null) {
        await promotionMetaService.incrementIssuedCount(promotionId).catch(() => {});
      }
      granted++;
    }

    if (granted > 0) {
      if (await ensureLink(customerId)) {
        issued.push({ customer_id: customerId, granted });
      } else {
        skipped.push({ customer_id: customerId, reason: 'link_error' });
      }
    } else if (!skippedInLoop) {
      // 🔴 모든 n 이 'duplicate' 로 끝났다 — 같은 submit_id 로 이미 전량 발급된 재시도다.
      // 다른 사유로 이미 skipped 에 등재된 경우(max_claims_exceeded/grant_error)는
      // skippedInLoop 가 true 라 여기 안 온다. customer_not_found·eligibility 스킵은
      // 위에서 continue 로 이 지점 자체에 도달하지 않는다. 이 branch 가 없으면 재시도로
      // 이미 성공한 고객이 issued 에도 skipped 에도 없는 「응답에 없는 고객」이 되어
      // 클라이언트가 조용히 '발급할 수 없습니다' 로 잘못 표시한다(#488 Task 12 리뷰).
      //
      // 링크는 여기서도 보장한다 — 직전 시도가 `link_error` 로 끝났다면 장은 있고 링크만
      // 없는 상태다. 그 재시도는 전량 duplicate 로 떨어지므로, 이 자리에서 링크를 다시
      // 만들지 않으면 `link_error` 에 복구 경로가 없다. `link.create` 는 upsert 라
      // 정상 재시도에서는 무해한 no-op 이다.
      if (await ensureLink(customerId)) {
        skipped.push({ customer_id: customerId, reason: 'already_issued' });
      } else {
        skipped.push({ customer_id: customerId, reason: 'link_error' });
      }
    }
  }

  return res.status(200).json({ promotion_id: promotionId, issued, skipped, force });
}

export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const promotionId = req.params.id;
  const { customer_ids } = req.body as RevokeBody;

  if (!customer_ids || !Array.isArray(customer_ids) || customer_ids.length === 0) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'customer_ids is required');
  }

  const link = req.scope.resolve(ContainerRegistrationKeys.LINK);
  const promotionMetaService = req.scope.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);

  const removed: { customer_id: string; grants: number }[] = [];
  for (const cid of customer_ids) {
    const n = await promotionMetaService.revokeGrants(promotionId, cid);
    if (n === 0) continue;
    removed.push({ customer_id: cid, grants: n });

    // 회수한 장수만큼 발급 카운트를 되돌린다 — 1회 고정이면 여러 장 회수 시 카운터가 남는다.
    for (let i = 0; i < n; i++) {
      await promotionMetaService.releaseClaimSlot(promotionId).catch(() => {});
    }

    // 남은 장이 없으면 표시용 링크도 걷는다.
    await link
      .dismiss([
        {
          [Modules.CUSTOMER]: { customer_id: cid },
          [Modules.PROMOTION]: { promotion_id: promotionId },
        },
      ])
      .catch(() => {});
  }

  return res.status(200).json({
    success: true,
    message: `${removed.length} customer(s) revoked from promotion`,
    promotion_id: promotionId,
    customer_ids: removed.map((r) => r.customer_id),
    revoked_grants: removed.reduce((s, r) => s + r.grants, 0),
  });
}
