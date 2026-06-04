import './tracing';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyMultipart from '@fastify/multipart';
import { WalletModule } from './wallet.module';
import { EventsModule } from '@app/events';
import { UGC_COMMAND_STREAM } from '@packages/event-contracts/streams';

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function parseAllowedOrigins(rawOrigins?: string): string[] {
  if (!rawOrigins) {
    return [];
  }

  return rawOrigins
    .split(',')
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean);
}

function getWildcardDomain(pattern: string): string | null {
  const normalizedPattern = normalizeOrigin(pattern).toLowerCase();
  const withoutProtocol = normalizedPattern.replace(/^[a-z]+:\/\//, '');

  if (!withoutProtocol.startsWith('*.')) {
    return null;
  }

  const domain = withoutProtocol.slice(2);
  return domain || null;
}

function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) {
    return true;
  }

  const normalizedOrigin = normalizeOrigin(origin);
  let parsedOrigin: URL;

  try {
    parsedOrigin = new URL(normalizedOrigin);
  } catch {
    return false;
  }

  const hostname = parsedOrigin.hostname.toLowerCase();

  return allowedOrigins.some((allowedOrigin) => {
    const wildcardDomain = getWildcardDomain(allowedOrigin);
    if (wildcardDomain) {
      return hostname.endsWith(`.${wildcardDomain}`);
    }

    return normalizedOrigin === normalizeOrigin(allowedOrigin);
  });
}

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(WalletModule, new FastifyAdapter());

  app.connectMicroservice(
    EventsModule.forConsumer({
      streams: [UGC_COMMAND_STREAM],
      groupId: process.env.KAFKA_GROUP_ID || 'wallet-consumer',
    }),
  );

  const isDev = process.env.NODE_ENV !== 'production';
  const allowedOrigins = parseAllowedOrigins(process.env.CORS_ORIGINS);

  await app.register(fastifyCors, {
    origin: isDev
      ? true
      : (origin, callback) => {
          callback(null, isOriginAllowed(origin, allowedOrigins));
        },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Client-Secret'],
    credentials: true,
  });
  await app.register(fastifyCookie);
  await app.register(fastifyMultipart, {
    limits: { fileSize: 5 * 1024 * 1024 },
  });

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

  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onSend', (_request: any, reply: any, _payload: any, done: any) => {
      if (_request.url === '/docs.yaml') {
        reply.header('Content-Type', 'application/x-yaml; charset=utf-8');
      }
      done();
    });

  const port = Number(process.env.PORT ?? 3000);
  await app.startAllMicroservices();
  await app.listen(port, '0.0.0.0');
}

bootstrap();
