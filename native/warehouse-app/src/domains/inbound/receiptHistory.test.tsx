import { expect, it } from 'vitest';
import {
  receiptHistoryPath,
  seoulDate,
  recentReceiptDates,
  validateReceiptHistory,
} from './receiptHistory';
it('서울 날짜와 창고 범위를 조회에 유지한다', () => {
  expect(seoulDate(new Date('2026-09-14T15:00:00Z'))).toBe('2026-09-15');
  expect(recentReceiptDates(new Date('2026-09-14T15:00:00Z'))).toEqual({
    startDate: '2026-09-09',
    endDate: '2026-09-15',
  });
  const url = new URL(
    receiptHistoryPath({
      warehouseId: 'w',
      receiptId: 'r',
      status: 'all',
      limit: 1,
      offset: 0,
    }),
    'https://local'
  );
  expect(url.searchParams.get('warehouseId')).toBe('w');
  expect(url.searchParams.get('receiptId')).toBe('r');
  expect(url.searchParams.get('status')).toBe('all');
});
it('구형 또는 손상된 표시 응답을 취소 가능한 이력으로 쓰지 않는다', () => {
  expect(() =>
    validateReceiptHistory({ items: [{ lines: [{ id: 'l' }] }], total: 1 })
  ).toThrow();
  expect(() =>
    validateReceiptHistory({
      items: [],
      total: 0,
      serverTime: '2026-09-15T00:00:00Z',
    })
  ).not.toThrow();
});

const historyLine = {
  id: 'line',
  skuId: 'sku',
  skuCode: 'SKU',
  skuName: '상품',
  quantity: 5,
  source: 'direct',
  originLocationCode: 'INBOUND',
  canceledQty: 0,
  returnedQty: 0,
  putawayFromOriginQty: 0,
  canCancel: true,
  cancelBlockReason: null,
};
function historyWith(line: unknown) {
  return {
    total: 1,
    serverTime: '2026-09-16T00:00:00Z',
    items: [
      {
        id: 'receipt',
        warehouseId: 'warehouse',
        method: 'direct',
        occurredAt: '2026-09-16T00:00:00Z',
        status: 'posted',
        totalQuantity: 5,
        lines: [line],
      },
    ],
  };
}
it('accepts optional current putaway policy without inventing eligibility for old responses', () => {
  const old = historyWith(historyLine);
  validateReceiptHistory(old);
  expect(old.items[0].lines[0]).not.toHaveProperty('canPutaway');
  expect(() =>
    validateReceiptHistory(
      historyWith({
        ...historyLine,
        pendingQty: -2,
        canPutaway: false,
        putawayBlockReason: 'ORIGIN_STOCK_INCONSISTENT',
      })
    )
  ).not.toThrow();
});
it.each([
  { canPutaway: 'true' },
  { pendingQty: NaN },
  { putawayBlockReason: 'UNKNOWN' },
])('rejects damaged optional current policy %#', (fields) => {
  expect(() =>
    validateReceiptHistory(historyWith({ ...historyLine, ...fields }))
  ).toThrow();
});
