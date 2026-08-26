import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { loggerConfig } from '@app/shared/observability/logger.config';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';
import { AuthorizationModule } from '@app/authorization';
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
import { MembershipDailySnapshotService } from './datasets/memberships/aggregates/membership-daily-snapshot.service';
import { StatisticsController } from './features/statistics/api/statistics.controller';
import { StatisticsQuery } from './features/statistics/read-model/statistics.query';
import { CustomerInsightsController } from './features/statistics/api/customer-insights.controller';
import { CustomerInsightsQuery } from './features/statistics/read-model/customer-insights.query';
import { ProfitController } from './features/statistics/api/profit.controller';
import { ProfitQuery } from './features/statistics/read-model/profit.query';
import { TrafficController } from './features/traffic/api/traffic.controller';
import { BehaviorController } from './features/traffic/api/behavior.controller';
import { TrafficQuery } from './features/traffic/read-model/traffic.query';
import { BehaviorQuery } from './features/traffic/read-model/behavior.query';
import { Ga4Client } from './features/traffic/ga4/ga4.client';
import { SCHEDULE_ROOT } from '@app/shared/schedule/schedule-root';

@Module({
  imports: [
    // 단 하나의 forRoot 결과를 공유해야 한다 — 직접 부르면 @Cron 이 두 번 등록된다 (#599)
    SCHEDULE_ROOT,
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
    // 소비만 하는 앱이다 — `publishes` 가 없다. 구독 토픽은 `@On` 에서 도출된다.
    EventsModule.forApp({
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
      policy: { validateOnConsume: true },
    }),
    AuthorizationModule.forRoot({
      microserviceName: 'analytics',
      scopes: [],
    }),
  ],
  controllers: [
    AnalyticsController,
    StatisticsController,
    CustomerInsightsController,
    ProfitController,
    TrafficController,
    BehaviorController,
    OrderEventsConsumer,
    ProductEventsConsumer,
    MembershipEventsConsumer,
  ],
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
    MembershipDailySnapshotService,
    StatisticsQuery,
    CustomerInsightsQuery,
    ProfitQuery,
    Ga4Client,
    TrafficQuery,
    BehaviorQuery,
  ],
})
export class AnalyticsModule {}
