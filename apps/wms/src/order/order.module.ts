import { Module } from '@nestjs/common';
import * as os from 'os';
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
import { MatchingsController } from './matchings/controllers/matchings.controller';
import { MatchingsService } from './matchings/services/matchings.service';
import { OutboxService } from './shared/services/outbox.service';
import { OutboxDispatcherService } from './shared/services/outbox-dispatcher.service';
import { SharedModule } from '../shared/shared.module';

// Kafka 설정 생성 함수
function createKafkaConfig() {
  // 필수 환경변수 검증
  const prefix = process.env.KAFKA_CLIENT_ID_PREFIX;
  if (!prefix) {
    throw new Error('KAFKA_CLIENT_ID_PREFIX 환경변수가 필요합니다.');
  }

  const brokers = process.env.KAFKA_BROKERS;
  if (!brokers) {
    throw new Error('KAFKA_BROKERS 환경변수가 필요합니다.');
  }

  const groupId = process.env.KAFKA_GROUP_ID;
  if (!groupId) {
    throw new Error('KAFKA_GROUP_ID 환경변수가 필요합니다.');
  }

  return {
    clientId: `${prefix}_${os.hostname()}`,
    brokers: [brokers],
    groupId,
    retry: {
      retries: 5,
      initialRetryTime: 300,
    },
    ssl: process.env.KAFKA_API_KEY ? true : false,
    sasl: process.env.KAFKA_API_KEY && process.env.KAFKA_API_SECRET ? {
      mechanism: 'plain' as const,
      username: process.env.KAFKA_API_KEY,
      password: process.env.KAFKA_API_SECRET,
    } : undefined,
  };
}

@Module({
  imports: [
    SharedModule, // Import SharedModule for MetricsService, AuditService etc.
    DbModule.forRoot({
      config: { connectionString: process.env.DATABASE_URL ?? '' },
      schema: wmsTables,
    }),
    EventsModule.forRoot({
      kafka: createKafkaConfig(),
      streams: [],
      serviceName: 'wms-order',
    }),
  ],
  controllers: [SalesOrdersController, FulfillmentsController, FulfillmentOrderController, ProductSkuMappingController, OutboundBatchController, InvoiceController, PickingController, DirectShipController, InspectionController, LocationOptimizationController, ConsolidationController, MatchingsController],
  providers: [SalesOrdersService, FulfillmentsService, FulfillmentOrderTransactionService, ProductSkuMappingService, OutboundBatchService, InvoiceService, PickingProcessService, DirectShipService, InspectionService, ConsolidationService, GoodsflowDeliveryProvider, BarcodeService, FulfillmentReservationsFacade, PoliciesService, AvailabilityService, MatchingsService, OutboxService, OutboxDispatcherService],
  exports: [SalesOrdersService, FulfillmentsService, FulfillmentOrderTransactionService, ProductSkuMappingService, OutboundBatchService, InvoiceService, PickingProcessService, MatchingsService, OutboxService, OutboxDispatcherService],
})
export class OrderModule {}


