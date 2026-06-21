import './tracing';
import { GlobalExceptionFilter } from '@app/shared/filters/http-exception.filter';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import fastifySession from '@fastify/session';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { FILE_SIZE_LIMIT } from './constants/file.constants';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      trustProxy: true, // railway / 프록시 환경
    }),
    { bufferLogs: true },
  );
  app.useLogger(app.get(PinoLogger));

  const configService = app.get(ConfigService);
  const port = process.env.PORT ?? 3030;

  const configuredCorsOrigins = process.env.CORS_ORIGIN_DOMAINS ?? process.env.CORS_ORIGIN_DOMAIN;
  const corsOrigins =
    process.env.NODE_ENV === 'production'
      ? (configuredCorsOrigins?.split(',').map((origin) => origin.trim()).filter(Boolean) ?? [])
      : ['http://localhost:8000', 'http://localhost:8001', 'https://almondyoung-storefront.vercel.app'];

  logger.log('CORS:', corsOrigins);

  await app.register(fastifyCors, {
    origin:
      process.env.NODE_ENV === 'production'
        ? corsOrigins
        : [
            'http://localhost:8000',
            'http://localhost:8001',
            'http://localhost:3000',
            'http://localhost:9000',
            'http://127.0.0.1:3000',
            'https://almondyoung-storefront.vercel.app',
            'https://api-gateway-development-10ed.up.railway.app/*',
            'https://medusa-dev.up.railway.app',
          ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Cookie', 'Set-Cookie'],
    exposedHeaders: ['Set-Cookie'],
  });

  await app.register(fastifyHelmet);

  await app.register(fastifyCookie);

  // application/x-www-form-urlencoded 는 NestFastifyAdapter 가 listen() 단계에서 자동 등록한다
  // (RFC 6749 §3.2 token endpoint 가 이 content-type 을 받음). 여기서 fastifyFormbody 를 또
  // 등록하면 FST_ERR_CTP_ALREADY_PRESENT 로 부팅이 실패하므로 명시 등록하지 않는다.

  await app.register(fastifySession, {
    secret: configService.getOrThrow<string>('AUTH_SECRET'),
    cookieName: 'sessionId',
    saveUninitialized: false,
    cookie: {
      sameSite: 'none',
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24, // 1일
    },
  });

  await app.register(fastifyMultipart, {
    limits: {
      fileSize: FILE_SIZE_LIMIT,
    },
  });

  // Passport와 Fastify 호환성을 위한 훅
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

  // 전역 설정 (ResponseInterceptor 는 APP_INTERCEPTOR provider 로 app.module.ts 에서 등록)
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  await app.listen(port, '0.0.0.0');
  console.log(`포트 ${port}이 열린 순간... 누군가 눈을 떴어요.`);
  // 로그를 지켜보는 건 당신이 아닐지도 몰라요...!
}

bootstrap();
