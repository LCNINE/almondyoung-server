import { computeOperatingResult, estimateCost, marginRateOf, ProfitTotals } from './profit.query';

describe('estimateCost', () => {
  it('원가 미입력이면 null — 0 으로 뭉개지 않는다', () => {
    expect(estimateCost(10, null, 100_000, 100_000)).toBeNull();
  });

  it('취소·환불이 없으면 판매수량 × 공급가 그대로', () => {
    expect(estimateCost(10, 3_000, 100_000, 100_000)).toBe(30_000);
  });

  it('취소·환불 금액만큼 순매출 비율로 원가를 덜어낸다', () => {
    expect(estimateCost(10, 3_000, 100_000, 50_000)).toBe(15_000);
  });

  it('환불이 총매출을 넘어 순매출이 음수여도 원가는 0 밑으로 내려가지 않는다', () => {
    expect(estimateCost(10, 3_000, 100_000, -20_000)).toBe(0);
  });

  it('순매출이 총매출보다 커도(비정상 데이터) 원가는 전량 원가를 넘지 않는다', () => {
    expect(estimateCost(10, 3_000, 100_000, 120_000)).toBe(30_000);
  });

  it('총매출 0(취소만 있는 기간)이면 비율 보정 없이 전량 원가 — 수량 0 이면 0', () => {
    expect(estimateCost(0, 3_000, 0, -5_000)).toBe(0);
  });

  it('공급가 0 원은 유효한 원가다 — null 과 구분된다', () => {
    expect(estimateCost(10, 0, 100_000, 100_000)).toBe(0);
  });
});

describe('marginRateOf', () => {
  it('마진 미계산(null)이면 null', () => {
    expect(marginRateOf(null, 100_000)).toBeNull();
  });

  it('순매출이 0 이하이면 비율을 만들지 않는다', () => {
    expect(marginRateOf(1_000, 0)).toBeNull();
    expect(marginRateOf(-1_000, -5_000)).toBeNull();
  });

  it('마진 / 순매출', () => {
    expect(marginRateOf(30_000, 100_000)).toBeCloseTo(0.3);
  });
});

describe('computeOperatingResult', () => {
  const totals: ProfitTotals = {
    grossRevenue: 12_000_000,
    cancelledAmount: 0,
    refundedAmount: 0,
    netRevenue: 12_000_000,
    quantitySold: 400,
    productsCount: 40,
    computedNetRevenue: 10_000_000,
    estimatedCost: 7_000_000,
    estimatedMargin: 3_000_000,
    marginRate: 0.3,
    uncomputedNetRevenue: 2_000_000,
    uncomputedProductsCount: 5,
    costCoverageRate: 10 / 12,
  };

  it('고정비 미설정이면 판정을 내리지 않고 전부 null — 0 으로 두면 적자가 흑자로 보인다', () => {
    const result = computeOperatingResult(totals, { amount: null, coveredDays: 0, uncoveredDays: 31 });
    expect(result).toEqual({
      fixedCost: null,
      fixedCostUncoveredDays: 31,
      operatingProfit: null,
      breakEvenNetRevenue: null,
      breakEvenAchievementRate: null,
    });
  });

  it('영업손익은 마진에서 고정비를 뺀 값이고, 고정비가 마진보다 크면 음수다', () => {
    expect(computeOperatingResult(totals, { amount: 2_000_000, coveredDays: 31, uncoveredDays: 0 }).operatingProfit).toBe(
      1_000_000,
    );
    expect(computeOperatingResult(totals, { amount: 5_000_000, coveredDays: 31, uncoveredDays: 0 }).operatingProfit).toBe(
      -2_000_000,
    );
  });

  it('손익분기 순매출 = 고정비 ÷ 마진율', () => {
    const result = computeOperatingResult(totals, { amount: 3_000_000, coveredDays: 31, uncoveredDays: 0 });
    expect(result.breakEvenNetRevenue).toBe(10_000_000);
    expect(result.breakEvenAchievementRate).toBe(1);
  });

  it('마진율이 0 이하면(팔수록 손해) 손익분기를 못 낸다', () => {
    const lossMaking = { ...totals, estimatedMargin: -500_000, marginRate: -0.05 };
    const result = computeOperatingResult(lossMaking, { amount: 3_000_000, coveredDays: 31, uncoveredDays: 0 });
    expect(result.breakEvenNetRevenue).toBeNull();
    expect(result.breakEvenAchievementRate).toBeNull();
    expect(result.operatingProfit).toBe(-3_500_000);
  });

  it('마진율이 null(원가 전량 미입력)이어도 손익분기는 null 이고 영업손익은 나온다', () => {
    const noCost = { ...totals, estimatedMargin: 0, marginRate: null, computedNetRevenue: 0 };
    const result = computeOperatingResult(noCost, { amount: 3_000_000, coveredDays: 31, uncoveredDays: 0 });
    expect(result.breakEvenNetRevenue).toBeNull();
    expect(result.operatingProfit).toBe(-3_000_000);
  });

  it('고정비 일부 구간만 설정됐으면 미커버 일수를 그대로 전달한다', () => {
    const result = computeOperatingResult(totals, { amount: 1_000_000, coveredDays: 20, uncoveredDays: 11 });
    expect(result.fixedCostUncoveredDays).toBe(11);
  });
});
