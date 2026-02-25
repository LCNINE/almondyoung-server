import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { GlobalExceptionFilter } from '@app/shared';
import fastifyCookie from '@fastify/cookie';
import { EventsModule } from '@app/events';
import { ORDER_STREAM } from '@packages/event-contracts';
import * as os from 'os';
import { AnalyticsModule } from './analytics.module';

function createKafkaConfig() {
  const prefix = process.env.KAFKA_CLIENT_ID_PREFIX;
  const brokers = process.env.KAFKA_BROKERS;

  if (!prefix || !brokers) {
    return null;
  }

  return {
    clientId: `${prefix}_${os.hostname()}`,
    brokers: brokers.split(','),
    retry: {
      retries: 5,
      initialRetryTime: 300,
      multiplier: 2,
      maxRetryTime: 30000,
    },
    ssl: process.env.KAFKA_API_KEY ? true : false,
    sasl:
      process.env.KAFKA_API_KEY && process.env.KAFKA_API_SECRET
        ? {
          mechanism: 'plain' as const,
          username: process.env.KAFKA_API_KEY,
          password: process.env.KAFKA_API_SECRET,
        }
        : undefined,
  };
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestFastifyApplication>(
    AnalyticsModule,
    new FastifyAdapter(),
  );

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

  app.useGlobalFilters(new GlobalExceptionFilter());

  app.enableCors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  });

  const config = new DocumentBuilder()
    .setTitle('Analytics Service API')
    .setDescription(
      'Analytics Service API\n\n' +
      'Provides aggregated metrics and statistics.',
    )
    .setVersion('1.0.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    yamlDocumentUrl: '/docs.yaml',
  });

  // YAML docs charset header for Swagger.
  app.getHttpAdapter().getInstance().addHook('onSend', (request, reply, payload, done) => {
    if (request.url === '/docs.yaml') {
      reply.header('Content-Type', 'application/x-yaml; charset=utf-8');
    }
    done();
  });

  const kafkaConfig = createKafkaConfig();
  if (kafkaConfig) {
    const consumerOptions = EventsModule.forConsumer({
      streams: [ORDER_STREAM],
      groupId: process.env.KAFKA_GROUP_ID || 'analytics-consumer',
      kafka: kafkaConfig,
    });

    app.connectMicroservice(consumerOptions);
    await app.startAllMicroservices();
    logger.log('Kafka consumer connected (orders.events.v1).');
  } else {
    logger.warn('Kafka consumer disabled: missing KAFKA_CLIENT_ID_PREFIX or KAFKA_BROKERS.');
  }

  const port = process.env.PORT ?? 3040;

  await app.listen(port, '0.0.0.0');

  console.log(`Analytics Service listening on 0.0.0.0:${port}`);
}
bootstrap();
