import { of, throwError } from 'rxjs';
import type { ClientKafka } from '@nestjs/microservices';
import type { MessageEnvelope } from '@packages/event-contracts/types';
import { DLQHandler } from './dlq-handler.service';
import { dlqMessagesTotal, dlqSendFailuresTotal } from './dlq.metrics';

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
    const kafka = { emit: () => of(undefined) } as unknown as ClientKafka;
    const handler = new DLQHandler(kafka);

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
    const kafka = {
      emit: () => throwError(() => new Error('broker down')),
    } as unknown as ClientKafka;
    const handler = new DLQHandler(kafka);

    await expect(handler.sendToDLQ(buildParams())).rejects.toThrow('broker down');

    const metric = await dlqSendFailuresTotal.get();
    const sample = metric.values.find(
      (v) => v.labels.topic === 'orders.events.v1' && v.labels.consumer === 'OrderEventsConsumer',
    );
    expect(sample?.value).toBe(1);
  });
});
