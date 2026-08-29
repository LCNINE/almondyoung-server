import {
  COUPON_VISIBILITIES,
  isCouponVisibility,
  toCouponVisibility,
} from './coupon-visibility';

describe('COUPON_VISIBILITIES', () => {
  it('어휘는 오늘 세 값이다 — 늘리려면 드리프트 가드가 가리키는 곳을 함께 고쳐야 한다', () => {
    expect([...COUPON_VISIBILITIES]).toEqual(['public', 'claimable', 'assigned_only']);
  });
});

describe('isCouponVisibility', () => {
  it('어휘 안의 값은 전부 true', () => {
    for (const v of COUPON_VISIBILITIES) {
      expect(isCouponVisibility(v)).toBe(true);
    }
  });

  it('어휘 밖의 값은 전부 false', () => {
    const outsiders: unknown[] = ['members_only', '', 'PUBLIC', null, undefined, 42, {}, ['public']];
    for (const v of outsiders) {
      expect(isCouponVisibility(v)).toBe(false);
    }
  });
});

describe('toCouponVisibility', () => {
  it('값이 없으면 컬럼 기본값과 같은 public 이다', () => {
    expect(toCouponVisibility(null)).toBe('public');
    expect(toCouponVisibility(undefined)).toBe('public');
    expect(toCouponVisibility('')).toBe('public');
  });

  it('어휘 안의 값은 그대로 돌려준다', () => {
    expect(toCouponVisibility('public')).toBe('public');
    expect(toCouponVisibility('claimable')).toBe('claimable');
    expect(toCouponVisibility('assigned_only')).toBe('assigned_only');
  });

  it('어휘 밖의 값은 public 으로 접지 않고 null 로 돌려준다 — #488 N3 의 회귀 방어선', () => {
    expect(toCouponVisibility('members_only')).toBeNull();
    expect(toCouponVisibility('PUBLIC')).toBeNull();
    expect(toCouponVisibility(3)).toBeNull();
    expect(toCouponVisibility({ visibility: 'public' })).toBeNull();
  });
});
