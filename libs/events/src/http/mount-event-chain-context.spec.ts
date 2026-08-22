/**
 * HTTP 경로 사슬 (#612)
 *
 * 소비 경로만 고치면 사슬은 *이어지지만* 시작되지 않는다. HTTP 요청 하나가 이벤트를
 * 둘 발행하면 서로 다른 `chainId` 를 받았다 — CLS 컨텍스트가 없어 발행부가 chainId 를
 * 심을 곳이 없었기 때문이다.
 *
 * **운영과 같은 어댑터(Fastify)로 검증한다.** 이 저장소의 HTTP 앱 9개가 전부 Fastify 이고,
 * `app.use` 미들웨어가 라우트 핸들러까지 async 컨텍스트를 전달하는지는 어댑터에 달린
 * 문제라 Express 로 검증하면 아무것도 증명하지 못한다.
 */

import { Controller, Get } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { z } from 'zod';
import { event, stream } from '@packages/event-contracts/types';
import { EventsModule } from '../events.module';
import { InjectPublisher } from '../publishers/inject-publisher';
import { StreamPublisher } from '../publishers/stream-publisher.service';
import { EVENT_TRANSPORT } from '../transport/transport.port';
import { InMemoryBroker } from '../transport/in-memory.broker';
import { InMemoryTransport } from '../transport/in-memory.transport';
import { mountEventChainContext } from './mount-event-chain-context';

const HTTP_STREAM = stream({
  topic: 'harness.http.v1',
  partitions: 1,
  aggregateType: 'HttpHarness',
  events: {
    ThingHappened: event('ThingHappened', z.object({ thingId: z.string() })),
  },
});

@Controller()
class PublishTwiceController {
  constructor(
    @InjectPublisher(HTTP_STREAM)
    private readonly publisher: StreamPublisher<typeof HTTP_STREAM.events>,
  ) {}

  /** 한 요청이 이벤트 둘을 내보내는 흔한 모양 */
  @Get('/do-thing')
  async doThing(): Promise<{ ok: true }> {
    await this.publisher.publishEvent({
      eventType: 'ThingHappened',
      aggregateId: 'thing-1',
      payload: { thingId: 'thing-1' },
    });
    await this.publisher.publishEvent({
      eventType: 'ThingHappened',
      aggregateId: 'thing-2',
      payload: { thingId: 'thing-2' },
    });
    return { ok: true };
  }
}

async function bootFastifyApp(broker: InMemoryBroker, mount: boolean): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      EventsModule.forApp({
        publishes: [HTTP_STREAM],
        serviceName: 'http-harness',
        kafka: { clientId: 'http-harness', brokers: ['unused:9092'] },
      }),
    ],
    controllers: [PublishTwiceController],
  })
    .overrideProvider(EVENT_TRANSPORT)
    .useValue(new InMemoryTransport(broker))
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false });
  if (mount) {
    mountEventChainContext(app);
  }
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe('HTTP 요청 스코프 사슬 (mountEventChainContext)', () => {
  let broker: InMemoryBroker;

  beforeAll(() => {
    // 토픽 부트스트랩은 Kafka admin 에 붙는다 — 하네스에서는 꺼야 한다
    process.env.KAFKA_BOOTSTRAP_TOPICS = 'false';
  });

  beforeEach(() => {
    broker = new InMemoryBroker();
  });

  it('마운트하면 한 요청의 두 발행이 같은 chainId 를 받는다', async () => {
    const app = await bootFastifyApp(broker, true);
    try {
      const res = await app.inject({ method: 'GET', url: '/do-thing' });
      expect(res.statusCode).toBe(200);

      const published = broker.envelopesOn(HTTP_STREAM.topic.topic);
      expect(published).toHaveLength(2);
      expect(published[0].chainId).toBeDefined();
      expect(published[1].chainId).toBe(published[0].chainId);
    } finally {
      await app.close();
    }
  });

  /**
   * 음성 대조군 — 이 스펙의 red 다.
   *
   * 마운트를 빼면 발행마다 새 사슬이 된다. 이것이 #612 이전의 라이브 동작이었고,
   * 누군가 `main.ts` 의 호출을 지우면 위 테스트가 아니라 **이 테스트가** 무엇이 달라졌는지
   * 말해준다.
   */
  it('마운트하지 않으면 발행마다 새 사슬이 된다 (수정 전 라이브 동작)', async () => {
    const app = await bootFastifyApp(broker, false);
    try {
      const res = await app.inject({ method: 'GET', url: '/do-thing' });
      expect(res.statusCode).toBe(200);

      const published = broker.envelopesOn(HTTP_STREAM.topic.topic);
      expect(published).toHaveLength(2);
      expect(published[1].chainId).not.toBe(published[0].chainId);
    } finally {
      await app.close();
    }
  });
});
