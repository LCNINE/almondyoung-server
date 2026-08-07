import { addDays } from 'date-fns';
import { bucketDiscountsByPeriod, deriveBillingPeriods } from '../billing-period.util';

const START = new Date('2026-01-15T00:00:00.000Z');

describe('deriveBillingPeriods', () => {
  it('월간 계약을 30일 주기로 쪼갠다', () => {
    const periods = deriveBillingPeriods(
      { contractId: 'c1', start: START, end: addDays(START, 90), durationDays: 30 },
      addDays(START, 75),
    );

    expect(periods).toHaveLength(3);
    expect(periods[0].start).toEqual(START);
    expect(periods[0].end).toEqual(addDays(START, 30));
    expect(periods[2].start).toEqual(addDays(START, 60));
  });

  it('진행 중인 주기 하나만 isCurrent 다', () => {
    const periods = deriveBillingPeriods(
      { contractId: 'c1', start: START, end: addDays(START, 90), durationDays: 30 },
      addDays(START, 40),
    );

    expect(periods.filter((p) => p.isCurrent)).toHaveLength(1);
    expect(periods.find((p) => p.isCurrent)!.periodNumber).toBe(2);
  });

  it('아직 오지 않은 주기는 만들지 않는다', () => {
    const periods = deriveBillingPeriods(
      { contractId: 'c1', start: START, end: addDays(START, 365), durationDays: 30 },
      addDays(START, 10),
    );

    expect(periods).toHaveLength(1);
  });

  it('중도해지한 계약의 마지막 주기는 종료일에서 잘린다', () => {
    const periods = deriveBillingPeriods(
      { contractId: 'c1', start: START, end: addDays(START, 40), durationDays: 30 },
      addDays(START, 90),
    );

    expect(periods).toHaveLength(2);
    expect(periods[1].end).toEqual(addDays(START, 40));
  });

  it('연간 계약은 한 주기다', () => {
    const periods = deriveBillingPeriods(
      { contractId: 'c1', start: START, end: addDays(START, 365), durationDays: 365 },
      addDays(START, 200),
    );

    expect(periods).toHaveLength(1);
    expect(periods[0].isCurrent).toBe(true);
  });

  it('아직 시작하지 않은 계약은 주기가 없다', () => {
    const periods = deriveBillingPeriods(
      { contractId: 'c1', start: addDays(START, 10), end: addDays(START, 40), durationDays: 30 },
      START,
    );

    expect(periods).toEqual([]);
  });
});

describe('bucketDiscountsByPeriod', () => {
  const periods = deriveBillingPeriods(
    { contractId: 'c1', start: START, end: addDays(START, 60), durationDays: 30 },
    addDays(START, 60),
  );

  const event = (dayOffset: number, discountAmount: number) => ({
    orderDate: addDays(START, dayOffset),
    discountAmount,
  });

  it('주문을 주기 경계에 맞춰 나눈다', () => {
    const buckets = bucketDiscountsByPeriod(periods, [event(1, 1000), event(29, 2000), event(31, 500)]);

    expect(buckets.get(periods[0])!.map((e) => e.discountAmount)).toEqual([1000, 2000]);
    expect(buckets.get(periods[1])!.map((e) => e.discountAmount)).toEqual([500]);
  });

  it('주기 시작일 당일 주문은 그 주기에 속한다 (경계는 시작 포함·종료 배타)', () => {
    const buckets = bucketDiscountsByPeriod(periods, [event(30, 700)]);

    expect(buckets.get(periods[0])).toEqual([]);
    expect(buckets.get(periods[1])!.map((e) => e.discountAmount)).toEqual([700]);
  });

  it('가입 전 주문은 어느 주기에도 들어가지 않는다', () => {
    const buckets = bucketDiscountsByPeriod(periods, [event(-5, 9999)]);

    expect([...buckets.values()].flat()).toEqual([]);
  });

  it('계약 종료 후 주문도 들어가지 않는다', () => {
    const buckets = bucketDiscountsByPeriod(periods, [event(70, 9999)]);

    expect([...buckets.values()].flat()).toEqual([]);
  });
});
