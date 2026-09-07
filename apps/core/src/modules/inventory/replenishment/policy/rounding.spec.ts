import { roundUpToLot } from './rounding';

describe('roundUpToLot', () => {
  it('0 이하는 0 — 부족하지 않으면 사지 않는다', () => {
    expect(roundUpToLot(0, { moq: 10, packingUnit: 6 })).toBe(0);
    expect(roundUpToLot(-3, { moq: 10, packingUnit: 6 })).toBe(0);
  });

  it('둘 다 없으면 정수 올림', () => {
    expect(roundUpToLot(7.2, { moq: null, packingUnit: null })).toBe(8);
  });

  it('MOQ 미만이면 MOQ 로 올린다', () => {
    expect(roundUpToLot(3, { moq: 10, packingUnit: null })).toBe(10);
    expect(roundUpToLot(12, { moq: 10, packingUnit: null })).toBe(12);
  });

  it('상자 단위 배수로 올린다', () => {
    expect(roundUpToLot(7, { moq: null, packingUnit: 6 })).toBe(12);
    expect(roundUpToLot(12, { moq: null, packingUnit: 6 })).toBe(12);
  });

  it('MOQ 를 먼저 적용하고 그 결과를 상자 배수로 올린다', () => {
    // 3 → MOQ 10 → 상자 6 배수 → 12
    expect(roundUpToLot(3, { moq: 10, packingUnit: 6 })).toBe(12);
  });

  it('0 이나 음수 lot 값은 없는 것으로 본다', () => {
    expect(roundUpToLot(7, { moq: 0, packingUnit: -1 })).toBe(7);
  });
});
