// apps/notification/src/main.ts
import './tracing';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { EventsModule, createKafkaConfigFromEnv } from '@app/events';
import { Logger } from 'nestjs-pino';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import { NotificationModule } from './notification.module';
import { AllExceptionsFilter } from './shared/filters/exception.filter';
import { LoggingInterceptor } from './shared/interceptors/logging.interceptor';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(NotificationModule, new FastifyAdapter(), {
    rawBody: true, // 웹훅 서명 검증용 raw body (req.rawBody: Buffer). 기존 body-parser verify 훅 대체.
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));

  // admin-web 은 이 서비스를 자기 프록시(/api/proxy/notification/*)로 부르면서 토큰을
  // Authorization 헤더가 아니라 accessToken **쿠키**로 넘긴다 (admin-web forward.ts).
  // 이 플러그인이 없으면 request.cookies 가 undefined 라 JwtAccessStrategy 의 쿠키 추출기가
  // 항상 빈손이 되고, 관리자 화면이 전부 401 이 된다.
  await app.register(fastifyCookie);

  // NOTE: 기존 body-parser urlencoded 파서는 제거됨. urlencoded 를 쓰던 경로는 Twilio 웹훅뿐이며
  // 현재 휴면(TWILIO_* env 미설정, 서명검증 TODO). 재활성화 시 @fastify/formbody 등록 필요.

  // Global pipes
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Global filters
  app.useGlobalFilters(new AllExceptionsFilter());

  // Global interceptors
  app.useGlobalInterceptors(new LoggingInterceptor());

  // CORS
  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    credentials: true,
  });

  // Swagger 설정
  const config = new DocumentBuilder()
    .setTitle('Notification Service API')
    .setDescription('아몬드영 알림 서비스 API 문서')
    .setVersion('1.0')
    .addTag('templates', '템플릿 관리')
    .addTag('notifications', '알림 발송')
    .addTag('providers', '알림 제공업체 관리')
    .addTag('bulk', '대량 발송')
    .addTag('dispatcher', '알림 디스패처')
    .addTag('event-handlers', '이벤트 핸들러')
    .addTag('webhooks', '웹훅 처리')
    .addTag('metrics', '메트릭 조회')
    .addTag('logs', '로그 조회')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT token',
        in: 'header',
      },
      'access-token',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    yamlDocumentUrl: '/api/docs.yaml',
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  // YAML 문서 charset 헤더 설정 (analytics/ugc 패턴)
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onSend', (request, reply, payload, done) => {
      if (request.url === '/api/docs.yaml') {
        reply.header('Content-Type', 'application/x-yaml; charset=utf-8');
      }
      done();
    });

  // Kafka Consumer 연결 — 구독 목록 인자가 없다. 소비 집합은 컨트롤러의 `@On`
  // 데코레이터에서 도출되고, 도출된 토픽은 startConsumer 가 로그로 찍는다 (ADR-0029 §3).
  await EventsModule.startConsumer(app, {
    groupId: process.env.KAFKA_GROUP_ID || 'notification-consumer',
    kafka: createKafkaConfigFromEnv()!,
  });

  const port = process.env.PORT ?? 5001;
  await app.listen(port, '0.0.0.0');

  console.log(`Notification service is running on port ${port}`);
  console.log(`Swagger documentation available at http://localhost:${port}/api/docs`);
}
bootstrap();
