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
  EventChainService,
  EventTrackingService,
  EventTraceApiModule,
  createKafkaConfigFromEnv,
  getPublisherToken,
  OutboxPublisher,
  StreamPublisher,
  type EventTransport,
  type StreamConfig,
} from '@app/events';
import { NaverSmartstoreAdapter } from './adapters/naver/naver-smartstore.adapter';
import { CoupangAdapter } from './adapters/coupang/coupang.adapter';

import { ChannelAdapterFactory } from './adapters/channel-adapter.factory';
import { SyncStatusService } from './services/sync-status.service';
import { ChannelAdapterController } from './controllers/channel-adapter.controller';
import { HealthController } from './controllers/health.controller';
import { SyncStatusController } from './controllers/sync-status.controller';
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
import { ChannelListingClient } from './services/clients/channel-listing.client';
import { InboxService } from './services/inbox.service';
import { PollingChangeHashService } from './services/polling-change-hash.service';
import { ShipmentDispatchInboxWorker } from './services/shipment-dispatch-inbox.worker';

// PIM-Medusa 동기화 서비스
// PIMCLIENT: Removed to enforce MSA boundary - no sync calls between internal services
// import { PimClient } from './adapters/medusa/pim.client';
import { MedusaClient } from './adapters/medusa/medusa.client';
import { PimMedusaSyncService } from './adapters/medusa/pim-medusa-sync.service';
import { StorefrontRevalidateService } from './adapters/medusa/storefront-revalidate.service';
import { DeferredRevalidateService } from './adapters/medusa/deferred-revalidate.service';
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
import { MedusaOrderSource } from './services/order-collection/medusa-order.source';
import { ChannelOrderTranslator } from './services/order-collection/channel-order.translator';
import { ChannelLineIdentityResolver } from './services/order-collection/channel-line-identity.resolver';
import { createOrderProvider } from './services/order-collection/translating-order.provider';
import { OrderCollectionFailureService } from './services/order-collection/order-collection-failure.service';
import { OrderPollerOrchestrator } from './services/order-collection/order-poller.orchestrator';

/**
 * `KAFKA_BROKERS` 가 없는 로컬 부팅에서 즉시 발행을 버리는 전송.
 *
 * `EventTransport` 는 발행 방향 한 메서드뿐이라(ADR-0029 §7) 스텁이 이 한 줄로 끝난다.
 * 아웃박스 적재는 이 전송을 지나지 않으므로 그대로 동작한다 — 로컬에서 이벤트 흐름을
 * 확인하려면 `event.outbox_events` 를 보면 된다.
 */
const DISCARDING_TRANSPORT: EventTransport = { send: () => Promise.resolve() };

/**
 * `KAFKA_BROKERS` 없는 부팅에서 publisher DI 를 채울 스트림들.
 *
 * `StreamConfig[]` 로 **명시 표기**한다. 이종 스트림 배열을 그냥 `.map` 하면 원소 타입이
 * 유니온으로 넓어져 `new StreamPublisher(...)` 의 제네릭 추론이 첫 원소에 고정되고 나머지가
 * 거부된다. `EventsModule.forApp({ publishes })` 도 같은 표기를 받는다.
 */
const NO_KAFKA_PUBLISHER_STREAMS: StreamConfig[] = [
  CHANNEL_ADAPTER_STREAM,
  ORDER_STREAM,
  CORE_ORDER_STREAM,
  USER_STREAM,
  PAYMENT_STREAM,
];

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
          EventsModule.forApp({
            publishes: [
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
            // 공용 아웃박스를 켠다 (ADR-0029 §5-1, Task 6-C-3). 이것이 `OutboxPublisher`
            // (적재기)와 `OutboxDispatcher`(발행기)를 등록한다. 이 목록이 이미
            // CHANNEL_ADAPTER_STREAM · ORDER_STREAM 을 담고 있으므로 디스패처의 publisherMap
            // 이 회수 대상 두 토픽을 처음부터 안다 — core 가 6-C-2 에서 겪은
            // `No publisher found for topic` 은 여기서 발생하지 않는다.
            enableOutbox: true,
            validation: {
              validateOnPublish: true,
              throwOnValidationError: true,
            },
            // 소비 정책 (ADR-0029 §1 — 정책은 도출 불가한 사실이라 선언이 맞다).
            //
            // Task 7 이전에는 이 앱만 선언 자리가 없어(`forConsumerModule` 미호출) providers
            // 배열에 `EVENTS_CONSUMER_POLICY` 를 손으로 등록하고 있었다. 그 자리를 `forApp`
            // 이 흡수했다 — `forConsumerModule` 을 피한 이유였던 필수 `streams` 인자가
            // 사라졌기 때문이다.
            //
            // 소비 스키마 검증 ON (플랜 Task 5-C, 2026-08-10). 이 앱을 막던 4개
            // 이벤트(`MembershipStatusChanged` · `ProductMasterActiveVersionChanged` ·
            // `ProductMasterDeleted` · `CategoryChanged`)는 아웃박스로 나가며 zod 를 우회했는데,
            // 6-A 가 적재·발행 양쪽에 문을 달아 그 우회를 없앴다. 34개가 전부 SAFE(11) 또는
            // PROVEN(23) 이다.
            //
            // 소비하는 34개는 전부 내부 발행이다 — 외부 payload 는 HTTP 로 들어와 이 앱이
            // *발행측*에서 정규화한다. 남은 위험은 외부성이 아니라 outbox 우회였고 닫혔다.
            //
            // 앱 중 blast radius 가 가장 크다 — 핸들러 34개 · 도출 토픽 9개. DLQ 메트릭은
            // 스크레이프되지 않으므로(`dlq.metrics.ts:10`) 관측은 로그다.
            //
            // 되돌리기는 이 한 줄을 `false` 로 바꾸는 것이다.
            // 현황: `npm run audit:consume-validation -- channel-adapter`
            policy: { validateOnConsume: true },
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

    // PIM 매핑 조회 클라이언트
    ChannelListingClient,

    // 계류 주문 서비스

    // 주문 이벤트 발행 서비스

    // Inbox 패턴 서비스 (발행은 공용 StreamPublisher.enqueue — ADR-0029 §5-1)
    InboxService,
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
    DeferredRevalidateService,
    InboxWorkerService,

    // 주문 수집 (ADR-0031: source 는 채널 원어, 번역·식별·격리는 공용)
    ChannelLineIdentityResolver,
    ChannelOrderTranslator,
    MedusaOrderSource,
    {
      provide: CHANNEL_ORDER_PROVIDER,
      // 채널이 늘면 source 를 하나 더 만들어 이 배열에 더한다. 번역기는 공유한다.
      useFactory: (translator: ChannelOrderTranslator, medusa: MedusaOrderSource) => [
        createOrderProvider(medusa, translator),
      ],
      inject: [ChannelOrderTranslator, MedusaOrderSource],
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

    // Kafka 환경변수 없을 때(로컬): publisher DI 를 채운다.
    //
    // **`NullEventPublisher` 를 여기서 없앴다 (Task 6-C-3).** 그 클래스는 `publishEvent` /
    // `publishEvents` 만 가진 오리-타이핑 스텁이었는데, 주입 지점의 타입은
    // `PublisherFor<typeof S>` 였다 — 문자열 토큰 뒤라 구조 불일치가 컴파일에 잡히지 않는
    // **DI 거짓말**이다. 회수가 그것을 실증했다: 아웃박스 적재는 `enqueue` 를 부르는데 스텁에
    // 그 메서드가 없어 로컬에서 `TypeError` 가 났을 것이다.
    //
    // no-op 으로 때울 수 없는 이유가 있다 — `OrderPollerOrchestrator` 는 `wms_order_mappings`
    // insert 와 **같은 트랜잭션**에서 적재한다. 적재가 조용히 사라지면 매핑만 남아 그 주문은
    // "수집됨" 으로 굳고 **영영 재발행되지 않는다.**
    //
    // 그래서 스텁 대신 **진짜 `StreamPublisher`** 를 no-op 전송으로 세운다. 아웃박스 적재는
    // 실제로 일어나고(검증·envelope 조립 포함) 즉시 발행만 버려진다. 로컬에는 디스패처가
    // 없으므로 행은 `PENDING` 으로 남는다 — 옛 경로가 행을 넣고 스텁 발행으로 `published`
    // 처리하던 것보다 정직하다.
    ...(!process.env.KAFKA_BROKERS
      ? [
          // 적재기. `EventsModule.forApp` 이 없는 분기라 여기서 직접 등록한다.
          { provide: OutboxPublisher, useClass: OutboxPublisher },
          // 토큰 문자열을 손으로 적지 않는다 — 형식의 소유자는 `publisher-token.ts` 한 곳이며
          // (ADR-0029 §4), 손으로 적은 사본은 형식이 바뀌어도 조용히 어긋난다. 계약 상수에서
          // 도출하면 `forApp({publishes})` 목록과 이 목록이 같은 출처를 갖는다.
          ...NO_KAFKA_PUBLISHER_STREAMS.map((stream) => ({
            provide: getPublisherToken(stream.topic.topic),
            useFactory: (outboxWriter: OutboxPublisher) =>
              new StreamPublisher(
                DISCARDING_TRANSPORT,
                stream,
                'channel-adapter',
                { validateOnPublish: true, throwOnValidationError: true },
                undefined,
                undefined,
                outboxWriter,
              ),
            inject: [OutboxPublisher],
          })),
        ]
      : []),
  ],
})
export class AdapterModule {}
