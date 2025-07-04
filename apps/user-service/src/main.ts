import { HttpExceptionFilter } from '@app/shared/filters/http-exception.filter';
import { ResponseInterceptor } from '@app/shared/interceptors/response.interceptor';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifySession from '@fastify/session';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  const configService = app.get(ConfigService);
  const port = configService.get('PORT') || 5000;
  const corsOrigin =
    configService.get('CORS_ORIGIN_DOMAIN') || 'http://localhost:3000';

  logger.log('CORS:', corsOrigin);

  // Passport와 Fastify 호환성을 위한 훅 추가
  app.getHttpAdapter().getInstance().addHook('onRequest', (request, reply, done) => {
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

  // 세션 설정(카카오 로그인을 위해 필요)
  await app.register(fastifySession, {
    secret: configService.get('KAKAO_CLIENT_SECRET') as string,
    cookieName: 'sessionId',
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24,
    },
  });

  await app.register(fastifyCors, {
    origin:
      process.env.NODE_ENV === 'production'
        ? [corsOrigin]
        : ['http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    exposedHeaders: ['Set-Cookie'],
    maxAge: 86400, // 24시간
  });

  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  logger.log(`Application running on port ${port}`);
  await app.listen(port, '0.0.0.0');
}

bootstrap();