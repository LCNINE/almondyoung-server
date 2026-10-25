import {
  directSupplierMissing,
  supplierIdsPayload,
} from './direct-supplier-requirement';

// core 규칙(sku-direct-supplier.rule.ts)과 같은 모양이어야 한다 — 서버가 최종 판정자.
describe('directSupplierMissing', () => {
  it('생성: 직배인데 입점사 없으면 true', () => {
    expect(
      directSupplierMissing({
        original: null,
        stockType: 'drop_shipped',
        directSupplierId: '',
      })
    ).toBe(true);
  });
  it('생성: 직배 + 입점사 있으면 false', () => {
    expect(
      directSupplierMissing({
        original: null,
        stockType: 'drop_shipped',
        directSupplierId: 'd1',
      })
    ).toBe(false);
  });
  it('생성: 사입이면 false', () => {
    expect(
      directSupplierMissing({
        original: null,
        stockType: 'physical',
        directSupplierId: '',
      })
    ).toBe(false);
  });
  it('수정: 연결 없는 옛 직배 SKU 를 그대로 두면 false', () => {
    expect(
      directSupplierMissing({
        original: { stockType: 'drop_shipped', directSupplierId: '' },
        stockType: 'drop_shipped',
        directSupplierId: '',
      })
    ).toBe(false);
  });
  it('수정: 사입 → 직배 전환에 입점사 없으면 true', () => {
    expect(
      directSupplierMissing({
        original: { stockType: 'physical', directSupplierId: '' },
        stockType: 'drop_shipped',
        directSupplierId: '',
      })
    ).toBe(true);
  });
});

describe('supplierIdsPayload', () => {
  const directSupplierIds = new Set(['d1', 'd2']);
  it('고른 입점사가 바뀌면 비직배 연결은 두고 직배만 갈아 끼운다', () => {
    expect(
      supplierIdsPayload({
        linkedSupplierIds: ['n1', 'd1'],
        directSupplierIds,
        originalDirectSupplierId: 'd1',
        directSupplierId: 'd2',
        stockType: 'drop_shipped',
      })
    ).toEqual({ supplierIds: ['n1', 'd2'] });
  });
  it('고른 값이 원래와 같으면 보내지 않는다', () => {
    expect(
      supplierIdsPayload({
        linkedSupplierIds: ['n1', 'd1'],
        directSupplierIds,
        originalDirectSupplierId: 'd1',
        directSupplierId: 'd1',
        stockType: 'drop_shipped',
      })
    ).toEqual({});
  });
  it('직배가 아니면 보내지 않는다', () => {
    expect(
      supplierIdsPayload({
        linkedSupplierIds: ['n1', 'd1'],
        directSupplierIds,
        originalDirectSupplierId: 'd1',
        directSupplierId: 'd2',
        stockType: 'physical',
      })
    ).toEqual({});
  });
  it('생성: 연결이 없으면 고른 입점사만', () => {
    expect(
      supplierIdsPayload({
        linkedSupplierIds: [],
        directSupplierIds,
        originalDirectSupplierId: '',
        directSupplierId: 'd1',
        stockType: 'drop_shipped',
      })
    ).toEqual({ supplierIds: ['d1'] });
  });
});
