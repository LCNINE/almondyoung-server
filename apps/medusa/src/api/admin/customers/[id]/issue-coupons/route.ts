import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { MedusaError } from '@medusajs/framework/utils';
import type { AutoIssueTrigger } from '../../../../../modules/promotion-meta/service';
import { autoIssueCoupons, isAutoIssueEnabled } from '../../../../../workflows/coupons/auto-issue-coupons';

// 🔴 이름을 바꾸지 말 것 — packages/domain-types/coupon-vocabulary-drift.spec.ts 가 이 상수를 앵커로 읽는다.
const VALID_TRIGGERS: AutoIssueTrigger[] = ['customer_registered', 'membership_activated'];

/**
 * POST /admin/customers/:id/issue-coupons
 * 트리거 기반 자동 발급: 지정 트리거에 등록된 활성 프로모션을 고객에게 발급한다.
 *
 * 두 역할이다 (#775):
 * - `membership_activated` 의 정상 입구 — channel-adapter 가 `MembershipStatusChanged` inbox 에서 부른다.
 * - `customer_registered` 의 **수동 복구 입구** — 정상 입구는 `subscribers/coupon-auto-issue-on-customer-created.ts`
 *   이고 재시도가 없으므로, 그 subscriber 가 실패 로그를 남기면 사람이 이 라우트를 한 번 부른다.
 *   발급 키가 결정적이라 몇 번 불러도 한 장이다.
 *
 * 판정·발급은 `workflows/coupons/auto-issue-coupons.ts` 가 한다. 여기엔 플래그 게이트·입력 검증·응답 모양만
 * 남는다 (ADR-0034 결정 3).
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const customerId = req.params.id;
  const { trigger } = req.body as { trigger: AutoIssueTrigger };

  // 트리거 자동발급 전면 차단. COUPON_AUTO_ISSUE_ENABLED=true 로만 켠다.
  // 200 + empty 로 응답해 channel-adapter 가 published 로 마킹하고 재시도하지 않게 한다.
  if (!isAutoIssueEnabled()) {
    return res.status(200).json({ issued: [], skipped: [] });
  }

  if (!trigger || !VALID_TRIGGERS.includes(trigger)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `trigger must be one of: ${VALID_TRIGGERS.join(', ')}`);
  }

  const { issued, skipped, failed } = await autoIssueCoupons(req.scope, { customerId, trigger });

  if (failed.length > 0) {
    // 사유 집합은 늘리지 않는다 — channel-adapter 가 `skipped.reason` 을 메트릭으로 세므로
    // 새 값은 그쪽 계약 변경이다. 실패는 200 의 사유가 아니라 500 으로 알린다.
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `자동발급 실패 ${failed.length}건 (promotion_ids=${failed.map((f) => f.promotion_id).join(',')}, customer_id=${customerId}, trigger=${trigger})`,
    );
  }

  return res.status(200).json({ issued, skipped });
}
