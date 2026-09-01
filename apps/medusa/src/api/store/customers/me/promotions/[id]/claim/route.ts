import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, Modules, MedusaError } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../../../../../../../modules/promotion-meta';
import PromotionMetaModuleService from '../../../../../../../modules/promotion-meta/service';
import { toMetadataShape } from '../../../../../../admin/promotions/helpers';
import { computeExpiresAt, issuanceWindowState } from '../../../../../../../modules/promotion-meta/validity';
import { evaluateIssuanceRules } from '../../../../../../../modules/promotion-meta/issuance-rules';

type LinkRecord = { customer_id: string; promotion_id: string };

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

  const linkModule = link.getLinkModule(
    Modules.CUSTOMER, 'customer_id', Modules.PROMOTION, 'promotion_id',
  );

  const [{ data: customers }, allLinks] = await Promise.all([
    query.graph({
      entity: 'customer',
      fields: ['id', 'promotions.id', 'groups.id'],
      filters: { id: customerId },
    }),
    linkModule.list({ promotion_id: promotionId }, { select: ['customer_id'] }) as Promise<LinkRecord[]>,
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

  const alreadyClaimed = (customers?.[0]?.promotions ?? []).some((p: any) => p.id === promotionId);

  if (alreadyClaimed) {
    return res.status(200).json({ success: true, promotion_id: promotionId });
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

  try {
    await link.create([{
      [Modules.CUSTOMER]: { customer_id: customerId },
      [Modules.PROMOTION]: { promotion_id: promotionId },
      data: {
        expires_at: computeExpiresAt(meta, now),
        issued_via: 'customer_claim',
        used_at: null,
        order_id: null,
      },
    }]);
  } catch (e: any) {
    // Link.create 는 복합 PK upsert 라 중복이 예외가 되지 않는다
    // (integration-tests/http/coupon-validity.spec.ts T3 로 실측). 여기 오는 것은 진짜 장애다.
    if (maxClaims !== null) await promotionMetaService.releaseClaimSlot(promotionId).catch(() => {});
    throw e;
  }

  // Audit log: customer self-claim
  await promotionMetaService.recordIssue(customerId, promotionId, 'customer_claim').catch(() => {});

  return res.status(200).json({ success: true, promotion_id: promotionId });
}
