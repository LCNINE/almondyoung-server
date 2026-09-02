import { randomUUID } from 'crypto';
import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, Modules, MedusaError } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../../../../../modules/promotion-meta';
import type PromotionMetaModuleService from '../../../../../modules/promotion-meta/service';
import type { CouponGrantRow } from '../../../../../modules/promotion-meta/service';
import { toMetadataShape } from '../../../promotions/helpers';
import { evaluateIssuanceRules } from '../../../../../modules/promotion-meta/issuance-rules';
import { computeExpiresAt, issuanceWindowState } from '../../../../../modules/promotion-meta/validity';
import { usableGrants, nextExpiryAt } from '../../../../../modules/promotion-meta/grants';

interface AssignPromotionsBody {
  promotion_ids: string[];
  /** true = 정책 검증 우회. 감사 로그에 admin_force로 기록됩니다. */
  force?: boolean;
  /**
   * 이 «제출» 의 식별자. 같은 제출이 재도착하면(따닥·타임아웃 재시도) 한 장만 남는다.
   * 없으면 서버가 만들어 쓰지만 **그 요청은 멱등하지 않다** — 클라이언트가 보내야 한다.
   */
  submit_id?: string;
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
  const quantity = Math.max(1, Math.min(Number(rawQuantity ?? 1), 50));
  const submitId = submit_id ?? randomUUID();
  const issued: string[] = [];
  const skipped: { promotion_id: string; reason: string }[] = [];

  for (const promo of promotions as any[]) {
    const meta = metaRecords.find((m: any) => m.promotion_id === promo.id);
    const metaShape = toMetadataShape(meta);

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
    for (let n = 1; n <= quantity; n++) {
      const issueKey = `${submitId}:${n}`;

      let slotReserved = false;
      if (!force && maxClaims !== null) {
        const slot = await promotionMetaService.reserveClaimSlot(promo.id, maxClaims);
        if (slot === 'exhausted') {
          skipped.push({ promotion_id: promo.id, reason: 'max_claims_exceeded' });
          break;
        }
        slotReserved = true;
      }

      let result: 'created' | 'duplicate';
      try {
        result = await promotionMetaService.issueGrant({
          promotion_id: promo.id,
          customer_id: customerId,
          issue_key: issueKey,
          issued_via: issueTrigger,
          expires_at: computeExpiresAt(meta, now),
          now,
        });
      } catch (e: any) {
        if (slotReserved) await promotionMetaService.releaseClaimSlot(promo.id).catch(() => {});
        skipped.push({ promotion_id: promo.id, reason: 'grant_error' });
        break;
      }

      if (result === 'duplicate') {
        // 같은 제출의 재도착이다. 슬롯을 잡았다면 되돌린다 — 잡은 쪽이 반환 책임을 진다.
        if (slotReserved) await promotionMetaService.releaseClaimSlot(promo.id).catch(() => {});
        continue;
      }

      if (force && maxClaims !== null) {
        // force 발급도 총 발급 수량에 포함 (issued_count SoT 유지)
        await promotionMetaService.incrementIssuedCount(promo.id).catch(() => {});
      }
      granted++;
    }

    // 링크는 표시 조인용으로만 유지한다 — `data` 는 싣지 않는다(만료·사용의 정본은 grant 다).
    if (granted > 0) {
      await (link as any).create([{
        [Modules.CUSTOMER]: { customer_id: customerId },
        [Modules.PROMOTION]: { promotion_id: promo.id },
      }]).catch(() => {});
      issued.push(promo.id);
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
    const n = await promotionMetaService.revokeGrants(pid, customerId);
    if (n === 0) continue;
    removed.push({ promotion_id: pid, grants: n });

    // 회수한 장수만큼 발급 카운트를 되돌린다 — 1회 고정이면 여러 장 회수 시 카운터가 남는다.
    for (let i = 0; i < n; i++) {
      await promotionMetaService.releaseClaimSlot(pid).catch(() => {});
    }

    // 남은 장이 없으면 표시용 링크도 걷는다.
    await link
      .dismiss([
        {
          [Modules.CUSTOMER]: { customer_id: customerId },
          [Modules.PROMOTION]: { promotion_id: pid },
        },
      ])
      .catch(() => {});
  }

  return res.status(200).json({
    success: true,
    message: `${removed.length} promotion(s) removed from customer`,
    customer_id: customerId,
    promotion_ids: removed.map((r) => r.promotion_id),
    revoked_grants: removed.reduce((s, r) => s + r.grants, 0),
  });
}
