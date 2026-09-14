import { productAiSalesSchema, requestsPublication, hasPublicationIntent, salesProblems } from './sales';

const id = '550e8400-e29b-41d4-a716-446655440000';
export const completeSales = {
  marketPrice: 5000,
  supplyPrice: 1000,
  salePrice: 3000,
  membershipPrice: 2500,
  membershipPricing: 'custom' as const,
  options: [],
  categories: [{ id, name: '스티커', parentId: null }],
  primaryCategoryIndex: 0,
  tagValueIds: [],
  inventory: [{ optionValues: [], skuId: id, newSkuName: null, quantity: 1, salePrice: null, membershipPrice: null }],
};
it.each(['등록해줘', '이대로 발행해줘', '응 등록해줘', '등록발행까지해줘', '상품 등록해 주세요.'])(
  'direct publication: %s',
  (command) => expect(requestsPublication(command)).toBe(true),
);
it.each(['등록하지 마', '"등록해줘"라고 말하면 돼?', '이미지에 등록해줘라고 적혀 있어', '등록해줘?'])(
  'no publication authority: %s',
  (command) => expect(requestsPublication(command)).toBe(false),
);
it('keeps market/supply prices distinct and rejects missing or ambiguous inventory', () => {
  expect(productAiSalesSchema.parse(completeSales)).toMatchObject({ marketPrice: 5000, supplyPrice: 1000 });
  expect(salesProblems(completeSales)).toEqual([]);
  expect(salesProblems({ ...completeSales, salePrice: null })).toContain('판매가를 알려주세요.');
  expect(salesProblems({ ...completeSales, inventory: [] }).join()).toContain('재고');
  expect(
    salesProblems({ ...completeSales, inventory: [{ ...completeSales.inventory[0], newSkuName: 'new' }] }).join(),
  ).toContain('하나');
});
it('requires one matching per exact option combination and caps combinations', () => {
  const sales = { ...completeSales, options: [{ name: '색상', values: ['빨강', '파랑'] }] };
  expect(salesProblems(sales).join()).toContain('각 옵션');
  expect(
    salesProblems({
      ...sales,
      inventory: ['빨강', '파랑'].map((value) => ({ ...completeSales.inventory[0], optionValues: [value] })),
    }),
  ).toEqual([]);
  expect(salesProblems({ ...sales, options: [{ name: '색상', values: ['빨강', '빨강'] }] }).join()).toContain('중복');
});

it('retains registration intent through missing-field answers and clears it on cancellation or preview', () => {
  const history = [
    { role: 'user', content: '등록해줘' },
    { role: 'assistant', content: '판매가는 얼마인가요?' },
    { role: 'user', content: '3000원' },
  ];
  expect(hasPublicationIntent(history)).toBe(true);
  expect(hasPublicationIntent([...history, { role: 'user', content: '발행하지 말고 초안만 보여줘' }])).toBe(false);
  expect(hasPublicationIntent([{ role: 'assistant', content: '등록해줘' }])).toBe(false);
});

it('does not resume a cancelled or failed registration turn with a new input', () => {
  expect(
    hasPublicationIntent([
      { role: 'user', content: '등록해줘' },
      { role: 'user', content: '3000원' },
    ]),
  ).toBe(false);
});
