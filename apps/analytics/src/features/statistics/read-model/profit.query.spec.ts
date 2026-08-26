import { estimateCost, marginRateOf } from './profit.query';

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
