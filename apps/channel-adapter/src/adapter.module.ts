import { Module } from '@nestjs/common';
import * as os from 'os';
import { HttpModule } from '@nestjs/axios';
import { ScheduleModule } from '@nestjs/schedule';
import { EventsModule, StreamPublisher } from '@app/events';
import { NaverSmartstoreAdapter } from './services/adapters/naver-smartstore.adapter';
import { CoupangAdapter } from './services/adapters/coupang.adapter';
import { OrderEventPublisher } from './services/order-event.publisher';

import { ChannelAdapterFactory } from './services/adapters/channel-adapter.factory';
import { SyncStatusService } from './services/sync-status.service';
import { ChannelAdapterController } from './controllers/channel-adapter.controller';
import { SyncStatusController } from './controllers/sync-status.controller';
import { ChannelAdapterService } from './services/channel-adapter.service';
import { NullEventPublisher } from './services/null-event-publisher.service';
import { DbModule } from '@app/db';
import { CHANNEL_ADAPTER_STREAM, ORDER_STREAM, FULFILLMENT_STREAM } from '@packages/event-contracts/streams';
import { FulfillmentEventsConsumer } from './consumers/fulfillment-events.consumer';
import * as schema from './schema';
import { channelAdapterSchema } from './schema';
import {
  CoupangOrderClient,
  CoupangReturnClient,
  CoupangExchangeClient,
  CoupangProductClient,
} from './services/clients/coupang';
import { NaverOrderClient } from './services/clients/naver/naver-order.client';
import { NaverClaimClient } from './services/clients/naver/naver-claim.client';
import { NaverProductClient } from './services/clients/naver/naver-product.client';
import { NaverAuthService } from './services/clients/naver/naver-auth.client';
import { ConfigModule } from '@nestjs/config';
import { validateChannelAdapterEnv } from './config/env.validation';
import { ChannelDataReader } from './services/channel-data.reader';
import { ChannelSyncManager } from './services/channel-sync.manager';
import { ChannelCommandManager } from './services/channel-command.manager';
import { PendingOrderRepository } from './services/pending-order.repository';
import { ChannelListingClient } from './services/clients/channel-listing.client';
import { PendingOrderService } from './services/pending-order.service';
import { OutboxService } from './services/outbox.service';
import { OutboxDispatcherService } from './services/outbox-dispatcher.service';

// PIM-Medusa 동기화 서비스
import { PimClient } from './services/pim-medusa-sync/pim.client';
import { MedusaClient } from './services/pim-medusa-sync/medusa.client';
import { PimMedusaSyncService } from './services/pim-medusa-sync/pim-medusa-sync.service';
import { PimProductEventConsumer } from './consumers/pim-product-event.consumer';
import { PimMedusaMappingRepository } from './services/pim-medusa-sync/pim-medusa-mapping.repository';

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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateChannelAdapterEnv,
    }),
    ScheduleModule.forRoot(), // ← Cron 활성화
    HttpModule,
    DbModule.forRoot({
      config: {
        connectionString:
          process.env.DATABASE_URL ||
          'postgresql://neondb_owner:npg_4jlXAK7qVywN@ep-young-thunder-a1bkhlx2-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
      },
      schema: { ...channelAdapterSchema },
    }),
    // 운영 환경에서만 실제 EventsModule 활성화
    ...(process.env.NODE_ENV === 'production'
      ? [
        EventsModule.forRoot({
          streams: [CHANNEL_ADAPTER_STREAM, ORDER_STREAM, FULFILLMENT_STREAM],
          serviceName: 'channel-adapter',
          kafka: createKafkaConfig(),
          validation: {
            validateOnPublish: true,
            throwOnValidationError: true,
          },
        }),
      ]
      : []),
  ],
  controllers: [ChannelAdapterController, SyncStatusController, FulfillmentEventsConsumer],
  providers: [
    ChannelAdapterService,
    SyncStatusService,
    ChannelAdapterFactory,
    NaverSmartstoreAdapter,
    CoupangAdapter,

    CoupangOrderClient,
    CoupangReturnClient,
    CoupangExchangeClient,
    CoupangProductClient,
    NaverOrderClient,
    NaverClaimClient,
    NaverProductClient,
    NaverAuthService,

    // 🆕 리팩토링된 레이어 클래스들
    ChannelDataReader,
    ChannelSyncManager,
    ChannelCommandManager,
    PendingOrderRepository,

    // PIM 매핑 조회 클라이언트
    ChannelListingClient,

    // 계류 주문 서비스
    PendingOrderService,

    // 주문 이벤트 발행 서비스
    OrderEventPublisher,

    // Outbox 패턴 서비스
    OutboxService,
    OutboxDispatcherService,

    // PIM-Medusa 동기화
    PimClient,
    MedusaClient,
    PimMedusaSyncService,
    PimProductEventConsumer,
    PimMedusaMappingRepository,

    // 개발/테스트 환경: NullEventPublisher를 토큰으로 제공
    ...(process.env.NODE_ENV !== 'production'
      ? [
        {
          provide: 'STREAM_PUBLISHER_channel-adapter.events.v1',
          useClass: NullEventPublisher,
        },
        {
          provide: 'STREAM_PUBLISHER_orders.events.v1',
          useClass: NullEventPublisher,
        },
      ]
      : []),
  ],
})
export class AdapterModule { }
