/**
 * 아웃박스 적재(enqueue) 시점의 스키마 검증 (ADR-0029 §5, 플랜 Task 6-A)
 *
 * 이 워크스트림의 5-C 는 "발행 경로를 전수로 닫아" 소비 검증을 켜도 되는지 판정한다. 그 논증이
 * 남긴 구멍이 정확히 하나였다 — `OutboxPublisher.saveEvent` 는 검증 없이 envelope 를 넣고,
 * `publishRawEnvelope` 가 zod 를 우회해 그것을 그대로 Kafka 로 실어 보냈다. 그래서 아웃박스로
 * 나가는 4개 이벤트가 UNVERIFIED 로 남아 analytics·search·channel-adapter 를 막고 있었다.
 *
 * 여기서 고정하는 것은 두 개의 문(門)이다:
 *
 * 1. **enqueue 문** — 잘못된 payload 는 아웃박스 행이 되지 못하고 호출자의 트랜잭션을 실패시킨다.
 *    poison row 가 남아 소비자 DLQ 에서 사후 발견되는 대신, 발행자의 도메인 연산이 그 자리에서
 *    터진다. 진단 위치가 원인에 붙어 있다는 것이 이 설계의 요지다 (ADR-0029 §5).
 * 2. **dispatch 문** — 그럼에도 어떤 경로로든 아웃박스에 들어온 행(배포 이전에 적재된 행,
 *    테이블에 직접 insert 하는 wallet 판본)은 Kafka 로 나가기 직전에 한 번 더 걸린다.
 *
 * 두 문이 함께 있어야 "Kafka 로 나간 payload 는 zod 파싱을 통과한 값"이 조건 없는 불변식이 된다.
 * 그 불변식이 5-C 의 나머지를 여는 열쇠다.
 *
 * **대조군을 함께 둔다.** 검증을 끄는 변이(`validateOnPublish: false`)로 같은 테스트가 반대
 * 결과를 내는지 확인하지 않으면, 초록불이 "검증이 막았다"인지 "애초에 그 payload 가 안 갔다"인지
 * 구분할 수 없다. 이 워크스트림이 반복해서 밟은 함정이다.
 *
 * 계약이 아니라 하네스 스트림을 쓰는 것은 `consume-validation.spec.ts` 와 같은 이유다 — 여기서
 * 고정하는 것은 메커니즘이고, 어느 앱의 어느 이벤트가 실제로 안전한가는
 * `npm run audit:consume-validation -- --gate` 가 상시 판정한다.
 */

import { Controller, INestMicroservice, UseInterceptors } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { z } from 'zod';
import { event, getDLQTopicName, stream, SchemaValidationError } from '@packages/event-contracts/types';
import type { MessageEnvelope } from '@packages/event-contracts/types';
import type { DLQMessage } from '../dlq/dlq.types';
import { EventsModule } from '../events.module';
import { EventPayload, On } from '../consumers/decorators';
import { buildConsumerInterceptors } from '../consumers/consumer-interceptors';
import { EventTypeGuard } from '../guards/event-type.guard';
import { StreamPublisher } from '../publishers/stream-publisher.service';
import { EVENT_TRANSPORT } from '../transport/transport.port';
import { InMemoryBroker } from '../transport/in-memory.broker';
import { InMemoryTransport } from '../transport/in-memory.transport';
import { InMemoryServer } from '../transport/in-memory.server';
import type { OutboxRecord, OutboxWriter } from './outbox-writer.port';
import type { DbTx } from './outbox.types';

const StockMovedSchema = z.object({
  sku: z.string().min(1),
  quantity: z.number().int().positive(),
});

const OUTBOX_STREAM = stream({
  topic: 'outbox.events.v1',
  partitions: 1,
  aggregateType: 'OutboxHarness',
  events: {
    StockMoved: event('StockMoved', StockMovedSchema),
  },
});

/** 아웃박스 테이블 대신 배열에 적재한다 — 이 스펙이 확인하는 것은 "적재되는가"이지 SQL 이 아니다. */
class RecordingOutboxWriter implements OutboxWriter {
  readonly rows: OutboxRecord[] = [];

  // eslint-disable-next-line @typescript-eslint/require-await
  async write(record: OutboxRecord, tx: DbTx): Promise<void> {
    void tx;
    this.rows.push(record);
  }
}

const received: unknown[] = [];

@Controller()
@UseInterceptors(EventTypeGuard)
class OutboxHarnessConsumer {
  @On(OUTBOX_STREAM, 'StockMoved')
  onMoved(@EventPayload() payload: { sku: string; quantity: number }): void {
    received.push(payload);
  }
}

/** 트랜잭션 핸들은 writer 에게만 의미가 있다 — publisher 는 그대로 넘기기만 한다. */
const TX = {} as DbTx;

describe('아웃박스 enqueue 시점 스키마 검증', () => {
  let app: INestMicroservice;
  let broker: InMemoryBroker;
  let writer: RecordingOutboxWriter;
  /** 검증 기본값(켜짐)으로 만든 publisher — 운영 배선과 같다. */
  let publisher: StreamPublisher<typeof OUTBOX_STREAM.events>;
  /** 대조군 — 검증만 끈 같은 publisher. */
  let unvalidated: StreamPublisher<typeof OUTBOX_STREAM.events>;

  beforeAll(async () => {
    process.env.KAFKA_BOOTSTRAP_TOPICS = 'false';
    broker = new InMemoryBroker();
    const kafka = { clientId: 'outbox-harness', brokers: ['unused:9092'] };

    const moduleRef = await Test.createTestingModule({
      imports: [
        EventsModule.forApp({
          kafka,
          policy: { validateOnConsume: true },
        }),
      ],
      controllers: [OutboxHarnessConsumer],
    })
      .overrideProvider(EVENT_TRANSPORT)
      .useValue(new InMemoryTransport(broker))
      .compile();

    app = moduleRef.createNestMicroservice({ strategy: new InMemoryServer(broker), logger: false });
    // 소비 인터셉터는 운영과 **같은 팩토리**로 만들어 얹는다 (ADR-0029 §8).
    // `startConsumer` 를 부르지 않는 이유는 하나뿐이다 — 그것은 계약 레지스트리에 없는
    // 토픽의 구독을 거부하는데, 이 하네스는 일부러 레지스트리 밖의 전용 계약을 쓴다.
    // 그래서 도출 대신 스트림을 손으로 주되, 인터셉터 구성 자체는 `buildConsumerInterceptors`
    // 한 곳에서 가져온다. 옛 `forConsumerModule` 의 `APP_INTERCEPTOR` 등록에 기대던 코드였는데,
    // 그 등록은 **운영 하이브리드 앱에서는 소비 경로에 닿은 적이 없다** — 즉 이 하네스는
    // 여태 운영과 다른 배선을 검증하고 있었다.
    app.useGlobalInterceptors(...buildConsumerInterceptors(app, [OUTBOX_STREAM]));
    await app.listen();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    received.length = 0;
    broker.reset();
    writer = new RecordingOutboxWriter();
    const transport = new InMemoryTransport(broker);
    publisher = new StreamPublisher(
      transport,
      OUTBOX_STREAM,
      'outbox-harness',
      undefined,
      undefined,
      undefined,
      writer,
    );
    unvalidated = new StreamPublisher(
      transport,
      OUTBOX_STREAM,
      'outbox-harness',
      { validateOnPublish: false },
      undefined,
      undefined,
      writer,
    );
  });

  const dlqOf = () => broker.envelopesOn<DLQMessage>(getDLQTopicName(OUTBOX_STREAM.topic.topic));

  // ── 문 1: enqueue ────────────────────────────────────────────────────────

  it('잘못된 payload 는 아웃박스 행이 되지 못하고 호출자에게 던진다', async () => {
    await expect(
      publisher.enqueue(
        {
          eventType: 'StockMoved',
          aggregateId: 'sku-1',
          payload: { sku: 'sku-1', quantity: -3 } as never, // positive() 위반
        },
        TX,
      ),
    ).rejects.toBeInstanceOf(SchemaValidationError);

    // 도메인 트랜잭션이 롤백되든 말든, 아웃박스에 poison row 자체가 생기지 않았다.
    expect(writer.rows).toHaveLength(0);
  });

  it('대조군 — 검증을 끄면 같은 payload 가 그대로 아웃박스에 적재된다', async () => {
    await unvalidated.enqueue(
      {
        eventType: 'StockMoved',
        aggregateId: 'sku-1',
        payload: { sku: 'sku-1', quantity: -3 } as never,
      },
      TX,
    );

    // 위 테스트의 초록이 "검증이 막았다"임을 이 줄이 증명한다 — 경로 자체는 살아 있다.
    expect(writer.rows).toHaveLength(1);
    expect(writer.rows[0].envelope.payload).toEqual({ sku: 'sku-1', quantity: -3 });
  });

  it('enqueue 는 zod 파싱 결과를 싣는다 — 계약에 없는 키는 적재 시점에 떨어진다', async () => {
    await publisher.enqueue(
      {
        eventType: 'StockMoved',
        aggregateId: 'sku-2',
        payload: { sku: 'sku-2', quantity: 5, legacyField: 'dropped' } as never,
      },
      TX,
    );

    expect(writer.rows).toHaveLength(1);
    expect(writer.rows[0].envelope.payload).toEqual({ sku: 'sku-2', quantity: 5 });
    expect(writer.rows[0]).toMatchObject({
      topic: 'outbox.events.v1',
      aggregateType: 'OutboxHarness',
      aggregateId: 'sku-2',
      eventType: 'StockMoved',
    });
  });

  it('아웃박스 writer 가 없으면 enqueue 는 조용히 성공하지 않는다', async () => {
    const noWriter = new StreamPublisher(new InMemoryTransport(broker), OUTBOX_STREAM, 'outbox-harness');

    await expect(
      noWriter.enqueue({ eventType: 'StockMoved', aggregateId: 'sku-3', payload: { sku: 'sku-3', quantity: 1 } }, TX),
    ).rejects.toThrow(/outbox/i);
  });

  // ── 문 2: dispatch ───────────────────────────────────────────────────────

  it('적재된 envelope 는 발행 → 소비 검증을 그대로 통과한다', async () => {
    await publisher.enqueue(
      { eventType: 'StockMoved', aggregateId: 'sku-4', payload: { sku: 'sku-4', quantity: 7 } },
      TX,
    );

    // 디스패처가 하는 일 그대로 — 저장된 envelope 를 그대로 싣는다.
    await publisher.publishStoredEnvelope(writer.rows[0].envelope, writer.rows[0].aggregateId);

    expect(received).toEqual([{ sku: 'sku-4', quantity: 7 }]);
    expect(dlqOf()).toHaveLength(0);
  });

  it('enqueue 를 우회해 들어온 poison 행은 발행 직전에 막힌다', async () => {
    const poison: MessageEnvelope = {
      messageId: 'msg-poison',
      messageType: 'StockMoved',
      messageVersion: 1,
      messageKind: 'event',
      correlationId: 'corr-poison',
      timestamp: new Date().toISOString(),
      occurredAt: new Date().toISOString(),
      source: { service: 'legacy', aggregateType: 'OutboxHarness', aggregateId: 'sku-5' },
      payload: { sku: '', quantity: 0 },
    };

    await expect(publisher.publishStoredEnvelope(poison, 'sku-5')).rejects.toBeInstanceOf(SchemaValidationError);

    // 브로커에 아무것도 나가지 않았다 = 디스패처가 실패로 기록하고 행을 다시 잡는다.
    expect(broker.envelopesOn(OUTBOX_STREAM.topic.topic)).toHaveLength(0);
    expect(received).toHaveLength(0);
  });

  it('대조군 — 검증을 끈 publisher 는 같은 poison 행을 그대로 내보낸다', async () => {
    const poison: MessageEnvelope = {
      messageId: 'msg-poison-2',
      messageType: 'StockMoved',
      messageVersion: 1,
      messageKind: 'event',
      correlationId: 'corr-poison-2',
      timestamp: new Date().toISOString(),
      occurredAt: new Date().toISOString(),
      source: { service: 'legacy', aggregateType: 'OutboxHarness', aggregateId: 'sku-6' },
      payload: { sku: '', quantity: 0 },
    };

    await unvalidated.publishStoredEnvelope(poison, 'sku-6');

    // 옛 `publishRawEnvelope` 의 동작이 이것이었다. 나간 뒤 소비 측 검증이 DLQ 로 보낸다.
    expect(broker.envelopesOn(OUTBOX_STREAM.topic.topic)).toHaveLength(1);
    expect(received).toHaveLength(0);
    expect(dlqOf()).toHaveLength(1);
  });
});
