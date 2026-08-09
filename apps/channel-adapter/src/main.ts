// apps/channel-adapter/src/main.ts
import './tracing';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AdapterModule } from './adapter.module';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { EventsModule, createKafkaConfigFromEnv } from '@app/events';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AdapterModule, new FastifyAdapter(), {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));

  // admin-web 프록시(/api/proxy/channel/*)가 토큰을 accessToken 쿠키로 넘긴다.
  // 이 플러그인이 없으면 JwtAccessStrategy 의 쿠키 추출기가 빈손이 되어 관리자 화면이 401 이 된다.
  await app.register(fastifyCookie);

  app.useGlobalPipes(new ValidationPipe());

  // Swagger API 문서 설정
  const config = new DocumentBuilder()
    .setTitle('아몬드영 채널 어댑터 API')
    .setDescription('판매채널(네이버 스마트스토어, 쿠팡 등)과 내부 시스템 간의 데이터 동기화 및 이벤트 중계를 위한 API')
    .setVersion('1.0.0')
    .addTag('adapter', '채널 어댑터 핵심 기능')
    .addTag('sync-status', '동기화 상태 및 통계')
    .addServer('http://localhost:3003', '개발 서버')
    .build();

  // OpenAPI 스펙 생성
  const document = SwaggerModule.createDocument(app, config);

  // Swagger UI (서버에서 바로 확인 가능)
  SwaggerModule.setup('/docs', app, document, {
    yamlDocumentUrl: '/docs.yaml',
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });

  // YAML 문서 charset 헤더 설정 (analytics/ugc 패턴)
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onSend', (request, reply, payload, done) => {
      if (request.url === '/docs.yaml') {
        reply.header('Content-Type', 'application/x-yaml; charset=utf-8');
      }
      done();
    });

  // CORS 허용
  app.enableCors({
    origin: [
      'http://127.0.0.1:5500',
      'http://localhost:5000',
      'http://localhost:8080',
      'http://localhost:9000',
      'http://localhost:8000',
    ],
    credentials: true,
  });

  console.log(`Current NODE_ENV: ${process.env.NODE_ENV}`);
  // 테스트 환경을 제외하고 Kafka Consumer 연결 (dev/prod)
  if (process.env.NODE_ENV !== 'test') {
    // 로컬 개발 시 별도 Consumer Group 사용 (Railway와 파티션 충돌 방지)
    const isLocal = !process.env.RAILWAY_ENVIRONMENT;
    const fallbackGroupId = isLocal ? 'channel-adapter-consumer-local' : 'channel-adapter-consumer';
    // KAFKA_GROUP_ID is the durable offset identity. For lcnine, we intentionally use
    // channel-adapter-group because the existing broker backlog is disposable.
    const groupId = process.env.KAFKA_GROUP_ID || fallbackGroupId;

    // 구독 목록 인자가 없다 — 소비 집합은 컨트롤러의 `@On` 에서 도출된다 (ADR-0029 §3).
    // 예전 이 자리의 `streams` 6개 목록은 실제 구독과 무관했다: 이 앱의 핸들러는
    // `users.events.v1` · `core.orders.events.v1` · `payments.events.v1` 도 구독한다.
    // 도출된 토픽 전량은 startConsumer 가 로그로 찍는다.
    await EventsModule.startConsumer(app, {
      groupId,
      kafka: createKafkaConfigFromEnv()!,
    });
  }

  const port = process.env.PORT ?? 3003;
  await app.listen(port, '0.0.0.0');
  console.log(`Channel Adapter running on port ${port}`);
}
bootstrap();
