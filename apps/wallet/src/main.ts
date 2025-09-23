// main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { join } from 'path';
async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  // ZodValidationPipe와 충돌하므로 글로벌 ValidationPipe 비활성화
  // app.useGlobalPipes(new ValidationPipe());

  await app.register(require('@fastify/multipart'), {
    attachFieldsToBody: true, // 🔧 false로 변경해서 전통적인 방식 사용
    limits: {
      fileSize: 1024 * 1024 * 10,
      files: 1,
    },
  });
  app.enableCors({
    origin: [
      'http://127.0.0.1:5500',
      'http://localhost:5000',
      'http://localhost:8080',
      'http://localhost:9000',
      'http://localhost:8000',
    ], // Live Server 주소 허용
    credentials: true,
  });

  // 정적 파일 서빙 설정 (HTML 파일들)
  // 프로젝트 루트의 html 폴더를 가리킴 (폴더명 변경 대응)
  const htmlPath = join(process.cwd(), 'html');

  await app.register(require('@fastify/static'), {
    root: htmlPath,
    prefix: '/html/',
  });

  console.log(`정적 파일 서빙 경로: ${htmlPath}`);

  const config = new DocumentBuilder()
    .setTitle('Wallet Payment Server')
    .setDescription('MVP payment server for Medusa integration')
    .setVersion('0.1.0')
    .build();

  const doc = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('/docs', app, doc);

  const port = process.env.PORT || 5000;
  await app.listen(port);
  console.log(`🚀 Wallet server is running on port ${port}`);
}
bootstrap();
