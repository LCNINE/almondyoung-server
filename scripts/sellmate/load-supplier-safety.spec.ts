import { buildSupplierSafetyRows } from './load-supplier-safety';

describe('buildSupplierSafetyRows', () => {
  it('reads supplier and safety stock per option, treating 0 as not set', () => {
    const { rows, duplicateCodes } = buildSupplierSafetyRows([
      ['상품명', '옵션정보일련번호', '공급처', '안정재고'],
      ['펌제', '91414', '자체제작', '17 개'],
      ['펌제', '91415', '자체제작', '0'],
      ['테이프', '6329', '', ''],
      ['테이프', '6329', '한국', '5'],
      ['', '', '자체제작', '3'],
    ]);

    expect(rows).toEqual([
      { skuCode: '91414', supplierName: '자체제작', safetyStock: 17 },
      { skuCode: '91415', supplierName: '자체제작', safetyStock: null },
      { skuCode: '6329', supplierName: '한국', safetyStock: 5 },
    ]);
    expect(duplicateCodes).toEqual(['6329']);
  });

  it('refuses a file without the option code or both value columns', () => {
    expect(() => buildSupplierSafetyRows([['상품명', '공급처']])).toThrow('필수 헤더');
    expect(() => buildSupplierSafetyRows([['옵션정보일련번호', '재고']])).toThrow('필수 헤더');
  });
});
