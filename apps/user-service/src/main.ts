import { HttpExceptionFilter } from '@app/shared/filters/http-exception.filter';
import { ResponseInterceptor } from '@app/shared/interceptors/response.interceptor';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  const configService = app.get(ConfigService);
  const port = configService.get('PORT') || 3000;

  await app.register(fastifyHelmet);
  await app.register(fastifyCookie);

  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());

  console.log(`Application running on port ${port}`);
  await app.listen(port, '0.0.0.0');
}

bootstrap();
