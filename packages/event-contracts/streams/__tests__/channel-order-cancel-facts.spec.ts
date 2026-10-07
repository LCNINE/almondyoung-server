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
  });

  describe('ChannelOrderCancelStalled', () => {
    const schema = ORDER_STREAM.events.ChannelOrderCancelStalled.schema!;

    it('stage 는 edited 뿐이다', () => {
      const payload = { ...key, stage: 'edited', message: '환불 미완' };
      expect(schema.parse(payload)).toEqual(payload);
      expect(() => schema.parse({ ...payload, stage: 'refunded' })).toThrow();
    });
  });
});
