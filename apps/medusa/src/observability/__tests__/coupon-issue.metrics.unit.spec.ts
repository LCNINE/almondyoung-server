import { register } from 'prom-client';
import { recordAutoIssueFailure, recordAutoIssueOutcome } from '../coupon-issue.metrics';

const value = async (name: string, labels: Record<string, string>): Promise<number> => {
  const metric = await register.getSingleMetric(name)!.get();
  const found = metric.values.find((v) => Object.entries(labels).every(([k, val]) => v.labels[k] === val));
  return found?.value ?? 0;
};

describe('Medusa 쪽 쿠폰 자동발급 메트릭 — channel-adapter 와 같은 이름·같은 라벨', () => {
  beforeEach(() => register.resetMetrics());

  it('발급 건수와 스킵 사유를 각각 센다', async () => {
    recordAutoIssueOutcome('customer_registered', {
      issued: [{ promotion_id: 'p1' }, { promotion_id: 'p2' }],
      skipped: [{ reason: 'already_issued' }, { reason: 'unsupported_rule' }],
    });
    expect(await value('coupon_auto_issue_total', { trigger: 'customer_registered', outcome: 'issued' })).toBe(2);
    expect(await value('coupon_auto_issue_total', { trigger: 'customer_registered', outcome: 'already_issued' })).toBe(1);
    expect(await value('coupon_auto_issue_total', { trigger: 'customer_registered', outcome: 'unsupported_rule' })).toBe(1);
  });

  it('발급 0·스킵 0 이면 시리즈를 만들지 않는다 (No Data 가 정상)', async () => {
    recordAutoIssueOutcome('customer_registered', { issued: [], skipped: [] });
    const metric = await register.getSingleMetric('coupon_auto_issue_total')!.get();
    expect(metric.values).toEqual([]);
  });

  it('실패는 전부 permanent 다 — 재시도가 없으므로 모든 실패가 최종이다', async () => {
    recordAutoIssueFailure('customer_registered');
    recordAutoIssueFailure('customer_registered');
    expect(await value('coupon_auto_issue_failures_total', { trigger: 'customer_registered', kind: 'permanent' })).toBe(2);
    expect(await value('coupon_auto_issue_failures_total', { trigger: 'customer_registered', kind: 'transient' })).toBe(0);
  });
});
