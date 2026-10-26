import { RETURN_REASONS, readReturnFeeBearer } from '../return-reasons';

describe('반품 사유 표', () => {
  it('사유 6종, value 는 core 옛 return_reason_code 와 같은 집합', () => {
    expect(RETURN_REASONS.map((r) => r.value).sort()).toEqual(
      ['change_of_mind', 'damaged_in_shipping', 'defective', 'not_as_described', 'other', 'wrong_item'],
    );
  });

  it('단순 변심만 customer, 기타는 operator·고객 선택 불가, 나머지는 seller', () => {
    const by = Object.fromEntries(RETURN_REASONS.map((r) => [r.value, r]));
    expect(by.change_of_mind).toMatchObject({ feeBearer: 'customer', customerSelectable: true });
    expect(by.other).toMatchObject({ feeBearer: 'operator', customerSelectable: false });
    for (const v of ['defective', 'not_as_described', 'wrong_item', 'damaged_in_shipping']) {
      expect(by[v]).toMatchObject({ feeBearer: 'seller', customerSelectable: true });
    }
  });

  it('readReturnFeeBearer — 모르는 값·없는 metadata 는 null', () => {
    expect(readReturnFeeBearer({ metadata: { feeBearer: 'seller' } })).toBe('seller');
    expect(readReturnFeeBearer({ metadata: { feeBearer: 'nobody' } })).toBeNull();
    expect(readReturnFeeBearer({ metadata: null })).toBeNull();
    expect(readReturnFeeBearer(undefined)).toBeNull();
  });
});
