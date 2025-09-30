// apps/channel-adapter/src/main.ts
import { NestFactory } from '@nestjs/core';
import { AdapterModule } from './adapter.module';
import { ValidationPipe } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { join } from 'path';
import { writeFileSync, mkdirSync } from 'fs';

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

  // OpenAPI 스펙 생성
  const document = SwaggerModule.createDocument(app, config);

  // Swagger JSON 파일 apps/channel-adapter/swagger-spec.json에 저장 (개발 환경만)
  if (process.env.NODE_ENV !== 'production') {
    const swaggerJsonPath = join(
      process.cwd(),
      'apps',
      'channel-adapter',
      'swagger-spec.json',
    );

    mkdirSync(join(process.cwd(), 'apps', 'channel-adapter'), {
      recursive: true,
    });

    writeFileSync(swaggerJsonPath, JSON.stringify(document, null, 2));
    console.log(`Swagger JSON 생성됨: ${swaggerJsonPath}`);
  }

  // Swagger UI (서버에서 바로 확인 가능)
  SwaggerModule.setup('/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });

  // 파일 업로드 등 Fastify 설정
  await app.register(require('@fastify/multipart'), {
    attachFieldsToBody: false,
    limits: {
      fileSize: 1024 * 1024 * 10,
      files: 1,
    },
  });

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
  const htmlPath = join(process.cwd(), 'html');
  await app.register(require('@fastify/static'), {
    root: htmlPath,
    prefix: '/html/',
  });
  console.log(`정적 파일 서빙 경로: ${htmlPath}`);

  const port = process.env.PORT ?? 3003;
  await app.listen(port);
  console.log(`Channel Adapter running on port ${port}`);
}
bootstrap();
