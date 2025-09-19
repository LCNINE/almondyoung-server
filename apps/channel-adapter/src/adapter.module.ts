import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { EventsModule, createKafkaConfigFromEnv } from '@app/events';
import { NaverSmartstoreStrategy } from './services/strategies/naver-smartstore.strategy';
import { CoupangStrategy } from './services/strategies/coupang.strategy';
import { MedusaStrategy } from './services/strategies/medusa.strategy';
import { ChannelStrategyFactory } from './services/strategies/channel-strategy.factory';
import { AdapterOrchestrationService } from './services/adapter-orchestration.service';
import { SyncStatusService } from './services/sync-status.service';
import { ChannelAdapterController } from './controllers/channel-adapter.controller';
import { SyncStatusController } from './controllers/sync-status.controller';
import { ChannelAdapterService } from './services/channel-adapter.service';
import { NaverCommerceApiService } from './services/apis/naver-commerce.api.service';
import { DbModule } from '@app/db';
import { CHANNEL_ADAPTER_EVENTS } from './events/channel-events';
import * as schema from './schema';
@Module({
  imports: [
    HttpModule,
    DbModule.forRoot({
      config: {
        connectionString:
          process.env.DATABASE_URL ||
          'postgresql://neondb_owner:npg_4jlXAK7qVywN@ep-young-thunder-a1bkhlx2-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
      },
      schema: { ...schema },
    }),
    // 이벤트 발행을 위한 Kafka 연동
    // EventsModule.forRoot({
    //   kafka: createKafkaConfigFromEnv({
    //     KAFKA_CLIENT_ID: process.env.KAFKA_CLIENT_ID || 'channel-adapter',
    //     KAFKA_BROKERS: process.env.KAFKA_BROKERS || 'localhost:9092',
    //     KAFKA_GROUP_ID: process.env.KAFKA_GROUP_ID || 'channel-adapter-group',
    //   }),
    //   events: CHANNEL_ADAPTER_EVENTS,
    //   serviceName: 'channel-adapter',
    // }),
  ],
  controllers: [ChannelAdapterController, SyncStatusController],
  providers: [
    ChannelAdapterService,
    AdapterOrchestrationService,
    SyncStatusService,
    ChannelStrategyFactory,
    NaverSmartstoreStrategy,
    CoupangStrategy,
    MedusaStrategy,
    NaverCommerceApiService,
  ],
})
export class AdapterModule {}
