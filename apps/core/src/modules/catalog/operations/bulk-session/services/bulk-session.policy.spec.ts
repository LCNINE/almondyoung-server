import { extractVariantPolicies, stripPolicyFields } from './bulk-session.policy';

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
