import { toCancelNoticeCsv } from './direct-ship-cancel-notice-csv';
import { DirectShipCancelNotice } from './direct-ship-cancel-notice.types';
import { SUPPLIER_SHEET_COLUMNS } from '../supplier-shipment/supplier-sheet.columns';

const row = (over: Partial<DirectShipCancelNotice> = {}): DirectShipCancelNotice => ({
  id: 'n1',
  supplierId: 'sup-1',
  companyName: '입점사',
  salesOrderId: 'so-1',
  orderNo: 'ORD-1',
  channelOrderId: 'CH-1',
  salesOrderLineId: 'line-1',
  orderCancellationId: 'oc-1',
  fulfillmentOrderId: 'fo-1',
  fulfillmentOrderItemId: 'foi-1',
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

const headerOf = (key: string) => SUPPLIER_SHEET_COLUMNS.find((column) => column.key === key)?.header;

describe('toCancelNoticeCsv', () => {
  it('헤더 줄은 정해진 열 순서이고, 앞 넷은 입점사가 받은 시트의 머리글과 같다', () => {
    const header = toCancelNoticeCsv([]).split('\n')[0];
    expect(header).toBe(
      [headerOf('rowKey'), headerOf('orderNo'), headerOf('productName'), headerOf('supplierSku')]
        .concat(['취소수량', '취소구분', '취소일시', '취소ID'])
        .map((h) => `"${h}"`)
        .join(','),
    );
    expect(header.startsWith('"행 키(지우지 마세요)","주문번호","상품명","공급사 상품코드"')).toBe(true);
  });

  it('행 키는 FOI id, 취소일시는 KST yyyy-MM-dd HH:mm, 구분은 전체/부분', () => {
    const lines = toCancelNoticeCsv([row({ cancellationScope: 'full' }), row()]).split('\n');
    expect(lines[1]).toBe('"foi-1","ORD-1","상품","SUP-1","2","전체","2026-10-24 12:05","oc-1"');
    expect(lines[2]).toContain('"부분"');
  });

  it('따옴표는 두 번 쓰고 빈 값은 빈 칸이다', () => {
    const lines = toCancelNoticeCsv([row({ skuName: 'A"B', supplierSku: null })]).split('\n');
    expect(lines[1]).toBe('"foi-1","ORD-1","A""B","","2","부분","2026-10-24 12:05","oc-1"');
  });

  it('고객 개인정보 칸이 없다', () => {
    const header = toCancelNoticeCsv([]).split('\n')[0];
    for (const key of ['recipientName', 'recipientPhone', 'address', 'entrancePassword']) {
      expect(header).not.toContain(headerOf(key));
    }
  });
});
