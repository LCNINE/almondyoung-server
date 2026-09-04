import type { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, MedusaError } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../../modules/promotion-meta';
import type PromotionMetaModuleService from '../../modules/promotion-meta/service';
import type { AutoIssueTrigger } from '../../modules/promotion-meta/service';
import {
  foldGrantResults,
  selectAutoIssueCandidates,
  type AutoIssueMeta,
  type AutoIssueOutcome,
  type AutoIssuePromotion,
} from './auto-issue-selection';
import { issueCouponGrantWorkflow, type IssueGrantResult } from './workflows/issue-coupon-grant-workflow';

/**
 * 트리거 자동발급 전면 차단 스위치. **두 진입점(라우트 · subscriber)이 같은 함수를 첫 줄에서 본다** —
 * 안 그러면 이 코드의 배포가 곧 A5 개통이다. 켜는 절차는 마스터플랜 「A5 개통」.
 */
export function isAutoIssueEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.COUPON_AUTO_ISSUE_ENABLED === 'true';
}

export type AutoIssueInput = { customerId: string; trigger: AutoIssueTrigger };

/**
 * 트리거 자동발급 한 번 (#775, 스펙 §4.2.1). 읽기(고객·메타·프로모션) → 순수 판정 → 워크플로 1회.
 *
 * 워크플로로 한 겹 더 감싸지 않는다 — 쓰기는 이미 `issueCouponGrantWorkflow` 를 지나(ADR-0034 결정 2)
 * 나머지는 읽기다. `workflow-engine-redis` 는 실행마다 상태를 영속하므로 가입마다 래퍼 기록을 하나 더
 * 남길 이유가 없다.
 *
 * 🔴 실패를 **모아서** 돌려주는 이유. 요청 하나가 터졌다고 던지면 A 의 실패가 같은 고객의 B·C 발급까지
 * 막는다. 반대로 삼키면 호출자가 성공으로 읽어 **그 쿠폰은 영영 안 나간다.** 그래서 「나머지는 다 시도하고
 * 실패는 `failed` 로 보고」다 — 라우트는 그것을 500 으로, subscriber 는 카운터로 올린다. 요청 단위
 * 격리는 스텝이 해 준다(`verdict === 'error'`).
 */
export async function autoIssueCoupons(container: MedusaContainer, input: AutoIssueInput): Promise<AutoIssueOutcome> {
  const { customerId, trigger } = input;
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const promotionMetaService = container.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);

  const { data: customers } = await query.graph({
    entity: 'customer',
    fields: ['id', 'groups.id'],
    filters: { id: customerId },
  });
  if (!customers?.length) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Customer ${customerId} not found`);
  }
  const customerGroupIds = new Set<string>(
    (customers[0].groups ?? []).map((g: { id: string }) => g.id),
  );

  // `getByAutoIssueTrigger()` 는 `Promise<any[]>` 다 — 캐스트는 순수 판정(`selectAutoIssueCandidates`)이
  // 읽는 필드로 좁힐 뿐, 런타임 모양을 바꾸지 않는다.
  const metas = (await promotionMetaService.getByAutoIssueTrigger(trigger)) as AutoIssueMeta[];
  if (!metas.length) return { issued: [], skipped: [], failed: [] };

  const { data: promotions } = await query.graph({
    entity: 'promotion',
    fields: ['id', 'code', 'status', 'is_automatic', 'rules.attribute', 'rules.operator', 'rules.values.value'],
    filters: { id: metas.map((m) => m.promotion_id), status: 'active', is_automatic: false },
  });

  const selection = selectAutoIssueCandidates({
    trigger,
    customerId,
    customerGroupIds,
    metas,
    // `query.graph` 도 타입 없이 온다 — 캐스트는 위와 같은 이유로 판정이 읽는 필드로만 좁힌다.
    promotions: promotions as AutoIssuePromotion[],
    now: new Date(),
  });

  for (const u of selection.unsupportedRules) {
    logger.warn(
      `[coupon] 자동발급 skip — 발급 시점에 평가할 수 없는 룰 (promotion_id=${u.promotion_id}, ` +
        `attribute=${u.attribute}, operator=${u.operator}, customer_id=${customerId}, trigger=${trigger}). ` +
        'modules/promotion-meta/issuance-rules.ts 의 분류표에 이 속성을 추가하고 평가를 구현할 것.',
    );
  }

  // 발급은 워크플로다 (ADR-0034 결정 1) — 요청 배치가 한 번에 지나간다 (PR-2 결정 3).
  const results: IssueGrantResult[] =
    selection.requests.length > 0
      ? (await issueCouponGrantWorkflow(container).run({ input: { requests: selection.requests } })).result.results
      : [];

  const folded = foldGrantResults(results, selection.codeById);
  for (const f of folded.failed) {
    logger.error(
      `[coupon] 자동발급 실패 (promotion_id=${f.promotion_id}, customer_id=${customerId}, trigger=${trigger}): ${f.error}`,
    );
  }

  return { issued: folded.issued, skipped: [...selection.skipped, ...folded.skipped], failed: folded.failed };
}
