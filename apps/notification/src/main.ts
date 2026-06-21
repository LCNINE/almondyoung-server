// apps/notification/src/main.ts
import './tracing';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { EventsModule, createKafkaConfigFromEnv } from '@app/events';
import { USER_STREAM, ORDER_STREAM, PAYMENT_STREAM } from '@packages/event-contracts';
import { Logger } from 'nestjs-pino';
import { NotificationModule } from './notification.module';
import { AllExceptionsFilter } from './shared/filters/exception.filter';
import { LoggingInterceptor } from './shared/interceptors/logging.interceptor';
import * as bodyParser from 'body-parser';

async function bootstrap() {
  const app = await NestFactory.create(NotificationModule, {
    bodyParser: false, // 기본 body parser 비활성화
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));

  // Raw body를 저장하는 미들웨어 (웹훅용)
  const rawBodyBuffer = (req: any, res: any, buffer: Buffer, encoding: BufferEncoding) => {
    if (buffer && buffer.length) {
      req.rawBody = buffer.toString(encoding || 'utf8');
    }
  };

  // 웹훅 경로에는 raw body 파서 적용
  app.use(
    '/webhooks/resend',
    bodyParser.json({
      verify: rawBodyBuffer,
    }),
  );

  // Kakao 웹훅 경로에도 raw body 파서 적용
  app.use(
    '/webhooks/kakao',
    bodyParser.json({
      verify: rawBodyBuffer,
    }),
  );

  // 나머지 경로에는 일반 JSON 파서 적용
  app.use(bodyParser.json({ verify: rawBodyBuffer }));
  app.use(bodyParser.urlencoded({ extended: true }));

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
    .setDescription('알몬드영 알림 서비스 API 문서')
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

  // YAML 문서 charset 헤더 설정 (Express)
  app.use('/api/docs.yaml', (req, res, next) => {
    res.setHeader('Content-Type', 'application/x-yaml; charset=utf-8');
    next();
  });

  // Kafka Consumer 연결
  const consumerOptions = EventsModule.forConsumer({
    streams: [USER_STREAM, ORDER_STREAM, PAYMENT_STREAM],
    groupId: process.env.KAFKA_GROUP_ID || 'notification-consumer',
    kafka: createKafkaConfigFromEnv()!,
  });

  app.connectMicroservice(consumerOptions);
  await app.startAllMicroservices();

  console.log('🚀 Kafka Consumer 연결 완료 (USER_STREAM, ORDER_STREAM, PAYMENT_STREAM 구독)');

  const port = process.env.PORT ?? 5001;
  await app.listen(port);

  console.log(`Notification service is running on port ${port}`);
  console.log(`Swagger documentation available at http://localhost:${port}/api/docs`);
}
bootstrap();
