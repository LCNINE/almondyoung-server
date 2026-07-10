import { ProductImportNormalizer } from './product-import.normalizer';
import { CategoryNode } from '../dto/import.types';

const CATEGORIES: CategoryNode[] = [
  { id: 'c-women', name: '여성패션', slug: 'women', parentId: null },
  { id: 'c-knit', name: '니트', slug: 'women-knit', parentId: 'c-women' },
  { id: 'c-men', name: '남성패션', slug: 'men', parentId: null },
  { id: 'c-knit2', name: '니트', slug: 'men-knit', parentId: 'c-men' }, // 동명 형제(다른 부모)
];

function parsed(products: Record<string, string>[], options: Record<string, string>[] = []) {
  return {
    products: products.map((cells, i) => ({ rowNumber: i + 1, cells })),
    options: options.map((cells, i) => ({ rowNumber: i + 1, cells })),
  };
}

describe('ProductImportNormalizer', () => {
  const normalizer = new ProductImportNormalizer();

  it('categoryPath(이름 경로)를 leaf id 로 해석하고 이름도 기록한다', () => {
    const [rec] = normalizer.normalize(parsed([{ productKey: 'P1', name: '니트A', categoryPath: '여성패션>니트' }]), CATEGORIES);
    expect(rec.categoryIds).toEqual(['c-knit']);
    expect(rec.primaryCategoryId).toBe('c-knit');
    expect(rec.categoryNames).toEqual(['여성패션', '니트']);
    expect(rec.errors).toEqual([]);
  });

  it('해석 불가 categoryPath 는 에러', () => {
    const [rec] = normalizer.normalize(parsed([{ productKey: 'P1', name: 'x', categoryPath: '없는>경로' }]), CATEGORIES);
    expect(rec.categoryIds).toEqual([]);
    expect(rec.errors.some((e) => e.sheet === 'Products' && /카테고리/.test(e.message))).toBe(true);
  });

  it('slug 정확 매칭도 허용한다', () => {
    const [rec] = normalizer.normalize(parsed([{ productKey: 'P1', name: 'x', categoryPath: 'men-knit' }]), CATEGORIES);
    expect(rec.categoryIds).toEqual(['c-knit2']);
  });

  it('Options 행을 productKey 로 묶어 옵션그룹을 만든다', () => {
    const [rec] = normalizer.normalize(
      parsed(
        [{ productKey: 'P1', name: 'x' }],
        [
          { productKey: 'P1', optionName: '색상', optionValues: '빨강|파랑' },
          { productKey: 'P1', optionName: '사이즈', optionValues: 'S|M|L' },
        ],
      ),
      CATEGORIES,
    );
    expect(rec.options).toEqual([
      { displayName: '색상', values: [{ displayName: '빨강' }, { displayName: '파랑' }] },
      { displayName: '사이즈', values: [{ displayName: 'S' }, { displayName: 'M' }, { displayName: 'L' }] },
    ]);
  });

  it('파일 내 중복 productKey 는 에러', () => {
    const recs = normalizer.normalize(parsed([{ productKey: 'P1', name: 'a' }, { productKey: 'P1', name: 'b' }]), CATEGORIES);
    expect(recs[1].errors.some((e) => /중복/.test(e.message))).toBe(true);
  });

  it('존재하지 않는 productKey 를 참조하는 Options 행은 invalid 레코드로 surface 한다', () => {
    const recs = normalizer.normalize(
      parsed([{ productKey: 'P1', name: 'a' }], [{ productKey: 'GHOST', optionName: '색상', optionValues: '빨강' }]),
      CATEGORIES,
    );
    const ghost = recs.find((r) => r.productKey === 'GHOST');
    expect(ghost).toBeDefined();
    expect(ghost!.errors.some((e) => e.sheet === 'Options')).toBe(true);
  });
});
