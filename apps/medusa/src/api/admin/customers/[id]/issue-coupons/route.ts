import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, Modules, MedusaError } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../../../../../modules/promotion-meta';
import type PromotionMetaModuleService from '../../../../../modules/promotion-meta/service';
import type { AutoIssueTrigger } from '../../../../../modules/promotion-meta/service';
import { computeExpiresAt, issuanceWindowState } from '../../../../../modules/promotion-meta/validity';
import { evaluateIssuanceRules } from '../../../../../modules/promotion-meta/issuance-rules';
import { resolveVisibility } from '../../../promotions/helpers';

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

    // 🔴 `public` 쿠폰에 트리거를 걸어두면 가입자 전원에게 장이 한 장씩 생기고, 카트 게이트가
    // 「장이 있으면 장이 정한다」로 갈리는 탓에 **그 전원이** 1회 제한에 걸린다 — 아무나 쓰라고
    // 만든 쿠폰이 자동발급을 켠 순간 1인 1회 쿠폰이 된다 (#488 A2). 수동 발급 두 라우트와
    // 같은 사유·같은 판단이다.
    if (resolveVisibility(meta) === 'public') {
      skipped.push({ promotion_id: promo.id, reason: 'public_promotion' });
      continue;
    }

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

    if (meta.max_claims != null) {
      const slot = await promotionMetaService.reserveClaimSlot(promo.id, Number(meta.max_claims));
      if (slot === 'exhausted') {
        skipped.push({ promotion_id: promo.id, reason: 'max_claims_exceeded' });
        continue;
      }
    }

    let result: 'created' | 'duplicate';
    try {
      result = await promotionMetaService.issueGrant({
        promotion_id: promo.id,
        customer_id: customerId,
        // 트리거당 한 장. 결정적 키라 channel-adapter 재시도가 멱등하다.
        issue_key: `trigger:${trigger}`,
        issued_via: trigger,
        expires_at: computeExpiresAt(meta, now),
        now,
      });
    } catch (e: any) {
      if (meta.max_claims != null) {
        await promotionMetaService.releaseClaimSlot(promo.id).catch(() => {});
      }
      // Transient DB 에러 → 500 으로 올려 channel-adapter 가 재시도하게 한다.
      // 재시도는 위 결정적 issue_key 덕에 멱등하다.
      throw e;
    }

    if (result === 'duplicate') {
      if (meta.max_claims != null) {
        await promotionMetaService.releaseClaimSlot(promo.id).catch(() => {});
      }
      skipped.push({ promotion_id: promo.id, reason: 'already_issued' });
      continue;
    }

    // 🔴 링크 생성 실패를 조용히 삼키면 「장은 있는데 어디에도 안 보이는 쿠폰」이 된다 —
    // 마이페이지(`/store/customers/me/promotions`)도 어드민 고객 상세도 링크 행으로
    // 열거하기 때문이다. 여기는 사람이 안 보는 자동 경로라 로그가 유일한 흔적이다.
    // 사유 집합은 늘리지 않는다 — channel-adapter 가 이 응답의 `skipped.reason` 을
    // 메트릭으로 세므로, 새 값은 그쪽 계약 변경이다.
    await (link as any).create([{
      [Modules.CUSTOMER]: { customer_id: customerId },
      [Modules.PROMOTION]: { promotion_id: promo.id },
    }]).catch((e: any) => {
      logger.warn(
        `[coupon] 자동발급 link 생성 실패 — 장은 만들어졌으나 목록에 안 보인다 ` +
          `(promotion_id=${promo.id}, customer_id=${customerId}, trigger=${trigger}): ${e?.message ?? e}`,
      );
    });
    issued.push({ promotion_id: promo.id, code: promo.code });
  }

  return res.status(200).json({ issued, skipped });
}
