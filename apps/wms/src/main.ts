// apps/wms/src/main.ts
import 'reflect-metadata'; // 배포 에러로 넣었음 지훈
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { WmsModule } from './wms.module';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { EventsModule } from '@app/events';
import { PRODUCT_STREAM } from '@packages/event-contracts';
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
  const app = await NestFactory.create<NestFastifyApplication>(
    WmsModule,
    new FastifyAdapter(),
  );

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

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({
    origin: true,
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Cookie',
      'Set-Cookie',
    ],
    exposedHeaders: ['Set-Cookie'],
  });
  app.enableShutdownHooks();

  const consumerOptions = EventsModule.forConsumer({
    streams: [PRODUCT_STREAM],
    groupId: 'wms-product-consumer',
    kafka: createKafkaConfig(),
  });

  app.connectMicroservice(consumerOptions);

  const config = new DocumentBuilder()
    .setTitle('WMS API')
    .setDescription('WMS Service API')
    .setVersion('1.0.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

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
