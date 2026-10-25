import { SHIPMENT_TRANSITIONS, assertLegalTransition, transitionEffect } from './shipment-transitions';

describe('shipment-transitions', () => {
  it('표는 15행이다', () => {
    expect(SHIPMENT_TRANSITIONS).toHaveLength(15);
  });

  it.each(SHIPMENT_TRANSITIONS.map((r) => [r.from, r.to, r]))('%s → %s 는 합법', (_from, _to, rule) => {
    expect(() =>
      assertLegalTransition(rule.from, rule.to, {
        fromCode: rule.fromCodes?.[0],
        toCode: rule.toCodes?.[0],
      }),
    ).not.toThrow();
  });

  it('표에 없는 쌍은 Error', () => {
    expect(() => assertLegalTransition('delivered', 'draft', {})).toThrow(Error);
    expect(() => assertLegalTransition('draft', 'draft', {})).toThrow(Error);
    expect(() => assertLegalTransition('failed', 'draft', {})).toThrow(Error);
  });

  it('draft → shipped 는 입점사 전용 행으로만 합법이다', () => {
    expect(() => assertLegalTransition('draft', 'shipped', {})).not.toThrow();
    const rules = SHIPMENT_TRANSITIONS.filter((r) => r.from === 'draft' && r.to === 'shipped');
    expect(rules).toHaveLength(1);
    expect(rules[0].owner).toBe('supplier');
    expect(SHIPMENT_TRANSITIONS.filter((r) => r.owner === 'supplier')).toHaveLength(1);
  });

  it('recovery_required 로 갈 때 코드가 없거나 허용 밖이면 Error', () => {
    expect(() => assertLegalTransition('draft', 'recovery_required', {})).toThrow();
    expect(() => assertLegalTransition('draft', 'recovery_required', { toCode: 'DISPATCH_RECALL_PENDING' })).toThrow();
  });

  it('CONSOLIDATION_PENDING 에서 draft 로는 못 간다', () => {
    expect(() => assertLegalTransition('recovery_required', 'draft', { fromCode: 'CONSOLIDATION_PENDING' })).toThrow();
  });

  it('재개봉 효과는 넷을 비우고 버전을 올리고 검수를 지운다', () => {
    expect(transitionEffect('draft')).toEqual({
      stamp: null,
      clears: ['recoveryCode', 'plannedAt', 'shippedAt', 'deliveredAt'],
      bumpsManifest: true,
      resetsInspection: true,
    });
  });

  it('superseded·canceled 도 manifest 를 올린다', () => {
    expect(transitionEffect('superseded').bumpsManifest).toBe(true);
    expect(transitionEffect('canceled').bumpsManifest).toBe(true);
  });
});
