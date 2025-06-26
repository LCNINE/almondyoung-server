import { HttpExceptionFilter } from '@app/shared/filters/http-exception.filter';
import { ResponseInterceptor } from '@app/shared/interceptors/response.interceptor';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import { UserServiceModule } from './user-service.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    UserServiceModule,
    new FastifyAdapter(),
  );

  await app.register(fastifyHelmet);
  await app.register(fastifyCookie);

  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());

  await app.listen(process.env.port ?? 3000, '0.0.0.0');
}

bootstrap();
