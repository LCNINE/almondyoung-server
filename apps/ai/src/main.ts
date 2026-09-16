import './tracing';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import { GlobalExceptionFilter } from '@app/shared';
import { Logger } from 'nestjs-pino';
import { AiModule } from './ai.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AiModule, new FastifyAdapter(), {
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));

  await app.register(fastifyCookie);
  // 어시스턴트가 엑셀·이미지를 첨부로 받는다. 파일 하나 20MB 면 충분하다 —
  // 그보다 큰 엑셀은 모델이 아니라 어드민 일괄등록 화면에서 처리할 일이다.
  await app.register(fastifyMultipart, { limits: { fileSize: 20 * 1024 * 1024 } });

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

  const port = process.env.PORT ?? 3070;

  await app.listen(port, '0.0.0.0');

  console.log(`🤖 AI Service가 0.0.0.0:${port}에서 실행 중입니다.`);
}
void bootstrap();
