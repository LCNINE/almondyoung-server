import { expect, it } from 'vitest';
import { validateOperationResult } from './operationResult';
it('does not confirm a malformed success response used for inventory counts', () => {
  expect(() => validateOperationResult('/inbound/simple', {})).toThrow();
  expect(() =>
    validateOperationResult('/shipments/one/simple-outbound-scans', {
      lines: [],
    })
  ).toThrow();
  expect(() =>
    validateOperationResult('/stocktaking/scan-product', {
      lineId: 'l',
      countedQuantity: 2,
    })
  ).toThrow();
  expect(() =>
    validateOperationResult('/inbound/simple', {
      id: 'r',
      lines: [{ id: 'l', skuId: 's', quantity: 2 }],
    })
  ).not.toThrow();
});

it('새 실사 상품 추가의 손상된 응답을 확인 완료로 만들지 않는다', () => {
  expect(() =>
    validateOperationResult('/stocktaking/count-items', {})
  ).toThrow();
  expect(() =>
    validateOperationResult('/stocktaking/count-items', {
      lineId: 'l',
      countedQuantity: 0,
      lineRevision: 1,
    })
  ).not.toThrow();
});
it('취소 성공은 출처별 결과 필드를 확인한다', () => {
  expect(() => validateOperationResult('/inbound/cancel', {})).toThrow();
  expect(() =>
    validateOperationResult('/inbound/cancel', { success: true })
  ).not.toThrow();
  expect(() =>
    validateOperationResult('/purchase-orders/receipt-lines/one/cancel', {})
  ).toThrow();
  expect(() =>
    validateOperationResult('/purchase-orders/receipt-lines/one/cancel', {
      receiptLineId: 'one',
      poId: 'p',
      skuId: 's',
      quantity: 4,
    })
  ).not.toThrow();
});
it('위치 출고 결과는 위치 식별자와 수량 관계가 있어야 한다', () => {
  const path = '/shipments/s/location-outbound-scans';
  const value = {
    shipmentId: 's',
    status: 'in_progress',
    lines: [{ shipmentLineId: 'l', qty: 2, pickedQty: 0, inspectedQty: 0 }],
  };
  expect(() => validateOperationResult(path, value)).toThrow();
  const source = {
    shipmentLineId: 'l',
    skuId: 'sku',
    sourceLocationId: 'B',
    sourceLocationCode: 'B',
    allocatedQty: 2,
    pickedQty: 0,
    remainingQty: 2,
  };
  expect(() =>
    validateOperationResult(path, {
      ...value,
      warehouseId: 'w',
      sources: [source],
    })
  ).not.toThrow();
  expect(() =>
    validateOperationResult(path, {
      ...value,
      warehouseId: 'w',
      sources: [{ ...source, remainingQty: 9 }],
    })
  ).toThrow();
});
