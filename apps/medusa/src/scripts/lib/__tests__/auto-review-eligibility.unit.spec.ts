import {
  ELIGIBILITY_CANDIDATE_SQL,
  ELIGIBILITY_DELIVERED_DAYS,
  ELIGIBILITY_ORDER_AGE_DAYS,
  ELIGIBILITY_SHIPPED_DAYS,
  ELIGIBILITY_WINDOW_DAYS,
  candidateWindowStart,
  judgeEligibility,
} from '../auto-review-eligibility';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-11T00:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString();
const order = (attempts: unknown, agedDays = 0) => ({ id: 'o1', created_at: daysAgo(agedDays), attempts }) as never;

describe('judgeEligibility — 세 단', () => {
  it('1단: 배송완료 후 유예가 지나면 배송완료 축으로 발급한다', () => {
    expect(
      judgeEligibility(order([{ status: 'delivered', deliveredAt: daysAgo(ELIGIBILITY_DELIVERED_DAYS + 1) }], 99), NOW),
    ).toMatchObject({ eligible: true, basis: 'delivered' });
  });

  it('2단: 배송완료가 없으면 출고 투영 축으로, 더 긴 유예를 쓴다', () => {
    const justOverDelivered = daysAgo(ELIGIBILITY_DELIVERED_DAYS + 1);

    expect(judgeEligibility(order([{ status: 'shipped', dispatchedAt: justOverDelivered }], 99), NOW)).toMatchObject({
      eligible: false,
      reason: 'within_grace',
    });
    expect(
      judgeEligibility(order([{ status: 'shipped', dispatchedAt: daysAgo(ELIGIBILITY_SHIPPED_DAYS + 1) }], 99), NOW),
    ).toMatchObject({ eligible: true, basis: 'shipped' });
  });

  it('3단: 배송 정보가 아예 없으면 주문일 축으로 내려간다', () => {
    expect(judgeEligibility(order([], ELIGIBILITY_ORDER_AGE_DAYS - 1), NOW)).toMatchObject({
      eligible: false,
      reason: 'within_grace',
    });
    expect(judgeEligibility(order(null, ELIGIBILITY_ORDER_AGE_DAYS + 1), NOW)).toMatchObject({
      eligible: true,
      basis: 'order_age',
    });
  });

  it('🔴 3단은 1단보다 «훨씬» 보수적이다 — 배송을 확인할 수 없는 상태의 값이다', () => {
    // 「추적 불가 → 발송처리일 +28일」이라는 업계 기준을 주문일로 옮긴 값이라 크게 벌어져야 한다.
    expect(ELIGIBILITY_ORDER_AGE_DAYS).toBeGreaterThan(ELIGIBILITY_SHIPPED_DAYS * 2);
  });

  it('배송 정보가 «있는데» 시각을 못 읽으면 3단으로 내려보내지 않는다', () => {
    // 데이터 이상이지 「정보 없음」이 아니다. 3단으로 흘리면 이상한 데이터가 조용히 발급된다.
    expect(judgeEligibility(order([{ status: 'shipped' }], 999), NOW)).toMatchObject({
      reason: 'attempt_without_timestamp',
    });
    expect(judgeEligibility(order([{ status: 'shipped', dispatchedAt: 'not-a-date' }], 999), NOW)).toMatchObject({
      reason: 'attempt_without_timestamp',
    });
  });

  it('🔴 창보다 오래된 주문은 발급하지 않는다 — 첫 실행이 과거 전체를 만들면 안 된다', () => {
    expect(judgeEligibility(order(null, ELIGIBILITY_ORDER_AGE_DAYS + ELIGIBILITY_WINDOW_DAYS + 1), NOW)).toMatchObject({
      eligible: false,
      reason: 'outside_window',
    });
  });

  it('회수된 시도가 하나라도 있으면 건드리지 않는다 — 주문일 축으로도 내려가지 않는다', () => {
    expect(
      judgeEligibility(
        order(
          [
            { status: 'delivered', deliveredAt: daysAgo(ELIGIBILITY_DELIVERED_DAYS + 1) },
            { status: 'recalled', dispatchedAt: daysAgo(ELIGIBILITY_DELIVERED_DAYS + 2) },
          ],
          999,
        ),
        NOW,
      ),
    ).toMatchObject({ eligible: false, reason: 'recalled_attempt' });
  });

  it('상자가 여럿이고 하나라도 배송완료가 아니면 전체를 2단으로 본다', () => {
    expect(
      judgeEligibility(
        order(
          [
            { status: 'delivered', deliveredAt: daysAgo(ELIGIBILITY_DELIVERED_DAYS + 2) },
            { status: 'shipped', dispatchedAt: daysAgo(ELIGIBILITY_DELIVERED_DAYS + 1) },
          ],
          999,
        ),
        NOW,
      ),
    ).toMatchObject({ eligible: false, reason: 'within_grace' });
  });

  it('가장 늦은 시도를 기준으로 삼는다', () => {
    expect(
      judgeEligibility(
        order(
          [
            { status: 'delivered', deliveredAt: daysAgo(ELIGIBILITY_DELIVERED_DAYS + 20) },
            { status: 'delivered', deliveredAt: daysAgo(1) },
          ],
          999,
        ),
        NOW,
      ),
    ).toMatchObject({ eligible: false, reason: 'within_grace' });
  });
});

describe('후보 조회 SQL', () => {
  it('취소·초안·입금대기 주문과 «이미 발급한» 주문을 술어로 쳐낸다', () => {
    expect(ELIGIBILITY_CANDIDATE_SQL).toContain('o.canceled_at is null');
    expect(ELIGIBILITY_CANDIDATE_SQL).toContain("<> 'awaiting_deposit'");
    expect(ELIGIBILITY_CANDIDATE_SQL).toContain("o.metadata->>'reviewEligibilityIssuedAt' is null");
  });

  it('🔴 결제·캡처를 술어로 쓰지 않는다 — 이 잡은 결제 경로를 타지 않는다', () => {
    expect(ELIGIBILITY_CANDIDATE_SQL).not.toContain('capture');
    expect(ELIGIBILITY_CANDIDATE_SQL).not.toContain('payment');
  });

  it('배치 상한과 창을 «반드시» 받는다 — 바인딩 자리가 둘이다', () => {
    expect(ELIGIBILITY_CANDIDATE_SQL.match(/\?/g)).toHaveLength(2);
    expect(ELIGIBILITY_CANDIDATE_SQL).toContain('limit ?');
    expect(ELIGIBILITY_CANDIDATE_SQL).toContain('o.created_at >= ?');
  });

  it('🔴 SQL 창은 «가장 이른 기산점»인 주문일로 잡혀야 한다', () => {
    // 배송완료 유예로 잡으면 1·2단 대상이 창 밖으로 잘려 나간다.
    const start = candidateWindowStart(NOW).getTime();
    const orderAgeCutoff = NOW.getTime() - (ELIGIBILITY_ORDER_AGE_DAYS + ELIGIBILITY_WINDOW_DAYS) * DAY;

    expect(start).toBeLessThan(orderAgeCutoff);
  });
});
