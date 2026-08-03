import { describe, it, expect } from 'vitest';
import type { SkuSearchItem } from '../inventory/types';
import { scanIncrement } from './packingUnit';

const sku: SkuSearchItem = {
  id: 's1',
  code: 'CT-001',
  name: '코튼셔츠',
  currentStock: 0,
  safetyStock: 0,
  barcodes: [
    { id: 'b1', barcode: '8801', isPrimary: true, packingUnit: null },
    { id: 'b2', barcode: '8802', isPrimary: false, packingUnit: 20 },
  ],
};

describe('scanIncrement', () => {
  it('스캔한 바코드의 packingUnit 을 쓴다', () => {
    expect(scanIncrement(sku, '8802')).toBe(20);
  });

  it('packingUnit 이 없는 바코드는 1', () => {
    expect(scanIncrement(sku, '8801')).toBe(1);
  });

  it('SKU 에 없는 바코드는 1', () => {
    expect(scanIncrement(sku, '9999')).toBe(1);
  });

  it('SKU 자체가 없으면 1', () => {
    expect(scanIncrement(undefined, '8802')).toBe(1);
  });

  // 컬럼이 varchar 라 서버 파싱을 뚫고 이상한 값이 올 여지가 남는다.
  it('정수가 아니거나 1 미만이면 1', () => {
    const broken: SkuSearchItem = {
      ...sku,
      barcodes: [
        { id: 'b3', barcode: '7001', isPrimary: false, packingUnit: 0 },
        { id: 'b4', barcode: '7002', isPrimary: false, packingUnit: -5 },
        { id: 'b5', barcode: '7003', isPrimary: false, packingUnit: 1.5 },
      ],
    };
    expect(scanIncrement(broken, '7001')).toBe(1);
    expect(scanIncrement(broken, '7002')).toBe(1);
    expect(scanIncrement(broken, '7003')).toBe(1);
  });
});
