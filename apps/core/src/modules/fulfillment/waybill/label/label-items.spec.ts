import { labelItemsOf, paginate } from './label-items';

describe('labelItemsOf — 배정 행을 (로케이션, SKU) 로', () => {
  const row = (locationCode: string, skuId: string, skuName: string, qty: number) => ({
    locationCode,
    skuId,
    skuName,
    qty,
  });

  it('같은 로케이션·같은 SKU 는 한 줄로 합친다(한 SKU 의 여러 출고 줄)', () => {
    expect(labelItemsOf([row('A-01', 's1', '볼펜', 1), row('A-01', 's1', '볼펜', 2)])).toEqual([
      { locationCode: 'A-01', skuId: 's1', name: '볼펜', quantity: 3 },
    ]);
  });

  it('같은 SKU 라도 로케이션이 다르면 두 줄 — 집는 곳이 다르다', () => {
    expect(
      labelItemsOf([row('B-02', 's1', '볼펜', 1), row('A-01', 's1', '볼펜', 2)]).map((i) => [
        i.locationCode,
        i.quantity,
      ]),
    ).toEqual([
      ['A-01', 2],
      ['B-02', 1],
    ]);
  });

  it('로케이션 코드 순 → 이름순(ko) → skuId 순, 입력 순서에 흔들리지 않는다', () => {
    const rows = [
      row('A-01', 's2', '하마', 1),
      row('A-01', 's1', '가위', 1),
      row('A-01', 's3', '가위', 1),
      row('A-00', 's9', '펜', 1),
    ];
    const items = labelItemsOf(rows);
    expect(items.map((i) => `${i.locationCode}/${i.name}/${i.skuId}`)).toEqual([
      'A-00/펜/s9',
      'A-01/가위/s1',
      'A-01/가위/s3',
      'A-01/하마/s2',
    ]);
    expect(labelItemsOf([...rows].reverse())).toEqual(items);
  });

  it('빈 목록은 빈 목록', () => {
    expect(labelItemsOf([])).toEqual([]);
  });
});

describe('paginate', () => {
  it.each([
    [0, 1],
    [1, 1],
    [4, 1],
    [5, 2],
    [8, 2],
    [9, 3],
  ])('%d 줄 → %d 쪽 (한 쪽 4줄)', (n, pages) => {
    expect(
      paginate(
        Array.from({ length: n }, (_, i) => i),
        4,
      ),
    ).toHaveLength(pages);
  });

  it('순서를 지키며 앞 쪽부터 채운다', () => {
    expect(paginate([1, 2, 3, 4, 5, 6, 7, 8, 9], 4)).toEqual([[1, 2, 3, 4], [5, 6, 7, 8], [9]]);
  });

  it('빈 목록도 빈 쪽 하나', () => {
    expect(paginate([], 4)).toEqual([[]]);
  });

  it('한 쪽 줄 수가 1 미만이면 던진다', () => {
    expect(() => paginate([1], 0)).toThrow(/perPage/);
  });
});
