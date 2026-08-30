import { buildCreatePromotionPayload, type CouponFormState } from './build-create-promotion-payload';

const base: CouponFormState = {
  code: 'welcome10',
  name: '웰컴 쿠폰',
  discountType: 'percentage',
  value: 10,
  targetType: 'order',
  targetAttribute: 'product_id',
  targetItemIds: [],
  minOrderAmount: '',
  customerGroupIds: [],
  startsAt: '',
  endsAt: '',
  usageLimit: '',
  spendLimit: '',
  maxUsesPerCustomer: '',
  maxClaims: '',
  visibility: 'public',
  autoIssueTrigger: '',
  createdBy: 'admin@lcnine.kr',
};

const opts = { campaignSuffix: '1756400000000' };

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
    // UI 는 datetime-local 이라 실제 입력은 'YYYY-MM-DDTHH:mm' 꼴이다 — 날짜만 있는 픽스처는
    // 이 필드가 실제로 뭘 받는지 검증하지 못하는 거짓 안전이라 실제 입력 모양으로 맞춘다.
    const p = buildCreatePromotionPayload({ ...base, endsAt: '2026-12-31T23:59' }, opts);
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
