import { compatibleShippingProfileId } from './shipping-profile';

describe('compatibleShippingProfileId', () => {
  it('모든 SKU 가 같은 프로필이면 그 값', () => {
    expect(compatibleShippingProfileId(['p1', 'p1'])).toBe('p1');
  });
  it('프로필이 섞이면 NULL — 확정 단계가 막는다', () => {
    expect(compatibleShippingProfileId(['p1', 'p2'])).toBeNull();
  });
  it('하나라도 프로필이 없으면 NULL', () => {
    expect(compatibleShippingProfileId(['p1', null])).toBeNull();
  });
  it('SKU 가 없으면 NULL', () => {
    expect(compatibleShippingProfileId([])).toBeNull();
  });
});
