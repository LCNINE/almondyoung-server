import { couponPeriodText, isCouponExpired } from './coupon-period';

const NOW = new Date('2026-08-31T00:00:00.000Z');

const promo = (metadata: Record<string, unknown> | null) => ({ metadata }) as any;

describe('couponPeriodText', () => {
  it('시작·종료가 다 있으면 범위로 쓴다', () => {
    expect(
      couponPeriodText(promo({ starts_at: '2026-09-01T00:00:00Z', ends_at: '2026-09-30T00:00:00Z' })),
    ).toMatch(/~/);
  });

  it('종료만 있으면 "~ 종료"', () => {
    expect(couponPeriodText(promo({ ends_at: '2026-09-30T00:00:00Z' })).startsWith('~')).toBe(true);
  });

  it('메타가 없거나 비어 있으면 무기한', () => {
    expect(couponPeriodText(promo(null))).toEqual('무기한');
    expect(couponPeriodText(promo({}))).toEqual('무기한');
  });

  it('유효기간(일)이 있으면 그것을 함께 알린다 — 발급일 기준이라 범위와 다르다', () => {
    expect(couponPeriodText(promo({ ends_at: '2026-09-30T00:00:00Z', validity_days: 30 }))).toMatch(
      /발급 후 30일/,
    );
  });
});

describe('isCouponExpired', () => {
  it('메타의 ends_at 이 지났으면 만료', () => {
    expect(isCouponExpired(promo({ ends_at: '2000-01-01T00:00:00Z' }), NOW)).toBe(true);
  });

  it('아직이면 만료 아님', () => {
    expect(isCouponExpired(promo({ ends_at: '2999-01-01T00:00:00Z' }), NOW)).toBe(false);
  });

  it('ends_at 이 없으면 만료 아님', () => {
    expect(isCouponExpired(promo({}), NOW)).toBe(false);
    expect(isCouponExpired(promo(null), NOW)).toBe(false);
  });
});
