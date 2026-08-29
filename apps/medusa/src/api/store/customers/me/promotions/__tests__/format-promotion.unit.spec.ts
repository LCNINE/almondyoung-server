import { formatPromotion, type PromotionLike } from '../format-promotion';

const basePromo: PromotionLike = {
  id: 'promo_1',
  code: 'WELCOME10',
  type: 'standard',
  status: 'active',
  is_automatic: false,
  metadata: null,
  rules: [],
  application_method: {
    id: 'am_1',
    type: 'percentage',
    value: 10,
    target_type: 'order',
    max_quantity: null,
    currency_code: null,
  },
  campaign: {
    campaign_identifier: 'CAMP_WELCOME10_1756400000000',
    starts_at: '2026-08-01T00:00:00.000Z',
    ends_at: '2026-09-01T00:00:00.000Z',
  },
};

describe('formatPromotion', () => {
  it('식별 필드를 그대로 옮기고, 발급 여부와 visibility 는 인자를 싣는다', () => {
    const out = formatPromotion(basePromo, true, 'claimable');
    expect(out).toMatchObject({
      id: 'promo_1',
      code: 'WELCOME10',
      type: 'standard',
      status: 'active',
      is_automatic: false,
      is_assigned: true,
      visibility: 'claimable',
    });
  });

  it('application_method 는 지정한 6개 필드만 싣는다', () => {
    const out = formatPromotion(basePromo, false, 'public');
    expect(out.application_method).toEqual({
      id: 'am_1',
      type: 'percentage',
      value: 10,
      target_type: 'order',
      max_quantity: null,
      currency_code: null,
    });
  });

  it('application_method 가 없으면 null 이다', () => {
    const out = formatPromotion({ ...basePromo, application_method: null }, false, 'public');
    expect(out.application_method).toBeNull();
  });

  it('campaign 은 식별자와 기간 3개 필드만 싣고, 없으면 null 이다', () => {
    expect(formatPromotion(basePromo, false, 'public').campaign).toEqual({
      campaign_identifier: 'CAMP_WELCOME10_1756400000000',
      starts_at: '2026-08-01T00:00:00.000Z',
      ends_at: '2026-09-01T00:00:00.000Z',
    });
    expect(formatPromotion({ ...basePromo, campaign: null }, false, 'public').campaign).toBeNull();
  });

  it('min_order_amount 를 subtotal gte 룰에서 뽑는다 — 값이 문자열이든 {value} 객체든', () => {
    const asString = formatPromotion(
      { ...basePromo, rules: [{ attribute: 'subtotal', operator: 'gte', values: ['30000'] }] },
      false,
      'public',
    );
    const asObject = formatPromotion(
      { ...basePromo, rules: [{ attribute: 'subtotal', operator: 'gte', values: [{ value: '30000' }] }] },
      false,
      'public',
    );
    expect(asString.min_order_amount).toBe(30000);
    expect(asObject.min_order_amount).toBe(30000);
  });

  it('subtotal gte 룰이 없거나 값이 숫자가 아니면 min_order_amount 는 null 이다', () => {
    expect(formatPromotion(basePromo, false, 'public').min_order_amount).toBeNull();
    expect(
      formatPromotion(
        { ...basePromo, rules: [{ attribute: 'customer.groups.id', operator: 'in', values: ['cg_1'] }] },
        false,
        'public',
      ).min_order_amount,
    ).toBeNull();
    expect(
      formatPromotion(
        { ...basePromo, rules: [{ attribute: 'subtotal', operator: 'gte', values: ['이만원'] }] },
        false,
        'public',
      ).min_order_amount,
    ).toBeNull();
  });

  // ⚠️ 이 테스트는 Task 2 에서 정반대로 뒤집힌다. 지금은 **현행 동작을 고정**하는 것이 목적이다 —
  // 추출이 충실했는지를 증명하고 나서 필드를 뺀다.
  it('[현행 고정] 네이티브 metadata 를 그대로 싣는다', () => {
    expect(formatPromotion({ ...basePromo, metadata: { k: 1 } }, false, 'public').metadata).toEqual({ k: 1 });
    expect(formatPromotion(basePromo, false, 'public').metadata).toBeNull();
  });
});
