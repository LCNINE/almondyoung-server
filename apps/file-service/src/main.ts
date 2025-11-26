import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import { FileServiceModule } from './file-service.module';
import fastifyCookie from '@fastify/cookie';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    FileServiceModule,
    new FastifyAdapter(),
  );

  // 쿠키 파서 등록 (JWT 토큰 인증을 위해 필요)
  await app.register(fastifyCookie);

  // Passport와 Fastify 호환성을 위한 훅 (중요!)
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', (request, reply, done) => {
      (reply as any).setHeader = function (key: string, value: string) {
        return this.raw.setHeader(key, value);
      };
      (reply as any).end = function () {
        this.raw.end();
      };
      (request as any).res = reply;
      done();
    });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // 전역 예외 필터 (Fastify 호환) - Guard 에러를 제대로 처리하기 위해 필수!
  app.useGlobalFilters({
    catch(exception: any, host: any) {
      const ctx = host.switchToHttp();
      const response = ctx.getResponse();
      const request = ctx.getRequest();

      const status = exception.getStatus?.() || 500;

      console.error('❌ [File Service] 전역 에러 발생:', {
        timestamp: new Date().toISOString(),
        path: request.url,
        method: request.method,
        status: status,
        errorName: exception.name,
        errorMessage: exception.message,
      });

      // Fastify 응답 처리
      response.code(status).send({
        statusCode: status,
        message: exception.message,
        error: exception.name,
        ...(exception.response && { details: exception.response }),
      });
    },
  });

  app.enableCors({
    origin: true,
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Cookie',
      'Set-Cookie',
    ],
    exposedHeaders: ['Set-Cookie'],
  });
  app.enableShutdownHooks();

  const config = new DocumentBuilder()
    .setTitle('File Service API')
    .setDescription(
      '파일 업로드, 다운로드, 생명주기 관리 API\n\n' +
      '파일 업로드(단일/일괄), 다운로드(Signed URL), 활성화/삭제 등 파일 관리 기능을 제공합니다.',
    )
    .setVersion('1.0.0')
    .addTag('Health', '서비스 헬스체크')
    .addTag('Upload', '파일 업로드 (단일/일괄)')
    .addTag('Download', '파일 다운로드 및 메타데이터 조회')
    .addTag('Lifecycle', '파일 생명주기 관리 (활성화/삭제)')
    .addApiKey(
      {
        type: 'apiKey',
        name: 'accessToken',
        in: 'cookie',
        description: 'JWT 토큰 쿠키 (accessToken)',
      },
      'cookie',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    yamlDocumentUrl: '/docs.yaml',
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });

  // YAML 문서 charset 헤더 설정
  app.getHttpAdapter().getInstance().addHook('onSend', (request, reply, payload, done) => {
    if (request.url === '/docs.yaml') {
      reply.header('Content-Type', 'application/x-yaml; charset=utf-8');
    }
    done();
  });

  // Railway는 PORT 환경변수를 제공하므로 우선 사용
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  // Fastify는 기본적으로 127.0.0.1에만 바인딩하므로, Railway에서 접근 가능하도록 0.0.0.0 명시
  await app.listen(port, '0.0.0.0');

  console.log(`🚀 File Service가 0.0.0.0:${port}에서 실행 중입니다.`);
  console.log(`📚 Swagger 문서: http://localhost:${port}/docs`);
}

bootstrap().catch((error) => {
  console.error('❌ Failed to start application:', error);
  process.exit(1);
});
