// apps/wms/src/main.ts
import { NestFactory } from '@nestjs/core';
import { WmsModule } from './wms.module';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { EventsModule } from '@app/events';
import { PRODUCT_STREAM } from '@packages/event-contracts';
import * as os from 'os';

function createKafkaConfig() {
  const prefix = process.env.KAFKA_CLIENT_ID_PREFIX;
  const brokers = process.env.KAFKA_BROKERS;

  // Kafka 환경변수가 없으면 null 반환 (선택적 연결)
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
    sasl: process.env.KAFKA_API_KEY && process.env.KAFKA_API_SECRET ? {
      mechanism: 'plain' as const,
      username: process.env.KAFKA_API_KEY,
      password: process.env.KAFKA_API_SECRET,
    } : undefined,
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

  // Kafka 연결은 선택사항 (환경변수가 있을 때만 연결)
  const kafkaConfig = createKafkaConfig();
  if (kafkaConfig) {
    try {
      const consumerOptions = EventsModule.forConsumer({
        streams: [PRODUCT_STREAM],
        groupId: 'wms-product-consumer',
        kafka: kafkaConfig,
      });
      app.connectMicroservice(consumerOptions);
      console.log('✅ Kafka microservice 연결됨');
    } catch (error) {
      console.warn('⚠️  Kafka 연결 실패 (선택사항이므로 계속 진행):', error.message);
    }
  } else {
    console.log('ℹ️  Kafka 환경변수가 없어 Kafka 연결을 건너뜁니다.');
  }

  const config = new DocumentBuilder()
    .setTitle('WMS API')
    .setDescription(
      '창고 관리 시스템 (Warehouse Management System) API\n\n' +
        '재고 관리, 입고/출고, 창고 위치 관리, 주문 처리, 이동 작업 등을 관리하는 API입니다.',
    )
    .setVersion('1.0.0')
    .addTag('WMS Health', '서비스 헬스체크')
    .addTag('Inventory', '재고 관리')
    .addTag('Location Management', '위치 관리')
    .addTag('Inbound', '입고 관리')
    .addTag('Outbound', '출고 관리')
    .addTag('Fulfillments', '주문 처리')
    .addTag('Picking', '피킹 작업')
    .addTag('Outbound Batches', '출고 배치')
    .addTag('Movement', '이동 작업')
    .addTag('Matchings', '상품 매칭')
    .addTag('Masters', '마스터 관리')
    .addServer('https://wms-development.up.railway.app', '개발 서버')
    .addServer('https://wms.almondyoung.com', '프로덕션 서버')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  // Kafka가 연결된 경우에만 마이크로서비스 시작
  if (kafkaConfig) {
    try {
      await app.startAllMicroservices();
      console.log('✅ 모든 마이크로서비스 시작됨');
    } catch (error) {
      console.warn('⚠️  마이크로서비스 시작 실패 (HTTP 서버는 계속 실행):', error.message);
    }
  }

  await app.listen(process.env.PORT ?? 3010);
  console.log(`🚀 WMS 서비스가 0.0.0.0:${process.env.PORT ?? 3010}에서 실행 중입니다.`);
  console.log(`📚 Swagger 문서: http://localhost:${process.env.PORT ?? 3010}/docs`);
}
bootstrap();
