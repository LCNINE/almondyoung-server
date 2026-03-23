import '@app/tracing'
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { EventsModule } from '@app/events';
import { PRODUCT_STREAM } from '@packages/event-contracts';
import * as os from 'os';
import { SearchModule } from './search.module';

function createKafkaConfig() {
  const prefix = process.env.KAFKA_CLIENT_ID_PREFIX;
  const brokers = process.env.KAFKA_BROKERS;

  if (!prefix || !brokers) {
    return null;
  }

  return {
    clientId: `${prefix}_${os.hostname()}`,
    brokers: brokers.split(','),
    retry: {
      retries: 5,
      initialRetryTime: 300,
      multiplier: 2,
      maxRetryTime: 30000,
    },
    ssl: process.env.KAFKA_API_KEY ? true : false,
    sasl:
      process.env.KAFKA_API_KEY && process.env.KAFKA_API_SECRET
        ? {
            mechanism: 'plain' as const,
            username: process.env.KAFKA_API_KEY,
            password: process.env.KAFKA_API_SECRET,
          }
        : undefined,
  };
}

async function bootstrap() {
  const logger = new Logger('SearchBootstrap');
  const app = await NestFactory.create(SearchModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const kafkaConfig = createKafkaConfig();
  if (kafkaConfig) {
    const consumerOptions = EventsModule.forConsumer({
      streams: [PRODUCT_STREAM],
      groupId: process.env.KAFKA_GROUP_ID || 'search-indexer',
      kafka: kafkaConfig,
    });
    app.connectMicroservice(consumerOptions);
    await app.startAllMicroservices();
    logger.log('Kafka consumer connected (products.events.v1).');
  } else {
    logger.warn(
      'Kafka consumer disabled: missing KAFKA_CLIENT_ID_PREFIX or KAFKA_BROKERS.',
    );
  }

  const port = parseInt(process.env.PORT || '3000', 10);
  await app.listen(port, '0.0.0.0');
  logger.log(`Search service listening on 0.0.0.0:${port}`);
}

bootstrap().catch((error) => {
  console.error('Failed to start Search application', error);
  process.exit(1);
});
