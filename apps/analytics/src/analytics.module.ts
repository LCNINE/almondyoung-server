import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { loggerConfig } from '@app/shared/observability/logger.config';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';
import { AuthorizationModule } from '@app/authorization';
import { ORDER_STREAM, PRODUCT_STREAM, MEMBERSHIP_STREAM } from '@packages/event-contracts';
import { AnalyticsController } from './features/analytics-api/analytics.controller';
import { AnalyticsService } from './features/analytics-api/analytics.service';
import { OrderEventsConsumer } from './datasets/orders/ingest/order-events.consumer';
import { ProductEventsConsumer } from './datasets/products/ingest/product-events.consumer';
import { OrderAggregatesService } from './datasets/orders/aggregates/order-aggregates.service';
import { UserPurchaseAggregatesService } from './datasets/orders/aggregates/user-purchase-aggregates.service';
import { ChannelAggregatesService } from './datasets/orders/aggregates/channel-aggregates.service';
import { VariantAggregatesService } from './datasets/orders/aggregates/variant-aggregates.service';
import { CustomerLifetimeService } from './datasets/orders/aggregates/customer-lifetime.service';
import { OrderFactsService } from './datasets/orders/facts/order-facts.service';
import { analyticsSchema } from './schema';
import { ProductDimensionsService } from './datasets/products/dimensions/product-dimensions.service';
import { ProductRankingQuery } from './features/product-ranking/read-model/product-ranking.query';
import { UserPurchaseQuery } from './features/user-purchase/read-model/user-purchase.query';
import { MembershipFactsService } from './datasets/memberships/facts/membership-facts.service';
import { MembershipDimensionsService } from './datasets/memberships/dimensions/membership-dimensions.service';
import { MembershipEventsConsumer } from './datasets/memberships/ingest/membership-events.consumer';

@Module({
  imports: [
    LoggerModule.forRoot(loggerConfig),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', 'apps/analytics/.env'],
    }),
    DbModule.forRoot({
      config: {
        connectionString: process.env.DATABASE_URL ?? '',
      },
      schema: analyticsSchema,
    }),
    EventsModule.forConsumerModule({
      streams: [ORDER_STREAM, PRODUCT_STREAM, MEMBERSHIP_STREAM],
      groupId: process.env.KAFKA_GROUP_ID || 'analytics-consumer',
      enableAutoDLQ: true,
      // 소비 스키마 검증 ON (플랜 Task 5-C, 2026-08-10).
      //
      // 이 앱을 막던 3개 이벤트(`MembershipStatusChanged` ·
      // `ProductMasterActiveVersionChanged` · `ProductMasterDeleted`)는 아웃박스로 나가면서
      // zod 를 우회했다. 6-A 가 적재(`enqueue`)와 발행(`publishStoredEnvelope`) 양쪽에 문을
      // 달아 그 우회를 없앴고, 셋 다 PROVEN 이 됐다 — 10/10 이 검증된 발행 경로만 탄다.
      //
      // 이 앱은 DLQ 메트릭이 스크레이프되지 않는다(`dlq.metrics.ts:10` — Alloy 는 Core 만).
      // 관측은 로그로 간다: 검증 실패는 `SchemaValidationInterceptor` 가 error 로,
      // DLQ 전송은 `DLQHandler` 가 warn 으로 찍고, 둘 다 OTLP 로그로 Loki 까지 간다.
      // 이 앱의 로그가 실제로 Loki 에 닿는지·구조화 필드가 남는지는 별도 PR 에서 확인·수정했다.
      //
      // 되돌리기는 이 한 줄을 `false` 로 바꾸는 것이다.
      // 현황: `npm run audit:consume-validation -- analytics`
      validation: { validateOnConsume: true },
    }),
    AuthorizationModule.forRoot({
      microserviceName: 'analytics',
      scopes: [],
    }),
  ],
  controllers: [AnalyticsController, OrderEventsConsumer, ProductEventsConsumer, MembershipEventsConsumer],
  providers: [
    AnalyticsService,
    OrderFactsService,
    OrderAggregatesService,
    UserPurchaseAggregatesService,
    ChannelAggregatesService,
    VariantAggregatesService,
    CustomerLifetimeService,
    ProductDimensionsService,
    ProductRankingQuery,
    UserPurchaseQuery,
    MembershipFactsService,
    MembershipDimensionsService,
  ],
})
export class AnalyticsModule {}
