import { buildSearchParams } from './products-list-search-params';

const base = {
  q: '',
  categoryId: '',
  supplierIds: [] as string[],
  createdBy: '',
  brand: '',
  status: undefined as string | undefined,
  stock: undefined as string | undefined,
  createdAt: undefined as string | undefined,
  datePreset: 'all',
};

describe('buildSearchParams', () => {
  it('page 를 항상 1로 되돌린다', () => {
    expect(buildSearchParams(base, {}).get('page')).toBe('1');
  });

  it('size 를 보존한다 — 검색해도 표시 개수가 유지돼야 한다', () => {
    expect(buildSearchParams(base, { size: '100' }).get('size')).toBe('100');
  });

  it('sort/order 도 보존한다', () => {
    const params = buildSearchParams(base, { sort: 'name', order: 'asc' });
    expect(params.get('sort')).toBe('name');
    expect(params.get('order')).toBe('asc');
  });

  it('보존값이 없으면 키 자체를 넣지 않는다', () => {
    const params = buildSearchParams(base, {});
    expect(params.has('size')).toBe(false);
    expect(params.has('sort')).toBe(false);
  });

  it('브랜드는 공백을 다듬어 싣는다', () => {
    expect(buildSearchParams({ ...base, brand: '  정관장 ' }, {}).get('brand')).toBe('정관장');
  });

  it('브랜드가 공백뿐이면 싣지 않는다', () => {
    expect(buildSearchParams({ ...base, brand: '   ' }, {}).has('brand')).toBe(false);
  });

  it('공급처는 콤마로 묶는다', () => {
    expect(buildSearchParams({ ...base, supplierIds: ['a', 'b'] }, {}).get('supplierId')).toBe('a,b');
  });

  it('검색어는 공백을 다듬어 싣는다', () => {
    expect(buildSearchParams({ ...base, q: '  마스크팩 ' }, {}).get('q')).toBe('마스크팩');
  });

  it('검색어가 공백뿐이면 싣지 않는다', () => {
    expect(buildSearchParams({ ...base, q: '   ' }, {}).has('q')).toBe(false);
  });

  it('categoryId 가 있으면 그대로 싣는다', () => {
    expect(buildSearchParams({ ...base, categoryId: 'cat-1' }, {}).get('categoryId')).toBe('cat-1');
  });

  it('categoryId 가 없으면 키 자체를 넣지 않는다', () => {
    expect(buildSearchParams(base, {}).has('categoryId')).toBe(false);
  });

  it('createdBy 가 있으면 그대로 싣는다', () => {
    expect(buildSearchParams({ ...base, createdBy: 'user-1' }, {}).get('createdBy')).toBe('user-1');
  });

  it('createdBy 가 없으면 키 자체를 넣지 않는다', () => {
    expect(buildSearchParams(base, {}).has('createdBy')).toBe(false);
  });

  it('status 가 있으면 그대로 싣는다', () => {
    expect(buildSearchParams({ ...base, status: 'active' }, {}).get('status')).toBe('active');
  });

  it('status 가 없으면 키 자체를 넣지 않는다', () => {
    expect(buildSearchParams(base, {}).has('status')).toBe(false);
  });

  it('stock 이 있으면 그대로 싣는다', () => {
    expect(buildSearchParams({ ...base, stock: 'sold_out' }, {}).get('stock')).toBe('sold_out');
  });

  it('stock 이 없으면 키 자체를 넣지 않는다', () => {
    expect(buildSearchParams(base, {}).has('stock')).toBe(false);
  });

  it('createdAt 이 있으면 그대로 싣는다', () => {
    const createdAt = JSON.stringify({ from: '2026-01-01', to: '2026-01-31' });
    expect(buildSearchParams({ ...base, createdAt }, {}).get('createdAt')).toBe(createdAt);
  });

  it('createdAt 이 없으면 키 자체를 넣지 않는다', () => {
    expect(buildSearchParams(base, {}).has('createdAt')).toBe(false);
  });

  it("datePreset 이 'all' 이 아니면 싣는다", () => {
    expect(buildSearchParams({ ...base, datePreset: '7d' }, {}).get('datePreset')).toBe('7d');
  });

  it("datePreset 이 'all' 이면 싣지 않는다", () => {
    expect(buildSearchParams({ ...base, datePreset: 'all' }, {}).has('datePreset')).toBe(false);
  });

  it('여러 키를 동시에 채우면 각각 제 이름으로 실린다 — 이름이 맞바뀌면 이 테스트가 잡는다', () => {
    const params = buildSearchParams(
      {
        q: 'q값',
        categoryId: 'categoryId값',
        supplierIds: ['supplierId값'],
        createdBy: 'createdBy값',
        brand: 'brand값',
        status: 'status값',
        stock: 'stock값',
        createdAt: 'createdAt값',
        datePreset: 'datePreset값',
      },
      { size: 'size값', sort: 'sort값', order: 'order값' },
    );

    expect(params.get('q')).toBe('q값');
    expect(params.get('categoryId')).toBe('categoryId값');
    expect(params.get('supplierId')).toBe('supplierId값');
    expect(params.get('createdBy')).toBe('createdBy값');
    expect(params.get('brand')).toBe('brand값');
    expect(params.get('status')).toBe('status값');
    expect(params.get('stock')).toBe('stock값');
    expect(params.get('createdAt')).toBe('createdAt값');
    expect(params.get('datePreset')).toBe('datePreset값');
    expect(params.get('size')).toBe('size값');
    expect(params.get('sort')).toBe('sort값');
    expect(params.get('order')).toBe('order값');
  });

  it(
    "이 함수는 'all' sentinel 을 모른다 — 호출부가 변환을 잊고 그대로 넘기면 " +
      "categoryId=all/createdBy=all 이 문자열 그대로 URL 에 실린다. truthy 검사만 하기 " +
      "때문이고, 여기서 'all' 을 걸러주는 방어선은 없다(그래서 hasActiveFilter 가 이걸 " +
      "활성 필터로 오판할 수 있다 — 변환은 반드시 호출부 책임). 나중에 이 함수 안에서 " +
      "'all' 을 특별 취급하기 시작하면 이 테스트가 깨져서 그 변경을 드러낸다.",
    () => {
      const params = buildSearchParams({ ...base, categoryId: 'all', createdBy: 'all' }, {});
      expect(params.get('categoryId')).toBe('all');
      expect(params.get('createdBy')).toBe('all');
    },
  );

  it('categoryId/createdBy 가 빈 문자열이면 키 자체를 넣지 않는다', () => {
    const params = buildSearchParams({ ...base, categoryId: '', createdBy: '' }, {});
    expect(params.has('categoryId')).toBe(false);
    expect(params.has('createdBy')).toBe(false);
  });
});
