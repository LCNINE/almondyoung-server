import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, Modules, MedusaError } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../../../../../modules/promotion-meta';
import type PromotionMetaModuleService from '../../../../../modules/promotion-meta/service';
import { meetsGroupRule, toMetadataShape } from '../../../promotions/helpers';

interface AssignPromotionsBody {
  promotion_ids: string[];
  /** true = 정책 검증 우회. 감사 로그에 admin_force로 기록됩니다. */
  force?: boolean;
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

  // Query parameters for pagination
  const limit = parseInt(req.query.limit as string) || 20;
  const offset = parseInt(req.query.offset as string) || 0;

  // Customer와 연결된 Promotions 조회
  const { data: customers } = await query.graph({
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
      'promotions.campaign.starts_at',
      'promotions.campaign.ends_at',
      'promotions.application_method.id',
      'promotions.application_method.type',
      'promotions.application_method.value',
      'promotions.application_method.target_type',
    ],
    filters: { id: customerId },
  });

  if (!customers || customers.length === 0) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, 'Customer not found');
  }

  const customer = customers[0];
  const promotions = customer.promotions || [];

  // Apply pagination
  const paginatedPromotions = promotions.slice(offset, offset + limit);

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
  const { promotion_ids, force = false } = req.body as AssignPromotionsBody;

  if (!promotion_ids || !Array.isArray(promotion_ids) || promotion_ids.length === 0) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'promotion_ids is required and must be a non-empty array');
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.REMOTE_LINK);
  const promotionMetaService = req.scope.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);

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
      'campaign.starts_at', 'campaign.ends_at',
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

  // Fetch already-issued promotions for this customer to avoid duplicate processing
  const { data: existingCustomers } = await query.graph({
    entity: 'customer',
    fields: ['id', 'promotions.id'],
    filters: { id: customerId },
  });
  const alreadyIssuedIds = new Set<string>(
    (existingCustomers?.[0]?.promotions ?? []).map((p: any) => p.id as string),
  );

  const issueTrigger = force ? 'admin_force' : 'admin_manual';
  const now = new Date();
  const issued: string[] = [];
  const skipped: { promotion_id: string; reason: string }[] = [];

  for (const promo of promotions as any[]) {
    if (alreadyIssuedIds.has(promo.id)) {
      skipped.push({ promotion_id: promo.id, reason: 'already_issued' });
      continue;
    }

    if (!force) {
      if (promo.status !== 'active') {
        throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `비활성 쿠폰은 발급할 수 없습니다: ${promo.code}. force: true로 강제 발급하세요.`);
      }
      if (promo.is_automatic) {
        throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `자동 쿠폰은 수동 발급할 수 없습니다: ${promo.code}`);
      }
      if (promo.campaign) {
        const startsAt = promo.campaign.starts_at ? new Date(promo.campaign.starts_at) : null;
        const endsAt = promo.campaign.ends_at ? new Date(promo.campaign.ends_at) : null;
        if (startsAt && now < startsAt) {
          throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `아직 발급 기간이 아닙니다: ${promo.code}. force: true로 강제 발급하세요.`);
        }
        if (endsAt && now > endsAt) {
          throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `기간이 만료된 쿠폰입니다: ${promo.code}. force: true로 강제 발급하세요.`);
        }
      }
      if (!meetsGroupRule(promo, customerGroupIds)) {
        throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `대상 고객 그룹이 아닙니다: ${promo.code}. force: true로 강제 발급하세요.`);
      }
    }

    const meta = metaRecords.find((m: any) => m.promotion_id === promo.id);
    const metaShape = toMetadataShape(meta);
    const maxClaims = metaShape?.max_claims != null ? Number(metaShape.max_claims) : null;

    let slotReserved = false;
    if (!force && maxClaims !== null) {
      const slot = await promotionMetaService.reserveClaimSlot(promo.id, maxClaims);
      if (slot === 'exhausted') {
        throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `발급 수량이 소진되었습니다: ${promo.code}. force: true로 강제 발급하세요.`);
      }
      slotReserved = true;
    }

    try {
      await (remoteLink as any).create([{
        [Modules.CUSTOMER]: { customer_id: customerId },
        [Modules.PROMOTION]: { promotion_id: promo.id },
      }]);
      await promotionMetaService.recordIssue(customerId, promo.id, issueTrigger).catch(() => {});
      // force 발급도 총 발급 수량에 포함 (issued_count SoT 유지)
      if (force && maxClaims !== null) {
        await promotionMetaService.incrementIssuedCount(promo.id).catch(() => {});
      }
      issued.push(promo.id);
    } catch (e: any) {
      if (slotReserved) await promotionMetaService.releaseClaimSlot(promo.id).catch(() => {});
      const isDuplicate = e?.code === '23505' || e?.message?.includes('unique') || e?.message?.includes('duplicate');
      if (isDuplicate) {
        skipped.push({ promotion_id: promo.id, reason: 'already_issued' });
      } else {
        throw e;
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

  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.REMOTE_LINK);

  // Dismiss links between customer and promotions
  const links = promotion_ids.map((promotionId) => ({
    [Modules.CUSTOMER]: { customer_id: customerId },
    [Modules.PROMOTION]: { promotion_id: promotionId },
  }));

  await remoteLink.dismiss(links);

  return res.status(200).json({
    success: true,
    message: `${promotion_ids.length} promotion(s) removed from customer`,
    customer_id: customerId,
    promotion_ids,
  });
}
