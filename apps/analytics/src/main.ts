import './tracing';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { GlobalExceptionFilter } from '@app/shared';
import fastifyCookie from '@fastify/cookie';
import { EventsModule, createKafkaConfigFromEnv } from '@app/events';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AnalyticsModule } from './analytics.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestFastifyApplication>(AnalyticsModule, new FastifyAdapter(), {
    bufferLogs: true,
  });
  app.useLogger(app.get(PinoLogger));

  await app.register(fastifyCookie);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
      disableErrorMessages: false,
      validationError: { target: false, value: false },
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());

  app.enableCors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  });

  const config = new DocumentBuilder()
    .setTitle('Analytics Service API')
    .setDescription('Analytics Service API\n\n' + 'Provides aggregated metrics and statistics.')
    .setVersion('1.0.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    yamlDocumentUrl: '/docs.yaml',
  });

  // YAML docs charset header for Swagger.
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onSend', (request, reply, payload, done) => {
      if (request.url === '/docs.yaml') {
        reply.header('Content-Type', 'application/x-yaml; charset=utf-8');
      }
      done();
    });

  const kafkaConfig = createKafkaConfigFromEnv();
  if (kafkaConfig) {
    // 구독 목록 인자가 없다 — 소비 집합은 `analytics.module.ts` 의 `controllers` 에
    // 등록된 컨트롤러의 `@On` 데코레이터에서 도출된다 (ADR-0029 §3). 예전에 이 자리에
    // 있던 `streams` 배열은 Nest 가 `subscribe.topics` 를 덮어쓰기 때문에 한 번도
    // 효과를 낸 적이 없었고, 그 목록을 실제 구독으로 읽은 주석이 2026-08-08 아키텍처
    // 리뷰의 오판을 낳았다. 이제 그 목록 자체가 없다.
    await EventsModule.startConsumer(app, {
      groupId: process.env.KAFKA_GROUP_ID || 'analytics-consumer',
      kafka: kafkaConfig,
    });
  } else {
    logger.warn('Kafka consumer disabled: KAFKA_BROKERS not set.');
  }

  const port = process.env.PORT ?? 3040;

  await app.listen(port, '0.0.0.0');

  console.log(`Analytics Service listening on 0.0.0.0:${port}`);
}
bootstrap();
