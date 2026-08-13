import type { ClassProvider, DynamicModule } from '@nestjs/common';
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
    const moduleRef = EventsModule.forApp({
      publishes: [USER_STREAM],
      kafka,
    });

    expect(getKafkaClientOptions(moduleRef)?.producerOnlyMode).toBe(true);
  });

  it('소비만 하는 앱(publishes 없음)도 DLQ 발행용 producer-only 클라이언트를 얻는다', () => {
    // 옛 `forConsumerModule` 이 하던 일이다. 소비 앱도 DLQ 로 **발행**하므로
    // KAFKA_CLIENT 가 필요하고, 소비 자체는 `startConsumer` 의 ServerKafka 가 따로 한다.
    const moduleRef = EventsModule.forApp({ kafka });

    expect(getKafkaClientOptions(moduleRef)?.producerOnlyMode).toBe(true);
  });
});

describe('EventsModule global retry interceptor registration', () => {
  const kafka = { clientId: 'test-service', brokers: ['localhost:9092'] };

  // 술어 타입은 파라미터 타입(Provider)에 대입 가능해야 한다. 임의 객체 리터럴로
  // 좁히면 그 조건이 깨지고 useClass 접근도 막힌다 — Nest 의 ClassProvider 를 쓴다.
  function appInterceptorsOf(dynamicModule: DynamicModule): ClassProvider[] {
    return (dynamicModule.providers ?? []).filter(
      (provider): provider is ClassProvider =>
        typeof provider === 'object' &&
        provider !== null &&
        'provide' in provider &&
        (provider as ClassProvider).provide === APP_INTERCEPTOR,
    );
  }

  it('forApp: EventRetryInterceptor가 최외곽(첫 번째) 전역 인터셉터다', () => {
    const moduleRef = EventsModule.forApp({ publishes: [USER_STREAM], kafka });
    const interceptors = appInterceptorsOf(moduleRef);
    expect(interceptors.length).toBeGreaterThanOrEqual(1);
    expect(interceptors[0].useClass).toBe(EventRetryInterceptor);
  });

  /**
   * 소비 경로의 인터셉터는 `APP_INTERCEPTOR` 가 아니라 **마이크로서비스 스코프**로
   * 붙는다 (`startConsumer` → `buildConsumerInterceptors`, ADR-0029 §8). 옛
   * `forConsumerModule` 은 SchemaValidation·ChainContext 를 `APP_INTERCEPTOR` 로도
   * 등록했지만 하이브리드 앱에서 그 등록은 소비 경로에 닿은 적이 없다. Task 7 에서
   * 걷어냈고, 이 단언이 다시 자라지 않게 막는다.
   */
  it('forApp 은 소비 인터셉터를 APP_INTERCEPTOR 로 등록하지 않는다', () => {
    const moduleRef = EventsModule.forApp({ publishes: [USER_STREAM], kafka, policy: { validateOnConsume: true } });
    const interceptors = appInterceptorsOf(moduleRef);

    expect(interceptors).toHaveLength(1);
    expect(interceptors[0].useClass).toBe(EventRetryInterceptor);
  });
});

/**
 * `enqueue` 는 publisher provider 가 `OutboxPublisher` 를 함께 주입받아야 동작한다
 * (ADR-0029 §5). 그 배선은 앱 **부팅 경로**에 있고, 스펙이 publisher 를 손으로 조립하면
 * 영영 검사되지 않는다 — 이 워크스트림이 반복해서 만난 실패 모드가 정확히 그것이다
 * (선언과 실제가 갈라져도 아무 일이 안 일어남).
 *
 * **Task 6-C-2 로 주입 조건이 바뀌었다.** 그 전에는 *같은* `forApp` 호출이 `enableOutbox`
 * 여야 주입 목록에 들어갔는데, 아웃박스는 앱 하나에 테이블 하나이고 BC 별 `forApp` 은 여럿이라
 * 그 결합이 어긋났다(core: catalog 만 켰지만 적재는 6개 토픽이 한다). 이제 **항상 optional 로**
 * 주입하고, 아무도 켜지 않은 앱에서는 `undefined` 가 들어와 `enqueue` 가 던진다. 그래서 대조군의
 * 주장도 "주입 목록에 없다" 가 아니라 **"writer 가 없으면 던진다"** 로 옮겼다 — 후자가 실제로
 * 지키려는 성질이고, 전자는 배선 방식이 바뀌면 뜻이 사라진다.
 */
describe('EventsModule outbox writer 배선 (ADR-0029 §5)', () => {
  const kafka = { clientId: 'test-service', brokers: ['localhost:9092'] };

  /** `forApp` 이 만드는 publisher provider 의 모양. DynamicModule 은 이보다 넓게 타이핑돼 있다. */
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

  /** `inject` 항목은 토큰이거나 `{ token, optional }` 이다 — 둘 다 이름으로 펴 준다. */
  const injectedNames = (provider: PublisherProvider) =>
    provider.inject.map((entry) => {
      const token = (entry as { token?: unknown }).token ?? entry;
      if (typeof token === 'function') return (token as { name: string }).name;
      return typeof token === 'symbol' ? token.toString() : String(token as string);
    });

  it('publisher 가 OutboxPublisher 를 주입받고 enqueue 가 그리로 쓴다', async () => {
    const provider = publisherProviderOf(EventsModule.forApp({ publishes: [USER_STREAM], kafka, enableOutbox: true }));

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

  it('대조군 — writer 가 없으면 enqueue 가 던진다 (아웃박스를 아무도 켜지 않은 앱)', async () => {
    const provider = publisherProviderOf(EventsModule.forApp({ publishes: [USER_STREAM], kafka }));

    // 토큰은 optional 이라 목록에 남아 있다. 지켜야 할 성질은 목록의 모양이 아니라,
    // writer 가 실제로 없을 때 **조용히 버리지 않고 던지는 것**이다.
    const publisher = provider.useFactory({ send: jest.fn() }, undefined, undefined, undefined);

    await expect(
      publisher.enqueue(
        {
          eventType: 'UserEmailVerified',
          aggregateId: 'user-1',
          payload: { userId: 'user-1', email: 'user@example.com', name: '홍길동' },
        },
        {},
      ),
    ).rejects.toThrow('no outbox writer');
  });

  it('OutboxPublisher 토큰이 optional 로 주입된다 — 켠 곳이 어디든 앱 전체 publisher 가 쓴다', () => {
    const provider = publisherProviderOf(EventsModule.forApp({ publishes: [USER_STREAM], kafka }));
    const entry = provider.inject.find(
      (e) => (e as { token?: { name?: string } }).token?.name === 'OutboxPublisher',
    ) as { optional?: boolean } | undefined;

    expect(entry?.optional).toBe(true);
  });
});
