import { ORDER_STREAM } from '../orders.stream';

describe('채널 주문 취소 결과 사실 (#1016 35번 행)', () => {
  const key = { requestId: 'req-1', salesChannel: 'medusa', externalOrderId: 'order_1' };

  it('옛 사실 둘은 스트림에서 사라졌다 — 들어오면 소비자가 경고 후 버린다(PR 6 판정 1)', () => {
    expect(Object.keys(ORDER_STREAM.events)).not.toContain('ChannelOrderCancelRejected');
    expect(Object.keys(ORDER_STREAM.events)).not.toContain('ChannelOrderCancelStalled');
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
