/**
 * 컨슈머 오프셋 커밋 — 실 브로커 (#1073)
 *
 * 커밋이 없던 동안 kafkajs 는 그룹에 다시 들어올 때마다 브로커에 오프셋을 물어, 없으면 최신으로
 * 점프했다. 그래서 컨슈머가 내려가 있던 사이 발행된 메시지는 영영 안 읽혔다(라이브 2026-10-01
 * channel-adapter 재고 이벤트 유실). 이 스펙은 같은 groupId 로 컨슈머를 내렸다 올려 그걸 본다.
 *
 * 세 메시지 모두 같은 aggregateId(= 같은 파티션)로 보낸다. 커밋은 처리한 메시지가 있는 파티션에만
 * 생기므로, 다른 파티션으로 보내면 고친 뒤에도 «아직 한 번도 안 받은 파티션» 구멍에 빠진다.
 *
 * 실행: KAFKA_IT_BROKERS=localhost:9092 npx jest libs/events/src/transport/kafka-commit.integration.spec.ts --runInBand
 */
import { Controller, INestApplication, UseInterceptors } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { CART_STREAM } from '@packages/event-contracts/streams/cart.stream';
import { EventsModule } from '../events.module';
import { testTenancyModule } from '../testing/tenancy';
import { EventPayload, On } from '../consumers/decorators';
import { EventTypeGuard } from '../guards/event-type.guard';
import { StreamPublisher } from '../publishers/stream-publisher.service';

const BROKERS = process.env.KAFKA_IT_BROKERS;
const describeIfKafka = BROKERS ? describe : describe.skip;
const kafka = { clientId: 'kafka-commit-it', brokers: (BROKERS ?? '').split(',') };
const TOPIC = CART_STREAM.topic.topic;

const received: string[] = [];

@Controller()
@UseInterceptors(EventTypeGuard)
class CartProbe {
  @On(CART_STREAM, 'CartCreated')
  onCreated(@EventPayload() payload: { id: string }): void {
    received.push(payload.id);
  }
}

async function startConsumerApp(groupId: string): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      testTenancyModule(),
      EventsModule.forApp({ publishes: [CART_STREAM], serviceName: 'kafka-commit-it', kafka }),
    ],
    controllers: [CartProbe],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await EventsModule.startConsumer(app, {
    tenancy: 'per-message',
    groupId,
    kafka,
  });
  await app.init();
  return app;
}

async function startPublisherApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      testTenancyModule(),
      EventsModule.forApp({ publishes: [CART_STREAM], serviceName: 'kafka-commit-it-pub', kafka }),
    ],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return app;
}

function cart(id: string) {
  return { id, customerId: 'cust-it', regionId: 'region-it', createdAt: new Date().toISOString() };
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return predicate();
}

describeIfKafka('컨슈머 오프셋 커밋 (실 브로커)', () => {
  jest.setTimeout(120_000);

  const run = randomUUID();
  const groupId = `kafka-commit-it-${run}`;
  const aggregateId = `probe-${run}`;
  let publisherApp: INestApplication;
  let publisher: StreamPublisher<typeof CART_STREAM.events>;

  const publish = (id: string) => publisher.publishEvent({ eventType: 'CartCreated', aggregateId, payload: cart(id) });

  beforeAll(async () => {
    publisherApp = await startPublisherApp();
    publisher = publisherApp.get(EventsModule.getPublisherToken(TOPIC));
  });

  afterAll(async () => {
    await publisherApp?.close();
  });

  it('내려가 있던 사이 발행된 메시지를 다시 올라온 컨슈머가 받고, 이미 처리한 것은 다시 받지 않는다', async () => {
    const first = await startConsumerApp(groupId);

    // fromBeginning: false 라 그룹 합류·위치 확정 전에 보낸 건 못 받는다 — 받을 때까지 데운다.
    let warm = 0;
    const warmed = await waitFor(() => {
      if (received.some((id) => id.startsWith(`warm-${run}`))) return true;
      publish(`warm-${run}-${warm++}`).catch(() => undefined);
      return false;
    }, 60_000);
    expect(warmed).toBe(true);

    await publish(`a-${run}`);
    expect(await waitFor(() => received.includes(`a-${run}`), 30_000)).toBe(true);

    await first.close();
    received.length = 0;

    await publish(`b-${run}`);

    const second = await startConsumerApp(groupId);
    try {
      expect(await waitFor(() => received.includes(`b-${run}`), 60_000)).toBe(true);
      // 커밋된 a 는 다시 오지 않는다. b 를 받았다면 a 는 그보다 앞 오프셋이므로 이미 지나갔다.
      expect(received).not.toContain(`a-${run}`);
    } finally {
      await second.close();
    }
  });
});
