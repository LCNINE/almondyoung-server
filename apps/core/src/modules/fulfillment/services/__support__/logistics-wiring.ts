import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbService } from '@app/db';
import { wmsSchema, DbTx } from '../../../inventory/schema/inventory.schema';

import { OutboxService as InventoryOutboxService } from '../../../inventory/shared/outbox/outbox.service';
import { OutboxService as FulfillmentOutboxService } from '../../outbox/outbox.service';
import { ProductSellableQuantityService } from '../../../inventory/product-sellable-quantity/services/product-sellable-quantity.service';
import { StockEventStore } from '../../../inventory/core/repositories/stock-event.store';
import { LocationService } from '../../../inventory/core/services/location.service';
import { InventoryCommandService } from '../../../inventory/core/services/inventory-command.service';
import { UnifiedReservationService } from '../../../inventory/shared/services/unified-reservation.service';
import { ReservationLifecycleService } from '../../../inventory/shared/services/reservation-lifecycle.service';
import { FifoLocationStrategy } from '../../../inventory/core/services/location-resolution.strategy';
import { BarcodeService } from '../../../inventory/shared/services/barcode.service';
import { OutboundConsumptionService } from '../outbound-consumption.service';
import { ShipmentService } from '../shipment.service';
import { PoliciesService } from '../policies.service';
import { AvailabilityService } from '../availability.service';
import { FulfillmentsService } from '../fulfillments.service';
import { FulfillmentReservationsFacade } from '../fulfillment-reservations.facade';
import { FulfillmentOrderReservationRetryWorker } from '../fulfillment-order-reservation-retry.worker';
import { OutboundBatchService } from '../outbound-batch.service';
import { PickingProcessService } from '../picking-process.service';
import { ProductSkuMappingService } from '../../../product-matching/services/product-sku-mapping.service';
import { FulfillmentOrderCreationBacklogService } from '../../backlog/fulfillment-order-creation-backlog.service';

export class Rollback extends Error {}

export function makeDb(url: string): { sql: postgres.Sql; db: PostgresJsDatabase<typeof wmsSchema> } {
  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql, { schema: wmsSchema });
  return { sql, db };
}

export function makeDbService(db: PostgresJsDatabase<typeof wmsSchema>): DbService<typeof wmsSchema> {
  return {
    db,
    run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> =>
      tx ? fn(tx) : db.transaction((t) => fn(t as unknown as DbTx)),
  } as unknown as DbService<typeof wmsSchema>;
}

export interface Wired {
  invOutbox: InventoryOutboxService;
  fulfillmentOutbox: FulfillmentOutboxService;
  sellable: ProductSellableQuantityService;
  eventStore: StockEventStore;
  location: LocationService;
  command: InventoryCommandService;
  unified: UnifiedReservationService;
  lifecycle: ReservationLifecycleService;
  consumption: OutboundConsumptionService;
  barcode: BarcodeService;
  shipment: ShipmentService;
  policies: PoliciesService;
  availability: AvailabilityService;
  backlog: FulfillmentOrderCreationBacklogService;
  productSkuMapping: ProductSkuMappingService;
  fulfillments: FulfillmentsService;
  reservationsFacade: FulfillmentReservationsFacade;
  retryWorker: FulfillmentOrderReservationRetryWorker;
  outboundBatch: OutboundBatchService;
  picking: PickingProcessService;
}

export function wireLogistics(dbService: DbService<typeof wmsSchema>): Wired {
  const invOutbox = new InventoryOutboxService(dbService);
  const fulfillmentOutbox = new FulfillmentOutboxService(dbService);
  const sellable = new ProductSellableQuantityService(dbService as never, invOutbox);
  const eventStore = new StockEventStore(dbService, sellable);
  const location = new LocationService(dbService);
  const command = new InventoryCommandService(dbService, eventStore, invOutbox, location);
  const unified = new UnifiedReservationService(dbService, sellable);
  const lifecycle = new ReservationLifecycleService(dbService, unified);
  const strategy = new FifoLocationStrategy();
  const consumption = new OutboundConsumptionService(dbService, strategy, command, lifecycle, fulfillmentOutbox);
  const barcode = new BarcodeService(dbService);
  const shipment = new ShipmentService(dbService, barcode, consumption);
  const policies = new PoliciesService(dbService);
  const availability = new AvailabilityService(dbService);
  const backlog = new FulfillmentOrderCreationBacklogService(dbService);
  const productSkuMapping = new ProductSkuMappingService(dbService, sellable, backlog);
  const fulfillments = new FulfillmentsService(
    dbService,
    policies,
    availability,
    lifecycle,
    unified,
    productSkuMapping,
    fulfillmentOutbox,
    undefined,
  );
  const reservationsFacade = new FulfillmentReservationsFacade(dbService, unified, sellable, policies);
  const retryWorker = new FulfillmentOrderReservationRetryWorker(dbService, reservationsFacade);
  const outboundBatch = new OutboundBatchService(dbService);
  const picking = new PickingProcessService(dbService, barcode);

  return {
    invOutbox,
    fulfillmentOutbox,
    sellable,
    eventStore,
    location,
    command,
    unified,
    lifecycle,
    consumption,
    barcode,
    shipment,
    policies,
    availability,
    backlog,
    productSkuMapping,
    fulfillments,
    reservationsFacade,
    retryWorker,
    outboundBatch,
    picking,
  };
}

export async function inRollbackTx(
  db: PostgresJsDatabase<typeof wmsSchema>,
  fn: (tx: DbTx) => Promise<void>,
): Promise<void> {
  await expect(
    db.transaction(async (tx) => {
      await fn(tx as unknown as DbTx);
      throw new Rollback('intentional rollback');
    }),
  ).rejects.toThrow(Rollback);
}
