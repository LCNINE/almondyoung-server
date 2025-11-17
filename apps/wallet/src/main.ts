// apps/wallet/src/main.ts
import 'reflect-metadata'; // 배포 에러로 넣었음 지훈
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { join } from 'path';
import { writeFileSync, mkdirSync } from 'fs';
import fastifyCookie from '@fastify/cookie';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  // ZodValidationPipe와 충돌하므로 글로벌 ValidationPipe 비활성화
  // app.useGlobalPipes(new ValidationPipe());

  // 쿠키 파서 등록 (JWT 토큰 인증을 위해 필요)
  await app.register(fastifyCookie);

  await app.register(require('@fastify/multipart'), {
    attachFieldsToBody: true,
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
    ],
    credentials: true,
  });

  // 정적 파일 서빙 설정 (HTML 파일들)
  const htmlPath = join(process.cwd(), 'html');

  await app.register(require('@fastify/static'), {
    root: htmlPath,
    prefix: '/html/',
  });

  console.log(`정적 파일 서빙 경로: ${htmlPath}`);

  // Swagger 설정
  const config = new DocumentBuilder()
    .setTitle('Wallet Payment Server')
    .setDescription('MVP payment server for Medusa integration')
    .setVersion('0.1.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  // Swagger JSON apps/wallet/swagger-spec.json에 저장 (개발 환경만)
  // if (process.env.NODE_ENV !== 'production') {
  //   const swaggerJsonPath = join(
  //     process.cwd(),
  //     'apps',
  //     'wallet',
  //     'swagger-spec.json',
  //   );
  //   mkdirSync(join(process.cwd(), 'apps', 'wallet'), { recursive: true });
  //   writeFileSync(swaggerJsonPath, JSON.stringify(document, null, 2));
  //   console.log(`Swagger JSON 생성됨: ${swaggerJsonPath}`);
  // }

  // Swagger UI (서버에서 확인)
  SwaggerModule.setup('/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });

  // 전역 에러 로깅 필터
  app.useGlobalFilters({
    catch(exception: any, host: any) {
      const ctx = host.switchToHttp();
      const response = ctx.getResponse();
      const request = ctx.getRequest();

      const status = exception.getStatus?.() || 500;

      console.error('❌ 전역 에러 발생:', {
        timestamp: new Date().toISOString(),
        path: request.url,
        method: request.method,
        status: status,
        body: request.body,
        query: request.query,
        params: request.params,
        errorName: exception.name,
        errorMessage: exception.message,
        // Zod 에러의 경우 상세 정보 포함
        zodErrors: exception.response?.message || exception.getResponse?.(),
      });

      // 스택 트레이스는 개발 환경에서만
      if (process.env.NODE_ENV !== 'production') {
        console.error('Stack trace:', exception.stack);
      }

      // Fastify 응답 처리
      response.code(status).send({
        statusCode: status,
        message: exception.message,
        error: exception.name,
        ...(exception.response && { details: exception.response }),
      });
    },
  });

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;
  await app.listen(port, '0.0.0.0');
  console.log(`🚀 Wallet server is running on port ${port}`);
}
bootstrap();
