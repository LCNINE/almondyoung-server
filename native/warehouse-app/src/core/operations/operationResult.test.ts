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
