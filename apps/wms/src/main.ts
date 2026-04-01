// apps/wms/src/main.ts
import './tracing';
import 'reflect-metadata'; // 배포 에러로 넣었음 지훈
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { WmsModule } from './wms.module';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { EventsModule } from '@app/events';
import { PRODUCT_STREAM, ORDER_STREAM } from '@packages/event-contracts';
import fastifyCookie from '@fastify/cookie';
import * as os from 'os';

function createKafkaConfig() {
  const prefix = process.env.KAFKA_CLIENT_ID_PREFIX;
  if (!prefix) {
    throw new Error('KAFKA_CLIENT_ID_PREFIX 환경변수가 필요합니다.');
  }

  const brokers = process.env.KAFKA_BROKERS;
  if (!brokers) {
    throw new Error('KAFKA_BROKERS 환경변수가 필요합니다.');
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
  const app = await NestFactory.create<NestFastifyApplication>(WmsModule, new FastifyAdapter());

  // 쿠키 파서 등록 (JWT 토큰 인증을 위해 필요)
  await app.register(fastifyCookie);

  // Passport와 Fastify 호환성을 위한 훅 (중요!)
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', (request, reply, done) => {
      (reply as any).setHeader = function (key: string, value: string) {
        return this.raw.setHeader(key, value);
      };
      (reply as any).end = function () {
        this.raw.end();
      };
      (request as any).res = reply;
      done();
    });

  app.setGlobalPrefix('wms');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // 전역 예외 필터 (Fastify 호환) - Guard 에러를 제대로 처리하기 위해 필수!
  app.useGlobalFilters({
    catch(exception: any, host: any) {
      const ctx = host.switchToHttp();
      const response = ctx.getResponse();
      const request = ctx.getRequest();

      const status = exception.getStatus?.() || 500;

      console.error('❌ [WMS] 전역 에러 발생:', {
        timestamp: new Date().toISOString(),
        path: request.url,
        method: request.method,
        status: status,
        exception,
      });

      // Fastify 응답 처리
      response.code(status).send({
        statusCode: status,
        message: exception.message,
        error: exception.name,
        ...(exception.response && { details: exception.response }),
      });
    },
  });

  app.enableCors({
    origin: true,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Cookie', 'Set-Cookie'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposedHeaders: ['Set-Cookie'],
  });
  app.enableShutdownHooks();

  const consumerOptions = EventsModule.forConsumer({
    streams: [PRODUCT_STREAM, ORDER_STREAM],
    groupId: 'wms-consumer',
    kafka: createKafkaConfig(),
  });

  app.connectMicroservice(consumerOptions);

  const config = new DocumentBuilder()
    .setTitle('WMS API')
    .setDescription('WMS Service API')
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

  await app.startAllMicroservices();

  // Railway는 PORT 환경변수를 제공하므로 우선 사용
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3010;

  // Fastify는 기본적으로 127.0.0.1에만 바인딩하므로, Railway에서 접근 가능하도록 0.0.0.0 명시
  await app.listen(port, '0.0.0.0');

  console.log(`🚀 WMS 서비스가 0.0.0.0:${port}에서 실행 중입니다.`);
}
bootstrap().catch((error) => {
  console.error('❌ Failed to start application:', error);
  process.exit(1);
});
