import { Module } from '@nestjs/common';
import * as os from 'os';
import { HttpModule } from '@nestjs/axios';
import { ScheduleModule } from '@nestjs/schedule';
import { ClsModule } from 'nestjs-cls';
import { EventsModule, StreamPublisher, EventChainService, EventTrackingService, EventTraceApiModule } from '@app/events';
import { NaverSmartstoreAdapter } from './adapters/naver/naver-smartstore.adapter';
import { CoupangAdapter } from './adapters/coupang/coupang.adapter';
import { OrderEventPublisher } from './services/order-event.publisher';

import { ChannelAdapterFactory } from './adapters/channel-adapter.factory';
import { SyncStatusService } from './services/sync-status.service';
import { ChannelAdapterController } from './controllers/channel-adapter.controller';
import { SyncStatusController } from './controllers/sync-status.controller';
import { ChannelAdapterService } from './services/channel-adapter.service';
import { NullEventPublisher } from './services/null-event-publisher.service';
import { DbModule } from '@app/db';
import { CHANNEL_ADAPTER_STREAM, ORDER_STREAM, FULFILLMENT_STREAM, PRODUCT_STREAM, MEMBERSHIP_STREAM, USER_STREAM } from '@packages/event-contracts/streams';
import { FulfillmentEventsConsumer } from './consumers/fulfillment-events.consumer';
import { UserEventConsumer } from './consumers/user-event.consumer';
import * as schema from './schema';
import { channelAdapterSchema } from './schema';
import {
  CoupangOrderClient,
  CoupangReturnClient,
  CoupangExchangeClient,
  CoupangProductClient,
} from './adapters/coupang/clients';
import { NaverOrderClient } from './adapters/naver/clients/naver-order.client';
import { NaverClaimClient } from './adapters/naver/clients/naver-claim.client';
import { NaverProductClient } from './adapters/naver/clients/naver-product.client';
import { NaverAuthService } from './adapters/naver/clients/naver-auth.client';
import { ConfigModule } from '@nestjs/config';
import { validateChannelAdapterEnv } from './config/env.validation';
import { ChannelDataReader } from './services/channel-data.reader';
import { ChannelSyncManager } from './services/channel-sync.manager';
import { ChannelCommandManager } from './services/channel-command.manager';
import { PendingOrderRepository } from './services/pending-order.repository';
import { ChannelListingClient } from './services/clients/channel-listing.client';
import { PendingOrderService } from './services/pending-order.service';
import { InboxService } from './services/inbox.service';
import { OutboxDispatcherService } from './services/outbox-dispatcher.service';

// PIM-Medusa 동기화 서비스
// PIMCLIENT: Removed to enforce MSA boundary - no sync calls between internal services
// import { PimClient } from './adapters/medusa/pim.client';
import { MedusaClient } from './adapters/medusa/medusa.client';
import { PimMedusaSyncService } from './adapters/medusa/pim-medusa-sync.service';
import { MembershipMedusaSyncService } from './adapters/medusa/membership-medusa-sync.service';
import { PimProductEventConsumer } from './consumers/pim-product-event.consumer';
import { PimCategoryConsumer } from './consumers/pim-category.consumer';
import { MembershipEventConsumer } from './consumers/membership-event.consumer';
import { PimMedusaMappingRepository } from './adapters/medusa/pim-medusa-mapping.repository';
import { InboxWorkerService } from './adapters/medusa/inbox-worker.service';
import { FirebaseMembershipSyncService } from './adapters/medusa/firebase-membership-sync.service';
import { AlmondAuthClient } from './adapters/almond-auth/almond-auth.client';
import { UserServiceClient } from './services/user-service.client';
import { MembershipDailySyncService } from './services/membership-daily-sync.service';
import { InternalMembershipController } from './controllers/internal-membership.controller';
import { CHANNEL_ORDER_PROVIDER } from './services/order-collection/channel-order-provider.interface';
import { MedusaOrderProvider } from './services/order-collection/medusa-order.provider';
import { OrderPollerOrchestrator } from './services/order-collection/order-poller.orchestrator';

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
    ClsModule.forRoot({ global: true, middleware: { mount: false } }),
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
    EventTraceApiModule,
    // 운영 환경에서만 실제 EventsModule 활성화
    ...(process.env.NODE_ENV === 'production'
      ? [
        EventsModule.forRoot({
          streams: [
            CHANNEL_ADAPTER_STREAM,
            ORDER_STREAM,
            FULFILLMENT_STREAM,
            PRODUCT_STREAM,
            MEMBERSHIP_STREAM,
            USER_STREAM,
          ],
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
  controllers: [
    ChannelAdapterController,
    SyncStatusController,
    InternalMembershipController,
    FulfillmentEventsConsumer,
    PimProductEventConsumer,
    PimCategoryConsumer,
    MembershipEventConsumer,
    UserEventConsumer,
  ],
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

    // Inbox/Outbox 패턴 서비스
    InboxService,
    OutboxDispatcherService,

    // PIM-Medusa 동기화
    // PIMCLIENT: Removed to enforce MSA boundary
    // PimClient,
    MedusaClient,
    PimMedusaSyncService,
    MembershipMedusaSyncService,
    PimProductEventConsumer,
    PimCategoryConsumer,
    MembershipEventConsumer,
    PimMedusaMappingRepository,
    InboxWorkerService,

    // 주문 수집 (Provider 패턴)
    MedusaOrderProvider,
    {
      provide: CHANNEL_ORDER_PROVIDER,
      useFactory: (provider: MedusaOrderProvider) => [provider],
      inject: [MedusaOrderProvider],
    },
    OrderPollerOrchestrator,

    // Firebase 멤버십 동기화
    AlmondAuthClient,
    UserServiceClient,
    FirebaseMembershipSyncService,
    MembershipDailySyncService,

    // Event Chain Tracking (환경 무관하게 항상 등록)
    EventChainService,
    EventTrackingService,

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
        {
          provide: 'STREAM_PUBLISHER_users.events.v1',
          useClass: NullEventPublisher,
        },
      ]
      : []),
  ],
})
export class AdapterModule { }
