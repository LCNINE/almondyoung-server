import { ORDER_STREAM, CHANNEL_ORDER_CANCEL_REJECTION_CODES } from '../orders.stream';

describe('채널 주문 취소 결과 사실 (#1016 35번 행)', () => {
  const key = { requestId: 'req-1', salesChannel: 'medusa', externalOrderId: 'order_1' };

  describe('ChannelOrderCancelRejected', () => {
    const schema = ORDER_STREAM.events.ChannelOrderCancelRejected.schema!;

    it.each(CHANNEL_ORDER_CANCEL_REJECTION_CODES)('%s 를 받는다', (reasonCode) => {
      const payload = { ...key, reasonCode, message: '사유' };
      expect(schema.parse(payload)).toEqual(payload);
    });

    it('core 내부 값 OPERATOR_WITHDRAWN 은 사실이 아니다', () => {
      expect(() => schema.parse({ ...key, reasonCode: 'OPERATOR_WITHDRAWN', message: '접음' })).toThrow();
    });

    it('requestId 가 없으면 core 가 요청을 찾지 못하므로 거절한다', () => {
      expect(() => schema.parse({ ...key, requestId: '', reasonCode: 'NOT_CANCELABLE', message: 'x' })).toThrow();
    });

    it('EXTERNAL_REFUND_UNRESOLVED 는 미해결 외부 환불 금액을 싣는다(#1016 37번)', () => {
      const payload = { ...key, reasonCode: 'EXTERNAL_REFUND_UNRESOLVED', message: '외부 환불 10,000원', unresolvedRefundAmount: 10000 };
      expect(schema.parse(payload)).toEqual(payload);
      expect(() => schema.parse({ ...payload, unresolvedRefundAmount: -1 })).toThrow();
    });
  });

  describe('ChannelOrderCancelStalled', () => {
    const schema = ORDER_STREAM.events.ChannelOrderCancelStalled.schema!;

    it('stage 는 edited 뿐이다', () => {
      const payload = { ...key, stage: 'edited', message: '환불 미완' };
      expect(schema.parse(payload)).toEqual(payload);
      expect(() => schema.parse({ ...payload, stage: 'refunded' })).toThrow();
    });
  });

  describe('OrderModified cancelRequests 의 상계액 (#1016 37번)', () => {
    const schema = ORDER_STREAM.events.OrderModified.schema!;
    it('externalRefundApplied 는 선택 칸이다', () => {
      const base = { requestId: 'req-1', stage: 'refunded', refundAmount: 20000, shippingCharge: 0, shippingRefund: 0, shippingNotAdjusted: false };
      const payload = (cancelRequests: unknown[]) => ({
        orderId: 'o1', salesChannel: 'medusa', externalOrderId: 'order_1', modifiedAt: '2026-10-10T00:00:00.000Z',
        snapshot: {
          lines: [],
          shippingAddress: { recipientName: 'a', phone: '', postalCode: '', roadAddress: '', detailAddress: '' },
          cancelRequests,
        },
      });
      expect(schema.parse(payload([base])).snapshot.cancelRequests).toEqual([base]);
      expect(schema.parse(payload([{ ...base, externalRefundApplied: 10000 }])).snapshot.cancelRequests?.[0]).toMatchObject({ externalRefundApplied: 10000 });
    });
  });
});
