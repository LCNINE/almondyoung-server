import { prorateAdjustments, cancelledAdjustmentShare } from '../prorate-adjustments';
import { toNumber } from '../amount';

describe('toNumber', () => {
  it('Medusa 금액 표현을 숫자로', () => {
    expect(toNumber(3)).toBe(3);
    expect(toNumber('3')).toBe(3);
    expect(toNumber({ numeric_: 3 })).toBe(3);
    expect(toNumber({ value: '3' })).toBe(3);
    expect(Number.isNaN(toNumber(null))).toBe(true);
  });
});

describe('prorateAdjustments', () => {
  it('남은 수량 비율로 줄인다 — 원 단위 반올림(half-up)', () => {
    expect(prorateAdjustments([{ amount: 2500, code: 'P' }], 3, 2)).toEqual([{ amount: 1667, code: 'P' }]);
  });
  it('.5 는 올린다', () => {
    expect(prorateAdjustments([{ amount: 1001 }], 2, 1)).toEqual([{ amount: 501 }]);
  });
  it('할인 줄이 여럿이면 줄마다 따로', () => {
    expect(prorateAdjustments([{ amount: 1000, code: 'A' }, { amount: 300, code: 'B' }], 2, 1)).toEqual([
      { amount: 500, code: 'A' }, { amount: 150, code: 'B' },
    ]);
  });
  it('취소분 할인 = 원래 − 남길 할인', () => {
    expect(cancelledAdjustmentShare([{ amount: 2500 }], 3, 2)).toBe(833);
  });
  it('줄 통째 제거(newQty 0)면 할인 전부가 취소분이다', () => {
    expect(cancelledAdjustmentShare([{ amount: 2500 }], 3, 0)).toBe(2500);
  });
  it('newQty 가 0 이거나 oldQty 이상이면 쓰지 않는 입력이다', () => {
    expect(() => prorateAdjustments([{ amount: 1 }], 2, 0)).toThrow();
    expect(() => prorateAdjustments([{ amount: 1 }], 2, 2)).toThrow();
  });
});
