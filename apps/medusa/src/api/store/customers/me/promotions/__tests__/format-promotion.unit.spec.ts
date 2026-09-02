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
    const out = formatPromotion(basePromo, true, { visibility: 'claimable', maxDiscountAmount: null, expiresAt: null, validityDays: null });
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
    const out = formatPromotion(basePromo, false, { visibility: 'public', maxDiscountAmount: null, expiresAt: null, validityDays: null });
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
    const out = formatPromotion({ ...basePromo, application_method: null }, false, { visibility: 'public', maxDiscountAmount: null, expiresAt: null, validityDays: null });
    expect(out.application_method).toBeNull();
  });

  it('campaign 은 식별자와 기간 3개 필드만 싣고, 없으면 null 이다', () => {
    expect(formatPromotion(basePromo, false, { visibility: 'public', maxDiscountAmount: null, expiresAt: null, validityDays: null }).campaign).toEqual({
      campaign_identifier: 'CAMP_WELCOME10_1756400000000',
      starts_at: '2026-08-01T00:00:00.000Z',
      ends_at: '2026-09-01T00:00:00.000Z',
    });
    expect(formatPromotion({ ...basePromo, campaign: null }, false, { visibility: 'public', maxDiscountAmount: null, expiresAt: null, validityDays: null }).campaign).toBeNull();
  });

  it('min_order_amount 를 subtotal gte 룰에서 뽑는다 — 값이 문자열이든 {value} 객체든', () => {
    const asString = formatPromotion(
      { ...basePromo, rules: [{ attribute: 'subtotal', operator: 'gte', values: ['30000'] }] },
      false,
      { visibility: 'public', maxDiscountAmount: null, expiresAt: null, validityDays: null },
    );
    const asObject = formatPromotion(
      { ...basePromo, rules: [{ attribute: 'subtotal', operator: 'gte', values: [{ value: '30000' }] }] },
      false,
      { visibility: 'public', maxDiscountAmount: null, expiresAt: null, validityDays: null },
    );
    expect(asString.min_order_amount).toBe(30000);
    expect(asObject.min_order_amount).toBe(30000);
  });

  it('subtotal gte 룰이 없거나 값이 숫자가 아니면 min_order_amount 는 null 이다', () => {
    expect(formatPromotion(basePromo, false, { visibility: 'public', maxDiscountAmount: null, expiresAt: null, validityDays: null }).min_order_amount).toBeNull();
    expect(
      formatPromotion(
        { ...basePromo, rules: [{ attribute: 'customer.groups.id', operator: 'in', values: ['cg_1'] }] },
        false,
        { visibility: 'public', maxDiscountAmount: null, expiresAt: null, validityDays: null },
      ).min_order_amount,
    ).toBeNull();
    expect(
      formatPromotion(
        { ...basePromo, rules: [{ attribute: 'subtotal', operator: 'gte', values: ['이만원'] }] },
        false,
        { visibility: 'public', maxDiscountAmount: null, expiresAt: null, validityDays: null },
      ).min_order_amount,
    ).toBeNull();
  });

  // #488 N2. 스토어 응답의 `metadata` 는 어드민의 합성 metadata 와 이름만 같고 정체가 달랐다 —
  // Medusa 네이티브 json 컬럼이라 쓰는 코드가 0곳이고 값이 항상 null 이었다. 「스토어에 메타가
  // 없다」는 잘못된 진단을 유도했으므로 이름 자체를 비운다. 스토어가 필요로 하는 메타 정보는
  // 최상위 `visibility` 로 이미 나간다.
  it('metadata 를 내리지 않는다 — 네이티브 값이 채워져 있어도 응답에 새지 않는다', () => {
    const out = formatPromotion({ ...basePromo, metadata: { internal: 'x' } }, false, { visibility: 'public', maxDiscountAmount: null, expiresAt: null, validityDays: null });
    expect(out).not.toHaveProperty('metadata');
    expect(JSON.stringify(out)).not.toContain('internal');
  });

  it('visibility 는 스토어가 받는 유일한 메타 정보다 — 항상 최상위 필드로 나간다', () => {
    expect(formatPromotion(basePromo, false, { visibility: 'assigned_only', maxDiscountAmount: null, expiresAt: null, validityDays: null }).visibility).toBe('assigned_only');
  });

  // 응답의 키 집합 자체를 고정한다. 부분일치(`toMatchObject`)만으로는 나중에 누가 `...promo` 를
  // 스프레드하거나 필드를 더해도 스펙이 초록이라, 「무엇이 나가는가」가 다시 검증 밖으로 샌다.
  it('응답 키 집합을 고정한다 — 여기 없는 키는 스토어로 나가지 않는다', () => {
    const out = formatPromotion(basePromo, false, { visibility: 'public', maxDiscountAmount: null, expiresAt: null, validityDays: null });
    expect(Object.keys(out).sort()).toEqual([
      'application_method',
      'campaign',
      'code',
      'expires_at',
      'id',
      'is_assigned',
      'is_automatic',
      'max_discount_amount',
      'min_order_amount',
      'status',
      'type',
      'validity_days',
      'visibility',
    ]);
  });
});

describe('최대 할인금액(#488 A4)', () => {
  it('캡이 있으면 응답에 실린다', () => {
    const result = formatPromotion(basePromo, true, {
      visibility: 'public',
      maxDiscountAmount: 30000,
      expiresAt: null, validityDays: null
    });
    expect(result.max_discount_amount).toBe(30000);
  });

  it('캡이 없으면 null 이다 — 키를 빼지 않는다(클라가 optional 분기를 안 타게)', () => {
    const result = formatPromotion(basePromo, true, {
      visibility: 'public',
      maxDiscountAmount: null,
      expiresAt: null, validityDays: null
    });
    expect(result.max_discount_amount).toBeNull();
  });
});

describe('만료 시점 — 링크 행이 있으면 링크 행, 아니면 정책 (#488 결정 1)', () => {
  it('expires_at 을 최상위로 내린다 — 발급된 장이면 링크 행 값이다', () => {
    const out = formatPromotion(basePromo, true, {
      visibility: 'assigned_only',
      maxDiscountAmount: null,
      expiresAt: '2026-12-31T00:00:00.000Z', validityDays: null
    });
    expect(out.expires_at).toEqual('2026-12-31T00:00:00.000Z');
  });

  it('무기한이면 null 이다', () => {
    const out = formatPromotion(basePromo, false, {
      visibility: 'public',
      maxDiscountAmount: null,
      expiresAt: null, validityDays: null
    });
    expect(out.expires_at).toBeNull();
  });
});

// W1 (2026-08-31). `expires_at` 이 null 인 이유가 「무기한」인지 「미발급 validity_days」인지
// 화면이 구분할 수 있게 정책의 validity_days 를 그대로 최상위에 내린다.
describe('validity_days — 「발급 후 N일」을 표시할 수 있도록 노출한다 (W1)', () => {
  it('정책에 validity_days 가 있으면 최상위로 내린다', () => {
    const out = formatPromotion(basePromo, false, {
      visibility: 'claimable',
      maxDiscountAmount: null,
      expiresAt: null,
      validityDays: 30,
    });
    expect(out.validity_days).toBe(30);
  });

  it('정책에 validity_days 가 없으면 null 이다', () => {
    const out = formatPromotion(basePromo, false, {
      visibility: 'public',
      maxDiscountAmount: null,
      expiresAt: null,
      validityDays: null,
    });
    expect(out.validity_days).toBeNull();
  });
});
