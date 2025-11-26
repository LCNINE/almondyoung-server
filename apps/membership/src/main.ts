// apps/membership/src/main.ts
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import fastifyCookie from '@fastify/cookie';
import { ZodValidationPipe } from 'nestjs-zod';

/**
 * 애플리케이션 부트스트랩 함수
 * 개발 환경에서는 Express, 운영 환경에서는 Fastify를 사용
 * Swagger는 개발 환경에서만 활성화
 */
async function bootstrap(): Promise<void> {
  const isDev = process.env.NODE_ENV !== 'production';

  console.log('🚀 Starting Membership API...');
  console.log('NODE_ENV:', process.env.NODE_ENV);
  console.log('Platform: Fastify');

  // 개발환경: Express, 운영환경: Fastify
  const app = isDev
    ? await NestFactory.create<NestFastifyApplication>(
        AppModule,
        new FastifyAdapter(),
      )
    : await NestFactory.create<NestFastifyApplication>(
        AppModule,
        new FastifyAdapter(),
      );

  // 쿠키 파서 등록 (Fastify)
  await app.register(fastifyCookie);
  app.useGlobalPipes(new ZodValidationPipe());
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

  // CORS 설정 - 개발 환경에서는 모든 origin 허용
  app.enableCors({
    origin: isDev ? true : ['http://localhost:8000', 'http://127.0.0.1:5000'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
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

  // Swagger는 개발 환경에서만 활성화
  if (isDev) {
    // Swagger 설정 (기존 setupSwagger 대신 직접 작성)
    const config = new DocumentBuilder()
      .setTitle('Membership Service API')
      .setDescription('Membership management API')
      .setVersion('1.0.0')
      .build();

    const document = SwaggerModule.createDocument(app, config);

    // apps/membership/swagger-spec.json에 저장 (개발 환경만)
    // if (process.env.NODE_ENV !== 'production') {
    //   const swaggerJsonPath = join(process.cwd(), 'apps', 'membership', 'swagger-spec.json');
    //   mkdirSync(join(process.cwd(), 'apps', 'membership'), { recursive: true });
    //   writeFileSync(swaggerJsonPath, JSON.stringify(document, null, 2));
    //   console.log(`Swagger JSON 생성됨: ${swaggerJsonPath}`);
    // }

    // Swagger UI
    SwaggerModule.setup('/api/docs', app, document, {
      yamlDocumentUrl: '/api/docs.yaml',
      swaggerOptions: {
        persistAuthorization: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
      },
    });

    // YAML 문서 charset 헤더 설정
    app.getHttpAdapter().getInstance().addHook('onSend', (request, reply, payload, done) => {
      if (request.url === '/api/docs.yaml') {
        reply.header('Content-Type', 'application/x-yaml; charset=utf-8');
      }
      done();
    });
  }

  // 전역 에러 로깅 필터 (Fastify 호환)
  app.useGlobalFilters({
    catch(exception: any, host: any) {
      const ctx = host.switchToHttp();
      const response = ctx.getResponse();
      const request = ctx.getRequest();

      const status = exception.getStatus?.() || 500;

      console.error('❌ [Membership] 전역 에러 발생:', {
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
      if (isDev) {
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

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
  await app.listen(port, '0.0.0.0');

  console.log(`🚀 Application running: http://localhost:${port}`);

  if (isDev) {
    console.log(`📚 Swagger documentation: http://localhost:${port}/docs`);
  }
}

bootstrap().catch((error) => {
  console.error('❌ Failed to start application:', error);
  process.exit(1);
});
