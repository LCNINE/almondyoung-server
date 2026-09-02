import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, Modules, MedusaError } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../../../../../../../modules/promotion-meta';
import PromotionMetaModuleService from '../../../../../../../modules/promotion-meta/service';
import { toMetadataShape } from '../../../../../../admin/promotions/helpers';
import { computeExpiresAt, issuanceWindowState } from '../../../../../../../modules/promotion-meta/validity';
import { evaluateIssuanceRules } from '../../../../../../../modules/promotion-meta/issuance-rules';

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const customerId = req.auth_context?.actor_id;

  if (!customerId) {
    return res.status(401).json({ message: 'Customer authentication required' });
  }

  const promotionId = req.params.id;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const link = req.scope.resolve(ContainerRegistrationKeys.LINK) as any;
  const promotionMetaService = req.scope.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);

  const { data: promotions } = await query.graph({
    entity: 'promotion',
    fields: ['id', 'code', 'status', 'is_automatic',
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
  // 발급 창은 캠페인이 아니라 promotion_meta 가 정한다 (#488 결정 1).
  const window = issuanceWindowState(meta, now);
  if (window === 'not_started') {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, '아직 발급받을 수 없는 쿠폰입니다.');
  }
  if (window === 'ended') {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, '발급 기간이 끝난 쿠폰입니다.');
  }

  const [{ data: customers }, allLinks] = await Promise.all([
    query.graph({
      entity: 'customer',
      fields: ['id', 'groups.id'],
      filters: { id: customerId },
    }),
    promotionMetaService.listGrantsForPromotion(promotionId),
  ]);

  // 발급 시점 룰 평가 — 판정은 modules/promotion-meta/issuance-rules.ts 하나뿐이다.
  // 옛 코드는 여기에 그룹 룰 검사를 손으로 복제해 뒀고, 그래서 `meetsGroupRule` 을 grep 해도
  // 이 자리가 안 잡혔다 (#488 7-3 이 말하는 «샌 계약» 의 축소판).
  const customerGroupIds = new Set<string>((customers?.[0]?.groups ?? []).map((g: any) => g.id));
  const eligibility = evaluateIssuanceRules(promotion.rules, customerGroupIds);
  if (!eligibility.eligible) {
    if (eligibility.reason === 'unsupported_rule') {
      req.scope
        .resolve(ContainerRegistrationKeys.LOGGER)
        .warn(
          `[coupon] 클레임 거부 — 발급 시점에 평가할 수 없는 룰 (promotion_id=${promotionId}, ` +
            `attribute=${eligibility.attribute}, operator=${eligibility.operator}, ` +
            `customer_id=${customerId}).`,
        );
    }
    // 고객에게는 사유를 구별해 주지 않는다 — 스토어프론트가 닫힌 어휘를 읽는다.
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, '이 쿠폰은 대상 고객만 발급받을 수 있습니다.');
  }

  const maxClaims = metaShape?.max_claims != null ? Number(metaShape.max_claims) : null;

  if (maxClaims !== null) {
    // Fast check: catch already-exhausted promotions (covers pre-migration links)
    if (allLinks.length >= maxClaims) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, '발급 수량이 모두 소진되었습니다.');
    }
    // Atomic slot reservation: prevents concurrent overclaims
    const slot = await promotionMetaService.reserveClaimSlot(promotionId, maxClaims);
    if (slot === 'exhausted') {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, '발급 수량이 모두 소진되었습니다.');
    }
  }

  let result: 'created' | 'duplicate';
  try {
    result = await promotionMetaService.issueGrant({
      promotion_id: promotionId,
      customer_id: customerId,
      issue_key: 'claim', // 클레임은 영구 1장 — 따닥 방어가 DB 레벨이다.
      issued_via: 'customer_claim',
      expires_at: computeExpiresAt(meta, now),
      now,
    });
  } catch (e: any) {
    if (maxClaims !== null) await promotionMetaService.releaseClaimSlot(promotionId).catch(() => {});
    throw e;
  }

  if (result === 'duplicate') {
    // 이미 받았다. 슬롯을 잡았다면 반환한다 — 이게 없으면 따닥 한 번에 2명분이 소진된다.
    if (maxClaims !== null) await promotionMetaService.releaseClaimSlot(promotionId).catch(() => {});
    return res.status(200).json({ success: true, promotion_id: promotionId });
  }

  await link.create([{
    [Modules.CUSTOMER]: { customer_id: customerId },
    [Modules.PROMOTION]: { promotion_id: promotionId },
  }]).catch(() => {});

  return res.status(200).json({ success: true, promotion_id: promotionId });
}
