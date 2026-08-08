import type { MessageEnvelope } from '@packages/event-contracts/types';
import { DLQHandler } from './dlq-handler.service';
import { dlqMessagesTotal, dlqSendFailuresTotal } from './dlq.metrics';
import type { EventTransport } from '../transport/transport.port';

function buildParams() {
  const originalMessage = {
    messageId: 'msg-1',
    messageType: 'OrderCancelled',
    source: { aggregateId: 'order-123' },
  } as unknown as MessageEnvelope;

  return {
    originalTopic: 'orders.events.v1',
    originalMessage,
    error: new Error('handler boom'), // name === 'Error'
    context: {
      partition: 0,
      offset: '42',
      consumer: 'OrderEventsConsumer',
      retryCount: 3,
    },
  };
}

describe('DLQHandler metrics', () => {
  beforeEach(() => {
    // 모듈 스코프 싱글턴이라 register.clear() 대신 값만 리셋(등록 유지).
    dlqMessagesTotal.reset();
    dlqSendFailuresTotal.reset();
  });

  it('DLQ 발행 성공 시 events_dlq_messages_total 을 라벨과 함께 증가시킨다', async () => {
    // port 덕분에 캐스팅 없이 그대로 만족하는 테스트 더블
    const transport: EventTransport = { send: async () => undefined };
    const handler = new DLQHandler(transport);

    await handler.sendToDLQ(buildParams());

    const metric = await dlqMessagesTotal.get();
    const sample = metric.values.find(
      (v) =>
        v.labels.topic === 'orders.events.v1' &&
        v.labels.consumer === 'OrderEventsConsumer' &&
        v.labels.error === 'Error',
    );
    expect(sample?.value).toBe(1);
  });

  it('DLQ 발행 실패 시 events_dlq_send_failures_total 을 증가시키고 에러를 재던진다', async () => {
    const transport: EventTransport = {
      send: async () => {
        throw new Error('broker down');
      },
    };
    const handler = new DLQHandler(transport);

    await expect(handler.sendToDLQ(buildParams())).rejects.toThrow('broker down');

    const metric = await dlqSendFailuresTotal.get();
    const sample = metric.values.find(
      (v) => v.labels.topic === 'orders.events.v1' && v.labels.consumer === 'OrderEventsConsumer',
    );
    expect(sample?.value).toBe(1);
  });
});
