import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import {
  EventsModule,
  EventPublisherService,
  createKafkaConfigFromEnv,
} from '@app/events';
import { NaverSmartstoreStrategy } from './services/strategies/naver-smartstore.strategy';
import { CoupangStrategy } from './services/strategies/coupang.strategy';

import { ChannelStrategyFactory } from './services/strategies/channel-strategy.factory';
import { AdapterOrchestrationService } from './services/adapter-orchestration.service';
import { SyncStatusService } from './services/sync-status.service';
import { IdempotencyService } from './services/idempotency.service';
import { ChannelAdapterController } from './controllers/channel-adapter.controller';
import { SyncStatusController } from './controllers/sync-status.controller';
import { ChannelAdapterService } from './services/channel-adapter.service';
import { NaverCommerceApiService } from './services/apis/naver-commerce.api.service';
import { NullEventPublisher } from './services/null-event-publisher.service';
import { DbModule } from '@app/db';
import {
  CHANNEL_ADAPTER_EVENTS,
  ChannelAdapterEvents,
} from './events/channel-events';
import * as schema from './schema';
import { CoupangApiService } from './services/apis/coupang.api.service';
import { WmsApiService } from './services/apis/wms.api.service';
import { DlqMonitoringService } from './services/dlq-monitoring.service';
import { ConfigModule } from '@nestjs/config';

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
    // 운영 환경에서만 실제 EventsModule 활성화
    ...(process.env.NODE_ENV === 'production'
      ? [
          EventsModule.forRoot({
            kafka: createKafkaConfigFromEnv({
              KAFKA_CLIENT_ID: process.env.KAFKA_CLIENT_ID || 'channel-adapter',
              KAFKA_BROKERS: process.env.KAFKA_BROKERS || 'localhost:9092',
              KAFKA_GROUP_ID:
                process.env.KAFKA_GROUP_ID || 'channel-adapter-group',
            }),
            events: CHANNEL_ADAPTER_EVENTS,
            serviceName: 'channel-adapter',
          }),
        ]
      : []),
  ],
  controllers: [ChannelAdapterController, SyncStatusController],
  providers: [
    ChannelAdapterService,
    AdapterOrchestrationService,
    SyncStatusService,
    IdempotencyService,
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
