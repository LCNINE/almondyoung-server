import './tracing';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { EventsModule, createKafkaConfigFromEnv } from '@app/events';
import { PRODUCT_STREAM, UGC_EVENT_STREAM } from '@packages/event-contracts';
import { SearchModule } from './search.module';

async function bootstrap() {
  const logger = new Logger('SearchBootstrap');
  const app = await NestFactory.create(SearchModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const kafkaConfig = createKafkaConfigFromEnv();
  if (kafkaConfig) {
    const consumerOptions = EventsModule.forConsumer({
      streams: [PRODUCT_STREAM, UGC_EVENT_STREAM],
      groupId: process.env.KAFKA_GROUP_ID || 'search-indexer',
      kafka: kafkaConfig,
    });
    app.connectMicroservice(consumerOptions);
    await app.startAllMicroservices();
    logger.log('Kafka consumer connected (products.events.v1, ugc.events.v1).');
  } else {
    logger.warn('Kafka consumer disabled: KAFKA_BROKERS not set.');
  }

  const port = parseInt(process.env.PORT || '3000', 10);
  await app.listen(port, '0.0.0.0');
  logger.log(`Search service listening on 0.0.0.0:${port}`);
}

bootstrap().catch((error) => {
  console.error('Failed to start Search application', error);
  process.exit(1);
});
