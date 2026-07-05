import { toCategoryFilterOptions } from './category-filter-options';

describe('toCategoryFilterOptions', () => {
  it('maps pathLabel to label and id to value', () => {
    const result = toCategoryFilterOptions([
      {
        id: 'c1',
        name: '스킨케어',
        pathLabel: '스킨케어',
        depth: 0,
        parentId: null,
        isActive: true,
      },
      {
        id: 'c2',
        name: '토너',
        pathLabel: '스킨케어 / 토너',
        depth: 1,
        parentId: 'c1',
        isActive: true,
      },
    ]);
    expect(result).toEqual([
      { label: '스킨케어', value: 'c1' },
      { label: '스킨케어 / 토너', value: 'c2' },
    ]);
  });

  it('returns an empty array for empty input', () => {
    expect(toCategoryFilterOptions([])).toEqual([]);
  });
});
