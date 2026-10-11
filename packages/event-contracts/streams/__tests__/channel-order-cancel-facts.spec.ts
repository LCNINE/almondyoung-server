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

  describe('ChannelOrderSettlementFailed (#1016 36번 재설계 §7.1)', () => {
    const schema = ORDER_STREAM.events.ChannelOrderSettlementFailed.schema!;
    const fact = {
      ...key,
      scope: 'full',
      retryable: false,
      failureCode: 'wallet_refund_refused:REFUND_NOT_AUTOMATABLE',
      message: '자동 환불할 수 없는 결제수단입니다',
      at: '2026-10-12T00:00:00.000Z',
    };

    it('영구·일시, 전체·부분을 받는다', () => {
      expect(schema.parse(fact)).toEqual(fact);
      const transient = { ...fact, scope: 'partial', retryable: true, failureCode: 'http_500', message: '' };
      expect(schema.parse(transient)).toEqual(transient);
    });

    it('failureCode 는 열린 문자열이다 — 새 값이 소비자 선배포를 요구하지 않는다', () => {
      expect(schema.parse({ ...fact, failureCode: 'something_new' })).toMatchObject({ failureCode: 'something_new' });
      expect(() => schema.parse({ ...fact, failureCode: '' })).toThrow();
    });

    it('판매주문 id 는 싣지 않는다 — channel-adapter 는 core 판매주문 id 를 모른다(#656). 요청 행은 requestId 로 찾는다', () => {
      expect(schema.parse({ ...fact, salesOrderId: 'so-1' })).not.toHaveProperty('salesOrderId');
      expect(() => schema.parse({ ...fact, requestId: '' })).toThrow();
    });

    it('retryable 은 boolean, at 은 ISO 시각이어야 한다', () => {
      expect(() => schema.parse({ ...fact, retryable: 'false' })).toThrow();
      expect(() => schema.parse({ ...fact, at: 'now' })).toThrow();
      expect(() => schema.parse({ ...fact, scope: 'some' })).toThrow();
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
