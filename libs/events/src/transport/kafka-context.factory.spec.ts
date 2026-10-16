import { KafkaContext, Server } from '@nestjs/microservices';
import { of } from 'rxjs';
import { buildKafkaContext, dispatchToServerHandler } from './kafka-context.factory';
import type { BrokerRecord } from './in-memory.broker';

const record = (headers: Record<string, string> = {}): BrokerRecord => ({
  topic: 'orders.events.v1',
  partition: 2,
  offset: '41',
  key: 'medusa',
  value: JSON.stringify({ messageId: 'm1', messageType: 'OrderCreated' }),
  headers,
  timestamp: '0',
});

describe('kafka-context.factory (#1016 8번)', () => {
  it('운영과 같이 value 를 JSON 객체로 파싱한 진짜 KafkaContext 를 만든다', () => {
    const { context, data } = buildKafkaContext(record({ 'x-dead-letter-id': '9' }), () => Promise.resolve());
    expect(context).toBeInstanceOf(KafkaContext);
    expect(context.getTopic()).toBe('orders.events.v1');
    expect(context.getPartition()).toBe(2);
    expect(data).toEqual({ messageId: 'm1', messageType: 'OrderCreated' });
    expect(String(context.getMessage().headers?.['x-dead-letter-id'])).toBe('9');
  });

  it('consumer·producer 를 쓰면 즉시 던진다 — 이 경로가 무엇을 보장하지 않는지 드러낸다', () => {
    const { context } = buildKafkaContext(record(), () => Promise.resolve());
    // Proxy 는 프로퍼티 접근 자체에서 던진다 — 메서드를 부르려는 게 아니라 접근을 검증한다
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(() => context.getConsumer().commitOffsets).toThrow(/제공하지 않는다/);
  });

  it('서버의 토픽 핸들러를 부르고, Observable 이면 끝까지 기다린다', async () => {
    const seen: unknown[] = [];
    const server = {
      getHandlerByPattern: (pattern: string) =>
        pattern === 'orders.events.v1'
          ? (data: unknown) => {
              seen.push(data);
              return Promise.resolve(of('done'));
            }
          : null,
    } as unknown as Server;

    await expect(dispatchToServerHandler(server, record())).resolves.toBe(true);
    expect(seen).toHaveLength(1);
  });

  it('핸들러가 없는 토픽이면 false', async () => {
    const server = { getHandlerByPattern: () => null } as unknown as Server;
    await expect(dispatchToServerHandler(server, record())).resolves.toBe(false);
  });
});
