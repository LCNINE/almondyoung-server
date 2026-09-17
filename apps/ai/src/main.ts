import './tracing';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import { GlobalExceptionFilter } from '@app/shared';
import { EventsModule, createKafkaConfigFromEnv } from '@app/events';
import { Logger } from 'nestjs-pino';
import { AiModule } from './ai.module';
import { MAX_FILES_PER_TURN } from './assistant/lib/multipart';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AiModule, new FastifyAdapter(), {
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));

  await app.register(fastifyCookie);
  // 어시스턴트가 엑셀·이미지를 첨부로 받는다. 파일 하나 20MB 면 충분하다.
  // files 도 꼭 준다 — busboy 기본값이 무제한이고 readTurn 이 전부 메모리에
  // 들고 있어서, 파일 수를 안 막으면 요청 하나로 OOM 이 난다.
  await app.register(fastifyMultipart, {
    limits: {
      fileSize: 20 * 1024 * 1024,
      files: MAX_FILES_PER_TURN,
      // content 가 사용자의 지시라 좁히면 안 된다. 파서는 초과분을 조용히 잘라서
      // 긴 지시가 반토막 난 채 모델에 들어간다 (readTurn 이 그건 400 으로 막는다).
      fieldSize: 1024 * 1024,
      // content 하나 + 파일당 fileIds 하나.
      fields: 64,
    },
  });

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
    .setTitle('AI Service API')
    .setDescription(
      'AI Service API\n\n' +
        'AI 어시스턴트(도구 호출 채팅)와 상품 상세설명 생성을 제공한다. ' +
        '다른 서비스(core·wallet·file-service 등)는 전부 HTTP 로 부른다.',
    )
    .setVersion('1.0.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, { yamlDocumentUrl: '/docs.yaml' });

  // 소비 집합은 `@On` 에서 도출된다 (ADR-0029 §3). ai.module.ts 의 `forApp` 조건과 짝이다.
  const kafkaConfig = createKafkaConfigFromEnv();
  if (kafkaConfig) {
    await EventsModule.startConsumer(app, {
      groupId: process.env.KAFKA_GROUP_ID ?? 'ai-consumer',
      kafka: kafkaConfig,
    });
  } else {
    console.warn('⚠️  KAFKA_BROKERS 가 없다 — 탈퇴 회원의 대화가 지워지지 않는다.');
  }

  const port = process.env.PORT ?? 3070;

  await app.listen(port, '0.0.0.0');

  console.log(`🤖 AI Service가 0.0.0.0:${port}에서 실행 중입니다.`);
}
void bootstrap();
