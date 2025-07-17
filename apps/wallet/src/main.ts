// main.ts
import { NestFactory } from '@nestjs/core';
import { PaymsModule } from './payms.module';
import { ValidationPipe } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    PaymsModule,
    new FastifyAdapter(),
    {
      bufferLogs: true,
      cors: true,
    },
  );
  app.useGlobalPipes(new ValidationPipe());

  await app.register(require('@fastify/multipart'), {
    attachFieldsToBody: false,
    limits: {
      fileSize: 1024 * 1024 * 10,
      files: 1,
    },
  });

  await app.listen(process.env.port ?? 5000);
}
bootstrap();
