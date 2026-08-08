import './tracing';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { GlobalExceptionFilter } from '@app/shared';
import fastifyCookie from '@fastify/cookie';
import { EventsModule, createKafkaConfigFromEnv } from '@app/events';
import { ORDER_STREAM, MEMBERSHIP_STREAM } from '@packages/event-contracts';
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
    // NOTE: this `streams` list does NOT determine what we subscribe to — it is inert.
    // forConsumer() builds `subscribe.topics` from it, but Nest's ServerKafka overrides
    // that field: `bindEvents()` spreads `options.subscribe` and then sets
    // `topics: [...this.messageHandlers.keys()]` after the spread
    // (node_modules/@nestjs/microservices/server/server-kafka.js:92, v11.1.17). Since
    // @OnEvent(topic, type) is EventPattern(topic) + metadata, the registered patterns
    // ARE the topic strings, so the real subscription set comes from the @OnEvent
    // decorators on controllers registered in analytics.module.ts.
    //
    // Concretely: PRODUCT_STREAM is absent from this array and products.events.v1 is
    // still subscribed, because ProductEventsConsumer is in `controllers` and declares
    // six @OnEvent('products.events.v1', ...) handlers. (An earlier version of this
    // comment claimed the opposite and was wrong — see docs/adr/0029.)
    //
    // The list that does carry weight is the one passed to forConsumerModule() in
    // analytics.module.ts: it supplies the topic -> StreamConfig map used by
    // SchemaValidationInterceptor, plus topic bootstrap. Load-bearing args here are
    // groupId and kafka.
    const consumerOptions = EventsModule.forConsumer({
      streams: [ORDER_STREAM, MEMBERSHIP_STREAM],
      groupId: process.env.KAFKA_GROUP_ID || 'analytics-consumer',
      kafka: kafkaConfig,
    });

    app.connectMicroservice(consumerOptions);
    await app.startAllMicroservices();
    logger.log('Kafka consumer connected (orders.events.v1, membership.events.v1).');
  } else {
    logger.warn('Kafka consumer disabled: KAFKA_BROKERS not set.');
  }

  const port = process.env.PORT ?? 3040;

  await app.listen(port, '0.0.0.0');

  console.log(`Analytics Service listening on 0.0.0.0:${port}`);
}
bootstrap();
