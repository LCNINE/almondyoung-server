import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, MedusaError } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../../../../../../../modules/promotion-meta';
import PromotionMetaModuleService from '../../../../../../../modules/promotion-meta/service';
import { toMetadataShape } from '../../../../../../admin/promotions/helpers';
import { computeExpiresAt, issuanceWindowState } from '../../../../../../../modules/promotion-meta/validity';
import { evaluateIssuanceRules } from '../../../../../../../modules/promotion-meta/issuance-rules';
import { issueCouponGrantWorkflow } from '../../../../../../../workflows/coupons/workflows/issue-coupon-grant-workflow';

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const customerId = req.auth_context?.actor_id;

  if (!customerId) {
    return res.status(401).json({ message: 'Customer authentication required' });
  }

  const promotionId = req.params.id;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
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

  // 🔴 「이미 가지고 있다」는 소진 검사보다 **먼저** 판정돼야 한다 (스펙 §5.1 의 200 계약).
  //
  // 클레임의 `issue_key` 는 `'claim'` 고정이라 한 고객당 영원히 한 장이고, 아래 원자 경로는
  // 재클릭에 반드시 `'duplicate'` 를 돌려준다. 그런데 **읽기 기반 소진 거절**이 그 앞에
  // 있으면, 소진된 쿠폰에서 이미 받은 사람이 재클릭할 때 「발급 수량이 모두 소진되었습니다」가
  // 나간다. 그래서 그 빠른 거절은 «새로 받으려는 사람» 에게만 적용한다.
  //
  // 🔴 옛 코드는 여기서 아예 `return 200` 으로 빠져나갔는데, 그게 링크 복구를 영영 막았다 —
  // 링크 생성이 한 번 실패해 「장은 있는데 쿠폰함에 안 보이는」 상태가 되면, 재클릭이 이
  // 조기 반환에 걸려 링크를 다시 만들 기회가 없었다(그 코드 주석도 「로그가 유일한 단서다」라고
  // 인정했다). 이제는 이미 가진 사람도 워크플로를 그대로 지나가고, `createRemoteLinkStep` 의
  // upsert 가 링크를 복구한다.
  const myLiveGrants = allLinks.filter((g) => g.customer_id === customerId);
  const alreadyHolds = myLiveGrants.length > 0;

  const maxClaims = metaShape?.max_claims != null ? Number(metaShape.max_claims) : null;

  // 읽기 기반 빠른 거절(백필 이전 링크까지 덮는다). 최종 권위는 아래 원자 경로다.
  if (!alreadyHolds && maxClaims !== null && allLinks.length >= maxClaims) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, '발급 수량이 모두 소진되었습니다.');
  }

  // 발급·슬롯·표시용 링크가 한 워크플로다 (ADR-0034 결정 1·2). 링크가 실패하면 장까지
  // 되감기므로 「받았는데 쿠폰함에 안 보이는」 쿠폰이 만들어지지 않는다 — 고객은 실패를
  // 보고 다시 누르면 되고, 그 재시도는 `issue_key` 가 고정이라 멱등하다.
  const { result: outcome } = await issueCouponGrantWorkflow(req.scope).run({
    input: {
      promotion_id: promotionId,
      customer_id: customerId,
      issue_keys: ['claim'], // 클레임은 영구 1장 — 따닥 방어가 DB 레벨이다.
      issued_via: 'customer_claim',
      expires_at: computeExpiresAt(meta, now)?.toISOString() ?? null,
      max_claims: maxClaims,
      enforce_cap: true,
    },
  });

  if (outcome.exhausted) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, '발급 수량이 모두 소진되었습니다.');
  }

  // `duplicate` 든 `created` 든 200 이다 — 재클릭은 성공으로 보이는 것이 맞고, 슬롯 증가는
  // 중복일 때 트랜잭션과 함께 되감겼다(따닥 한 번에 2명분이 소진되지 않는다).
  return res.status(200).json({ success: true, promotion_id: promotionId });
}
