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
    const p = buildCreatePromotionPayload({ ...base, endsAt: '2026-12-31' }, opts);
    expect(p.campaign?.campaign_identifier).toBe('CAMP_WELCOME10_1756400000000');
  });
});
