/**
 * 소비 스키마 검증을 **켰을 때** 무슨 일이 일어나는가 (ADR-0029 §8, 플랜 Task 5-C)
 *
 * 5-C 는 앱별로 `validateOnConsume` 을 뒤집는 작업이고, core 가 첫 번째다. 그 결정이 기대는
 * 두 사실을 여기서 실행으로 고정한다 — 둘 다 코드를 읽어서 "그럴 것이다"라고 말할 수는 있지만,
 * 이 워크스트림이 반복해서 배운 것은 **읽어서 내린 결론이 틀렸다**는 것이었다(§8, Follow-up 3·10).
 *
 * 1. **켜도 정상 경로가 안 깨진다.** `publishEvent` 로 나간 메시지는 소비 검증을 반드시 통과한다.
 *    이유는 우연이 아니라 구조다 — publisher 가 envelope 에 싣는 것은 원본 payload 가 아니라
 *    **zod 가 파싱한 결과**(`stream-publisher.service.ts:123`)라, 같은 스키마로 다시 파싱하면
 *    반드시 통과한다(파싱의 멱등성). 그래서 발행 시 알 수 없는 키가 섞여 있어도 소비에서 문제가
 *    되지 않는다 — 발행 단계에서 이미 떨어져 나갔기 때문이다.
 *
 * 2. **틀린 메시지는 재시도 없이 즉시 DLQ 로 간다.** `EventRetryInterceptor` 가
 *    `SchemaValidationError` 를 `nonRetryableErrors` 에 강제로 넣는다(`event-retry.interceptor.ts:91`).
 *    이것이 5-C 의 비용 계산을 바꾸는 사실이다 — 검증을 켜는 것이 파티션을 막는 재시도 폭풍을
 *    부르지 않는다. 스키마 위반은 결정적이라 재시도해도 결과가 같고, 인터셉터가 그것을 알고 있다.
 *
 * 하네스 스트림을 쓰고 실제 계약을 쓰지 않는 것은 `round-trip.spec.ts` 와 같은 이유다 — 계약이
 * 바뀌었다고 이 스펙이 깨지면 안 된다. **어느 앱의 어느 이벤트가 실제로 안전한가**는 스펙이 아니라
 * `npm run audit:consume-validation -- --gate` 가 상시 판정한다. 여기서 고정하는 것은 메커니즘이다.
 */

import { Controller, INestMicroservice, UseInterceptors } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { z } from 'zod';
import { event, getDLQTopicName, stream } from '@packages/event-contracts/types';
import type { DLQMessage } from '../dlq/dlq.types';
import { EventsModule } from '../events.module';
import { EventPayload, OnEvent } from '../consumers/decorators';
import { EventTypeGuard } from '../guards/event-type.guard';
import { RetryPolicy } from '../retry/retry-policy.decorator';
import { StreamPublisher } from '../publishers/stream-publisher.service';
import { EVENT_TRANSPORT } from './transport.port';
import { InMemoryBroker } from './in-memory.broker';
import { InMemoryTransport } from './in-memory.transport';
import { InMemoryServer } from './in-memory.server';

const OrderPlacedSchema = z.object({
  orderId: z.string().min(1),
  amount: z.number().int().positive(),
});

const VALIDATED_STREAM = stream({
  topic: 'validated.events.v1',
  partitions: 1,
  aggregateType: 'Validated',
  events: {
    OrderPlaced: event('OrderPlaced', OrderPlacedSchema),
  },
});

/** 핸들러가 몇 번 불렸는지 — 재시도 여부를 세는 자리. */
const attempts: unknown[] = [];

/** 스키마는 통과하되 핸들러가 던지게 만드는 값. 재시도 대조군에 쓴다. */
const POISON_AMOUNT = 666;

@Controller()
@UseInterceptors(EventTypeGuard)
class ValidatedConsumer {
  /**
   * 재시도를 넉넉히 열어 둔다. 그런데도 스키마 위반이 1회만 실행되면, 그 억제는
   * `maxRetries` 가 아니라 `SchemaValidationError` 의 non-retryable 분류에서 온 것이다.
   * 대기 시간이 실제로 들어가지 않는지도 이 설정이 드러낸다 — 재시도가 돌면 백오프로 느려진다.
   */
  @OnEvent('validated.events.v1', 'OrderPlaced')
  @RetryPolicy({ maxRetries: 3, initialDelayMs: 1 })
  onPlaced(@EventPayload() payload: { orderId: string; amount: number }): void {
    attempts.push(payload);
    // 대조군용 독약 — 스키마는 통과하지만 핸들러가 던지는 경우. 이 갈래가 4회 실행되는 것이
    // "스키마 위반이 1회로 그친 것은 재시도 설정 때문이 아니다"의 근거가 된다.
    if (payload.amount === POISON_AMOUNT) throw new Error('handler blew up');
  }
}

describe('소비 스키마 검증 ON (validateOnConsume: true)', () => {
  let app: INestMicroservice;
  let broker: InMemoryBroker;
  let publisher: StreamPublisher<typeof VALIDATED_STREAM.events>;

  beforeAll(async () => {
    process.env.KAFKA_BOOTSTRAP_TOPICS = 'false';
    broker = new InMemoryBroker();
    const kafka = { clientId: 'validation-harness', brokers: ['unused:9092'] };

    const moduleRef = await Test.createTestingModule({
      imports: [
        EventsModule.forRoot({ streams: [VALIDATED_STREAM], serviceName: 'validation-harness', kafka }),
        EventsModule.forConsumerModule({
          streams: [VALIDATED_STREAM],
          groupId: 'validation-harness-consumer',
          kafka,
          // 이 스펙의 전제 — 5-C 가 앱에서 뒤집는 바로 그 한 줄이다
          validation: { validateOnConsume: true },
        }),
      ],
      controllers: [ValidatedConsumer],
    })
      .overrideProvider(EVENT_TRANSPORT)
      .useValue(new InMemoryTransport(broker))
      .compile();

    app = moduleRef.createNestMicroservice({ strategy: new InMemoryServer(broker), logger: false });
    await app.listen();
    publisher = app.get(EventsModule.getPublisherToken(VALIDATED_STREAM.topic.topic));
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    attempts.length = 0;
    broker.reset();
  });

  const dlqOf = () => broker.envelopesOn<DLQMessage>(getDLQTopicName(VALIDATED_STREAM.topic.topic));

  it('publishEvent 로 나간 메시지는 검증을 켜도 그대로 핸들러에 도달한다', async () => {
    await publisher.publishEvent({
      eventType: 'OrderPlaced',
      aggregateId: 'order-1',
      payload: { orderId: 'order-1', amount: 9_900 },
    });

    expect(attempts).toEqual([{ orderId: 'order-1', amount: 9_900 }]);
    expect(dlqOf()).toHaveLength(0);
  });

  it('발행 시 알 수 없는 키는 zod 가 떼어내므로 소비 검증이 볼 일이 없다', async () => {
    await publisher.publishEvent({
      eventType: 'OrderPlaced',
      aggregateId: 'order-2',
      // 계약에 없는 키. 타입으로는 막히지만 런타임에는 들어올 수 있는 모양이다.
      payload: { orderId: 'order-2', amount: 100, legacyField: 'dropped' } as never,
    });

    // 나간 것도 받은 것도 스키마의 출력 — 이것이 "발행된 것은 반드시 소비된다"의 기계적 근거다
    expect(broker.envelopesOn(VALIDATED_STREAM.topic.topic)[0].payload).toEqual({
      orderId: 'order-2',
      amount: 100,
    });
    expect(attempts).toEqual([{ orderId: 'order-2', amount: 100 }]);
    expect(dlqOf()).toHaveLength(0);
  });

  it('스키마를 위반한 인바운드는 핸들러에 닿지 않고 DLQ 로 간다', async () => {
    await broker.inject(VALIDATED_STREAM.topic.topic, {
      messageId: 'msg-bad',
      messageType: 'OrderPlaced',
      messageVersion: 1,
      messageKind: 'event',
      correlationId: 'corr-bad',
      timestamp: new Date().toISOString(),
      occurredAt: new Date().toISOString(),
      source: { service: 'other-service', aggregateType: 'Validated', aggregateId: 'order-3' },
      payload: { orderId: 'order-3', amount: -5 }, // positive() 위반
    });

    expect(attempts).toHaveLength(0);

    const dlq = dlqOf();
    expect(dlq).toHaveLength(1);
    expect(dlq[0].error.name).toBe('SchemaValidationError');
    expect(dlq[0].originalMessage.messageId).toBe('msg-bad');
  });

  /**
   * 5-C 의 비용 논증. 스키마 위반은 결정적이므로 재시도가 순수 낭비이고, 그 낭비는 컨슈머
   * 파티션을 붙잡는 형태로 나타난다. `@RetryPolicy({ maxRetries: 3 })` 이 걸려 있는데도
   * DLQ 항목이 1건이고 시도 이력이 1건이면, 억제한 것은 non-retryable 분류다.
   */
  it('스키마 위반은 재시도하지 않는다 — maxRetries 가 열려 있어도 즉시 DLQ', async () => {
    await broker.inject(VALIDATED_STREAM.topic.topic, {
      messageId: 'msg-bad-2',
      messageType: 'OrderPlaced',
      messageVersion: 1,
      messageKind: 'event',
      correlationId: 'corr-bad-2',
      timestamp: new Date().toISOString(),
      occurredAt: new Date().toISOString(),
      source: { service: 'other-service', aggregateType: 'Validated', aggregateId: 'order-4' },
      payload: { orderId: '', amount: 1 }, // min(1) 위반
    });

    const dlq = dlqOf();
    expect(dlq).toHaveLength(1);
    // 시도 이력이 1건 = 최초 시도뿐, 재시도 0회
    expect(dlq[0].context.attemptHistory).toHaveLength(1);
    expect(dlq[0].context.retryCount).toBe(1);
  });

  /**
   * 위 테스트의 대조군. 같은 핸들러·같은 `@RetryPolicy` 인데 **핸들러가 던지는** 에러는
   * 1+3 = 4회 실행된다. 두 테스트를 나란히 두어야 "1회로 그친 것"이 재시도 설정 탓이 아니라
   * `SchemaValidationError` 의 non-retryable 분류 때문임이 드러난다. 대조군 없이 앞 테스트만
   * 두면 `maxRetries` 를 0으로 바꿔도 여전히 초록이라 아무것도 증명하지 못한다.
   */
  it('대조군 — 핸들러가 던지는 (스키마와 무관한) 에러는 정책대로 재시도한다', async () => {
    await publisher.publishEvent({
      eventType: 'OrderPlaced',
      aggregateId: 'order-6',
      payload: { orderId: 'order-6', amount: POISON_AMOUNT },
    });

    expect(attempts).toHaveLength(4); // 최초 1 + 재시도 3

    const dlq = dlqOf();
    expect(dlq).toHaveLength(1);
    expect(dlq[0].error.name).toBe('Error');
    expect(dlq[0].context.attemptHistory).toHaveLength(4);
  });

  it('검증이 켜져 있어도 소비 실패가 발행자에게 전파되지 않는다', async () => {
    await broker.inject(VALIDATED_STREAM.topic.topic, {
      messageId: 'msg-bad-3',
      messageType: 'OrderPlaced',
      messageVersion: 1,
      messageKind: 'event',
      correlationId: 'corr-bad-3',
      timestamp: new Date().toISOString(),
      occurredAt: new Date().toISOString(),
      source: { service: 'other-service', aggregateType: 'Validated', aggregateId: 'order-5' },
      payload: { amount: 'nope' },
    });

    // DLQ 로 분류된 뒤 에러가 삼켜져야 offset 이 전진한다 (§8 의 "탈출구")
    expect(broker.deliveryFailures).toHaveLength(0);
    expect(dlqOf()).toHaveLength(1);
  });
});
