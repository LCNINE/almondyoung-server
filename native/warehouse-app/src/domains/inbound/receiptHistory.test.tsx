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
