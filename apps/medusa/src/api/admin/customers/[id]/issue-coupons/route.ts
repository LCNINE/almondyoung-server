import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, Modules, MedusaError } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../../../../../modules/promotion-meta';
import type PromotionMetaModuleService from '../../../../../modules/promotion-meta/service';
import type { AutoIssueTrigger } from '../../../../../modules/promotion-meta/service';
import { meetsGroupRule } from '../../../promotions/helpers';

const VALID_TRIGGERS: AutoIssueTrigger[] = ['customer_registered', 'membership_activated', 'birthday'];

/**
 * POST /admin/customers/:id/issue-coupons
 * 트리거 기반 자동 발급: 지정 트리거에 등록된 활성 프로모션을 고객에게 발급합니다.
 * channel-adapter에서 Kafka 이벤트 수신 후 호출합니다.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const customerId = req.params.id;
  const { trigger } = req.body as { trigger: AutoIssueTrigger };

  if (!trigger || !VALID_TRIGGERS.includes(trigger)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `trigger must be one of: ${VALID_TRIGGERS.join(', ')}`,
    );
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.REMOTE_LINK);
  const promotionMetaService = req.scope.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);

  const { data: customers } = await query.graph({
    entity: 'customer',
    fields: ['id', 'groups.id'],
    filters: { id: customerId },
  });

  if (!customers?.length) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Customer ${customerId} not found`);
  }

  const customerGroupIds = new Set<string>(
    (customers[0].groups ?? []).map((g: any) => g.id as string),
  );

  const metaRecords = await promotionMetaService.getByAutoIssueTrigger(trigger);
  if (!metaRecords.length) {
    return res.status(200).json({ issued: [], skipped: [] });
  }

  const promotionIds = metaRecords.map((m: any) => m.promotion_id);
  const { data: promotions } = await query.graph({
    entity: 'promotion',
    fields: [
      'id', 'code', 'status', 'is_automatic',
      'campaign.starts_at', 'campaign.ends_at',
      'rules.attribute', 'rules.operator', 'rules.values.value',
    ],
    filters: { id: promotionIds, status: 'active', is_automatic: false },
  });

  const now = new Date();
  const validPromotions = (promotions as any[]).filter((p) => {
    if (!meetsGroupRule(p, customerGroupIds)) return false;
    if (!p.campaign) return true;
    const starts = p.campaign.starts_at ? new Date(p.campaign.starts_at) : null;
    const ends = p.campaign.ends_at ? new Date(p.campaign.ends_at) : null;
    if (starts && now < starts) return false;
    if (ends && now > ends) return false;
    return true;
  });

  const issued: { promotion_id: string; code: string }[] = [];
  const skipped: { promotion_id: string; reason: string }[] = [];

  for (const promo of validPromotions) {
    const meta = metaRecords.find((m: any) => m.promotion_id === promo.id);
    if (!meta) continue;

    const alreadyIssued = await promotionMetaService.isAlreadyIssued(customerId, promo.id);
    if (alreadyIssued) {
      skipped.push({ promotion_id: promo.id, reason: 'already_issued' });
      continue;
    }

    if (meta.max_claims != null) {
      const slot = await promotionMetaService.reserveClaimSlot(promo.id, Number(meta.max_claims));
      if (slot === 'exhausted') {
        skipped.push({ promotion_id: promo.id, reason: 'max_claims_exceeded' });
        continue;
      }
    }

    try {
      await (remoteLink as any).create([{
        [Modules.CUSTOMER]: { customer_id: customerId },
        [Modules.PROMOTION]: { promotion_id: promo.id },
      }]);
      await promotionMetaService.recordIssue(customerId, promo.id, trigger);
      issued.push({ promotion_id: promo.id, code: promo.code });
    } catch (e: any) {
      const isDuplicate = e?.code === '23505' || e?.message?.includes('unique') || e?.message?.includes('duplicate');
      if (isDuplicate) {
        if (meta.max_claims != null) await promotionMetaService.releaseClaimSlot(promo.id).catch(() => {});
        await promotionMetaService.recordIssue(customerId, promo.id, trigger).catch(() => {});
        skipped.push({ promotion_id: promo.id, reason: 'already_issued' });
      } else {
        if (meta.max_claims != null) await promotionMetaService.releaseClaimSlot(promo.id).catch(() => {});
        // Transient DB/Link error → 500으로 올려서 channel-adapter가 재시도하게 함.
        // isAlreadyIssued 체크로 재시도는 멱등하게 처리됨.
        throw e;
      }
    }
  }

  return res.status(200).json({ issued, skipped });
}
