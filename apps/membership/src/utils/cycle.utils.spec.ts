import { calculateCycleStart, calculateCycleNumber, formatDate } from './cycle.utils';

// 환불 판정은 (userId, cycleStartDate) 로 키가 잡힌 "현재 주기" 혜택만 본다.
// 따라서 멤버십을 해지→재가입했을 때, 첫 멤버십에서 쓴 웰컴딜(다른 주기)이
// 두번째 멤버십의 현재 주기 판정을 오염시키면 안 된다. 그 격리의 primitive 가 여기다.
describe('cycle.utils - 주기 격리 (멤버십 재가입 환불 시나리오)', () => {
  it('주문은 "구매 시점이 속한 주기(구매 당시 billingDate 기준)"에 귀속된다', () => {
    const billing = new Date('2025-01-15');
    // 1주기: 01-15 ~ 02-13, 2주기 시작: 02-14 (billingDate + 30일)
    expect(formatDate(calculateCycleStart(billing, new Date('2025-01-20')))).toBe('2025-01-15');
    expect(formatDate(calculateCycleStart(billing, new Date('2025-02-20')))).toBe('2025-02-14');
    // 주기 번호는 1부터
    expect(calculateCycleNumber(billing, calculateCycleStart(billing, new Date('2025-01-20')))).toBe(1);
    expect(calculateCycleNumber(billing, calculateCycleStart(billing, new Date('2025-02-20')))).toBe(2);
  });

  it('첫 멤버십의 웰컴딜 주기 키 ≠ 재가입한 두번째 멤버십의 현재 주기 키', () => {
    // 첫 멤버십: 2025-01-15 가입, 웰컴딜을 2025-02-01 에 구매 → 첫 멤버십의 어느 주기에 기록됨
    const firstBilling = new Date('2025-01-15');
    const welcomeDealOrderDate = new Date('2025-02-01');
    const firstCycleKey = formatDate(calculateCycleStart(firstBilling, welcomeDealOrderDate));

    // 두번째 멤버십: 2025-06-20 재가입, 현재(2025-07-01)엔 아무 할인 구매 없음
    const secondBilling = new Date('2025-06-20');
    const now = new Date('2025-07-01');
    const secondCurrentCycleKey = formatDate(calculateCycleStart(secondBilling, now));

    // 두 주기 row 키가 다르므로 첫 멤버십 웰컴딜 사용이 두번째 멤버십 환불 판정에 잡히지 않는다.
    expect(firstCycleKey).not.toBe(secondCurrentCycleKey);
  });

  it('billingDate 그리드가 정확히 30일 배수로 정렬돼도, 과거 구매 주기는 현재 주기보다 항상 이르다', () => {
    // 재가입일이 원 billingDate + 90일(30의 배수)이라 주기 그리드가 겹치는 최악 케이스
    const firstBilling = new Date('2025-01-15');
    const secondBilling = new Date('2025-04-15'); // +90일
    const pastPurchaseCycle = calculateCycleStart(firstBilling, new Date('2025-02-01'));
    const currentCycle = calculateCycleStart(secondBilling, new Date('2025-05-01'));

    // 시간은 앞으로만 흐르므로 과거 구매 주기 시작 < 현재 주기 시작 → 키 충돌 없음
    expect(pastPurchaseCycle.getTime()).toBeLessThan(currentCycle.getTime());
    expect(formatDate(pastPurchaseCycle)).not.toBe(formatDate(currentCycle));
  });
});
