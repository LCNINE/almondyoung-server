import './tracing';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { UgcServiceModule } from './ugc-service.module';
import { ValidationPipe } from '@nestjs/common';
import { GlobalExceptionFilter } from '@app/shared';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import { createKafkaConfigFromEnv, EventsModule, mountEventChainContext } from '@app/events';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(UgcServiceModule, new FastifyAdapter(), {
    bufferLogs: true,
  });

  // HTTP 요청 하나 = 사슬 하나 (#612). CLS 컨텍스트가 없으면 한 요청 안의 두 발행이 서로
  // 다른 chainId 를 받는다. 다른 미들웨어·전역 파이프보다 앞이어야 한다.
  mountEventChainContext(app);
  app.useLogger(app.get(Logger));

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
    .setTitle('UGC Service API')
    .setDescription(
      'UGC Service API\n\n' +
        'UGC Service는 리뷰, 게시판 등 사용자 생성 콘텐츠 (User Generated Content) 기능을 제공하는 서비스입니다.',
    )
    .setVersion('1.0.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    yamlDocumentUrl: '/docs.yaml',
  });

  // YAML 문서 charset 헤더 설정
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onSend', (request, reply, payload, done) => {
      if (request.url === '/docs.yaml') {
        reply.header('Content-Type', 'application/x-yaml; charset=utf-8');
      }
      done();
    });

  // 주문 취소를 듣기 위한 첫 소비자. 구독 집합은 `@On` 에서 도출된다 (ADR-0029 §3).
  // Kafka 설정이 없으면 소비 없이 HTTP 만 뜬다 — 로컬·테스트가 브로커 없이 돌아야 한다.
  const kafkaConfig = createKafkaConfigFromEnv();
  if (kafkaConfig) {
    await EventsModule.startConsumer(app, {
      groupId: process.env.KAFKA_GROUP_ID || 'ugc-service-consumer',
      kafka: kafkaConfig,
    });
  } else {
    console.warn('Kafka consumer disabled: KAFKA_BROKERS not set.');
  }

  const port = process.env.PORT ?? 3031;

  await app.listen(port, '0.0.0.0');

  console.log(`🚀 UGC Service가 0.0.0.0:${port}에서 실행 중입니다.`);
}
bootstrap();
