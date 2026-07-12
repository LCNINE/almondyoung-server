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
