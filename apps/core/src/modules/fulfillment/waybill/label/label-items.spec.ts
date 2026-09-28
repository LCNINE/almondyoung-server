import { labelItemsOf, paginate } from './label-items';

describe('labelItemsOf', () => {
  it('같은 SKU 는 한 줄로 합치고 수량을 더한다', () => {
    expect(
      labelItemsOf([
        { skuId: 'a', skuName: '볼펜', quantity: 1 },
        { skuId: 'b', skuName: '공책', quantity: 2 },
        { skuId: 'a', skuName: '볼펜', quantity: 3 },
      ]),
    ).toEqual([
      { name: '공책', quantity: 2 },
      { name: '볼펜', quantity: 4 },
    ]);
  });

  it('한글 이름순이고 입력 순서에 흔들리지 않는다', () => {
    const lines = [
      { skuId: '1', skuName: '하마', quantity: 1 },
      { skuId: '2', skuName: '가위', quantity: 1 },
      { skuId: '3', skuName: '나비', quantity: 1 },
    ];
    expect(labelItemsOf(lines).map((i) => i.name)).toEqual(['가위', '나비', '하마']);
    expect(labelItemsOf([...lines].reverse())).toEqual(labelItemsOf(lines));
  });

  it('동명의 다른 SKU 는 합치지 않고 skuId 순 두 줄', () => {
    const lines = [
      { skuId: 'b', skuName: '펜', quantity: 1 },
      { skuId: 'a', skuName: '펜', quantity: 2 },
    ];
    expect(labelItemsOf(lines)).toEqual([
      { name: '펜', quantity: 2 },
      { name: '펜', quantity: 1 },
    ]);
    expect(labelItemsOf([...lines].reverse())).toEqual(labelItemsOf(lines));
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
