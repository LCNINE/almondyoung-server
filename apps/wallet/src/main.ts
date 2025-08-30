// main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    {
      bufferLogs: true,
      cors: {
        origin: ['http://127.0.0.1:5500', 'http://localhost:5500'],
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Idempotency-Key'],
        credentials: true,
      },
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

  const config = new DocumentBuilder()
    .setTitle('Wallet Payment Server')
    .setDescription('MVP payment server for Medusa integration')
    .setVersion('0.1.0')
    .build();

  const doc = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('/docs', app, doc);
  await app.listen(process.env.port ?? 5000);
}
bootstrap();
