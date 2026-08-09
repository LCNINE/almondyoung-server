import type { DynamicModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { USER_STREAM } from '@packages/event-contracts/streams';
import { EventsModule } from './events.module';
import { EventRetryInterceptor } from './interceptors/event-retry.interceptor';

function getKafkaClientOptions(dynamicModule: DynamicModule) {
  const clientsModule = dynamicModule.imports?.find((moduleRef: any) =>
    moduleRef.providers?.some((provider: any) => provider.provide === 'KAFKA_CLIENT'),
  ) as any;

  const provider = clientsModule?.providers?.find((item: any) => item.provide === 'KAFKA_CLIENT');
  return provider?.useValue?.options;
}

describe('EventsModule Kafka client configuration', () => {
  const kafka = { clientId: 'test-service', brokers: ['localhost:9092'] };

  it('uses producer-only ClientKafka for publishers', () => {
    const moduleRef = EventsModule.forRoot({
      streams: [USER_STREAM],
      kafka,
    });

    expect(getKafkaClientOptions(moduleRef)?.producerOnlyMode).toBe(true);
  });

  it('uses producer-only ClientKafka for consumer-side DLQ publishing', () => {
    const moduleRef = EventsModule.forConsumerModule({
      streams: [USER_STREAM],
      groupId: 'test-consumer',
      kafka,
    });

    expect(getKafkaClientOptions(moduleRef)?.producerOnlyMode).toBe(true);
  });
});

describe('EventsModule global retry interceptor registration', () => {
  const kafka = { clientId: 'test-service', brokers: ['localhost:9092'] };

  function appInterceptorsOf(dynamicModule: DynamicModule) {
    return (dynamicModule.providers ?? []).filter(
      (provider): provider is { provide: unknown; useClass?: unknown } =>
        typeof provider === 'object' &&
        provider !== null &&
        (provider as { provide?: unknown }).provide === APP_INTERCEPTOR,
    );
  }

  it('forRoot: EventRetryInterceptor가 최외곽(첫 번째) 전역 인터셉터다', () => {
    const moduleRef = EventsModule.forRoot({ streams: [USER_STREAM], kafka });
    const interceptors = appInterceptorsOf(moduleRef);
    // forRoot는 producer 전용이라 SchemaValidation/ChainContext 인터셉터가 등록되지 않는다
    // (그건 forConsumerModule 소관) — 여기서는 retry가 유일한 첫 항목이면 충분하다.
    expect(interceptors.length).toBeGreaterThanOrEqual(1);
    expect(interceptors[0].useClass).toBe(EventRetryInterceptor);
  });

  it('forConsumerModule: EventRetryInterceptor가 최외곽(첫 번째) 전역 인터셉터다', () => {
    const moduleRef = EventsModule.forConsumerModule({ streams: [USER_STREAM], groupId: 'test-consumer', kafka });
    const interceptors = appInterceptorsOf(moduleRef);
    expect(interceptors.length).toBeGreaterThanOrEqual(2);
    expect(interceptors[0].useClass).toBe(EventRetryInterceptor);
  });
});

/**
 * `enqueue` 는 publisher provider 가 `OutboxPublisher` 를 함께 주입받아야 동작한다
 * (ADR-0029 §5). 그 배선은 앱 **부팅 경로**에 있고, 스펙이 publisher 를 손으로 조립하면
 * 영영 검사되지 않는다 — 이 워크스트림이 반복해서 만난 실패 모드가 정확히 그것이다
 * (선언과 실제가 갈라져도 아무 일이 안 일어남).
 *
 * `inject` 배열을 보는 이유는 컨테이너를 띄우려면 `DbService` 가 필요해서다. 여기서
 * 확인하는 것은 "아웃박스를 켠 앱에서만 writer 가 따라 들어간다"는 배선 자체다.
 */
describe('EventsModule outbox writer 배선 (ADR-0029 §5)', () => {
  const kafka = { clientId: 'test-service', brokers: ['localhost:9092'] };

  /** `forRoot` 가 만드는 publisher provider 의 모양. DynamicModule 은 이보다 넓게 타이핑돼 있다. */
  interface PublisherProvider {
    provide: string;
    inject: Array<string | symbol | { name?: string }>;
    useFactory: (...args: unknown[]) => { enqueue: (params: unknown, tx: unknown) => Promise<void> };
  }

  function publisherProviderOf(moduleRef: DynamicModule): PublisherProvider {
    const token = EventsModule.getPublisherToken(USER_STREAM.topic.topic);
    const found = (moduleRef.providers ?? []).find((provider) => (provider as { provide?: unknown }).provide === token);
    return found as unknown as PublisherProvider;
  }

  const injectedNames = (provider: PublisherProvider) =>
    provider.inject.map((token) => (typeof token === 'function' ? (token as { name: string }).name : String(token)));

  it('enableOutbox: true 면 publisher 가 OutboxPublisher 를 함께 주입받고 enqueue 가 그리로 쓴다', async () => {
    const provider = publisherProviderOf(EventsModule.forRoot({ streams: [USER_STREAM], kafka, enableOutbox: true }));

    expect(injectedNames(provider)).toContain('OutboxPublisher');

    // 토큰만 보면 팩토리가 그 인자를 버려도 초록이다. 실제로 조립해 적재까지 확인한다.
    const rows: unknown[] = [];
    const publisher = provider.useFactory({ send: jest.fn() }, undefined, undefined, {
      write: (record: unknown) => {
        rows.push(record);
        return Promise.resolve();
      },
    });

    await publisher.enqueue(
      {
        eventType: 'UserEmailVerified',
        aggregateId: 'user-1',
        payload: { userId: 'user-1', email: 'user@example.com', name: '홍길동' },
      },
      {},
    );

    expect(rows).toHaveLength(1);
  });

  it('대조군 — 아웃박스를 켜지 않으면 주입하지 않는다 (그 앱에서 enqueue 는 던진다)', () => {
    const provider = publisherProviderOf(EventsModule.forRoot({ streams: [USER_STREAM], kafka }));

    expect(injectedNames(provider)).not.toContain('OutboxPublisher');
  });
});
