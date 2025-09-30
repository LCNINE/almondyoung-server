import { GlobalExceptionFilter } from '@app/shared/filters/http-exception.filter';
import { ResponseInterceptor } from '@app/shared/interceptors/response.interceptor';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import fastifySession from '@fastify/session';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { FILE_SIZE_LIMIT } from './constants/file.constants';
import { writeFileSync } from 'fs';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  const configService = app.get(ConfigService);
  const port = configService.get('PORT') || 5000;
  const corsOrigins = process.env.CORS_ORIGIN_DOMAIN
    ? process.env.CORS_ORIGIN_DOMAIN.split(',').map((origin) => origin.trim())
    : ['http://localhost:3000'];

  logger.log('CORS:', corsOrigins);

  // Swagger 설정
  const config = new DocumentBuilder()
    .setTitle('User Service API')
    .setDescription('The User Service API description')
    .setVersion('1.0')
    .addTag('Auth', '인증 관련 API')
    .addTag('Users', '사용자 관련 API')
    .addTag('Admin', '관리자 관련 API')
    .addTag('Admin/Roles', '관리자 권한 관련 API')
    .addTag('Admin/Scopes', '관리자 스코프 관련 API')
    .addTag('Admin/Dormant', '휴면 계정 관련 API')
    .addTag('Shop', '상점 관련 API')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT token',
        in: 'header',
      },
      'access-token',
    )
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  // Swagger JSON 파일로 저장 (개발 환경에서만)
  if (process.env.NODE_ENV !== 'production') {
    writeFileSync(
      'apps/user-service/swagger-spec.json',
      JSON.stringify(document),
    );
  }

  // Passport와 Fastify 호환성을 위한 훅 추가
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', (request, reply, done) => {
      (reply as any).setHeader = function (key, value) {
        return this.raw.setHeader(key, value);
      };
      (reply as any).end = function () {
        this.raw.end();
      };
      (request as any).res = reply;
      done();
    });

  await app.register(fastifyHelmet);
  await app.register(fastifyCookie);

  // Multipart 설정 추가
  await app.register(fastifyMultipart, {
    limits: {
      fileSize: FILE_SIZE_LIMIT,
    },
  });

  // 세션 설정(카카오 로그인을 위해 필요)
  await app.register(fastifySession, {
    secret: configService.get('KAKAO_CLIENT_SECRET') as string,
    cookieName: 'sessionId',
    saveUninitialized: false,
    cookie: {
      sameSite: 'none',
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24,
    },
  });

  await app.register(fastifyCors, {
    origin:
      process.env.NODE_ENV === 'production'
        ? corsOrigins
        : [
            'http://localhost:8000',
            'http://localhost:3000',
            'http://localhost:9000',
            'http://127.0.0.1:3000',
          ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Cookie',
      'Set-Cookie',
    ],
    exposedHeaders: ['Set-Cookie'],
  });

  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  logger.log(`Application running on port ${port}`);
  await app.listen(port, '0.0.0.0');
}

bootstrap();
