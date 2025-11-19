// apps/wms/src/main.ts
import { NestFactory } from '@nestjs/core';
import { WmsModule } from './wms.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { EventsModule } from '@app/events';
import { PRODUCT_STREAM } from '@packages/event-contracts';
import * as os from 'os';

function createKafkaConfig() {
  const prefix = process.env.KAFKA_CLIENT_ID_PREFIX;
  if (!prefix) {
    throw new Error('KAFKA_CLIENT_ID_PREFIX 환경변수가 필요합니다.');
  }

  const brokers = process.env.KAFKA_BROKERS;
  if (!brokers) {
    throw new Error('KAFKA_BROKERS 환경변수가 필요합니다.');
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
  const app = await NestFactory.create(WmsModule);

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({
    origin: true,
    credentials: true,
  });
  app.enableShutdownHooks();

  const consumerOptions = EventsModule.forConsumer({
    streams: [PRODUCT_STREAM],
    groupId: 'wms-product-consumer',
    kafka: createKafkaConfig(),
  });

  app.connectMicroservice(consumerOptions);

  const config = new DocumentBuilder()
    .setTitle('WMS API')
    .setDescription('WMS Service API')
    .setVersion('1.0.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  // Kafka 마이크로서비스 시작 (연결 실패 시에도 앱은 계속 실행)
  const logger = new Logger('Bootstrap');
  try {
    await app.startAllMicroservices();
    logger.log('✅ Kafka microservice started successfully');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      `⚠️ Failed to start Kafka microservice: ${errorMessage}`,
      error instanceof Error ? error.stack : undefined,
    );

    // 개발 환경에서는 경고만 출력하고 계속 진행
    if (process.env.NODE_ENV !== 'production') {
      logger.warn(
        '⚠️ Continuing without Kafka microservice (development mode)',
      );
    } else {
      // 프로덕션 환경에서는 에러를 다시 던짐
      logger.error('❌ Kafka connection required in production');
      throw error;
    }
  }

  await app.listen(process.env.PORT ?? 3010);
  logger.log(`🚀 WMS API is running on port ${process.env.PORT ?? 3010}`);
}

bootstrap().catch((error) => {
  const logger = new Logger('Bootstrap');
  logger.error('Failed to start application', error);
  process.exit(1);
});
