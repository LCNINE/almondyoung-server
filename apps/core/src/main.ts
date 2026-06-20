import './tracing';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import { Logger } from 'nestjs-pino';
import { EventsModule } from '@app/events';
import { GlobalExceptionFilter } from '@app/shared';
import { ORDER_STREAM } from '@packages/event-contracts';
import { AppModule } from './app.module';

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

  // Global pipes & filters
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

  // CORS
  app.enableCors({
    origin: true,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Cookie', 'Set-Cookie'],
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

  // Phase 5+: Kafka consumer 연결
  const consumerOptions = EventsModule.forConsumer({
    streams: [ORDER_STREAM],
    groupId: 'almondyoung-order-consumer',
  });
  app.connectMicroservice(consumerOptions);
  await app.startAllMicroservices();

  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');

  console.log(`Almondyoung server running on 0.0.0.0:${port}`);
}
bootstrap().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});
