import { z } from 'zod';
import { event, stream, type MessageEnvelope } from '@packages/event-contracts/types';
import { OutboxDispatcher } from '../outbox/outbox-dispatcher.service';
import { StreamPublisher } from '../publishers/stream-publisher.service';
import type { EventTransport, TransportMessage } from '../transport/transport.port';
import { EventTenantStamp, type EventTenantStampOptions } from './event-tenant-stamp';

/**
 * 봉투 `metadata.tenantId` 는 라이브러리가 찍는다 — 생산 코드는 찍지 않는다.
 * 직접 발행(`publishEvent`·`publishCommand`)은 맥락의 테넌트, 맥락이 없으면 앱의 T 로 찍는다.
 * payload 는 건드리지 않는다: strict 토픽(`shipments`·`fulfillments.v2`)의 옛 소비자가 모르는 키에 throw 한다.
 */
const ThingSchema = z.object({ thingId: z.string() }).strict();
const STRICT_STREAM = stream({
  topic: 'tenant-stamp.test.v1',
  aggregateType: 'Thing',
  events: { ThingHappened: event('ThingHappened', ThingSchema) },
});

class CapturingTransport implements EventTransport {
  readonly sent: TransportMessage[] = [];
  async send(_topic: string, message: TransportMessage): Promise<void> {
    this.sent.push(message);
  }
  envelopes(): MessageEnvelope[] {
    return this.sent.map((m) => JSON.parse(m.value) as MessageEnvelope);
  }
}

function setup(options: Partial<EventTenantStampOptions> = {}) {
  let context: string | undefined;
  const stamp = new EventTenantStamp({
    contextTenant: () => context,
    servedTenantId: '1',
    outboxTenantId: undefined,
    gateMode: 'warn',
    ...options,
  });
  const transport = new CapturingTransport();
  const publisher = new StreamPublisher(
    transport,
    STRICT_STREAM,
    'test-svc',
    undefined,
    undefined,
    undefined,
    undefined,
    stamp,
  );
  return { publisher, transport, enterTenant: (tenantId: string | undefined) => (context = tenantId) };
}

const publish = (publisher: StreamPublisher<typeof STRICT_STREAM.events>, metadata?: Record<string, unknown>) =>
  publisher.publishEvent({
    eventType: 'ThingHappened',
    aggregateId: 'thing-1',
    payload: { thingId: 'thing-1' },
    metadata,
  });

describe('직접 발행의 테넌트 찍기', () => {
  it('맥락에 테넌트가 있으면 그 테넌트로 찍는다 — 앱의 T 보다 앞선다', async () => {
    const { publisher, transport, enterTenant } = setup({ servedTenantId: '1' });
    enterTenant('2');

    await publish(publisher);

    expect(transport.envelopes()[0].metadata?.tenantId).toBe('2');
  });

  it('맥락이 없으면 앱의 T 로 찍는다', async () => {
    const { publisher, transport } = setup({ servedTenantId: '1' });

    await publish(publisher);

    expect(transport.envelopes()[0].metadata?.tenantId).toBe('1');
  });

  it('payload 는 그대로다 — strict 스키마로 다시 파싱해도 통과한다', async () => {
    const { publisher, transport } = setup();

    await publish(publisher);

    const [sent] = transport.envelopes();
    expect(sent.payload).toEqual({ thingId: 'thing-1' });
    expect(() => ThingSchema.parse(sent.payload)).not.toThrow();
  });

  it('생산 코드가 넣은 tenantId 는 덮어쓰고, 다른 metadata 는 남긴다', async () => {
    const { publisher, transport } = setup({ servedTenantId: '1' });

    await publish(publisher, { tenantId: '9', userId: 'u-1' });

    expect(transport.envelopes()[0].metadata).toEqual({ tenantId: '1', userId: 'u-1' });
  });

  it('커맨드도 같은 규칙으로 찍는다', async () => {
    const { publisher, transport, enterTenant } = setup({ servedTenantId: '1' });
    enterTenant('2');

    await publisher.publishCommand({ commandType: 'ThingHappened', aggregateId: 'thing-1', payload: { thingId: 'x' } });

    expect(transport.envelopes()[0].metadata?.tenantId).toBe('2');
  });

  describe('맥락도 T 도 없으면', () => {
    it('① warn: 테넌트 없이 보낸다(문이 «없으면 경고»라 소비는 그대로 돈다)', async () => {
      const { publisher, transport } = setup({ servedTenantId: undefined, gateMode: 'warn' });

      await publish(publisher, { tenantId: '9' });

      expect(transport.sent).toHaveLength(1);
      expect(transport.envelopes()[0].metadata?.tenantId).toBeUndefined();
    });

    it('② reject: 보내지 않고 던진다', async () => {
      const { publisher, transport } = setup({ servedTenantId: undefined, gateMode: 'reject' });

      await expect(publish(publisher)).rejects.toThrow(/테넌트/);
      expect(transport.sent).toHaveLength(0);
    });
  });
});

/**
 * outbox 행은 그 행이 든 DB 의 테넌트로 나간다. 적재 때가 아니라 나갈 때 찍으므로 이 코드 전에 쌓인 행도 찍힌다.
 * 디스패처는 맥락을 보지 않는다 — 요청 밖에서 돌고, 행의 테넌트는 DB 가 이미 말한다.
 */
describe('outbox 발행의 테넌트 찍기', () => {
  function storedRow(envelope: Partial<MessageEnvelope>) {
    return {
      id: 1,
      topic: STRICT_STREAM.topic.topic,
      aggregateType: 'Thing',
      aggregateId: 'thing-1',
      eventType: 'ThingHappened',
      partitionKey: null,
      payload: {
        messageId: 'm-1',
        messageType: 'ThingHappened',
        messageVersion: 1,
        messageKind: 'event',
        correlationId: 'm-1',
        timestamp: '2026-10-30T00:00:00.000Z',
        source: { service: 'core', aggregateType: 'Thing', aggregateId: 'thing-1' },
        payload: { thingId: 'thing-1' },
        ...envelope,
      },
      retryCount: 0,
      createdAt: new Date('2026-10-30T00:00:00.000Z'),
    };
  }

  /** 행 하나를 집어 발행하는 디스패처. DB 는 선택·상태 갱신만 흉내 낸다 — 관찰 대상은 나간 봉투다. */
  function dispatcherFor(row: ReturnType<typeof storedRow>, options: Partial<EventTenantStampOptions>) {
    const { publisher, transport, enterTenant } = setup(options);
    const select = () => ({
      from: () => ({ where: () => ({ orderBy: () => ({ limit: () => ({ for: async () => [row] }) }) }) }),
    });
    const where = () => Object.assign(Promise.resolve(undefined), { returning: async () => [] });
    const update = () => ({ set: () => ({ where }) });
    const transaction = async (callback: (tx: unknown) => Promise<unknown>) => callback({ select, update });
    const stamp = new EventTenantStamp({
      contextTenant: () => undefined,
      servedTenantId: undefined,
      outboxTenantId: undefined,
      gateMode: 'warn',
      ...options,
    });
    const dispatcher = new OutboxDispatcher(
      { db: { update, transaction } } as never,
      new Map([[STRICT_STREAM.topic.topic, publisher as StreamPublisher]]),
      undefined,
      undefined,
      undefined,
      stamp,
    );
    return { dispatcher, transport, enterTenant };
  }

  it('테넌트 없이 쌓인 옛 행도 나갈 때 outbox DB 의 테넌트로 찍힌다', async () => {
    const { dispatcher, transport } = dispatcherFor(storedRow({}), { outboxTenantId: '1' });

    await dispatcher.dispatchPendingEvents();

    expect(transport.envelopes()[0].metadata?.tenantId).toBe('1');
    expect(transport.envelopes()[0].payload).toEqual({ thingId: 'thing-1' });
  });

  it('행에 실린 tenantId 는 DB 의 테넌트로 덮어쓴다', async () => {
    const { dispatcher, transport } = dispatcherFor(storedRow({ metadata: { tenantId: '9', userId: 'u-1' } }), {
      outboxTenantId: '1',
    });

    await dispatcher.dispatchPendingEvents();

    expect(transport.envelopes()[0].metadata).toEqual({ tenantId: '1', userId: 'u-1' });
  });

  it('② reject 에서 outbox 의 테넌트를 모르면 보내지 않는다(행은 재시도에 남는다)', async () => {
    const { dispatcher, transport } = dispatcherFor(storedRow({}), { outboxTenantId: undefined, gateMode: 'reject' });

    await dispatcher.dispatchPendingEvents();

    expect(transport.sent).toHaveLength(0);
  });
});
