import { filterRefundIssueRows } from './refund-filter.utils';

const row = (orderId: string, orderStatus: string, refundStatus?: string) => ({
  orderId,
  orderStatus,
  refundStatus,
});

describe('filterRefundIssueRows (환불 결정 전·실패)', () => {
  it('살아 있는 주문의 manual_pending 도 걸린다', () => {
    expect(filterRefundIssueRows([row('o1', 'confirmed', 'manual_pending')])).toHaveLength(1);
  });
  it('requested 도 걸린다', () => {
    expect(filterRefundIssueRows([row('o1', 'cancelled', 'requested')])).toHaveLength(1);
  });
  it('failed 는 주문 상태와 무관하게 걸린다', () => {
    expect(filterRefundIssueRows([row('o1', 'confirmed', 'failed')])).toHaveLength(1);
  });
  it('succeeded·waived·pending·none 은 안 걸린다', () => {
    const rows = [
      row('o1', 'cancelled', 'succeeded'),
      row('o2', 'cancelled', 'waived'),
      row('o3', 'cancelled', 'pending'),
      row('o4', 'cancelled'),
    ];
    expect(filterRefundIssueRows(rows)).toHaveLength(0);
  });
});
