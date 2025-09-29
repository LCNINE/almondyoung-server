import { Module } from '@nestjs/common';
import { SalesOrdersController } from './sales-orders/controllers/sales-orders.controller';
import { SalesOrdersService } from './sales-orders/services/sales-orders.service';
import { FulfillmentsController } from './fulfillments/controllers/fulfillments.controller';
import { FulfillmentsService } from './fulfillments/services/fulfillments.service';
import { FulfillmentOrderController, ProductSkuMappingController } from './fulfillments/controllers/fulfillment-order.controller';
import { OutboundBatchController } from './fulfillments/controllers/outbound-batch.controller';
import { InvoiceController } from './fulfillments/controllers/invoice.controller';
import { PickingController } from './fulfillments/controllers/picking.controller';
import { DirectShipController } from './fulfillments/controllers/direct-ship.controller';
import { InspectionController } from './fulfillments/controllers/inspection.controller';
import { LocationOptimizationController } from './fulfillments/controllers/location-optimization.controller';
import { ConsolidationController } from './fulfillments/controllers/consolidation.controller';
import { FulfillmentOrderTransactionService } from './shared/services/fulfillment-order-transaction.service';
import { ProductSkuMappingService } from './shared/services/product-sku-mapping.service';
import { OutboundBatchService } from './shared/services/outbound-batch.service';
import { InvoiceService } from './shared/services/invoice.service';
import { PickingProcessService } from './shared/services/picking-process.service';
import { DirectShipService } from './shared/services/direct-ship.service';
import { InspectionService } from './shared/services/inspection.service';
import { ConsolidationService } from './shared/services/consolidation.service';
import { GoodsflowDeliveryProvider } from './shared/services/goodsflow-delivery.provider';
import { BarcodeService } from '../shared/services/barcode.service';
import { FulfillmentReservationsFacade } from './shared/services/fulfillment-reservations.facade';
import { PoliciesService } from './shared/services/policies.service';
import { AvailabilityService } from './shared/services/availability.service';
import { DbModule } from '@app/db';
import { wmsTables, wmsSchema } from '../../database/schemas/wms-schema';
import { EventsModule } from '@app/events';
import { createKafkaConfigFromEnv } from '@app/events/types';
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
      kafka: createKafkaConfigFromEnv({
        KAFKA_CLIENT_ID: process.env.KAFKA_CLIENT_ID ?? 'wms',
        KAFKA_BROKERS: process.env.KAFKA_BROKERS ?? '',
        KAFKA_GROUP_ID: process.env.KAFKA_GROUP_ID ?? 'wms-group',
        KAFKA_API_KEY: process.env.KAFKA_API_KEY,
        KAFKA_API_SECRET: process.env.KAFKA_API_SECRET,
      }),
      events: {} as any,
      serviceName: 'wms-order',
    }),
  ],
  controllers: [SalesOrdersController, FulfillmentsController, FulfillmentOrderController, ProductSkuMappingController, OutboundBatchController, InvoiceController, PickingController, DirectShipController, InspectionController, LocationOptimizationController, ConsolidationController, MatchingsController],
  providers: [SalesOrdersService, FulfillmentsService, FulfillmentOrderTransactionService, ProductSkuMappingService, OutboundBatchService, InvoiceService, PickingProcessService, DirectShipService, InspectionService, ConsolidationService, GoodsflowDeliveryProvider, BarcodeService, FulfillmentReservationsFacade, PoliciesService, AvailabilityService, MatchingsService, OutboxService, OutboxDispatcherService],
  exports: [SalesOrdersService, FulfillmentsService, FulfillmentOrderTransactionService, ProductSkuMappingService, OutboundBatchService, InvoiceService, PickingProcessService, MatchingsService, OutboxService, OutboxDispatcherService],
})
export class OrderModule {}


