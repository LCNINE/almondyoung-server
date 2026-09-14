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
