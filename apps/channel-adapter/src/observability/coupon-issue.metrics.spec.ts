import { register } from 'prom-client';
import {
  recordAutoIssueOutcome,
  recordAutoIssueFailure,
  recordCouponIssueBacklog,
  COUPON_TRIGGER_EVENT_TYPES,
} from './coupon-issue.metrics';

const value = async (name: string, labels: Record<string, string>): Promise<number> => {
  const metric = await register.getSingleMetric(name)!.get();
  const found = metric.values.find((v) =>
    Object.entries(labels).every(([k, val]) => v.labels[k] === val),
  );
  return found?.value ?? 0;
};

describe('쿠폰 자동발급 메트릭', () => {
  beforeEach(() => {
    register.resetMetrics();
  });

  it('발급 건수와 스킵 사유를 각각 센다', async () => {
    recordAutoIssueOutcome('membership_activated', {
      issued: [{ promotion_id: 'p1' }, { promotion_id: 'p2' }],
      skipped: [{ promotion_id: 'p3', reason: 'already_issued' }],
    });

    expect(
      await value('coupon_auto_issue_total', {
        trigger: 'membership_activated',
        outcome: 'issued',
      }),
    ).toBe(2);
    expect(
      await value('coupon_auto_issue_total', {
        trigger: 'membership_activated',
        outcome: 'already_issued',
      }),
    ).toBe(1);
  });

  it('분류표 밖 룰 스킵은 고유 라벨로 보인다 — 이게 fail-closed 의 관측 지점이다', async () => {
    recordAutoIssueOutcome('customer_registered', {
      issued: [],
      skipped: [{ promotion_id: 'p1', reason: 'unsupported_rule' }],
    });

    expect(
      await value('coupon_auto_issue_total', {
        trigger: 'customer_registered',
        outcome: 'unsupported_rule',
      }),
    ).toBe(1);
  });

  it('모르는 사유는 other 로 접어 라벨 카디널리티를 닫는다', async () => {
    recordAutoIssueOutcome('customer_registered', {
      issued: [],
      skipped: [{ promotion_id: 'p1', reason: 'something_new' }, { promotion_id: 'p2' }],
    });

    expect(
      await value('coupon_auto_issue_total', {
        trigger: 'customer_registered',
        outcome: 'other',
      }),
    ).toBe(2);
  });

  it('빈 응답에도 죽지 않는다', () => {
    expect(() => recordAutoIssueOutcome('customer_registered', null)).not.toThrow();
    expect(() => recordAutoIssueOutcome('customer_registered', {})).not.toThrow();
  });

  it('영구/일시 실패를 나눠 센다', async () => {
    recordAutoIssueFailure('membership_activated', 'permanent');
    recordAutoIssueFailure('membership_activated', 'transient');
    recordAutoIssueFailure('membership_activated', 'transient');

    expect(
      await value('coupon_auto_issue_failures_total', {
        trigger: 'membership_activated',
        kind: 'permanent',
      }),
    ).toBe(1);
    expect(
      await value('coupon_auto_issue_failures_total', {
        trigger: 'membership_activated',
        kind: 'transient',
      }),
    ).toBe(2);
  });

  it('백로그 게이지는 행이 없는 타입을 0 으로 되돌린다', async () => {
    recordCouponIssueBacklog([{ eventType: 'UserEmailVerified', count: 3 }]);
    expect(await value('coupon_issue_inbox_failed_rows', { event_type: 'UserEmailVerified' })).toBe(3);
    expect(await value('coupon_issue_inbox_failed_rows', { event_type: 'MembershipStatusChanged' })).toBe(
      0,
    );

    // 다음 회차에 3건이 해소되면 게이지도 내려가야 한다 — 안 그러면 알림이 영원히 켜져 있다.
    recordCouponIssueBacklog([]);
    expect(await value('coupon_issue_inbox_failed_rows', { event_type: 'UserEmailVerified' })).toBe(0);
  });

  it('트리거 이벤트 타입은 둘이다', () => {
    expect([...COUPON_TRIGGER_EVENT_TYPES]).toEqual(['UserEmailVerified', 'MembershipStatusChanged']);
  });
});
