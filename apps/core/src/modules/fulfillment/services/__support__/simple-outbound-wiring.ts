import { ConfigService } from '@nestjs/config';
import { DbService } from '@app/db';
import { BatchControlledStockGuard } from '../../../inventory/core/services/batch-controlled-stock.guard';
import { InventoryCommandService } from '../../../inventory/core/services/inventory-command.service';
import { LocationService } from '../../../inventory/core/services/location.service';
import { StockEventStore } from '../../../inventory/core/repositories/stock-event.store';
import { ProductSellableQuantityService } from '../../../inventory/product-sellable-quantity/services/product-sellable-quantity.service';
import { DbTx, wmsSchema } from '../../../inventory/schema/inventory.schema';
import { outboxPublisherFor } from '../../outbox/__support__/outbox-publisher.factory';
import {
  FULFILLMENT_STREAM,
  FULFILLMENT_V2_STREAM,
  INVENTORY_STREAM,
  SHIPMENT_STREAM,
} from '@packages/event-contracts/streams';
import { AuditService } from '../../../inventory/shared/services/audit.service';
import { BarcodeService } from '../../../inventory/shared/services/barcode.service';
import { UnifiedReservationService } from '../../../inventory/shared/services/unified-reservation.service';
import { BatchInventorySessionService } from '../batch-inventory-session.service';
import { FulfillmentCommandService } from '../fulfillment-command.service';
import { FulfillmentInvariantService } from '../fulfillment-invariant.service';
import { FulfillmentProgressService } from '../fulfillment-progress.service';
import { FulfillmentWorkflowGate } from '../fulfillment-workflow-gate.service';
import { OutboundBatchOrchestrator } from '../outbound-batch-orchestrator.service';
import { PickingProcessService } from '../picking-process.service';
import { PickingStrategyRegistry } from '../../picking/picking-strategy.registry';
import { DiscretePickingStrategy } from '../../picking/discrete-picking.strategy';
import { ShipmentDispatchService } from '../shipment-dispatch.service';
import { ShipmentReservationService } from '../shipment-reservation.service';
import { SimpleOutboundService } from '../simple-outbound.service';
import { WaybillService } from '../../waybill/waybill.service';
import { WaybillManager } from '../../waybill/waybill.manager';
import { WaybillReader } from '../../waybill/waybill.reader';
import { WaybillRepository } from '../../waybill/waybill.repository';

export function ambientDbService(tx: DbTx): DbService<typeof wmsSchema> {
  return {
    db: tx,
    run: <T>(fn: (trx: DbTx) => Promise<T>): Promise<T> => fn(tx),
  } as unknown as DbService<typeof wmsSchema>;
}

export function assembleSimpleOutbound(tx: DbTx): SimpleOutboundService {
  const dbService = ambientDbService(tx);
  const workflowGate = new FulfillmentWorkflowGate(
    new ConfigService({
      FULFILLMENT_WORKFLOW_MODE: 'v2',
      FULFILLMENT_V2_CUTOVER_AT: '1970-01-01T00:00:00.000Z',
    }),
  );
  const commands = new FulfillmentCommandService(dbService);
  const invariant = new FulfillmentInvariantService();
  const audit = new AuditService(dbService);
  const controlled = new BatchControlledStockGuard();
  const sessions = new BatchInventorySessionService(dbService, controlled, audit);
  const inventoryPublisher = outboxPublisherFor(INVENTORY_STREAM, dbService);
  const shipmentPublisher = outboxPublisherFor(SHIPMENT_STREAM, dbService);
  const fulfillmentV2Publisher = outboxPublisherFor(FULFILLMENT_V2_STREAM, dbService);
  const fulfillmentV1Publisher = outboxPublisherFor(FULFILLMENT_STREAM, dbService);
  const sellable = new ProductSellableQuantityService(dbService as never, inventoryPublisher);
  const eventStore = new StockEventStore(dbService, sellable, controlled);
  const inventory = new InventoryCommandService(
    dbService,
    eventStore,
    inventoryPublisher,
    new LocationService(dbService),
    controlled,
  );
  const unified = new UnifiedReservationService(dbService, sellable);
  const shipmentReservations = new ShipmentReservationService(
    dbService,
    unified,
    new FulfillmentProgressService(),
    invariant,
  );
  // dispatch·picking 은 WaybillService 의 읽기/CAS 만 소비한다 — carrier registry·issue
  // machine 은 이 경로에서 호출되지 않아 stub 으로 충분(waybill.manager.integration.spec 패턴).
  const waybills = new WaybillService(
    new WaybillManager(
      new WaybillReader(dbService),
      new WaybillRepository(dbService),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      dbService,
    ),
  );
  // orchestrator 의 moduleRef 는 대기 오퍼레이션 재개(ConsolidationService)에만 쓰인다.
  // 단순출고 경로는 그 분기에 닿지 않으므로 no-op stub 이면 된다.
  const moduleRef = { get: () => ({ resumePending: async () => {} }) } as never;
  const batches = new OutboundBatchOrchestrator(
    dbService,
    commands,
    invariant,
    waybills,
    audit,
    workflowGate,
    moduleRef,
  );
  const discrete = new DiscretePickingStrategy(commands, workflowGate, sessions, batches);
  const picking = new PickingProcessService(
    dbService,
    commands,
    workflowGate,
    sessions,
    invariant,
    controlled,
    waybills,
    new PickingStrategyRegistry(dbService, [discrete]),
  );
  const barcodes = new BarcodeService(dbService);
  const dispatch = new ShipmentDispatchService(
    dbService,
    commands,
    inventory,
    sessions,
    shipmentReservations,
    waybills,
    barcodes,
    shipmentPublisher,
    fulfillmentV2Publisher,
    fulfillmentV1Publisher,
    audit,
    workflowGate,
  );
  return new SimpleOutboundService(dbService, batches, picking, workflowGate, commands, dispatch, barcodes);
}
