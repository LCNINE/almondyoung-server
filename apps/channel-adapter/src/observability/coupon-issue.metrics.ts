import { Counter, Gauge, register } from 'prom-client';

/**
 * 쿠폰 자동발급 관측 (#488 `7-4`).
 *
 * 그전까지 영구 실패는 `logger.error` 한 줄이 전부였고, 「발급이 안 되고 있다」는 사실을
 * 알 방법이 없었다. 자동발급은 사람이 안 보는 경로라 그 침묵의 대가가 크다.
 *
 * 모듈 스코프 싱글턴이다 — prom-client 전역 register 는 같은 이름을 두 번 등록하면 던지므로,
 * 인스턴스 필드로 두면 프로바이더가 두 번 생성될 때 부팅이 죽는다(`libs/events/src/dlq/dlq.metrics.ts`
 * 가 같은 이유로 같은 모양이다). 노출은 `startMetricsServer()` 가 앱포트+10000 에 띄우는
 * `/metrics` 이고 Alloy 가 긁어간다.
 */

/** 발급 트리거를 나르는 inbox 이벤트 타입. 리컨실과 게이지가 공유한다. */
export const COUPON_TRIGGER_EVENT_TYPES = ['UserEmailVerified', 'MembershipStatusChanged'] as const;

/**
 * 라벨 카디널리티를 닫는다. Medusa 가 새 사유를 내면 `other` 로 접히고, 그 사실은 이 배열을
 * 갱신하라는 신호다(그래야 Grafana 에서 구별된다).
 */
const KNOWN_OUTCOMES = new Set([
  'already_issued',
  'group_mismatch',
  'unsupported_rule',
  'max_claims_exceeded',
  'not_started',
  'expired',
  // 공개 쿠폰에 자동발급 트리거가 걸려 있다 (#488 A2). 발급하면 가입자 전원이 1회 제한에
  // 걸리므로 Medusa 가 거절한다 — 이 라벨이 보이면 쿠폰 설정을 고쳐야 한다는 신호다.
  'public_promotion',
]);

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

const inboxFailedRows = new Gauge({
  name: 'coupon_issue_inbox_failed_rows',
  help: 'inbox_events rows stuck in status=failed for coupon trigger event types',
  labelNames: ['event_type'],
  registers: [register],
});

export type AutoIssueResult =
  | {
      issued?: unknown[] | null;
      // 실제 응답의 항목은 `{ promotion_id, reason }` 이다. 여기서 읽는 것은 `reason` 뿐이지만
      // 인덱스 시그니처를 열어 둔다 — 안 그러면 호출부의 객체 리터럴이 excess-property 검사에 걸린다.
      skipped?: ({ reason?: string | null; [key: string]: unknown } | null)[] | null;
    }
  | null
  | undefined;

export function recordAutoIssueOutcome(trigger: string, result: AutoIssueResult): void {
  const issued = result?.issued?.length ?? 0;
  if (issued > 0) autoIssueTotal.inc({ trigger, outcome: 'issued' }, issued);

  for (const entry of result?.skipped ?? []) {
    const reason = entry?.reason ?? '';
    autoIssueTotal.inc({ trigger, outcome: KNOWN_OUTCOMES.has(reason) ? reason : 'other' });
  }
}

export function recordAutoIssueFailure(trigger: string, kind: 'permanent' | 'transient'): void {
  autoIssueFailuresTotal.inc({ trigger, kind });
}

/**
 * 백로그 게이지를 «전체 다시 쓰기» 로 갱신한다.
 *
 * 행이 없는 타입을 0 으로 명시하는 것이 핵심이다. 안 그러면 마지막으로 관측된 값이 남아
 * 알림이 영원히 켜져 있고, 그 상태에서는 아무도 알림을 안 본다.
 */
export function recordCouponIssueBacklog(rows: { eventType: string; count: number }[]): void {
  const byType = new Map(rows.map((r) => [r.eventType, r.count]));
  for (const eventType of COUPON_TRIGGER_EVENT_TYPES) {
    inboxFailedRows.set({ event_type: eventType }, byType.get(eventType) ?? 0);
  }
}
