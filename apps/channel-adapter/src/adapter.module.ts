import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ScheduleModule } from '@nestjs/schedule';
import { ClsModule } from 'nestjs-cls';
import {
  EventsModule,
  StreamPublisher,
  EventChainService,
  EventTrackingService,
  EventTraceApiModule,
  createKafkaConfigFromEnv,
} from '@app/events';
import { NaverSmartstoreAdapter } from './adapters/naver/naver-smartstore.adapter';
import { CoupangAdapter } from './adapters/coupang/coupang.adapter';
import { OrderEventPublisher } from './services/order-event.publisher';

import { ChannelAdapterFactory } from './adapters/channel-adapter.factory';
import { SyncStatusService } from './services/sync-status.service';
import { ChannelAdapterController } from './controllers/channel-adapter.controller';
import { HealthController } from './controllers/health.controller';
import { SyncStatusController } from './controllers/sync-status.controller';
import { ChannelAdapterService } from './services/channel-adapter.service';
import { NullEventPublisher } from './services/null-event-publisher.service';
import { DbModule } from '@app/db';
import {
  CHANNEL_ADAPTER_STREAM,
  ORDER_STREAM,
  FULFILLMENT_STREAM,
  PRODUCT_STREAM,
  INVENTORY_STREAM,
  MEMBERSHIP_STREAM,
  USER_STREAM,
  PAYMENT_STREAM,
} from '@packages/event-contracts/streams';
import { FulfillmentEventsConsumer } from './consumers/fulfillment-events.consumer';
import { UserEventConsumer } from './consumers/user-event.consumer';
import { PaymentEventsConsumer } from './consumers/payment-events.consumer';
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
import { PollingChangeHashService } from './services/polling-change-hash.service';

// PIM-Medusa 동기화 서비스
// PIMCLIENT: Removed to enforce MSA boundary - no sync calls between internal services
// import { PimClient } from './adapters/medusa/pim.client';
import { MedusaClient } from './adapters/medusa/medusa.client';
import { PimMedusaSyncService } from './adapters/medusa/pim-medusa-sync.service';
import { MembershipMedusaSyncService } from './adapters/medusa/membership-medusa-sync.service';
import { PimProductEventConsumer } from './consumers/pim-product-event.consumer';
import { PimCategoryConsumer } from './consumers/pim-category.consumer';
import { ProductSellableQuantityConsumer } from './consumers/product-sellable-quantity.consumer';
import { MembershipEventConsumer } from './consumers/membership-event.consumer';
import { PimMedusaMappingRepository } from './adapters/medusa/pim-medusa-mapping.repository';
import { InboxWorkerService } from './adapters/medusa/inbox-worker.service';
import { FirebaseMembershipSyncService } from './adapters/medusa/firebase-membership-sync.service';
import { AlmondAuthClient } from './adapters/almond-auth/almond-auth.client';
import { UserServiceClient } from './services/user-service.client';
import { MembershipDailySyncService } from './services/membership-daily-sync.service';
import { CouponIssueReconciliationService } from './services/coupon-issue-reconciliation.service';
import { InternalMembershipController } from './controllers/internal-membership.controller';
import { OrderCollectionFailuresController } from './controllers/order-collection-failures.controller';
import { CHANNEL_ORDER_PROVIDER } from './services/order-collection/channel-order-provider.interface';
import { MedusaOrderProvider } from './services/order-collection/medusa-order.provider';
import { OrderCollectionFailureService } from './services/order-collection/order-collection-failure.service';
import { OrderPollerOrchestrator } from './services/order-collection/order-poller.orchestrator';

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
    // Kafka 환경변수가 있으면 실제 EventsModule 활성화 (로컬 개발 환경 제외)
    ...(process.env.KAFKA_BROKERS
      ? [
          EventsModule.forRoot({
            streams: [
              CHANNEL_ADAPTER_STREAM,
              ORDER_STREAM,
              FULFILLMENT_STREAM,
              PRODUCT_STREAM,
              INVENTORY_STREAM,
              MEMBERSHIP_STREAM,
              USER_STREAM,
              PAYMENT_STREAM,
            ],
            serviceName: 'channel-adapter',
            kafka: createKafkaConfigFromEnv()!,
            validation: {
              validateOnPublish: true,
              throwOnValidationError: true,
            },
          }),
        ]
      : []),
  ],
  controllers: [
    HealthController,
    ChannelAdapterController,
    SyncStatusController,
    InternalMembershipController,
    FulfillmentEventsConsumer,
    PimProductEventConsumer,
    PimCategoryConsumer,
    ProductSellableQuantityConsumer,
    MembershipEventConsumer,
    UserEventConsumer,
    PaymentEventsConsumer,
    OrderCollectionFailuresController,
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

    // 폴링 dedupe (외부 데이터 변경 감지)
    PollingChangeHashService,

    // PIM-Medusa 동기화
    // PIMCLIENT: Removed to enforce MSA boundary
    // PimClient,
    MedusaClient,
    PimMedusaSyncService,
    MembershipMedusaSyncService,
    PimProductEventConsumer,
    PimCategoryConsumer,
    ProductSellableQuantityConsumer,
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
    OrderCollectionFailureService,

    // Firebase 멤버십 동기화
    AlmondAuthClient,
    UserServiceClient,
    FirebaseMembershipSyncService,
    MembershipDailySyncService,
    CouponIssueReconciliationService,

    // Event Chain Tracking (환경 무관하게 항상 등록)
    EventChainService,
    EventTrackingService,

    // Kafka 환경변수 없을 때(로컬): NullEventPublisher로 DI 채우기
    ...(!process.env.KAFKA_BROKERS
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
          {
            provide: 'STREAM_PUBLISHER_payments.events.v1',
            useClass: NullEventPublisher,
          },
        ]
      : []),
  ],
})
export class AdapterModule {}
