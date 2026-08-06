import {
  applyPolicyDecisions,
  extractVariantPolicies,
  hasPolicyFields,
  stripPolicyFields,
} from './bulk-session.policy';

const rows = (combo: string, cells: Record<string, string>) => [{ combination: combo, ...cells }];

describe('stripPolicyFields', () => {
  it('정책 경로만 빼고 나머지는 그대로 둔다', () => {
    const out = stripPolicyFields({
      'product.name': '새 이름',
      'variant:c1.variantCode': 'V-1',
      'variant:c1.preStockSellable': 'Y',
      'variant:c1.availabilityOverride': '품절',
    });
    expect(out).toEqual({ 'product.name': '새 이름', 'variant:c1.variantCode': 'V-1' });
  });

  it('옵션 없는 상품의 빈 조합키도 걸러낸다', () => {
    // combination 이 빈 문자열인 것은 예외가 아니라 계약이다(form-export.snapshot.reader.ts:263-267).
    expect(stripPolicyFields({ 'variant:.preStockSellable': 'Y' })).toEqual({});
  });
});

describe('extractVariantPolicies', () => {
  it('선판매·항상판매를 boolean 으로 옮긴다', () => {
    const out = extractVariantPolicies(
      { 'variant:c1.preStockSellable': 'Y', 'variant:c1.alwaysSellableZeroStock': 'N' },
      rows('c1', {}),
    );
    expect(out.get('c1')).toEqual({ preStockSellable: true, alwaysSellableZeroStock: false });
  });

  it('빈칸은 지시 없음이라 키를 만들지 않는다', () => {
    const out = extractVariantPolicies({ 'variant:c1.preStockSellable': '' }, rows('c1', {}));
    expect(out.get('c1')).toBeUndefined();
  });

  it('판매상태재정의를 비우면 해제(null)로 옮긴다', () => {
    const out = extractVariantPolicies(
      { 'variant:c1.availabilityOverride': '' },
      rows('c1', { availabilityOverride: '', comingSoonDate: '' }),
    );
    expect(out.get('c1')).toEqual({ availabilityOverride: null, comingSoonDate: null });
  });

  it('출시예정은 날짜와 한 단위로 실린다', () => {
    const out = extractVariantPolicies(
      { 'variant:c1.availabilityOverride': '출시예정' },
      rows('c1', { availabilityOverride: '출시예정', comingSoonDate: '2026-09-01' }),
    );
    expect(out.get('c1')).toEqual({ availabilityOverride: 'coming_soon', comingSoonDate: '2026-09-01' });
  });

  it('날짜만 바뀐 행도 override 를 함께 싣는다', () => {
    // upsertSalesVariantPolicy 가 comingSoonDate 를 availabilityOverride **키의 존재**로
    // 게이팅한다 — 날짜만 보내면 조용히 버려진다. 차분에는 override 가 없으므로 시트에서 읽는다.
    const out = extractVariantPolicies(
      { 'variant:c1.comingSoonDate': '2026-10-01' },
      rows('c1', { availabilityOverride: '출시예정', comingSoonDate: '2026-10-01' }),
    );
    expect(out.get('c1')).toEqual({ availabilityOverride: 'coming_soon', comingSoonDate: '2026-10-01' });
  });

  it('정책 차분이 없는 조합은 항목을 만들지 않는다', () => {
    const out = extractVariantPolicies({ 'variant:c1.variantCode': 'V-1' }, rows('c1', {}));
    expect(out.size).toBe(0);
  });
});

/**
 * 충돌 결정은 정책 필드에도 걸린다(스펙 §4.2). 이 필터가 없으면 관리자가 UI 에서 바꾼 값을
 * 작업자가 `skip`(현재 값 유지)으로 결정했는데도 양식의 옛 값이 그것을 덮는다 — 아무도
 * 지시하지 않은 변경이고, 화면은 '발행됨' 으로 보인다.
 */
describe('applyPolicyDecisions', () => {
  it('skip 한 필드를 뺀다', () => {
    const out = applyPolicyDecisions(
      { 'variant:c1.preStockSellable': 'Y', 'variant:c1.alwaysSellableZeroStock': 'N' },
      { 'variant:c1.preStockSellable': 'skip' },
    );
    expect(out).toEqual({ 'variant:c1.alwaysSellableZeroStock': 'N' });
  });

  it('(a) 판매상태재정의를 skip 하면 그 조합에 override 패치가 안 나간다', () => {
    const fields = { 'variant:c1.availabilityOverride': '품절' };
    const decided = applyPolicyDecisions(fields, { 'variant:c1.availabilityOverride': 'skip' });

    expect(decided).toEqual({});
    // 짝 칸 규약이 시트에서 값을 되읽지 못하는지까지 본다 — 거른 뒤 실제 추출까지 태운다.
    const policies = extractVariantPolicies(decided, rows('c1', { availabilityOverride: '품절', comingSoonDate: '' }));
    expect(policies.size).toBe(0);
  });

  it('(b) 출시예정일만 남아도 override 가 시트에서 되살아나지 않는다', () => {
    // 이것이 이 필터의 존재 이유다. `applyDecisions` 만 쓰면 comingSoonDate 가 살아남고,
    // `extractVariantPolicies` 는 짝 칸 규약 때문에 **시트 원본에서 override 를 다시 읽는다**
    // — skip 한 '품절' 이 정확히 그 경로로 부활한다.
    const fields = {
      'variant:c1.availabilityOverride': '품절',
      'variant:c1.comingSoonDate': '',
    };
    const decided = applyPolicyDecisions(fields, { 'variant:c1.availabilityOverride': 'skip' });

    expect(decided).toEqual({});
    const policies = extractVariantPolicies(decided, rows('c1', { availabilityOverride: '품절', comingSoonDate: '' }));
    expect(policies.get('c1')).toBeUndefined();
  });

  it('override 축만 빼고 같은 조합의 다른 정책 축은 남긴다', () => {
    const out = applyPolicyDecisions(
      {
        'variant:c1.availabilityOverride': '품절',
        'variant:c1.comingSoonDate': '',
        'variant:c1.preStockSellable': 'Y',
      },
      { 'variant:c1.comingSoonDate': 'skip' },
    );
    // 짝 중 하나가 skip 이라 override 축은 통째로 빠지지만, 선판매는 별개 축이다.
    expect(out).toEqual({ 'variant:c1.preStockSellable': 'Y' });
  });

  it('다른 조합의 override 는 건드리지 않는다', () => {
    const out = applyPolicyDecisions(
      { 'variant:c1.availabilityOverride': '품절', 'variant:c2.availabilityOverride': '출시예정' },
      { 'variant:c1.availabilityOverride': 'skip' },
    );
    expect(out).toEqual({ 'variant:c2.availabilityOverride': '출시예정' });
  });

  it('결정이 없으면 그대로 통과시킨다', () => {
    const fields = { 'variant:c1.availabilityOverride': '품절', 'product.name': '새 이름' };
    expect(applyPolicyDecisions(fields, {})).toEqual(fields);
  });
});

describe('hasPolicyFields', () => {
  it('정책 경로가 있으면 참이다', () => {
    expect(hasPolicyFields({ 'variant:c1.preStockSellable': 'Y' })).toBe(true);
  });

  it('정책 경로가 없으면 거짓이다', () => {
    expect(hasPolicyFields({ 'product.name': '새 이름', 'variant:c1.variantCode': 'V-1' })).toBe(false);
  });
});
