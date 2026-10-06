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
});
