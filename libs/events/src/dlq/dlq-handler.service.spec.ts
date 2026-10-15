import { MessageEnvelope } from '@packages/event-contracts/types';
import { DLQHandler } from './dlq-handler.service';

describe('DLQHandler.sendToDLQ', () => {
  const context = { partition: 0, offset: '1', consumer: 'c', retryCount: 0 };

  // source 가 없는 envelope 가 TypeError 로 DLQ 발행에 실패하면 kafkajs 가 컨슈머를 크래시시키고,
  // 커밋된 오프셋 때문에 재시작해도 같은 메시지가 와서 앱의 모든 토픽이 무한 루프에 빠진다 (#1073).
  it('source 가 없는 envelope 도 던지지 않고 DLQ 토픽으로 보낸다', async () => {
    const send = jest.fn(async () => undefined);
    const handler = new DLQHandler({ send } as never);
    const envelope = { messageId: 'm-1', messageType: 'X', payload: {} } as unknown as MessageEnvelope;

    await expect(
      handler.sendToDLQ({
        originalTopic: 'orders.events.v1',
        originalMessage: envelope,
        error: new Error('boom'),
        context,
      }),
    ).resolves.toBeUndefined();

    expect(send).toHaveBeenCalledTimes(1);
    const [topic, message] = send.mock.calls[0] as unknown as [
      string,
      { key: string; headers: Record<string, string> },
    ];
    expect(topic).toBe('orders.events.v1.dlq');
    expect(message.key).toBe('m-1');
    expect(message.headers['original-aggregate-id']).toBe('unknown');
  });
});
