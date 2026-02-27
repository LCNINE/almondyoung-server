import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import { WalletModule } from './wallet.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    WalletModule,
    new FastifyAdapter(),
  );

  const isDev = process.env.NODE_ENV !== 'production';
  const rawOrigins = process.env.WALLET_CORS_ORIGINS;
  const allowedOrigins = rawOrigins
    ? rawOrigins.split(',').map((o) => o.trim()).filter(Boolean)
    : [];

  await app.register(fastifyCors, {
    origin: isDev ? true : allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
      'X-Client-Secret',
    ],
    credentials: true,
  });
  await app.register(fastifyCookie);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
      disableErrorMessages: false,
      validationError: { target: false, value: false },
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Wallet Gateway API')
    .setDescription('Payment Gateway API (Phase 1)')
    .setVersion('1.0.0')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'Authorization' }, 'api-key')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    yamlDocumentUrl: '/docs.yaml',
  });

  app.getHttpAdapter().getInstance().addHook('onSend', (_request: any, reply: any, _payload: any, done: any) => {
    if (_request.url === '/docs.yaml') {
      reply.header('Content-Type', 'application/x-yaml; charset=utf-8');
    }
    done();
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
}

bootstrap();
