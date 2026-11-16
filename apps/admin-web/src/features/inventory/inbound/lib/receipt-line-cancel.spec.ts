import {
  INBOUND_SHIPMENT_CANCEL_NOTICE,
  receiptLineCancelRoute,
} from './receipt-line-cancel';

describe('receiptLineCancelRoute', () => {
  it('발주·직접·선적 입고를 가른다', () => {
    expect(receiptLineCancelRoute('purchase_order')).toBe('purchase_order');
    expect(receiptLineCancelRoute('direct')).toBe('direct');
    expect(receiptLineCancelRoute('inbound_shipment')).toBe('inbound_shipment');
  });
  it('출처를 모르면 지금처럼 직접 취소', () => {
    expect(receiptLineCancelRoute(null)).toBe('direct');
    expect(receiptLineCancelRoute(undefined)).toBe('direct');
  });
  it('안내 문구', () => {
    expect(INBOUND_SHIPMENT_CANCEL_NOTICE).toContain('물류 앱');
  });
});
