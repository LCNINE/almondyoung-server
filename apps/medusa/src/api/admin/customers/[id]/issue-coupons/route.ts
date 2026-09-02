import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, Modules, MedusaError } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../../../../../modules/promotion-meta';
import type PromotionMetaModuleService from '../../../../../modules/promotion-meta/service';
import type { AutoIssueTrigger } from '../../../../../modules/promotion-meta/service';
import { computeExpiresAt, issuanceWindowState } from '../../../../../modules/promotion-meta/validity';
import { evaluateIssuanceRules } from '../../../../../modules/promotion-meta/issuance-rules';

const VALID_TRIGGERS: AutoIssueTrigger[] = ['customer_registered', 'membership_activated'];

/**
 * POST /admin/customers/:id/issue-coupons
 * 트리거 기반 자동 발급: 지정 트리거에 등록된 활성 프로모션을 고객에게 발급합니다.
 * channel-adapter에서 Kafka 이벤트 수신 후 호출합니다.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const customerId = req.params.id;
  const { trigger } = req.body as { trigger: AutoIssueTrigger };

  // 트리거 자동발급 전면 차단. COUPON_AUTO_ISSUE_ENABLED=true 로만 켠다.
  // 200 + empty 로 응답해 channel-adapter 가 published 로 마킹하고 재시도하지 않게 한다.
  if (process.env.COUPON_AUTO_ISSUE_ENABLED !== 'true') {
    return res.status(200).json({ issued: [], skipped: [] });
  }

  if (!trigger || !VALID_TRIGGERS.includes(trigger)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `trigger must be one of: ${VALID_TRIGGERS.join(', ')}`,
    );
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const link = req.scope.resolve(ContainerRegistrationKeys.LINK);
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
      'rules.attribute', 'rules.operator', 'rules.values.value',
    ],
    filters: { id: promotionIds, status: 'active', is_automatic: false },
  });

  const now = new Date();
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);
  const metaById = new Map<string, any>(metaRecords.map((m: any) => [m.promotion_id, m]));

  const issued: { promotion_id: string; code: string }[] = [];
  const skipped: { promotion_id: string; reason: string }[] = [];

  // 옛 코드는 창·그룹 불일치를 `filter` 로 조용히 떨어뜨려 응답에 흔적이 없었다. 자동발급은
  // 사람이 안 보는 경로라 그 침묵이 곧 «발급이 안 된 이유를 아무도 모름» 이었다 — 이제
  // 수동 경로처럼 사유를 실어 보내고, channel-adapter 가 그것을 메트릭으로 센다(#488 7-4).
  for (const promo of promotions as any[]) {
    const meta = metaById.get(promo.id);
    if (!meta) continue;

    // 발급 창은 캠페인이 아니라 promotion_meta 가 정한다 (#488 결정 1).
    const window = issuanceWindowState(meta, now);
    if (window !== 'ok') {
      skipped.push({
        promotion_id: promo.id,
        reason: window === 'not_started' ? 'not_started' : 'expired',
      });
      continue;
    }

    // 분류표 밖 룰은 fail-closed (#488 1-5). 근거는 issuance-rules.ts 헤더 주석.
    const eligibility = evaluateIssuanceRules(promo.rules, customerGroupIds);
    if (!eligibility.eligible) {
      if (eligibility.reason === 'unsupported_rule') {
        logger.warn(
          `[coupon] 자동발급 skip — 발급 시점에 평가할 수 없는 룰 (promotion_id=${promo.id}, ` +
            `attribute=${eligibility.attribute}, operator=${eligibility.operator}, ` +
            `customer_id=${customerId}, trigger=${trigger}). ` +
            'modules/promotion-meta/issuance-rules.ts 의 분류표에 이 속성을 추가하고 평가를 구현할 것.',
        );
      }
      skipped.push({ promotion_id: promo.id, reason: eligibility.reason });
      continue;
    }

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

    let linkCreated = false;
    try {
      await (link as any).create([{
        [Modules.CUSTOMER]: { customer_id: customerId },
        [Modules.PROMOTION]: { promotion_id: promo.id },
        data: {
          expires_at: computeExpiresAt(meta, now),
          issued_via: trigger,
          used_at: null,
          order_id: null,
        },
      }]);
      linkCreated = true;
      await promotionMetaService.recordIssue(customerId, promo.id, trigger);
      issued.push({ promotion_id: promo.id, code: promo.code });
    } catch (e: any) {
      // Link.create 는 복합 PK upsert 라 중복이 예외가 되지 않는다
      // (integration-tests/http/coupon-validity.spec.ts T3 로 실측). 여기 오는 것은 진짜 장애다.
      // 슬롯 반환은 링크가 생성되지 않은 경우에만 한다.
      // 링크는 생겼는데 recordIssue 만 실패(transient)한 경우엔 슬롯을 유지해야
      // issued_count 가 실제 링크 수와 정합 — 재시도는 recordIssue 만 멱등 보정한다.
      if (meta.max_claims != null && !linkCreated) {
        await promotionMetaService.releaseClaimSlot(promo.id).catch(() => {});
      }
      // Transient DB/Link error → 500으로 올려서 channel-adapter가 재시도하게 함.
      // isAlreadyIssued 체크로 재시도는 멱등하게 처리됨.
      throw e;
    }
  }

  return res.status(200).json({ issued, skipped });
}
