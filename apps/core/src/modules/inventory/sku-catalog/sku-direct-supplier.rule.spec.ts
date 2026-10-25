import { directSupplierViolation, type SkuSupplierState } from './sku-direct-supplier.rule';

const state = (stockType: SkuSupplierState['stockType'], directSupplierIds: string[]): SkuSupplierState => ({
  stockType,
  directSupplierIds,
});

describe('directSupplierViolation (K3 §4.2)', () => {
  describe('생성(before=null)은 항상 판정한다', () => {
    it('직배 SKU 에 직배 공급사가 없거나 둘이면 위반', () => {
      expect(directSupplierViolation(null, state('drop_shipped', []))).toBe('SKU_DIRECT_SUPPLIER_REQUIRED');
      expect(directSupplierViolation(null, state('drop_shipped', ['a', 'b']))).toBe('SKU_DIRECT_SUPPLIER_REQUIRED');
    });
    it('직배 SKU 에 직배 공급사 하나면 통과', () => {
      expect(directSupplierViolation(null, state('drop_shipped', ['a']))).toBeNull();
    });
    it('직배가 아닌 SKU 는 직배 공급사 수와 무관', () => {
      expect(directSupplierViolation(null, state('physical', []))).toBeNull();
      expect(directSupplierViolation(null, state('physical', ['a', 'b']))).toBeNull();
    });
  });

  describe('수정은 값이 바뀔 때만 판정한다', () => {
    it('옛 직배 SKU(연결 없음)가 그대로면 통과', () => {
      expect(directSupplierViolation(state('drop_shipped', []), state('drop_shipped', []))).toBeNull();
    });
    it('physical → drop_shipped 전환에 직배 공급사가 없으면 위반', () => {
      expect(directSupplierViolation(state('physical', []), state('drop_shipped', []))).toBe(
        'SKU_DIRECT_SUPPLIER_REQUIRED',
      );
    });
    it('직배 공급사를 다른 하나로 바꾸면 통과', () => {
      expect(directSupplierViolation(state('drop_shipped', ['a']), state('drop_shipped', ['b']))).toBeNull();
    });
    it('직배 공급사를 지우면 위반', () => {
      expect(directSupplierViolation(state('drop_shipped', ['a']), state('drop_shipped', []))).toBe(
        'SKU_DIRECT_SUPPLIER_REQUIRED',
      );
    });
  });
});
