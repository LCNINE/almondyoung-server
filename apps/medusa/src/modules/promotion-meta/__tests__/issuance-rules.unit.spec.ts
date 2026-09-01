import {
  evaluateIssuanceRules,
  isIssuableToCustomer,
  requiresCustomerContext,
  CART_CONTEXT_ATTRIBUTES,
  CUSTOMER_SCOPED_ATTRIBUTES,
} from '../issuance-rules';

const groups = (...ids: string[]) => new Set(ids);

describe('evaluateIssuanceRules', () => {
  it('룰이 없으면 통과한다', () => {
    expect(evaluateIssuanceRules([], groups())).toEqual({ eligible: true });
    expect(evaluateIssuanceRules(null, groups())).toEqual({ eligible: true });
    expect(evaluateIssuanceRules(undefined, groups())).toEqual({ eligible: true });
  });

  it('customer.groups.id + in — 그룹에 속하면 통과', () => {
    const rules = [{ attribute: 'customer.groups.id', operator: 'in', values: [{ value: 'cg_1' }] }];
    expect(evaluateIssuanceRules(rules, groups('cg_1'))).toEqual({ eligible: true });
  });

  it('customer.groups.id + in — 그룹에 없으면 group_mismatch', () => {
    const rules = [{ attribute: 'customer.groups.id', operator: 'in', values: [{ value: 'cg_1' }] }];
    expect(evaluateIssuanceRules(rules, groups('cg_2'))).toEqual({
      eligible: false,
      reason: 'group_mismatch',
    });
  });

  it('문자열 values 도 받는다 (query.graph 가 두 모양으로 준다)', () => {
    const rules = [{ attribute: 'customer.groups.id', operator: 'in', values: ['cg_1'] }];
    expect(evaluateIssuanceRules(rules, groups('cg_1'))).toEqual({ eligible: true });
  });

  it('values 가 비면 아무도 못 받는다 (fail-closed)', () => {
    const rules = [{ attribute: 'customer.groups.id', operator: 'in', values: [] }];
    expect(evaluateIssuanceRules(rules, groups('cg_1'))).toEqual({
      eligible: false,
      reason: 'group_mismatch',
    });
  });

  it.each(CART_CONTEXT_ATTRIBUTES)('카트 문맥 룰 %s 은 의도적으로 무시한다', (attribute) => {
    const rules = [{ attribute, operator: 'in', values: [{ value: 'whatever' }] }];
    expect(evaluateIssuanceRules(rules, groups())).toEqual({ eligible: true });
  });

  it('분류표 밖 속성은 fail-closed 다 (오늘의 fail-open 을 뒤집는다)', () => {
    const rules = [{ attribute: 'customer.email', operator: 'eq', values: [{ value: 'a@b.c' }] }];
    expect(evaluateIssuanceRules(rules, groups('cg_1'))).toEqual({
      eligible: false,
      reason: 'unsupported_rule',
      attribute: 'customer.email',
      operator: 'eq',
    });
  });

  it('아는 속성이라도 모르는 operator 면 fail-closed 다', () => {
    // 엔진은 gt/lt/eq/ne/in/lte/gte 를 다 허용한다. 우리 폼은 `in` 만 만든다.
    const rules = [{ attribute: 'customer.groups.id', operator: 'ne', values: [{ value: 'cg_1' }] }];
    expect(evaluateIssuanceRules(rules, groups('cg_1'))).toEqual({
      eligible: false,
      reason: 'unsupported_rule',
      attribute: 'customer.groups.id',
      operator: 'ne',
    });
  });

  it('카트 문맥 + 고객 고유가 섞이면 고객 고유만 본다', () => {
    const rules = [
      { attribute: 'subtotal', operator: 'gte', values: [{ value: '30000' }] },
      { attribute: 'customer.groups.id', operator: 'in', values: [{ value: 'cg_1' }] },
    ];
    expect(evaluateIssuanceRules(rules, groups('cg_1'))).toEqual({ eligible: true });
    expect(evaluateIssuanceRules(rules, groups('cg_9'))).toEqual({
      eligible: false,
      reason: 'group_mismatch',
    });
  });

  it('분류표 밖 룰이 하나라도 있으면 나머지가 통과해도 거부다', () => {
    const rules = [
      { attribute: 'customer.groups.id', operator: 'in', values: [{ value: 'cg_1' }] },
      { attribute: 'customer.created_at', operator: 'gte', values: [{ value: '2026-01-01' }] },
    ];
    expect(evaluateIssuanceRules(rules, groups('cg_1'))).toMatchObject({
      eligible: false,
      reason: 'unsupported_rule',
    });
  });
});

describe('isIssuableToCustomer', () => {
  it('eligible 을 boolean 으로 접는다', () => {
    expect(isIssuableToCustomer([], groups())).toBe(true);
    expect(
      isIssuableToCustomer(
        [{ attribute: 'customer.groups.id', operator: 'in', values: [{ value: 'cg_1' }] }],
        groups('cg_2'),
      ),
    ).toBe(false);
  });
});

describe('requiresCustomerContext', () => {
  it('카트 문맥 룰만 있으면 고객 문맥이 필요 없다', () => {
    expect(requiresCustomerContext([{ attribute: 'subtotal', operator: 'gte', values: [] }])).toBe(false);
    expect(requiresCustomerContext([])).toBe(false);
  });

  it('고객 고유 룰이나 분류표 밖 룰이 있으면 고객 문맥이 필요하다', () => {
    expect(
      requiresCustomerContext([{ attribute: 'customer.groups.id', operator: 'in', values: [] }]),
    ).toBe(true);
    expect(requiresCustomerContext([{ attribute: 'customer.email', operator: 'eq', values: [] }])).toBe(
      true,
    );
  });
});

describe('분류표 자체', () => {
  it('고객 고유 1 + 카트 문맥 5 로 닫혀 있다', () => {
    expect(CUSTOMER_SCOPED_ATTRIBUTES).toEqual(['customer.groups.id']);
    expect([...CART_CONTEXT_ATTRIBUTES].sort()).toEqual(
      [
        'currency_code',
        'region.id',
        'sales_channel_id',
        'shipping_address.country_code',
        'subtotal',
      ].sort(),
    );
  });
});
