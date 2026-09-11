/**
 * 배송이 끝났을 법한 주문에 **리뷰 자격을 발급**한다.
 *
 * 지금 자격은 고객이 마이페이지에서 구매확정을 눌러야만 생기고, 라이브 `review_eligibilities` 는
 * 0행이다. 결제 매입은 이미 체크아웃에서 끝나 있어(실측) 구매확정 버튼에 남은 실질이 자격 발급
 * 하나뿐이라, 이 잡은 **결제 경로를 타지 않고 자격만** 만든다. 판정 규칙과 근거는
 * `lib/auto-review-eligibility.ts`.
 *
 * 🔴 **기본은 꺼져 있다.** `ELIGIBILITY_AUTO_ISSUE=true` 가 아니면 후보를 세고 로그만 남긴다.
 * 처음 켜기 전에 꺼진 채로 한 번 돌려 건수를 본다.
 *
 * **과거분 밀어주기**는 별도 코드가 없다 — 창을 크게 준 채 한 번 돌리면 된다:
 *   ELIGIBILITY_AUTO_ISSUE=true ELIGIBILITY_WINDOW_DAYS=120 ELIGIBILITY_BATCH=500 \
 *     npx medusa exec ./src/scripts/auto-review-eligibility.ts
 *
 * 평시 실행:
 *   npx medusa exec ./src/scripts/auto-review-eligibility.ts
 */
import type { ExecArgs } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { createReviewEligibility } from '../workflows/orders/steps/create-review-eligibility-step';
import {
  ELIGIBILITY_BATCH,
  ELIGIBILITY_CANDIDATE_SQL,
  ELIGIBILITY_ISSUED_METADATA_KEY,
  type EligibilityCandidate,
  candidateWindowStart,
  eligibilityIssuingEnabled,
  judgeEligibility,
} from './lib/auto-review-eligibility';

export interface AutoEligibilitySummary {
  enabled: boolean;
  scanned: number;
  eligible: number;
  issued: number;
  failed: number;
  /** 발급하지 않은 사유별 건수. 「0으로 뭉개지 않는다」 — 왜 안 했는지가 남아야 한다. */
  skipped: Record<string, number>;
  /** 어느 단으로 판정했는지. 물류연동이 붙으면 order_age 가 줄고 delivered 가 늘어야 한다. */
  basis: Record<string, number>;
}

type OrderForIssue = {
  id: string;
  customer_id?: string | null;
  items?: Array<{
    id: string;
    product_id: string;
    unit_price?: number | string | null;
    detail?: { quantity?: number | string | null } | null;
    adjustments?: Array<{ amount?: number | string | null }> | null;
  }>;
};

export default async function autoReviewEligibility({ container }: ExecArgs): Promise<AutoEligibilitySummary> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const orderModule = container.resolve(Modules.ORDER);

  const now = new Date();
  const summary: AutoEligibilitySummary = {
    enabled: eligibilityIssuingEnabled(),
    scanned: 0,
    eligible: 0,
    issued: 0,
    failed: 0,
    skipped: {},
    basis: {},
  };

  const result =
    (await (knex as { raw: (sql: string, bindings: unknown[]) => Promise<{ rows?: EligibilityCandidate[] }> }).raw(
      ELIGIBILITY_CANDIDATE_SQL,
      [candidateWindowStart(now).toISOString(), ELIGIBILITY_BATCH],
    )) ?? {};
  const candidates: EligibilityCandidate[] = result.rows ?? [];
  summary.scanned = candidates.length;

  if (candidates.length >= ELIGIBILITY_BATCH) {
    // 조용한 절단 금지: 상한에 걸렸으면 뒤쪽 주문은 이번 회차에서 «안 본» 것이다.
    logger.warn(`[review-eligibility] scan hit the ${ELIGIBILITY_BATCH} cap — the rest waits for the next tick`);
  }

  const eligible: string[] = [];
  for (const candidate of candidates) {
    const verdict = judgeEligibility(candidate, now);
    if (verdict.eligible) {
      eligible.push(verdict.orderId);
      summary.basis[verdict.basis] = (summary.basis[verdict.basis] ?? 0) + 1;
    } else {
      summary.skipped[verdict.reason] = (summary.skipped[verdict.reason] ?? 0) + 1;
    }
  }
  summary.eligible = eligible.length;

  if (!summary.enabled) {
    logger.info(
      `[review-eligibility] disabled (ELIGIBILITY_AUTO_ISSUE != true) — would issue for ${eligible.length} of ${candidates.length} scanned, basis=${JSON.stringify(summary.basis)}`,
    );
    return summary;
  }

  for (const orderId of eligible) {
    // 🔴 건별 격리 — 한 건이 터져도 배치가 멈추지 않는다. 표식을 못 남긴 건은 다음 틱이 다시
    // 잡고, ugc 의 발급은 `source_event_id` unique 로 멱등이라 두 번 만들어지지 않는다.
    try {
      const issued = await issueOne(query, orderModule, container, orderId, logger);
      if (issued) summary.issued += 1;
      else summary.skipped.nothing_to_issue = (summary.skipped.nothing_to_issue ?? 0) + 1;
    } catch (err) {
      summary.failed += 1;
      logger.error(`[review-eligibility] order ${orderId} failed: ${(err as Error)?.message}`);
    }
  }

  logger.info(
    `[review-eligibility] scanned=${summary.scanned} eligible=${summary.eligible} issued=${summary.issued} failed=${summary.failed} basis=${JSON.stringify(summary.basis)} skipped=${JSON.stringify(summary.skipped)}`,
  );
  return summary;
}

async function issueOne(
  query: { graph: (args: unknown) => Promise<{ data: unknown[] }> },
  orderModule: { updateOrders: (data: unknown) => Promise<unknown> },
  container: unknown,
  orderId: string,
  logger: { warn: (msg: string) => void },
): Promise<boolean> {
  const { data } = await query.graph({
    entity: 'order',
    fields: [
      'id',
      'customer_id',
      'items.id',
      'items.product_id',
      // 계산 필드(`items.total`)는 필드를 지정해 조회하면 키째 빠진다 — 저장된 값으로 셈한다.
      'items.unit_price',
      'items.detail.quantity',
      'items.adjustments.amount',
    ],
    filters: { id: orderId },
  });

  const order = data?.[0] as OrderForIssue | undefined;
  if (!order?.customer_id) {
    logger.warn(`[review-eligibility] order ${orderId} has no customer — skipped`);
    return false;
  }

  const result = await createReviewEligibility(
    { customerId: order.customer_id, orderId, items: order.items ?? [] },
    container as { resolve: <T>(key: string) => T },
  );

  // 🔴 표식은 «발급이 실제로 성공했을 때만» 남긴다. 실패한 건에 표식을 남기면 그 주문은 영영
  // 자격을 못 받는다 — 재시도가 조용히 사라지는 쪽이 중복 왕복보다 나쁘다.
  if (result.status !== 'created') return false;

  await orderModule.updateOrders([
    { id: orderId, metadata: { [ELIGIBILITY_ISSUED_METADATA_KEY]: new Date().toISOString() } },
  ]);

  return true;
}
