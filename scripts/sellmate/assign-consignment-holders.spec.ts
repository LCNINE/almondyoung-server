import { parseVendorRows } from './assign-consignment-holders';

describe('parseVendorRows', () => {
  it('빈 칸을 건너뛰고 같은 줄은 하나로 합친다', () => {
    expect(
      parseVendorRows([
        ['옵션정보일련번호', '업체'],
        ['1', 'a'],
        ['1', 'a'],
        ['', 'a'],
        ['2', ''],
      ]),
    ).toEqual([{ skuCode: '1', vendor: 'a' }]);
  });

  it('한 SKU 에 업체가 둘이면 멈춘다', () => {
    expect(() =>
      parseVendorRows([
        ['옵션정보일련번호', '업체'],
        ['1', 'a'],
        ['1', 'b'],
      ]),
    ).toThrow('업체가 둘');
  });

  it('열이 없으면 멈춘다', () => {
    expect(() => parseVendorRows([['상품명']])).toThrow('열을 못 찾았습니다');
  });
});
