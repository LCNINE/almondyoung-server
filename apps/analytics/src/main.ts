import './tracing';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { GlobalExceptionFilter } from '@app/shared';
import fastifyCookie from '@fastify/cookie';
import { EventsModule, createKafkaConfigFromEnv } from '@app/events';
import { ORDER_STREAM } from '@packages/event-contracts';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AnalyticsModule } from './analytics.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestFastifyApplication>(AnalyticsModule, new FastifyAdapter(), {
    bufferLogs: true,
  });
  app.useLogger(app.get(PinoLogger));

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
    .setDescription('Analytics Service API\n\n' + 'Provides aggregated metrics and statistics.')
    .setVersion('1.0.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    yamlDocumentUrl: '/docs.yaml',
  });

  // YAML docs charset header for Swagger.
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onSend', (request, reply, payload, done) => {
      if (request.url === '/docs.yaml') {
        reply.header('Content-Type', 'application/x-yaml; charset=utf-8');
      }
      done();
    });

  const kafkaConfig = createKafkaConfigFromEnv();
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
    logger.warn('Kafka consumer disabled: KAFKA_BROKERS not set.');
  }

  const port = process.env.PORT ?? 3040;

  await app.listen(port, '0.0.0.0');

  console.log(`Analytics Service listening on 0.0.0.0:${port}`);
}
bootstrap();
