import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';
import { ORDER_STREAM } from '@packages/event-contracts';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { OrderEventsConsumer } from './orders/order-events.consumer';
import { OrderAggregatesService } from './orders/order-aggregates.service';
import { OrderAggregatesBatchService } from './orders/order-aggregates-batch.service';
import { OrderFactsService } from './orders/order-facts.service';
import { analyticsSchema } from './schema';

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
      streams: [ORDER_STREAM],
      groupId: process.env.KAFKA_GROUP_ID || 'analytics-consumer',
      enableAutoDLQ: true,
    }),
  ],
  controllers: [AnalyticsController, OrderEventsConsumer],
  providers: [
    AnalyticsService,
    OrderFactsService,
    OrderAggregatesService,
    OrderAggregatesBatchService,
  ],
})
export class AnalyticsModule {}
