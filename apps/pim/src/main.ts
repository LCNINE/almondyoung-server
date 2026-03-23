import '@app/tracing'
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { PimModule } from './pim.module';
import fastifyMultipart from '@fastify/multipart';
import fastifyCookie from '@fastify/cookie';
import { GlobalExceptionFilter } from '@app/shared';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    PimModule,
    new FastifyAdapter(),
  );

  await app.register(fastifyCookie);

  // Fastify multipart 지원
  await app.register(fastifyMultipart, {
    limits: {
      fileSize: 10 * 1024 * 1024,
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
    .setTitle('PIM API')
    .setDescription(
      '상품 정보 관리 시스템 (Product Information Management) API\n\n' +
      '제품 마스터, 변형, 카테고리, 판매 채널, 채널별 제품 정보를 관리하는 API입니다.',
    )
    .setVersion('1.0.0')
    .addTag('PIM Health', '서비스 헬스체크')
    .addTag('Categories', '제품 카테고리 관리')
    .addTag('Product Masters', '제품 마스터 관리')
    .addTag('Product Variants', '제품 변형 관리')
    .addTag('Channel Products', '채널별 제품 관리')
    .addTag('Sales Channels', '판매 채널 관리')
    .addTag('File Upload', '파일 업로드')
    .addTag('Product Approval', '제품 승인 관리')
    .addTag('Product Bulk Operations', '제품 일괄 작업')
    .addTag('Product CSV', 'CSV 가져오기/내보내기')
    .addTag('Product Audit', '제품 감사 로그')
    .addTag('Dashboard', '대시보드 통계')
    .addTag('Tags', '태그 관리')
    .addServer('http://localhost:3020', '로컬 개발 서버')
    .addServer('https://pim-development.up.railway.app', 'Railway 개발 서버')
    .addServer('https://pim.almondyoung.com', '프로덕션 서버')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    yamlDocumentUrl: '/docs.yaml',
  });

  // YAML 문서 charset 헤더 설정
  app.getHttpAdapter().getInstance().addHook('onSend', (request, reply, payload, done) => {
    if (request.url === '/docs.yaml') {
      reply.header('Content-Type', 'application/x-yaml; charset=utf-8');
    }
    done();
  });

  // Railway는 PORT 환경변수를 제공하므로 우선 사용
  const port = process.env.PORT ?? 3020;

  // Fastify는 기본적으로 127.0.0.1에만 바인딩하므로, Railway에서 접근 가능하도록 0.0.0.0 명시
  await app.listen(port, '0.0.0.0');

  console.log(`🚀 PIM 서비스가 0.0.0.0:${port}에서 실행 중입니다.`);
}
bootstrap();
