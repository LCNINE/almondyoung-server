import { describe, expect, it } from 'vitest';
import { validateReceiptLineState } from './receiptState';

export const receiptState = {
  lineId: 'line',
  receiptId: 'receipt',
  warehouseId: 'warehouse',
  source: 'direct',
  receiptStatus: 'posted',
  skuId: 'sku',
  skuCode: 'SKU',
  skuName: '상품',
  originLocationId: 'origin',
  originLocationCode: 'INBOUND',
  quantity: 5,
  putawayFromOriginQty: 0,
  canceledQty: 0,
  returnedQty: 0,
  pendingQty: 5,
  canPutaway: true,
  putawayBlockReason: null,
  canCancel: true,
  cancelBlockReason: null,
} as const;

describe('receipt state contract', () => {
  it('accepts the complete server state', () => {
    expect(() =>
      validateReceiptLineState(receiptState, 'line', 'warehouse')
    ).not.toThrow();
  });
  it.each([
    null,
    {},
    { ...receiptState, lineId: 'other' },
    { ...receiptState, warehouseId: 'other' },
    { ...receiptState, source: 'unknown' },
    { ...receiptState, source: ['direct'] },
    { ...receiptState, receiptStatus: ['posted'] },
    { ...receiptState, pendingQty: NaN },
    { ...receiptState, quantity: Number.MAX_SAFE_INTEGER + 1 },
    { ...receiptState, canCancel: 'true' },
    { ...receiptState, putawayBlockReason: 'UNKNOWN' },
    { ...receiptState, canPutaway: true, putawayBlockReason: 'CANCELED' },
    { ...receiptState, canCancel: false, cancelBlockReason: null },
  ])('rejects malformed or mismatched state %#', (value) => {
    expect(() =>
      validateReceiptLineState(value, 'line', 'warehouse')
    ).toThrow();
  });
  it('preserves blocked negative diagnostic facts and nullable legacy origins', () => {
    const value = {
      ...receiptState,
      pendingQty: -2,
      canceledQty: 7,
      originLocationId: null,
      originLocationCode: null,
      canPutaway: false,
      canCancel: false,
      putawayBlockReason: 'MISSING_ORIGIN_OR_EVENT',
      cancelBlockReason: 'MISSING_ORIGIN_OR_EVENT',
    };
    expect(() =>
      validateReceiptLineState(value, 'line', 'warehouse')
    ).not.toThrow();
    expect(value.pendingQty).toBe(-2);
  });
});
