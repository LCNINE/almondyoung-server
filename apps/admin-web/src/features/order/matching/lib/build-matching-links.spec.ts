import { buildMatchingLinks, normalizeQuantity, type AutoTabState } from './build-matching-links';

const HOLDER = '11111111-1111-1111-1111-111111111111';
const SUPPLIER = '22222222-2222-2222-2222-222222222222';

function state(overrides: Partial<AutoTabState> = {}): AutoTabState {
  return {
    holderId: HOLDER,
    supplierId: SUPPLIER,
    businessProductName: '사입 상품명',
    importDeclarationNumber: '',
    optionKey: '',
    productDescription: '',
    moq: '',
    memo2: '',
    memo3: '',
    optionRows: [{ id: 'r1', name: 'S / 검정', quantity: 1 }],
    ...overrides,
  };
}

describe('normalizeQuantity', () => {
  it('floors to at least 1 and truncates fractions', () => {
    expect(normalizeQuantity(0)).toBe(1);
    expect(normalizeQuantity(-3)).toBe(1);
    expect(normalizeQuantity(2.7)).toBe(2);
    expect(normalizeQuantity(Number.NaN)).toBe(1);
    expect(normalizeQuantity(5)).toBe(5);
  });
});

describe('buildMatchingLinks', () => {
  it('builds one newSku link per filled option row', () => {
    const result = buildMatchingLinks(
      state({
        optionRows: [
          { id: 'r1', name: 'S / 검정', quantity: 2 },
          { id: 'r2', name: 'M / 검정', quantity: 1 },
        ],
      }),
    );

    expect(result).toEqual({
      ok: true,
      links: [
        {
          quantity: 2,
          newSku: { name: 'S / 검정', holderId: HOLDER, supplierIds: [SUPPLIER], businessProductName: '사입 상품명' },
        },
        {
          quantity: 1,
          newSku: { name: 'M / 검정', holderId: HOLDER, supplierIds: [SUPPLIER], businessProductName: '사입 상품명' },
        },
      ],
    });
  });

  it('drops rows whose name is blank', () => {
    const result = buildMatchingLinks(
      state({
        optionRows: [
          { id: 'r1', name: '  ', quantity: 1 },
          { id: 'r2', name: 'M', quantity: 1 },
          { id: 'r3', name: '', quantity: 1 },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.links).toHaveLength(1);
    expect(result.ok && result.links[0].newSku?.name).toBe('M');
  });

  it('trims option names', () => {
    const result = buildMatchingLinks(state({ optionRows: [{ id: 'r1', name: '  S  ', quantity: 1 }] }));
    expect(result.ok && result.links[0].newSku?.name).toBe('S');
  });

  it('omits blank optional fields rather than sending empty strings', () => {
    const result = buildMatchingLinks(state({ businessProductName: '   ', memo2: '' }));
    expect(result.ok && result.links[0].newSku).toEqual({
      name: 'S / 검정',
      holderId: HOLDER,
      supplierIds: [SUPPLIER],
    });
  });

  it('carries the optional fields that core can store', () => {
    const result = buildMatchingLinks(
      state({
        importDeclarationNumber: 'IMP-1',
        optionKey: 'S/검정',
        productDescription: '설명',
        moq: '10',
        memo2: '메모2',
        memo3: '메모3',
      }),
    );

    expect(result.ok && result.links[0].newSku).toMatchObject({
      importDeclarationNumber: 'IMP-1',
      optionKey: 'S/검정',
      productDescription: '설명',
      moq: 10,
      memo2: '메모2',
      memo3: '메모3',
    });
  });

  it('drops a non-numeric or non-positive moq', () => {
    for (const moq of ['abc', '0', '-4', '']) {
      const result = buildMatchingLinks(state({ moq }));
      expect(result.ok).toBe(true);
      expect(result.ok && 'moq' in (result.links[0].newSku ?? {})).toBe(false);
    }
  });

  it('reports missing-required when supplier or holder is unset', () => {
    expect(buildMatchingLinks(state({ supplierId: '' }))).toEqual({ ok: false, reason: 'missing-required' });
    expect(buildMatchingLinks(state({ holderId: '' }))).toEqual({ ok: false, reason: 'missing-required' });
  });

  it('reports no-options when every row is blank', () => {
    expect(buildMatchingLinks(state({ optionRows: [{ id: 'r1', name: ' ', quantity: 1 }] }))).toEqual({
      ok: false,
      reason: 'no-options',
    });
  });
});
