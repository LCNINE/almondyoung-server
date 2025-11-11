// apps/wms/src/main.ts
import { NestFactory } from '@nestjs/core';
import { WmsModule } from './wms.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { EventsModule } from '@app/events';
import { PRODUCT_STREAM } from '@packages/event-contracts';
import * as os from 'os';

const logger = new Logger('KafkaConfig');

function maskString(str: string | undefined, visibleChars = 4): string {
  if (!str) return '<undefined>';
  if (str.length <= visibleChars) return '***';
  return str.substring(0, visibleChars) + '***';
}

function createKafkaConfig() {
  logger.log('🔍 [Kafka Config] 환경변수 확인 중...');
  
  const prefix = process.env.KAFKA_CLIENT_ID_PREFIX;
  const brokers = process.env.KAFKA_BROKERS;
  const apiKey = process.env.KAFKA_API_KEY;
  const apiSecret = process.env.KAFKA_API_SECRET;
  
  logger.log(`  - KAFKA_CLIENT_ID_PREFIX: ${prefix || '<undefined>'}`);
  logger.log(`  - KAFKA_BROKERS: ${brokers || '<undefined>'}`);
  logger.log(`  - KAFKA_API_KEY: ${maskString(apiKey)} (length: ${apiKey?.length || 0})`);
  logger.log(`  - KAFKA_API_SECRET: ${maskString(apiSecret, 0)} (length: ${apiSecret?.length || 0})`);
  logger.log(`  - Hostname: ${os.hostname()}`);
  
  if (!prefix) {
    throw new Error('KAFKA_CLIENT_ID_PREFIX 환경변수가 필요합니다.');
  }

  if (!brokers) {
    throw new Error('KAFKA_BROKERS 환경변수가 필요합니다.');
  }

  const clientId = `${prefix}_${os.hostname()}`;
  const brokerList = brokers.split(',');
  const hasSasl = !!(apiKey && apiSecret);
  
  logger.log(`✅ [Kafka Config] 생성 완료`);
  logger.log(`  - ClientId: ${clientId}`);
  logger.log(`  - Brokers: ${brokerList.join(', ')}`);
  logger.log(`  - SSL: ${hasSasl}`);
  logger.log(`  - SASL: ${hasSasl ? 'PLAIN' : 'disabled'}`);
  
  if (hasSasl) {
    logger.log(`  - SASL Username (first 4 chars): ${apiKey?.substring(0, 4)}***`);
  }

  const config = {
    clientId,
    brokers: brokerList,
    retry: {
      retries: 5,
      initialRetryTime: 300,
      multiplier: 2,
      maxRetryTime: 30000,
    },
    ssl: hasSasl,
    sasl: hasSasl ? {
      mechanism: 'plain' as const,
      username: apiKey!,
      password: apiSecret!,
    } : undefined,
  };
  
  return config;
}

async function bootstrap() {
  const app = await NestFactory.create(WmsModule);

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({
    origin: true,
    credentials: true,
  });
  app.enableShutdownHooks();

  logger.log('🚀 [Bootstrap] Kafka Consumer 설정 시작...');
  const kafkaConfig = createKafkaConfig();
  
  const consumerOptions = EventsModule.forConsumer({
    streams: [PRODUCT_STREAM],
    groupId: 'wms-product-consumer',
    kafka: kafkaConfig,
  });

  logger.log(`📡 [Bootstrap] Consumer Options:`);
  logger.log(`  - Transport: KAFKA`);
  logger.log(`  - GroupId: wms-product-consumer`);
  logger.log(`  - Streams: ${PRODUCT_STREAM.topic.topic}`);
  logger.log(`  - Client Options: ${JSON.stringify({
    clientId: consumerOptions.options.client.clientId,
    brokers: consumerOptions.options.client.brokers,
    ssl: consumerOptions.options.client.ssl,
    saslMechanism: consumerOptions.options.client.sasl?.mechanism,
    saslUsername: maskString(consumerOptions.options.client.sasl?.username, 4),
  }, null, 2)}`);

  app.connectMicroservice(consumerOptions);

  const config = new DocumentBuilder()
    .setTitle('WMS API')
    .setDescription('WMS Service API')
    .setVersion('1.0.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  await app.startAllMicroservices();
  await app.listen(process.env.PORT ?? 3010);
}
bootstrap();
