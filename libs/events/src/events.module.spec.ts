import type { DynamicModule } from '@nestjs/common';
import { USER_STREAM } from '@packages/event-contracts/streams';
import { EventsModule } from './events.module';

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
