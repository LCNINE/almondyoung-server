import { formatCouponConditions } from './format-coupon-conditions';
import type { MedusaPromotion } from '@/lib/api/domains/medusa/promotions';

const basePromotion: MedusaPromotion = {
  id: 'promo_1',
  code: 'WELCOME10',
  type: 'standard',
  status: 'active',
  is_automatic: false,
  campaign_id: null,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
};

describe('formatCouponConditions', () => {
  it('아무 한도도 없으면 빈 결과(-)를 낸다', () => {
    expect(formatCouponConditions(basePromotion)).toBe('-');
  });

  it('신규 쿠폰: promotion.limit 만 있으면 "전체 N회" 가 나온다', () => {
    const coupon: MedusaPromotion = { ...basePromotion, limit: 100, used: 3 };
    expect(formatCouponConditions(coupon)).toBe('전체 100회');
  });

  it('옛 쿠폰(하위 호환): campaign.budget{type:usage} 만 있어도 여전히 나온다', () => {
    const coupon: MedusaPromotion = {
      ...basePromotion,
      campaign: {
        campaign_identifier: 'CAMP_WELCOME10_1',
        starts_at: null,
        ends_at: null,
        budget: { type: 'usage', limit: 50, used: 10 },
      },
    };
    expect(formatCouponConditions(coupon)).toBe('전체 50회');
  });

  it('신규 조합: promotion.limit + budget use_by_attribute 는 둘 다 나온다 (이 브랜치의 목적)', () => {
    const coupon: MedusaPromotion = {
      ...basePromotion,
      limit: 100,
      used: 3,
      campaign: {
        campaign_identifier: 'CAMP_WELCOME10_1',
        starts_at: null,
        ends_at: null,
        budget: { type: 'use_by_attribute', limit: 1, used: 0 },
      },
    };
    expect(formatCouponConditions(coupon)).toBe('전체 100회 · 1인당 1회');
  });

  it('budget spend 는 금액으로 나온다', () => {
    const coupon: MedusaPromotion = {
      ...basePromotion,
      campaign: {
        campaign_identifier: 'CAMP_WELCOME10_1',
        starts_at: null,
        ends_at: null,
        budget: { type: 'spend', limit: 5_000_000, used: 0 },
      },
    };
    expect(formatCouponConditions(coupon)).toBe('총 5,000,000원 한도');
  });

  it('최소주문금액과 신규 전역 한도를 함께 조립한다', () => {
    const coupon: MedusaPromotion = {
      ...basePromotion,
      limit: 100,
      rules: [{ attribute: 'subtotal', operator: 'gte', values: ['30000'] }],
    };
    expect(formatCouponConditions(coupon)).toBe('30,000원 이상 · 전체 100회');
  });

  it('promotion.limit 과 옛 budget usage 가 동시에 있어도 전체 한도를 중복 표시하지 않는다', () => {
    const coupon: MedusaPromotion = {
      ...basePromotion,
      limit: 100,
      campaign: {
        campaign_identifier: 'CAMP_WELCOME10_1',
        starts_at: null,
        ends_at: null,
        budget: { type: 'usage', limit: 100, used: 0 },
      },
    };
    expect(formatCouponConditions(coupon)).toBe('전체 100회');
  });
});
