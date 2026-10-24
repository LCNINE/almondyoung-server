import type { DirectShipCancelNotice } from '@/lib/types/dto/fulfillment';
import { CANCEL_NOTICE_OVERDUE_HOURS, groupByCompany, isOverdue } from './cancel-notice-view';

const NOW = new Date('2026-10-24T12:00:00Z');
const HOUR = 3600_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const row = (id: string, companyName: string, createdAt: string): DirectShipCancelNotice => ({
  id,
  companyName,
  salesOrderId: `so-${id}`,
  channelOrderId: null,
  salesOrderLineId: null,
  fulfillmentOrderId: `fo-${id}`,
  skuName: 'sku',
  supplierSku: null,
  canceledQty: 1,
  cancellationScope: 'full',
  cancelledAt: createdAt,
  createdAt,
  notifiedAt: null,
  notifiedBy: null,
});

describe('isOverdue', () => {
  it('기준 시간은 24시간이다', () => {
    expect(CANCEL_NOTICE_OVERDUE_HOURS).toBe(24);
  });
  it('23시간 59분은 아니다', () => {
    expect(isOverdue(ago(24 * HOUR - 60_000), NOW)).toBe(false);
  });
  it('정확히 24시간이면 넘은 것이다', () => {
    expect(isOverdue(ago(24 * HOUR), NOW)).toBe(true);
  });
});

describe('groupByCompany', () => {
  it('업체 이름 순이고 안의 행 순서는 입력 순서다, 넘은 건수를 센다', () => {
    const rows = [
      row('1', '나', ago(30 * HOUR)),
      row('2', '가', ago(1 * HOUR)),
      row('3', '나', ago(2 * HOUR)),
      row('4', '가', ago(25 * HOUR)),
    ];
    const g = groupByCompany(rows, NOW);
    expect(g.map((x) => x.companyName)).toEqual(['가', '나']);
    expect(g[0].rows.map((r) => r.id)).toEqual(['2', '4']);
    expect(g[1].rows.map((r) => r.id)).toEqual(['1', '3']);
    expect(g[0].overdueCount).toBe(1);
    expect(g[1].overdueCount).toBe(1);
  });
  it('빈 입력은 빈 배열', () => {
    expect(groupByCompany([], NOW)).toEqual([]);
  });
});
