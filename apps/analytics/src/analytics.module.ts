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
      // ⚠️ 현상 유지다 — 이 앱은 소비 경로에 스키마 검증이 붙은 적이 없다
      // (ADR-0029 §8). startConsumer 로 이주하면 인터셉터가 처음 붙으므로,
      // 명시하지 않으면 기본값 `true` 가 배선 이주에 묻어 함께 켜진다.
      // 검증 활성화는 payload 샘플링 후 별도 결정 (플랜 Task 5-C).
      validation: { validateOnConsume: false },
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
