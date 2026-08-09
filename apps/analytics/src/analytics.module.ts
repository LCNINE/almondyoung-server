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
      // ⚠️ 아직 끈다. core 는 5-C 에서 켰지만 이 앱은 못 켠다 (ADR-0029 §8).
      //
      // 막는 것은 3개 이벤트다 — `MembershipStatusChanged` ·
      // `ProductMasterActiveVersionChanged` · `ProductMasterDeleted`. 셋 다
      // `OutboxPublisher.saveEvent` 로 발행되고, 그 경로는 `publishRawEnvelope` 로 zod 를
      // 우회한다. 즉 스키마를 안 지키는 payload 가 올라올 수 있는지 정적으로 증명되지 않는다.
      // 나머지 7개는 발행 시 검증되므로 안전하다.
      //
      // **이걸 여는 것은 Task 6 이다** (enqueue 시점 zod 검증). 그게 들어가면 셋 다 자동으로
      // PROVEN 이 되어 이 줄을 뒤집을 수 있다. 그 전에 켜는 것은 추측이고, 이 앱은 DLQ 를
      // 스크레이프하지 않아(`dlq.metrics.ts:10`) 추측이 틀려도 아무도 모른다.
      // 현황: `npm run audit:consume-validation -- analytics`
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
