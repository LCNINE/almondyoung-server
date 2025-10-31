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
  app.enableCors();

  const config = new DocumentBuilder()
    .setTitle('PIM API')
    .setDescription(
      '상품 정보 관리 시스템 (Product Information Management) API',
    )
    .setVersion('1.0.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  await app.listen(process.env.PIM_SERVICE_PORT || 3020);
}
bootstrap();
