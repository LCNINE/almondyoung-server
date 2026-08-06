import { calculateShippingFee } from '../calculate-shipping-fee';
import { resolveKoreanShippingArea } from '../korea-postal-area';
import type { ShippingFeePolicy } from '../types';

const SEOUL = '06236';
const JEJU = '63001';
const ULLEUNG = '40200';

function lines(...items: Array<[subtotal: number, quantity: number]>) {
  return items.map(([subtotal, quantity]) => ({ subtotal, quantity }));
}

describe('resolveKoreanShippingArea', () => {
  it('제주 / 도서산간 / 일반 을 구분한다', () => {
    expect(resolveKoreanShippingArea(JEJU)).toBe('jeju');
    expect(resolveKoreanShippingArea('63644')).toBe('jeju');
    expect(resolveKoreanShippingArea(ULLEUNG)).toBe('island');
    expect(resolveKoreanShippingArea('58900')).toBe('island');
    expect(resolveKoreanShippingArea(SEOUL)).toBeNull();
  });

  it('5자리가 아니거나 비어 있으면 판정하지 않는다', () => {
    expect(resolveKoreanShippingArea(null)).toBeNull();
    expect(resolveKoreanShippingArea('')).toBeNull();
    expect(resolveKoreanShippingArea('123-456')).toBeNull();
    expect(resolveKoreanShippingArea('630010')).toBeNull();
  });

  it('하이픈이 섞여도 5자리면 판정한다', () => {
    expect(resolveKoreanShippingArea('63-001')).toBe('jeju');
  });
});

describe('calculateShippingFee', () => {
  it('그룹에 담긴 라인이 없으면 0원', () => {
    const policy: ShippingFeePolicy = { type: 'flat', baseFee: 3000, jejuExtraFee: 5000 };
    expect(calculateShippingFee(policy, [], JEJU)).toBe(0);
  });

  describe('free', () => {
    const policy: ShippingFeePolicy = { type: 'free', baseFee: 3000 };

    it('항상 0원이고 baseFee 를 무시한다', () => {
      expect(calculateShippingFee(policy, lines([100000, 3]), SEOUL)).toBe(0);
    });

    it('무료여도 제주 추가비는 부과한다', () => {
      expect(calculateShippingFee({ ...policy, jejuExtraFee: 5000 }, lines([10000, 1]), JEJU)).toBe(5000);
    });
  });

  describe('flat', () => {
    const policy: ShippingFeePolicy = { type: 'flat', baseFee: 2500 };

    it('금액·수량과 무관하게 baseFee', () => {
      expect(calculateShippingFee(policy, lines([1000, 1]), SEOUL)).toBe(2500);
      expect(calculateShippingFee(policy, lines([500000, 20]), SEOUL)).toBe(2500);
    });
  });

  describe('conditional_free', () => {
    const policy: ShippingFeePolicy = { type: 'conditional_free', baseFee: 3000, freeThreshold: 30000 };

    it('그룹 소계가 기준 미만이면 baseFee', () => {
      expect(calculateShippingFee(policy, lines([29999, 1]), SEOUL)).toBe(3000);
    });

    it('그룹 소계가 기준 이상이면 0원 (경계 포함)', () => {
      expect(calculateShippingFee(policy, lines([30000, 1]), SEOUL)).toBe(0);
      expect(calculateShippingFee(policy, lines([20000, 1], [15000, 1]), SEOUL)).toBe(0);
    });

    // 이 기능의 존재 이유: 카트 전체가 아니라 그룹 소계로 판정해야 한다.
    it('같은 카트에 있는 다른 그룹 금액은 판정에 섞이지 않는다', () => {
      const mealLinesOnly = lines([3000, 1]);
      expect(calculateShippingFee(policy, mealLinesOnly, SEOUL)).toBe(3000);
    });

    it('무료로 떨어져도 도서산간 추가비는 부과한다', () => {
      const withIsland = { ...policy, islandExtraFee: 4000 };
      expect(calculateShippingFee(withIsland, lines([50000, 1]), ULLEUNG)).toBe(4000);
      expect(calculateShippingFee(withIsland, lines([10000, 1]), ULLEUNG)).toBe(7000);
    });
  });

  describe('per_quantity', () => {
    const policy: ShippingFeePolicy = { type: 'per_quantity', baseFee: 2500 };

    it('수량에 비례한다', () => {
      expect(calculateShippingFee(policy, lines([10000, 1]), SEOUL)).toBe(2500);
      expect(calculateShippingFee(policy, lines([10000, 2], [5000, 1]), SEOUL)).toBe(7500);
    });
  });

  it('알 수 없는 유형이면 조용히 0원을 주지 않고 던진다', () => {
    const broken = { type: 'weight_tier', baseFee: 3000 } as unknown as ShippingFeePolicy;
    expect(() => calculateShippingFee(broken, lines([10000, 1]), SEOUL)).toThrow(/weight_tier/);
  });
});
