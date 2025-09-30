import { Module } from '@nestjs/common';
import * as os from 'os';
import { HttpModule } from '@nestjs/axios';
import {
  EventsModule,
  EventPublisherService,
} from '@app/events';
import { NaverSmartstoreStrategy } from './services/strategies/naver-smartstore.strategy';
import { CoupangStrategy } from './services/strategies/coupang.strategy';

import { ChannelStrategyFactory } from './services/strategies/channel-strategy.factory';
import { AdapterOrchestrationService } from './services/adapter-orchestration.service';
import { SyncStatusService } from './services/sync-status.service';
import { ChannelAdapterController } from './controllers/channel-adapter.controller';
import { SyncStatusController } from './controllers/sync-status.controller';
import { ChannelAdapterService } from './services/channel-adapter.service';
import { NaverCommerceApiService } from './services/apis/naver-commerce.api.service';
import { NullEventPublisher } from './services/null-event-publisher.service';
import { DbModule } from '@app/db';
import { CHANNEL_ADAPTER_EVENTS } from '@app/shared/events/adapter.events';
import * as schema from './schema';
import { CoupangApiService } from './services/apis/coupang.api.service';
import { WmsApiService } from './services/apis/wms.api.service';
import { DlqMonitoringService } from './services/dlq-monitoring.service';
import { ConfigModule } from '@nestjs/config';

// Kafka 설정 생성 함수 (운영 환경 전용)
function createKafkaConfig() {
  // 필수 환경변수 검증
  const prefix = process.env.KAFKA_CLIENT_ID_PREFIX;
  if (!prefix) {
    throw new Error('KAFKA_CLIENT_ID_PREFIX 환경변수가 필요합니다.');
  }

  const brokers = process.env.KAFKA_BROKERS;
  if (!brokers) {
    throw new Error('KAFKA_BROKERS 환경변수가 필요합니다.');
  }

  const groupId = process.env.KAFKA_GROUP_ID;
  if (!groupId) {
    throw new Error('KAFKA_GROUP_ID 환경변수가 필요합니다.');
  }

  return {
    clientId: `${prefix}_${os.hostname()}`,
    brokers: brokers.split(','),
    groupId,
    retry: {
      retries: 5,
      initialRetryTime: 300,
    },
    ssl: process.env.KAFKA_API_KEY ? true : false,
    sasl: process.env.KAFKA_API_KEY && process.env.KAFKA_API_SECRET ? {
      mechanism: 'plain' as const,
      username: process.env.KAFKA_API_KEY,
      password: process.env.KAFKA_API_SECRET,
    } : undefined,
  };
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    HttpModule,
    DbModule.forRoot({
      config: {
        connectionString:
          process.env.DATABASE_URL ||
          'postgresql://neondb_owner:npg_4jlXAK7qVywN@ep-young-thunder-a1bkhlx2-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
      },
      schema: { ...schema },
    }),
    EventsModule.forRoot({
      kafka: createKafkaConfigFromEnv({
        KAFKA_CLIENT_ID: process.env.KAFKA_CLIENT_ID || 'channel-adapter',
        KAFKA_BROKERS: process.env.KAFKA_BROKERS || 'localhost:9092',
        KAFKA_GROUP_ID: process.env.KAFKA_GROUP_ID || 'channel-adapter-group',
      }),
      events: CHANNEL_ADAPTER_EVENTS,
      serviceName: 'channel-adapter',
    }),
  ],
  controllers: [ChannelAdapterController, SyncStatusController],
  providers: [
    ChannelAdapterService,
    AdapterOrchestrationService,
    SyncStatusService,
    ChannelStrategyFactory,
    NaverSmartstoreStrategy,
    CoupangStrategy,
    NaverCommerceApiService,
    CoupangApiService,
    WmsApiService,
    DlqMonitoringService,

    // 환경별 EventPublisher 제공
    ...(process.env.NODE_ENV === 'production'
      ? [] // 운영 환경: EventsModule에서 제공하는 EventPublisherService 사용
      : [
          // 개발/테스트 환경: NullEventPublisher로 대체
          {
            provide: EventPublisherService,
            useClass: NullEventPublisher,
          },
        ]),
  ],
})
export class AdapterModule {}
