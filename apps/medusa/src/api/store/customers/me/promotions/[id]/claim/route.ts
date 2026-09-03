import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, MedusaError } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../../../../../../../modules/promotion-meta';
import PromotionMetaModuleService from '../../../../../../../modules/promotion-meta/service';
import { toMetadataShape } from '../../../../../../admin/promotions/helpers';
import { computeExpiresAt, issuanceWindowState } from '../../../../../../../modules/promotion-meta/validity';
import { evaluateIssuanceRules } from '../../../../../../../modules/promotion-meta/issuance-rules';
import { grantsFor, hasUsableGrant } from '../../../../../../../modules/promotion-meta/grants';
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

  const [{ data: customers }, grants] = await Promise.all([
    query.graph({
      entity: 'customer',
      fields: ['id', 'groups.id'],
      filters: { id: customerId },
    }),
    promotionMetaService.listGrantsForCustomer(customerId),
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
  // Task 7: 이 빠른 경로는 한때 있다가 사라졌었다 — customer↔promotion 링크가 살아 있던
  // 시절에는 여기서 200 으로 빠져나가면 링크 복구 기회(워크플로를 다시 지나가야만 도는
  // `createRemoteLinkStep` 의 upsert)를 영영 잃었다. 이제 그 링크 자체가 없다(ADR-0034
  // 결정 2 완료) — 복구할 게 없으니 다시 빠른 경로로 끝나도 안전하다.
  const myGrants = grantsFor(grants, promotionId);
  if (hasUsableGrant(myGrants, now)) {
    return res.status(200).json({ success: true, promotion_id: promotionId, issued: false, reason: 'already_issued' });
  }

  const maxClaims = metaShape?.max_claims != null ? Number(metaShape.max_claims) : null;

  // 읽기 기반 빠른 거절. 최종 권위는 아래 원자 경로다 — 이 카운트와 실제 발급 사이 레이스는
  // `issueGrantWithSlot` 의 `enforce_cap` 이 잡는다.
  //
  // 🔴 `myGrants.length === 0` 를 반드시 같이 본다 — «usable 한 장이 없다» 가 «이 쿠폰과
  // 아무 관계가 없다» 를 뜻하지 않는다. 이미 쓴 장을 가진 고객이 재클릭하면 `myGrants` 는
  // 비지 않지만 `hasUsableGrant` 는 false 라 위 빠른 경로를 못 탄다. `issue_key` 가
  // `'claim'` 고정이라 그 재시도는 원자 경로에서 반드시 `duplicate` 로 끝나는데
  // (`중복은 상한보다 먼저 판정된다`, service.integration.spec.ts), 그 앞에서 이 카운트가
  // 먼저 던지면 소진된 쿠폰을 이미 써버린 자기 자신에게 「소진되었습니다」가 나간다 — 스펙
  // §5.1 의 200 계약을 새로 가진 grant 만 아는 사람에게 위반하는 셈이다. «새로 받으려는
  // 사람»(이 쿠폰의 grant 가 하나도 없는 사람)만 이 조회를 문다.
  if (myGrants.length === 0 && maxClaims !== null) {
    const issuedCount = await promotionMetaService.countIssuedGrants(promotionId);
    if (issuedCount >= maxClaims) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, '발급 수량이 모두 소진되었습니다.');
    }
  }

  // 발급은 워크플로다 (ADR-0034 결정 1) — 표시용 링크 스텝은 Task 7 로 사라졌다. 실패하면
  // 고객은 다시 누르면 되고, 그 재시도는 `issue_key` 가 고정이라 멱등하다.
  const {
    result: {
      results: [outcome],
    },
  } = await issueCouponGrantWorkflow(req.scope).run({
    input: {
      requests: [
        {
          promotion_id: promotionId,
          customer_id: customerId,
          issue_keys: ['claim'], // 클레임은 영구 1장 — 따닥 방어가 DB 레벨이다.
          issued_via: 'customer_claim',
          expires_at: computeExpiresAt(meta, now)?.toISOString() ?? null,
          max_claims: maxClaims,
          enforce_cap: true,
        },
      ],
    },
  });

  // 200 본문은 빠른 경로와 **같은 모양**이다 (PR-2 결정 4). `issued` 가 이번 클릭이 장을 만들었는지,
  // `reason` 은 안 만들었을 때만 붙는다. 재클릭은 성공으로 보이는 것이 맞고, 슬롯 증가는 중복일 때
  // 트랜잭션과 함께 되감겼다(따닥 한 번에 2명분이 소진되지 않는다).
  switch (outcome.verdict) {
    case 'error':
      // 🔴 `outcome.error` 는 스토어프론트에 나가면 안 된다 — Medusa 의 error-handler 는
      // `UNEXPECTED_STATE` 메시지를 **가리지 않고 그대로** 내보내므로, DB 에러 문구·테이블 이름이
      // 고객 브라우저까지 간다. 원인은 서버 로그에만 남기고 고객에겐 일반 문구를 준다.
      req.scope
        .resolve(ContainerRegistrationKeys.LOGGER)
        .error(
          `[coupon] 클레임 발급 실패 (promotion_id=${promotionId}, customer_id=${customerId}): ${outcome.error}`,
        );
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        '쿠폰 발급 처리 중 오류가 발생했습니다. 다시 시도해주세요.',
      );
    case 'exhausted':
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, '발급 수량이 모두 소진되었습니다.');
    case 'already_issued':
      return res
        .status(200)
        .json({ success: true, promotion_id: promotionId, issued: false, reason: 'already_issued' });
    case 'issued':
    case 'partial':
      // `partial` 은 키가 `['claim']` 하나뿐이라 나올 수 없다 — 그래도 어휘가 닫혀 있으니 같은 칸에
      // 둔다. 나오더라도 장은 «만들어졌으므로» `issued: true` 가 맞다.
      return res.status(200).json({ success: true, promotion_id: promotionId, issued: true });
    default: {
      // 어휘가 늘었는데 여기 분기를 안 더하면 컴파일이 막는다 — 안 그러면 그 항목은 issued 에도
      // skipped 에도 없는 「응답에 없는 항목」이 되어 화면이 조용히 '발급할 수 없습니다' 로 뭉갠다.
      const exhaustive: never = outcome.verdict;
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `알 수 없는 발급 결과: ${String(exhaustive)}`);
    }
  }
}
