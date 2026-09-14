import type { ProductAiDraft } from './draft';
import { publicationNextStep, publicationProblems } from './publication';

const id = '550e8400-e29b-41d4-a716-446655440000';
const draft: ProductAiDraft = {
  name: '냥이 스티커',
  description: '',
  seoTitle: '스티커',
  seoDescription: '스티커',
  seoKeywords: [],
  tags: [],
  thumbnailFileId: id,
  additionalImageFileIds: [],
  sections: [{ kind: 'text', heading: '', body: '스티커' }],
  pendingItems: [],
  sales: {
    marketPrice: 5000,
    supplyPrice: 1000,
    salePrice: 3000,
    membershipPrice: 2500,
    membershipPricing: 'custom',
    options: [],
    categories: [],
    primaryCategoryIndex: null,
    tagValueIds: [],
    inventory: [],
  },
};

it('guides category selection first, then inventory, without asking to save a draft', () => {
  expect(publicationNextStep(draft)).toMatchObject({ label: '카테고리 후보 찾기' });
  const categorized = {
    ...draft,
    sales: { ...draft.sales!, categories: [{ id, name: '스티커', parentId: null }], primaryCategoryIndex: 0 },
  };
  expect(publicationNextStep(categorized)).toMatchObject({ label: '기존 재고 후보 찾기' });
  const complete = {
    ...categorized,
    sales: {
      ...categorized.sales,
      inventory: [
        { optionValues: [], skuId: id, newSkuName: null, quantity: 1, salePrice: null, membershipPrice: null },
      ],
    },
  };
  expect(publicationProblems(complete)).toEqual([]);
  expect(publicationNextStep(complete)).toBeNull();
});

it('preserves server-required creation review before ordinary missing fields', () => {
  const approval = '새 재고 품목 생성 계획을 확인해 주세요.';
  expect(publicationNextStep(draft, [approval, ...publicationProblems(draft)])?.question).toBe(approval);
});

it('asks only for the primary category when categories are already selected', () => {
  expect(
    publicationNextStep({
      ...draft,
      sales: { ...draft.sales!, categories: [{ id, name: '스티커', parentId: null }] },
    }),
  ).toMatchObject({ label: '대표카테고리 선택하기' });
});

it('does not overlook missing thumbnail or other unresolved questions', () => {
  expect(publicationProblems({ ...draft, thumbnailFileId: null, pendingItems: ['규격 확인'] })).toEqual(
    expect.arrayContaining(['대표 이미지를 선택해 주세요.', '규격 확인']),
  );
});
