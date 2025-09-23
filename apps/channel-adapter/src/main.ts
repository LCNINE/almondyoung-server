// main.ts
import { NestFactory } from '@nestjs/core';
import { AdapterModule } from './adapter.module';
import { ValidationPipe } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { join } from 'path';
async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AdapterModule,
    new FastifyAdapter(),
  );

  app.useGlobalPipes(new ValidationPipe());

  // Swagger API 문서 설정
  const config = new DocumentBuilder()
    .setTitle('아몬드영 채널 어댑터 API')
    .setDescription(
      '판매채널(네이버 스마트스토어, 쿠팡 등)과 내부 시스템 간의 데이터 동기화 및 이벤트 중계를 위한 API',
    )
    .setVersion('1.0.0')
    .addTag('adapter', '채널 어댑터 핵심 기능')
    .addTag('sync-status', '동기화 상태 및 통계')
    .addServer('http://localhost:3003', '개발 서버')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });

  await app.register(require('@fastify/multipart'), {
    attachFieldsToBody: false, // 🔧 false로 변경해서 전통적인 방식 사용
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

  await app.listen(3003);
}
bootstrap();
