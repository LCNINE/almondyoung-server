import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AdminRealmGuard, AuthorizationModule, JwtAuthGuard } from '@app/authorization';
import { LoggerModule } from 'nestjs-pino';
import { loggerConfig } from '@app/shared/observability/logger.config';
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
  EVENTS_CONSUMER_POLICY,
  type EventsConsumerPolicy,
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
  CORE_ORDER_STREAM,
  FULFILLMENT_STREAM,
  PRODUCT_STREAM,
  INVENTORY_STREAM,
  MEMBERSHIP_STREAM,
  USER_STREAM,
  PAYMENT_STREAM,
  SHIPMENT_STREAM,
  FULFILLMENT_V2_STREAM,
} from '@packages/event-contracts/streams';
import { FulfillmentEventsConsumer } from './consumers/fulfillment-events.consumer';
import { ShipmentEventsConsumer } from './consumers/shipment-events.consumer';
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
import { ShipmentDispatchInboxWorker } from './services/shipment-dispatch-inbox.worker';

// PIM-Medusa 동기화 서비스
// PIMCLIENT: Removed to enforce MSA boundary - no sync calls between internal services
// import { PimClient } from './adapters/medusa/pim.client';
import { MedusaClient } from './adapters/medusa/medusa.client';
import { PimMedusaSyncService } from './adapters/medusa/pim-medusa-sync.service';
import { StorefrontRevalidateService } from './adapters/medusa/storefront-revalidate.service';
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
import { MembershipServiceClient } from './services/membership-service.client';
import { MembershipDailySyncService } from './services/membership-daily-sync.service';
import { CouponIssueReconciliationService } from './services/coupon-issue-reconciliation.service';
import { InternalMembershipController } from './controllers/internal-membership.controller';
import { OrderCollectionFailuresController } from './controllers/order-collection-failures.controller';
import { ChannelDispatchOperationsController } from './controllers/channel-dispatch-operations.controller';
import { CHANNEL_ORDER_PROVIDER } from './services/order-collection/channel-order-provider.interface';
import { MedusaOrderProvider } from './services/order-collection/medusa-order.provider';
import { OrderCollectionFailureService } from './services/order-collection/order-collection-failure.service';
import { OrderPollerOrchestrator } from './services/order-collection/order-poller.orchestrator';

@Module({
  imports: [
    LoggerModule.forRoot(loggerConfig),
    ClsModule.forRoot({ global: true, middleware: { mount: false } }),
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateChannelAdapterEnv,
    }),
    ScheduleModule.forRoot(), // ← Cron 활성화
    HttpModule,
    DbModule.forRoot({
      config: {
        // fallback 을 두지 않는다. `config/env.validation.ts` 가 DATABASE_URL 을 필수로
        // 강제하므로(z.string().url()) 값이 없으면 부팅이 죽는 게 옳다 — 조용히 다른 DB 에
        // 붙는 것보다 낫다. 여기 있던 하드코딩 Neon 문자열은 2026-08-08 제거했다.
        // `as string` 은 그 검증이 보장하는 불변식을 TS 에 알리는 용도다.
        connectionString: process.env.DATABASE_URL as string,
      },
      schema: { ...channelAdapterSchema },
    }),
    // 스코프는 선언하지 않는다 — 이 서비스의 인가는 "직원이냐" 한 축뿐이다.
    // 내부 호출용 `internal/*` 는 각자 공유키를 직접 검증하므로 @Public 로 빠진다.
    AuthorizationModule.forRoot({ microserviceName: 'channel-adapter', scopes: [] }),
    EventTraceApiModule,
    // Kafka 환경변수가 있으면 실제 EventsModule 활성화 (로컬 개발 환경 제외)
    ...(process.env.KAFKA_BROKERS
      ? [
          EventsModule.forRoot({
            streams: [
              CHANNEL_ADAPTER_STREAM,
              ORDER_STREAM,
              CORE_ORDER_STREAM,
              FULFILLMENT_STREAM,
              PRODUCT_STREAM,
              INVENTORY_STREAM,
              MEMBERSHIP_STREAM,
              USER_STREAM,
              PAYMENT_STREAM,
              SHIPMENT_STREAM,
              FULFILLMENT_V2_STREAM,
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
    ShipmentEventsConsumer,
    PimProductEventConsumer,
    PimCategoryConsumer,
    ProductSellableQuantityConsumer,
    MembershipEventConsumer,
    UserEventConsumer,
    PaymentEventsConsumer,
    OrderCollectionFailuresController,
    ChannelDispatchOperationsController,
  ],
  providers: [
    // 이 서비스도 공용 ALB 와일드카드로 인터넷에 노출돼 있는데 인증이 전혀 없었다.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: AdminRealmGuard },

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
    ShipmentDispatchInboxWorker,

    // 폴링 dedupe (외부 데이터 변경 감지)
    PollingChangeHashService,

    // PIM-Medusa 동기화
    // PIMCLIENT: Removed to enforce MSA boundary
    // PimClient,
    MedusaClient,
    PimMedusaSyncService,
    StorefrontRevalidateService,
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
    MembershipServiceClient,
    FirebaseMembershipSyncService,
    MembershipDailySyncService,
    CouponIssueReconciliationService,

    // Event Chain Tracking (환경 무관하게 항상 등록)
    EventChainService,
    EventTrackingService,

    // 소비 정책 (ADR-0029 §1 — 정책은 도출 불가한 사실이라 선언이 맞다).
    //
    // 이 앱만 `forConsumerModule` 을 부르지 않아 정책 선언 자리가 없었고, 그래서
    // `EVENTS_CONSUMER_POLICY` 토큰이 컨테이너에 없었다. 그 상태로 startConsumer 로
    // 이주하면 `buildConsumerInterceptors` 의 optionalGet 이 undefined 를 받아
    // 기본값 `validateOnConsume: true` 가 먹는다 — **선택이 아니라 누락으로** 배선
    // 이주와 검증 활성화가 한 배포에 같이 켜지는 것이다. 외부 채널에서 들어오는
    // payload 라 그 조합이 가장 위험한 앱이기도 하다. 그래서 명시한다.
    //
    // `forConsumerModule` 을 부르지 않는 이유: 그 표면은 `streams` 를 필수로 받는데,
    // 그 목록이야말로 이 워크스트림이 없애는 중인 두 번째 진실이다. 필요한 것은
    // 정책 하나뿐이므로 정책만 등록한다. Task 7 의 `forApp` 이 이 자리를 흡수한다.
    {
      provide: EVENTS_CONSUMER_POLICY,
      useValue: { validation: { validateOnConsume: false } } satisfies EventsConsumerPolicy,
    },

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
            provide: 'STREAM_PUBLISHER_core.orders.events.v1',
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
