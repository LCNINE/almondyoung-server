import { buildShelfPositionRows } from './load-shelf-positions';

const HEADER = ['옵션정보일련번호', '상품위치', '대표이미지주소'];

describe('buildShelfPositionRows', () => {
  it('위치를 정규화하고 빈 위치는 건너뛴다', () => {
    const out = buildShelfPositionRows([
      HEADER,
      ['92663', ' t-01-20 ', 'https://x/a.jpg'],
      ['92662', '', ''],
      ['92661', 'P-01-06', ''],
    ]);
    expect(out.rows).toEqual([
      { skuCode: '92663', positionCode: 'T-01-20', imageUrl: 'https://x/a.jpg' },
      { skuCode: '92661', positionCode: 'P-01-06', imageUrl: null },
    ]);
    expect(out.skippedNoPosition).toBe(1);
  });

  it('같은 SKU 가 두 번이면 마지막 값과 중복 보고', () => {
    const out = buildShelfPositionRows([HEADER, ['1', 'A-01-01', ''], ['1', 'A-01-02', '']]);
    expect(out.rows).toEqual([{ skuCode: '1', positionCode: 'A-01-02', imageUrl: null }]);
    expect(out.duplicateCodes).toEqual(['1']);
  });

  it('필수 헤더가 없으면 던진다', () => {
    expect(() => buildShelfPositionRows([['상품명'], ['x']])).toThrow();
  });
});
