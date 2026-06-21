// apps/channel-adapter/src/main.ts
import './tracing';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AdapterModule } from './adapter.module';
import { ValidationPipe } from '@nestjs/common';
// import {
//   FastifyAdapter,
//   NestFastifyApplication,
// } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { join } from 'path';
import { writeFileSync, mkdirSync } from 'fs';
import { EventsModule, createKafkaConfigFromEnv } from '@app/events';
import {
  FULFILLMENT_STREAM,
  INVENTORY_STREAM,
  PRODUCT_STREAM,
  MEMBERSHIP_STREAM,
} from '@packages/event-contracts/streams';

async function bootstrap() {
  const app = await NestFactory.create(
    AdapterModule,
    // new FastifyAdapter(),
    { bufferLogs: true },
  );
  app.useLogger(app.get(Logger));

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

  // Swagger JSON 파일 apps/channel-adapter/swagger-spec.json에 저장 (개발 환경만)
  // if (process.env.NODE_ENV !== 'production') {
  //   const swaggerJsonPath = join(
  //     process.cwd(),
  //     'apps',
  //     'channel-adapter',
  //     'swagger-spec.json',
  //   );

  //   mkdirSync(join(process.cwd(), 'apps', 'channel-adapter'), {
  //     recursive: true,
  //   });

  //   writeFileSync(swaggerJsonPath, JSON.stringify(document, null, 2));
  //   console.log(`Swagger JSON 생성됨: ${swaggerJsonPath}`);
  // }

  // Swagger UI (서버에서 바로 확인 가능)
  SwaggerModule.setup('/docs', app, document, {
    yamlDocumentUrl: '/docs.yaml',
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });

  // YAML 문서 charset 헤더 설정
  // app.getHttpAdapter().getInstance().addHook('onSend', (request, reply, payload, done) => {
  //   if (request.url === '/docs.yaml') {
  //     reply.header('Content-Type', 'application/x-yaml; charset=utf-8');
  //   }
  //   done();
  // });

  // 파일 업로드 등 Fastify 설정
  // await app.register(require('@fastify/multipart'), {
  //   attachFieldsToBody: false,
  //   limits: {
  //     fileSize: 1024 * 1024 * 10,
  //     files: 1,
  //   },
  // });

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

  // 정적 파일 서빙 설정
  // const htmlPath = join(process.cwd(), 'html');
  // await app.register(require('@fastify/static'), {
  //   root: htmlPath,
  //   prefix: '/html/',
  // });
  // console.log(`정적 파일 서빙 경로: ${htmlPath}`);

  console.log(`Current NODE_ENV: ${process.env.NODE_ENV}`);
  // 테스트 환경을 제외하고 Kafka Consumer 연결 (dev/prod)
  if (process.env.NODE_ENV !== 'test') {
    // 로컬 개발 시 별도 Consumer Group 사용 (Railway와 파티션 충돌 방지)
    const isLocal = !process.env.RAILWAY_ENVIRONMENT;
    const fallbackGroupId = isLocal ? 'channel-adapter-consumer-local' : 'channel-adapter-consumer';
    // KAFKA_GROUP_ID is the durable offset identity. For lcnine, we intentionally use
    // channel-adapter-group because the existing broker backlog is disposable.
    const groupId = process.env.KAFKA_GROUP_ID || fallbackGroupId;

    const consumerOptions = EventsModule.forConsumer({
      streams: [FULFILLMENT_STREAM, PRODUCT_STREAM, INVENTORY_STREAM, MEMBERSHIP_STREAM],
      groupId,
      kafka: createKafkaConfigFromEnv()!,
    });

    app.connectMicroservice(consumerOptions);
    await app.startAllMicroservices();
    console.log(`Kafka Consumer connected: groupId=${groupId}, streams=fulfillment,product,inventory,membership`);
  }

  const port = process.env.PORT ?? 3003;
  await app.listen(port, '0.0.0.0');
  console.log(`Channel Adapter running on port ${port}`);
}
bootstrap();
