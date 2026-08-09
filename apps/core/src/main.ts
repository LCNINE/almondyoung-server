import './tracing';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import { Logger } from 'nestjs-pino';
import { EventsModule } from '@app/events';
import { GlobalExceptionFilter } from '@app/shared';
import { AppModule } from './app.module';
import { createGlobalValidationPipe } from './platform/http/validation-pipe';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    // 부팅 로그를 버퍼링했다가 pino 로거가 준비되면 flush — 초기 로그도 JSON+trace_id 로.
    { bufferLogs: true },
  );

  // nestjs-pino 를 Nest 의 기본 로거로 사용. trace_id 주입은 instrumentation-pino 가 처리.
  app.useLogger(app.get(Logger));

  // Fastify plugins
  await app.register(fastifyCookie);
  await app.register(fastifyMultipart, {
    limits: { fileSize: 10 * 1024 * 1024 },
  });

  // Passport + Fastify 호환성 훅 (WMS auth guard용)
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', (request: any, reply: any, done: () => void) => {
      reply.setHeader = function (key: string, value: string) {
        return this.raw.setHeader(key, value);
      };
      reply.end = function () {
        this.raw.end();
      };
      request.res = reply;
      done();
    });

  // Global pipes & filters — 설정 본체는 platform/http/validation-pipe.ts 가 소유한다.
  app.useGlobalPipes(createGlobalValidationPipe());
  app.useGlobalFilters(new GlobalExceptionFilter());

  // CORS
  app.enableCors({
    origin: true,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Cookie', 'Set-Cookie', 'Idempotency-Key'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    exposedHeaders: ['Set-Cookie'],
  });

  app.enableShutdownHooks();

  // Swagger
  const config = new DocumentBuilder()
    .setTitle('Almondyoung API')
    .setDescription('Almondyoung 통합 서버 — Catalog, Inventory, Sales Order, Fulfillment, Product Matching')
    .setVersion('1.0.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    yamlDocumentUrl: '/docs.yaml',
  });

  // YAML charset 헤더
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onSend', (request: any, reply: any, payload: any, done: () => void) => {
      if (request.url === '/docs.yaml') {
        reply.header('Content-Type', 'application/x-yaml; charset=utf-8');
      }
      done();
    });

  // Kafka consumer 연결 — 구독 목록 인자가 없다. 소비 집합은 컨트롤러의 `@On`
  // 데코레이터에서 도출되고, 소비 인터셉터(재시도·DLQ·스키마 검증)도 여기서
  // 마이크로서비스 스코프로 붙는다 (ADR-0029 §3·§8).
  await EventsModule.startConsumer(app, { groupId: 'almondyoung-order-consumer' });

  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');

  console.log(`Almondyoung server running on 0.0.0.0:${port}`);
}
bootstrap().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});
