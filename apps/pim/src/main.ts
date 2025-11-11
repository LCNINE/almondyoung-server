import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { PimModule } from './pim.module';
import { join } from 'path';
import fastifyMultipart from '@fastify/multipart';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    PimModule,
    new FastifyAdapter(),
  );

  // 정적 파일 서빙 설정 (이미지 파일 접근용)
  app.useStaticAssets({
    root: join(process.cwd(), 'images'),
    prefix: '/images/',
  });

  // Fastify multipart 지원
  await app.register(fastifyMultipart, {
    limits: {
      fileSize: 10 * 1024 * 1024,
    },
  });

  // app.useGlobalPipes(
  //   new ValidationPipe({
  //     whitelist: true,
  //     transform: true,
  //     forbidNonWhitelisted: true,
  //     disableErrorMessages: false,
  //     validationError: { target: false, value: false },
  //   }),
  // );
  app.enableCors({
    origin: true,
    credentials: true,
  });

  const config = new DocumentBuilder()
    .setTitle('PIM API')
    .setDescription(
      '상품 정보 관리 시스템 (Product Information Management) API',
    )
    .setVersion('1.0.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  // Railway는 PORT 환경변수를 제공하므로 우선 사용
  const port = process.env.PORT ?? 3020;

  // Fastify는 기본적으로 127.0.0.1에만 바인딩하므로, Railway에서 접근 가능하도록 0.0.0.0 명시
  await app.listen(port, '0.0.0.0');

  console.log(`🚀 PIM 서비스가 0.0.0.0:${port}에서 실행 중입니다.`);
}
bootstrap();
