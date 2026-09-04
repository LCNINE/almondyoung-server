import { Counter, register } from 'prom-client';
import type { AutoIssueTrigger } from '../modules/promotion-meta/service';
import type { AutoIssueSkipReason } from '../workflows/coupons/auto-issue-selection';

/**
 * 쿠폰 자동발급 관측 — Medusa 쪽 (#775, 스펙 결정 1·5).
 *
 * `customer_registered` 는 이제 Medusa 안(`customer.created` subscriber)에서 발급되어 channel-adapter 의
 * 카운터를 지나지 않는다. 그래서 **같은 이름·같은 라벨**을 여기서 낸다 — Grafana 의
 * `sum by (trigger, outcome) (increase(coupon_auto_issue_total[1h]))` 가 job 구분 없이 두 트리거를 합산한다.
 * 세는 쪽은 «발화시킨 쪽»이다: `membership_activated` 는 channel-adapter, `customer_registered` 는 여기.
 * 라우트 안에서 세면 전자가 두 번 세어진다.
 *
 * channel-adapter 의 `KNOWN_OUTCOMES` 허용목록이 여기 없는 이유: `skipped.reason` 의 **생산자가 이 트리**라
 * 유니온(`AutoIssueSkipReason`)이 이미 닫혀 있다.
 *
 * 모듈 스코프 싱글턴이다 — prom-client 전역 register 는 같은 이름을 두 번 등록하면 던진다.
 * 노출은 `metrics-server.ts` 의 `:PORT+10000/metrics`, Alloy `prometheus.scrape "medusa"` 가 긁는다.
 */
const autoIssueTotal = new Counter({
  name: 'coupon_auto_issue_total',
  help: 'Auto-issuance outcomes reported by the Medusa issue-coupons endpoint',
  labelNames: ['trigger', 'outcome'],
  registers: [register],
});

const autoIssueFailuresTotal = new Counter({
  name: 'coupon_auto_issue_failures_total',
  help: 'Failed calls to the Medusa auto-issuance endpoint, split by permanence',
  labelNames: ['trigger', 'kind'],
  registers: [register],
});

export type AutoIssueOutcomeCounts = {
  issued: readonly unknown[];
  skipped: readonly { reason: AutoIssueSkipReason }[];
};

export function recordAutoIssueOutcome(trigger: AutoIssueTrigger, result: AutoIssueOutcomeCounts): void {
  if (result.issued.length > 0) autoIssueTotal.inc({ trigger, outcome: 'issued' }, result.issued.length);
  for (const entry of result.skipped) {
    autoIssueTotal.inc({ trigger, outcome: entry.reason });
  }
}

/**
 * `kind` 는 항상 `permanent` 다. subscriber 에는 재시도가 없어(스펙 결정 2) 모든 실패가 최종이고 사람이 봐야
 * 한다 — P7 의 알림 `failures_total{kind="permanent"} > 0` 이 정의 그대로 이 트리거를 덮는다.
 */
export function recordAutoIssueFailure(trigger: AutoIssueTrigger): void {
  autoIssueFailuresTotal.inc({ trigger, kind: 'permanent' });
}
