import { Module } from '@nestjs/common';
import { SalesOrdersController } from './sales-orders/controllers/sales-orders.controller';
import { SalesOrdersService } from './sales-orders/services/sales-orders.service';
import { FulfillmentsController } from './fulfillments/controllers/fulfillments.controller';
import { FulfillmentsService } from './fulfillments/services/fulfillments.service';
import { ReservationsService } from './shared/services/reservations.service';
import { PoliciesService } from './shared/services/policies.service';
import { AvailabilityService } from './shared/services/availability.service';
import { DbModule } from '@app/db';
import { wmsTables } from '../../database/schemas/wms-schema';
import { EventsModule } from '@app/events';
import { MatchingsController } from './matchings/controllers/matchings.controller';
import { MatchingsService } from './matchings/services/matchings.service';
import { OutboxService } from './shared/services/outbox.service';
import { OutboxDispatcherService } from './shared/services/outbox-dispatcher.service';
import { SharedModule } from '../shared/shared.module';

@Module({
  imports: [
    SharedModule, // Import SharedModule for MetricsService, AuditService etc.
    DbModule.forRoot({
      config: { connectionString: process.env.DATABASE_URL ?? '' },
      schema: wmsTables,
    }),
    EventsModule.forRoot({
      kafka: {
        clientId: process.env.KAFKA_CLIENT_ID ?? 'wms',
        brokers: (process.env.KAFKA_BROKERS ?? '').split(',').filter(Boolean),
        groupId: process.env.KAFKA_GROUP_ID ?? 'wms-group',
      },
      events: {} as any,
      serviceName: 'wms-order',
    }),
  ],
  controllers: [SalesOrdersController, FulfillmentsController, MatchingsController],
  providers: [SalesOrdersService, FulfillmentsService, ReservationsService, PoliciesService, AvailabilityService, MatchingsService, OutboxService, OutboxDispatcherService],
  exports: [SalesOrdersService, FulfillmentsService, MatchingsService, OutboxService, OutboxDispatcherService],
})
export class OrderModule {}


