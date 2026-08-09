import './tracing';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { EventsModule, createKafkaConfigFromEnv } from '@app/events';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger as PinoLogger } from 'nestjs-pino';
import { SearchModule } from './search.module';

async function bootstrap() {
  const logger = new Logger('SearchBootstrap');
  const app = await NestFactory.create<NestFastifyApplication>(SearchModule, new FastifyAdapter(), { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const kafkaConfig = createKafkaConfigFromEnv();
  if (kafkaConfig) {
    // 구독 목록 인자가 없다 — 소비 집합은 컨트롤러의 `@On` 에서 도출된다 (ADR-0029 §3).
    // 도출된 토픽은 startConsumer 가 로그로 찍으므로 여기서 손으로 나열하지 않는다.
    await EventsModule.startConsumer(app, {
      groupId: process.env.KAFKA_GROUP_ID || 'search-indexer',
      kafka: kafkaConfig,
    });
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
