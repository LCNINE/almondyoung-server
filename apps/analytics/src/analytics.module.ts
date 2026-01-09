import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';
import { ORDER_STREAM, PRODUCT_STREAM } from '@packages/event-contracts';
import { AnalyticsController } from './modules/analytics-api/analytics.controller';
import { AnalyticsService } from './modules/analytics-api/analytics.service';
import { OrderEventsConsumer } from './ingest/order-events.consumer';
import { ProductEventsConsumer } from './ingest/product-events.consumer';
import { OrderAggregatesService } from './aggregates/order-aggregates.service';
import { OrderAggregatesBatchService } from './aggregates/order-aggregates-batch.service';
import { OrderFactsService } from './facts/order-facts.service';
import { analyticsSchema } from './schema';
import { ProductDimensionsService } from './dimensions/product-dimensions.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', 'apps/analytics/.env'],
    }),
    ScheduleModule.forRoot(),
    DbModule.forRoot({
      config: {
        connectionString: process.env.DATABASE_URL ?? '',
      },
      schema: analyticsSchema,
    }),
    EventsModule.forConsumerModule({
      streams: [ORDER_STREAM, PRODUCT_STREAM],
      groupId: process.env.KAFKA_GROUP_ID || 'analytics-consumer',
      enableAutoDLQ: true,
    }),
  ],
  controllers: [AnalyticsController, OrderEventsConsumer, ProductEventsConsumer],
  providers: [
    AnalyticsService,
    OrderFactsService,
    OrderAggregatesService,
    OrderAggregatesBatchService,
    ProductDimensionsService,
  ],
})
export class AnalyticsModule {}
