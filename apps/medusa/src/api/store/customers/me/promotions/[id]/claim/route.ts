import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, Modules, MedusaError } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../../../../../../../modules/promotion-meta';
import PromotionMetaModuleService from '../../../../../../../modules/promotion-meta/service';
import { toMetadataShape } from '../../../../../../admin/promotions/helpers';

type LinkRecord = { customer_id: string; promotion_id: string };

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const customerId = req.auth_context?.actor_id;

  if (!customerId) {
    return res.status(401).json({ message: 'Customer authentication required' });
  }

  const promotionId = req.params.id;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.REMOTE_LINK);
  const promotionMetaService = req.scope.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);

  const { data: promotions } = await query.graph({
    entity: 'promotion',
    fields: ['id', 'code', 'status', 'is_automatic', 'campaign.starts_at', 'campaign.ends_at',
      'rules.attribute', 'rules.operator', 'rules.values.value'],
    filters: { id: promotionId },
  });

  const promotion = promotions?.[0];
  if (!promotion) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, 'Promotion not found');
  }

  const meta = await promotionMetaService.getByPromotionId(promotionId);
  const metaShape = toMetadataShape(meta);

  if (metaShape?.visibility !== 'claimable') {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, '이 쿠폰은 발급받기가 불가능합니다.');
  }

  if (promotion.status !== 'active' || promotion.is_automatic) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, '발급받을 수 없는 쿠폰입니다.');
  }

  const now = new Date();
  if (promotion.campaign) {
    const startsAt = promotion.campaign.starts_at ? new Date(promotion.campaign.starts_at) : null;
    const endsAt = promotion.campaign.ends_at ? new Date(promotion.campaign.ends_at) : null;
    if (startsAt && now < startsAt) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, '아직 발급받을 수 없는 쿠폰입니다.');
    }
    if (endsAt && now > endsAt) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, '기간이 만료된 쿠폰입니다.');
    }
  }

  const linkModule = (req.scope.resolve(ContainerRegistrationKeys.LINK) as any)
    .getLinkModule(Modules.CUSTOMER, 'customer_id', Modules.PROMOTION, 'promotion_id');

  const [{ data: customers }, allLinks] = await Promise.all([
    query.graph({
      entity: 'customer',
      fields: ['id', 'promotions.id', 'groups.id'],
      filters: { id: customerId },
    }),
    linkModule.list({ promotion_id: promotionId }, { select: ['customer_id'] }) as Promise<LinkRecord[]>,
  ]);

  // 고객 그룹 rule 검증: promotion에 customer.groups.id 룰이 있으면 고객이 해당 그룹에 속해야 함
  const groupRule = (promotion.rules ?? []).find(
    (r: any) => r.attribute === 'customer.groups.id' && r.operator === 'in',
  );
  if (groupRule) {
    const requiredGroupIds = new Set<string>(
      (groupRule.values ?? []).map((v: any) => (typeof v === 'string' ? v : v?.value)),
    );
    const customerGroupIds = new Set<string>((customers?.[0]?.groups ?? []).map((g: any) => g.id));
    const hasGroup = [...requiredGroupIds].some((gid) => customerGroupIds.has(gid));
    if (!hasGroup) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, '이 쿠폰은 대상 고객만 발급받을 수 있습니다.');
    }
  }

  const alreadyClaimed = (customers?.[0]?.promotions ?? []).some((p: any) => p.id === promotionId);

  if (alreadyClaimed) {
    return res.status(200).json({ success: true, promotion_id: promotionId });
  }

  // max_claims 검증 (단순 count 방식 — 고트래픽 선착순 쿠폰은 별도 atomic counter 필요)
  const maxClaims = metaShape?.max_claims != null ? Number(metaShape.max_claims) : null;
  if (maxClaims !== null && allLinks.length >= maxClaims) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, '발급 수량이 모두 소진되었습니다.');
  }

  try {
    await (remoteLink as any).create([{
      [Modules.CUSTOMER]: { customer_id: customerId },
      [Modules.PROMOTION]: { promotion_id: promotionId },
    }]);
  } catch (e: any) {
    // unique constraint violation → 동시 요청에서 이미 발급 처리된 경우, idempotent하게 성공 반환
    const isUniqueViolation =
      e?.code === '23505' || e?.message?.includes('unique') || e?.message?.includes('duplicate');
    if (!isUniqueViolation) throw e;
  }

  return res.status(200).json({ success: true, promotion_id: promotionId });
}
