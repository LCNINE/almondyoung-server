import { CHANNEL_ORDERS_COMMAND_STREAM, channelOrderPartitionKey } from '../channel-orders-command.stream';

describe('CHANNEL_ORDERS_COMMAND_STREAM', () => {
  it('역할 이름의 명령 토픽이다 — 서비스 이름(channel-adapter)을 담지 않는다', () => {
    expect(CHANNEL_ORDERS_COMMAND_STREAM.topic.topic).toBe('channel-orders.commands.v1');
    expect(CHANNEL_ORDERS_COMMAND_STREAM.topic.topic).not.toContain('adapter');
  });

  it('ResyncChannelOrder 스키마는 채널·주문 id·ISO 시각을 요구한다', () => {
    const schema = CHANNEL_ORDERS_COMMAND_STREAM.events.ResyncChannelOrder.schema!;
    expect(() =>
      schema.parse({ salesChannel: 'medusa', externalOrderId: 'order_1', requestedAt: '2026-10-06T00:00:00.000Z' }),
    ).not.toThrow();
    expect(() => schema.parse({ salesChannel: '', externalOrderId: 'order_1', requestedAt: '2026-10-06T00:00:00.000Z' })).toThrow();
    expect(() => schema.parse({ salesChannel: 'medusa', externalOrderId: '', requestedAt: '2026-10-06T00:00:00.000Z' })).toThrow();
    expect(() => schema.parse({ salesChannel: 'medusa', externalOrderId: 'order_1', requestedAt: 'yesterday' })).toThrow();
  });

  it('파티션 키는 채널:주문 id — 같은 주문의 명령이 한 파티션으로 간다', () => {
    expect(channelOrderPartitionKey('naver', '2026100612345')).toBe('naver:2026100612345');
  });

  describe('CancelChannelOrder (#1016 35번 행)', () => {
    const schema = CHANNEL_ORDERS_COMMAND_STREAM.events.CancelChannelOrder.schema!;
    const full = {
      requestId: '0192f0aa-0000-7000-8000-000000000001',
      salesChannel: 'medusa',
      externalOrderId: 'order_1',
      scope: 'full',
      requestedBy: 'operator',
      requestedAt: '2026-10-07T00:00:00.000Z',
    };
    const partial = { ...full, scope: 'partial', lines: [{ channelOrderItemId: 'ordli_1', quantity: 2 }] };

    it('전체취소는 줄 없이, 부분취소는 줄과 함께 통과한다', () => {
      expect(schema.parse(full)).toEqual(full);
      expect(schema.parse(partial)).toEqual(partial);
      expect(schema.parse({ ...full, reasonCode: 'CUSTOMER_REQUEST', requestedBy: 'wallet-refund-approval' })).toMatchObject({
        reasonCode: 'CUSTOMER_REQUEST',
      });
    });

    it('부분취소인데 줄이 없거나 비면 거절한다', () => {
      expect(() => schema.parse({ ...full, scope: 'partial' })).toThrow();
      expect(() => schema.parse({ ...partial, lines: [] })).toThrow();
    });

    it('전체취소에 줄을 실으면 거절한다 — 어느 쪽이 정본인지 갈린다', () => {
      expect(() => schema.parse({ ...full, lines: partial.lines })).toThrow();
    });

    it('같은 줄이 두 번 실리면 거절한다', () => {
      expect(() =>
        schema.parse({
          ...partial,
          lines: [
            { channelOrderItemId: 'ordli_1', quantity: 1 },
            { channelOrderItemId: 'ordli_1', quantity: 1 },
          ],
        }),
      ).toThrow();
    });

    it.each([
      ['수량 0', { lines: [{ channelOrderItemId: 'ordli_1', quantity: 0 }] }],
      ['소수 수량', { lines: [{ channelOrderItemId: 'ordli_1', quantity: 1.5 }] }],
      ['빈 줄 id', { lines: [{ channelOrderItemId: '', quantity: 1 }] }],
      ['빈 requestId', { requestId: '' }],
      ['모르는 scope', { scope: 'some' }],
      ['모르는 요청자', { requestedBy: 'robot' }],
      ['ISO 아닌 시각', { requestedAt: 'yesterday' }],
    ])('%s 는 거절한다', (_label, patch) => {
      expect(() => schema.parse({ ...partial, ...patch })).toThrow();
    });

    it('이미 환불한 금액(#1016 37번)은 부분취소에만 — 0 이상 정수', () => {
      expect(schema.parse({ ...partial, alreadyRefundedAmount: 0 })).toMatchObject({ alreadyRefundedAmount: 0 });
      expect(schema.parse({ ...partial, alreadyRefundedAmount: 10000 })).toMatchObject({ alreadyRefundedAmount: 10000 });
      expect(() => schema.parse({ ...full, alreadyRefundedAmount: 10000 })).toThrow();
      expect(() => schema.parse({ ...partial, alreadyRefundedAmount: -1 })).toThrow();
      expect(() => schema.parse({ ...partial, alreadyRefundedAmount: 1.5 })).toThrow();
    });
  });
});
