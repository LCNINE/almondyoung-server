import {
  deliveryProfileMissing,
  requiresDeliveryProfile,
} from './delivery-profile-requirement';

describe('requiresDeliveryProfile', () => {
  it('사입·위탁만 필수', () => {
    expect(requiresDeliveryProfile('physical')).toBe(true);
    expect(requiresDeliveryProfile('consignment')).toBe(true);
    expect(requiresDeliveryProfile('drop_shipped')).toBe(false);
    expect(requiresDeliveryProfile('infinite')).toBe(false);
  });
});

// core 규칙(sku-delivery-profile.rule.ts)과 같은 모양이어야 한다 — 서버가 최종 판정자.
describe('deliveryProfileMissing', () => {
  it('생성: 사입인데 프로필 없으면 true', () => {
    expect(
      deliveryProfileMissing({
        original: null,
        stockType: 'physical',
        deliveryProfileId: '',
      })
    ).toBe(true);
    expect(
      deliveryProfileMissing({
        original: null,
        stockType: 'physical',
        deliveryProfileId: 'p1',
      })
    ).toBe(false);
    expect(
      deliveryProfileMissing({
        original: null,
        stockType: 'drop_shipped',
        deliveryProfileId: '',
      })
    ).toBe(false);
  });
  it('수정: 아무것도 안 바꾸면 옛 SKU 도 false', () => {
    const original = { stockType: 'physical', deliveryProfileId: '' };
    expect(
      deliveryProfileMissing({
        original,
        stockType: 'physical',
        deliveryProfileId: '',
      })
    ).toBe(false);
  });
  it('수정: 직배 → 사입 전환에 프로필 없으면 true', () => {
    const original = { stockType: 'drop_shipped', deliveryProfileId: '' };
    expect(
      deliveryProfileMissing({
        original,
        stockType: 'physical',
        deliveryProfileId: '',
      })
    ).toBe(true);
  });
  it('수정: 사입 SKU 의 프로필을 지우면 true', () => {
    const original = { stockType: 'physical', deliveryProfileId: 'p1' };
    expect(
      deliveryProfileMissing({
        original,
        stockType: 'physical',
        deliveryProfileId: '',
      })
    ).toBe(true);
  });
});
