import { CHANNEL_ORDERS_COMMAND_STREAM } from './channel-orders-command.stream';

describe('CancelChannelOrder', () => {
  const schema = CHANNEL_ORDERS_COMMAND_STREAM.events.CancelChannelOrder.schema!;
  const base = {
    requestId: 'amend-1',
    salesChannel: 'naver',
    externalOrderId: 'ord-1',
    scope: 'full',
    requestedBy: 'operator',
    requestedAt: '2026-11-10T01:00:00.000Z',
  };

  it('answers 없는 페이로드를 통과시킨다', () => {
    expect(() => schema.parse(base)).not.toThrow();
  });

  it('answers 있는 페이로드를 통과시킨다', () => {
    const parsed = schema.parse({
      ...base,
      requestedBy: 'channel-customer',
      answers: { channelRequestRef: 'po-1', needsApproval: true },
    });
    expect(parsed).toMatchObject({ answers: { channelRequestRef: 'po-1', needsApproval: true } });
  });

  it('requestedBy channel-customer 를 받는다', () => {
    expect(() => schema.parse({ ...base, requestedBy: 'channel-customer' })).not.toThrow();
  });

  it('answers.channelRequestRef 가 비면 거절한다', () => {
    expect(() => schema.parse({ ...base, answers: { channelRequestRef: '', needsApproval: true } })).toThrow();
  });
});
