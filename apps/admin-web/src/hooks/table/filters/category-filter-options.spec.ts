import { toCategoryFilterOptions } from './category-filter-options';

describe('toCategoryFilterOptions', () => {
  it('joins the path with > and maps id to value', () => {
    const result = toCategoryFilterOptions([
      {
        id: 'c1',
        name: '스킨케어',
        pathLabel: '스킨케어',
        pathSegments: ['스킨케어'],
        depth: 0,
        parentId: null,
        isActive: true,
      },
      {
        id: 'c2',
        name: '토너',
        pathLabel: '스킨케어 / 토너',
        pathSegments: ['스킨케어', '토너'],
        depth: 1,
        parentId: 'c1',
        isActive: true,
      },
    ]);
    expect(result).toEqual([
      { label: '스킨케어', value: 'c1' },
      { label: '스킨케어 > 토너', value: 'c2' },
    ]);
  });

  it('카테고리명에 슬래시가 있어도 경로가 깨지지 않는다', () => {
    const result = toCategoryFilterOptions([
      {
        id: 'c3',
        name: '의자',
        pathLabel: '가구 / 인테리어 / 의자',
        pathSegments: ['가구 / 인테리어', '의자'],
        depth: 1,
        parentId: 'c0',
        isActive: true,
      },
    ]);
    expect(result).toEqual([{ label: '가구 / 인테리어 > 의자', value: 'c3' }]);
  });

  it('returns an empty array for empty input', () => {
    expect(toCategoryFilterOptions([])).toEqual([]);
  });
});
