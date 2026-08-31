import { buildCreatePromotionPayload, type CouponFormState } from './build-create-promotion-payload';

const base: CouponFormState = {
  code: 'welcome10',
  name: '웰컴 쿠폰',
  discountType: 'percentage',
  value: 10,
  maxDiscountAmount: '',
  targetType: 'order',
  targetAttribute: 'product_id',
  targetItemIds: [],
  minOrderAmount: '',
  customerGroupIds: [],
  startsAt: '',
  endsAt: '',
  validityDays: '',
  usageLimit: '',
  spendLimit: '',
  maxUsesPerCustomer: '',
  maxClaims: '',
  visibility: 'public',
  autoIssueTrigger: '',
  createdBy: 'admin@lcnine.kr',
};

const opts = { campaignSuffix: '1756400000000' };

// 기존 테스트들은 `{ ...base, ... }` 리터럴을 인라인으로 써왔다. 아래 유효기간 테스트들이
// 요구하는 `form(overrides)` 헬퍼가 파일에 없었으므로 여기서 뽑는다 — `base` 를 감싸기만
// 하고 기본값은 바꾸지 않는다(`validityDays` 기본은 `''`, `base` 에 없으므로 자동으로 `''`).
function form(overrides: Partial<CouponFormState> = {}): CouponFormState {
  return { ...base, ...overrides };
}

describe('buildCreatePromotionPayload', () => {
  it('코드를 대문자로 정규화하고 항상 active·비자동으로 생성한다', () => {
    const p = buildCreatePromotionPayload(base, opts);
    expect(p.code).toBe('WELCOME10');
    expect(p.status).toBe('active');
    expect(p.is_automatic).toBe(false);
    expect(p.type).toBe('standard');
  });

  it('한도·기간이 없으면 campaign 을 만들지 않는다', () => {
    expect(buildCreatePromotionPayload(base, opts).campaign).toBeUndefined();
  });

  it('spend 예산에는 currency_code 를 반드시 싣는다 (1-1 회귀 방지)', () => {
    const p = buildCreatePromotionPayload({ ...base, spendLimit: 5_000_000 }, opts);
    expect(p.campaign?.budget).toEqual({ type: 'spend', limit: 5_000_000, currency_code: 'krw' });
  });

  it('items 대상은 라인아이템 경로로 매핑한다 (1-4 회귀 방지)', () => {
    const p = buildCreatePromotionPayload(
      { ...base, targetType: 'items', targetAttribute: 'product_category_id', targetItemIds: ['cat_1'] },
      opts,
    );
    expect(p.application_method.target_rules).toEqual([
      { attribute: 'items.product.categories.id', operator: 'in', values: ['cat_1'] },
    ]);
    expect(p.application_method.allocation).toBe('across');
  });

  it('최소주문금액과 고객그룹을 promotion rules 로 싣는다', () => {
    const p = buildCreatePromotionPayload(
      { ...base, minOrderAmount: 30000, customerGroupIds: ['cg_1'] },
      opts,
    );
    expect(p.rules).toEqual([
      { attribute: 'subtotal', operator: 'gte', values: ['30000'] },
      { attribute: 'customer.groups.id', operator: 'in', values: ['cg_1'] },
    ]);
  });

  it('claimable 일 때만 max_claims 를 additional_data 에 싣는다', () => {
    const withClaims = buildCreatePromotionPayload(
      { ...base, visibility: 'claimable', maxClaims: 100 }, opts);
    expect(withClaims.additional_data).toMatchObject({ visibility: 'claimable', max_claims: 100 });

    const publicOnly = buildCreatePromotionPayload({ ...base, maxClaims: 100 }, opts);
    expect(publicOnly.additional_data).not.toHaveProperty('max_claims');
  });

  it('campaign_identifier 에 주입받은 suffix 를 붙인다 (1-3 충돌 방지)', () => {
    // 날짜만으로는 더 이상 campaign 이 생기지 않는다(#488 1-3) — 이 테스트가 검증하려는
    // campaign_identifier 를 실제로 얻으려면 예산(캠페인의 유일한 트리거)이 있어야 한다.
    const p = buildCreatePromotionPayload({ ...base, spendLimit: 100000 }, opts);
    expect(p.campaign?.campaign_identifier).toBe('CAMP_WELCOME10_1756400000000');
  });
});

describe('사용 한도 조합', () => {
  it('전역 사용 한도는 campaign budget 이 아니라 promotion.limit 으로 나간다', () => {
    const p = buildCreatePromotionPayload({ ...base, usageLimit: 100 }, opts);
    expect(p.limit).toBe(100);
    expect(p.campaign).toBeUndefined();
  });

  it('전역 한도와 1인당 한도를 동시에 실을 수 있다 (1-2 해금)', () => {
    const p = buildCreatePromotionPayload(
      { ...base, usageLimit: 100, maxUsesPerCustomer: 1 }, opts);
    expect(p.limit).toBe(100);
    expect(p.campaign?.budget).toEqual({
      type: 'use_by_attribute', attribute: 'customer_id', limit: 1,
    });
  });

  it('전역 한도와 총 할인금액 한도를 동시에 실을 수 있다', () => {
    const p = buildCreatePromotionPayload(
      { ...base, usageLimit: 100, spendLimit: 5_000_000 }, opts);
    expect(p.limit).toBe(100);
    expect(p.campaign?.budget).toEqual({
      type: 'spend', limit: 5_000_000, currency_code: 'krw',
    });
  });

  it('총 할인금액 한도와 1인당 한도는 조용히 버리지 않고 throw 한다', () => {
    expect(() =>
      buildCreatePromotionPayload({ ...base, spendLimit: 5_000_000, maxUsesPerCustomer: 1 }, opts),
    ).toThrow('총 할인금액 한도와 1인당 사용 한도는 동시에 설정할 수 없습니다');
  });

  it('전역 한도만 있으면 campaign 을 만들지 않는다 (캠페인 오염 감소)', () => {
    expect(buildCreatePromotionPayload({ ...base, usageLimit: 100 }, opts).campaign).toBeUndefined();
  });
});

describe('spend budget 과 application_method.currency_code 정합', () => {
  // @medusajs/promotion promotion-module.js:542-546 — campaign.budget.type === SPEND 이면
  // application_method.currency_code 와 campaign.budget.currency_code 가 일치해야 하고,
  // 안 실으면 (정률 쿠폰은 기본적으로 currency_code 가 없다) INVALID_DATA 로 400.
  // 이 유닛 테스트는 "우리가 만드는 객체 모양"만 증명한다 — Medusa 가 실제로 받아주는지는
  // 이 테스트로 증명되지 않는다(엔진 통합 테스트가 아니므로).
  it('정률 + spendLimit 이면 application_method 에도 currency_code 가 실린다', () => {
    const p = buildCreatePromotionPayload(
      { ...base, discountType: 'percentage', spendLimit: 5_000_000 },
      opts,
    );
    expect(p.application_method.currency_code).toBe('krw');
    expect(p.campaign?.budget).toEqual({ type: 'spend', limit: 5_000_000, currency_code: 'krw' });
  });

  it('정액 할인은 spendLimit 없이도 currency_code 를 싣는다 (기존 동작 유지)', () => {
    const p = buildCreatePromotionPayload({ ...base, discountType: 'fixed' }, opts);
    expect(p.application_method.currency_code).toBe('krw');
  });

  it('정률 + spendLimit 없음이면 currency_code 를 싣지 않는다', () => {
    const p = buildCreatePromotionPayload({ ...base, discountType: 'percentage' }, opts);
    expect(p.application_method.currency_code).toBeUndefined();
  });
});

// Medusa 는 target_type 이 items·shipping_methods 일 때 allocation 을 요구한다
// (없으면 400 invalid_data). 이 축에 테스트가 하나도 없어서 배송비 쿠폰이 생성
// 불가인 채로 살아남았다 — 리허설 1차가 실측으로 잡았다(#488 F1).
describe('application_method.allocation', () => {
  it('배송비 대상에도 allocation 을 싣는다 (F1 회귀 방지)', () => {
    const p = buildCreatePromotionPayload({ ...base, targetType: 'shipping_methods' }, opts);
    expect(p.application_method.allocation).toBe('across');
  });

  it('상품 대상에는 계속 allocation 을 싣는다', () => {
    const p = buildCreatePromotionPayload(
      { ...base, targetType: 'items', targetItemIds: ['prod_1'] },
      opts,
    );
    expect(p.application_method.allocation).toBe('across');
  });

  it('전체 주문 대상에는 allocation 을 싣지 않는다', () => {
    const p = buildCreatePromotionPayload({ ...base, targetType: 'order' }, opts);
    expect(p.application_method.allocation).toBeUndefined();
  });
});

describe('유효기간 두 축 — 날짜는 additional_data 로, 캠페인은 예산 전용 (#488 결정 1)', () => {
  it('날짜는 campaign 이 아니라 additional_data 로 간다 (#488 결정 1)', () => {
    const out = buildCreatePromotionPayload(
      form({ startsAt: '2026-09-01T00:00', endsAt: '2026-09-30T00:00' }),
      { campaignSuffix: 'X' },
    );
    expect(out.additional_data?.starts_at).toEqual(new Date('2026-09-01T00:00').toISOString());
    expect(out.additional_data?.ends_at).toEqual(new Date('2026-09-30T00:00').toISOString());
  });

  it('🔴 날짜만 넣으면 캠페인을 만들지 않는다 — 캠페인 탭 오염 종결 (#488 1-3)', () => {
    const out = buildCreatePromotionPayload(
      form({ startsAt: '2026-09-01T00:00', endsAt: '2026-09-30T00:00' }),
      { campaignSuffix: 'X' },
    );
    expect(out.campaign).toBeUndefined();
  });

  it('예산이 있으면 캠페인을 만든다 — 예산은 캠페인에만 있다', () => {
    const out = buildCreatePromotionPayload(form({ spendLimit: 100000 }), { campaignSuffix: 'X' });
    expect(out.campaign).toBeDefined();
    expect(out.campaign?.starts_at).toBeUndefined();
    expect(out.campaign?.ends_at).toBeUndefined();
  });

  it('유효기간(일)은 additional_data 로 간다', () => {
    const out = buildCreatePromotionPayload(form({ validityDays: 30 }), { campaignSuffix: 'X' });
    expect(out.additional_data?.validity_days).toEqual(30);
  });

  it('유효기간(일)을 안 넣으면 키 자체가 없다', () => {
    const out = buildCreatePromotionPayload(form({}), { campaignSuffix: 'X' });
    expect('validity_days' in (out.additional_data ?? {})).toBe(false);
  });

  it('유효기간(일)이 0이면 키 자체가 없다 — 백엔드는 0을 양수 정수 위반으로 거부한다', () => {
    const out = buildCreatePromotionPayload(form({ validityDays: 0 }), { campaignSuffix: 'X' });
    expect('validity_days' in (out.additional_data ?? {})).toBe(false);
  });

  it('시작일·종료일이 비어 있으면 additional_data 에도 키가 없다', () => {
    const out = buildCreatePromotionPayload(form({ startsAt: '', endsAt: '' }), { campaignSuffix: 'X' });
    expect('starts_at' in (out.additional_data ?? {})).toBe(false);
    expect('ends_at' in (out.additional_data ?? {})).toBe(false);
  });
});

describe('최대 할인금액 (#488 A4)', () => {
  it('정률 쿠폰이면 additional_data 에 실린다', () => {
    const p = buildCreatePromotionPayload(
      { ...base, discountType: 'percentage', value: 10, maxDiscountAmount: 30000 },
      opts,
    );
    expect(p.additional_data).toMatchObject({ max_discount_amount: 30000 });
  });

  it('정액 쿠폰이면 싣지 않는다 — 정액에 상한은 무의미하다', () => {
    const p = buildCreatePromotionPayload(
      { ...base, discountType: 'fixed', value: 5000, maxDiscountAmount: 30000 },
      opts,
    );
    expect(p.additional_data).not.toHaveProperty('max_discount_amount');
  });

  it('비어 있으면 싣지 않는다', () => {
    const p = buildCreatePromotionPayload(
      { ...base, discountType: 'percentage', value: 10, maxDiscountAmount: '' },
      opts,
    );
    expect(p.additional_data).not.toHaveProperty('max_discount_amount');
  });
});
