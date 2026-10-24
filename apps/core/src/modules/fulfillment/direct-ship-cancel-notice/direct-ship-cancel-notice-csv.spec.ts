import { toCancelNoticeCsv } from './direct-ship-cancel-notice-csv';
import { DirectShipCancelNotice } from './direct-ship-cancel-notice.types';

const row = (over: Partial<DirectShipCancelNotice> = {}): DirectShipCancelNotice => ({
  id: 'n1',
  companyName: '업체',
  salesOrderId: 'so-1',
  channelOrderId: 'CH-1',
  salesOrderLineId: 'line-1',
  fulfillmentOrderId: 'fo-1',
  skuName: '상품',
  supplierSku: 'SUP-1',
  canceledQty: 2,
  cancellationScope: 'partial',
  cancelledAt: new Date('2026-10-24T03:05:00Z'),
  createdAt: new Date('2026-10-24T03:05:00Z'),
  notifiedAt: null,
  notifiedBy: null,
  ...over,
});

describe('toCancelNoticeCsv', () => {
  it('헤더 줄은 정해진 열 순서 그대로다', () => {
    expect(toCancelNoticeCsv([]).split('\n')[0]).toBe(
      '"판매주문ID","주문라인ID","상품명","취소수량","공급사SKU","취소구분","취소일시"',
    );
  });

  it('취소일시는 KST yyyy-MM-dd HH:mm, 구분은 전체/부분', () => {
    const lines = toCancelNoticeCsv([row({ cancellationScope: 'full' }), row()]).split('\n');
    expect(lines[1]).toBe('"so-1","line-1","상품","2","SUP-1","전체","2026-10-24 12:05"');
    expect(lines[2]).toContain('"부분"');
  });

  it('따옴표는 두 번 쓰고 빈 값은 빈 칸이다', () => {
    const lines = toCancelNoticeCsv([row({ skuName: 'A"B', salesOrderLineId: null, supplierSku: null })]).split('\n');
    expect(lines[1]).toBe('"so-1","","A""B","2","","부분","2026-10-24 12:05"');
  });
});
