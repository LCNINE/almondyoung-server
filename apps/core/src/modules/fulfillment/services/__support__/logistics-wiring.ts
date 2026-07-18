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
import { BarcodeService } from '../../../inventory/shared/services/barcode.service';
import { PoliciesService } from '../policies.service';
import { AvailabilityService } from '../availability.service';
import { FulfillmentsService } from '../fulfillments.service';
import { FulfillmentOrderReservationRetryWorker } from '../fulfillment-order-reservation-retry.worker';
import { FulfillmentWorkflowGate, type FulfillmentWorkflowMode } from '../fulfillment-workflow-gate.service';
import { ConfigService } from '@nestjs/config';
import { PickingProcessService } from '../picking-process.service';
import { ProductSkuMappingService } from '../../../product-matching/services/product-sku-mapping.service';
import { FulfillmentOrderCreationBacklogService } from '../../backlog/fulfillment-order-creation-backlog.service';
import { FulfillmentProgressService } from '../fulfillment-progress.service';
import { FulfillmentInvariantService } from '../fulfillment-invariant.service';
import { ShipmentReservationService } from '../shipment-reservation.service';

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
  barcode: BarcodeService;
  policies: PoliciesService;
  availability: AvailabilityService;
  backlog: FulfillmentOrderCreationBacklogService;
  productSkuMapping: ProductSkuMappingService;
  fulfillments: FulfillmentsService;
  shipmentReservations: ShipmentReservationService;
  retryWorker: FulfillmentOrderReservationRetryWorker;
  picking: PickingProcessService;
}

export function wireLogistics(
  dbService: DbService<typeof wmsSchema>,
  workflowMode: FulfillmentWorkflowMode = 'v2',
): Wired {
  const invOutbox = new InventoryOutboxService(dbService);
  const fulfillmentOutbox = new FulfillmentOutboxService(dbService);
  const sellable = new ProductSellableQuantityService(dbService as never, invOutbox);
  const eventStore = new StockEventStore(dbService, sellable);
  const location = new LocationService(dbService);
  const command = new InventoryCommandService(dbService, eventStore, invOutbox, location);
  const unified = new UnifiedReservationService(dbService, sellable);
  const lifecycle = new ReservationLifecycleService(dbService, unified);
  // 로컬 컨벤션(.env.wms.example)과 동일한 epoch cutover — "모든 주문이 커토버 이후" 를 참으로 만든다.
  // cutover 미설정이면 v2 게이트가 fail-closed 라 backlog enqueue 가 전부 거부된다.
  const workflowGate = new FulfillmentWorkflowGate(
    new ConfigService({
      FULFILLMENT_WORKFLOW_MODE: workflowMode,
      FULFILLMENT_V2_CUTOVER_AT: '1970-01-01T00:00:00.000Z',
    }),
  );
  const barcode = new BarcodeService(dbService);
  const policies = new PoliciesService(dbService);
  const availability = new AvailabilityService(dbService);
  const backlog = new FulfillmentOrderCreationBacklogService(dbService, workflowGate);
  const productSkuMapping = new ProductSkuMappingService(dbService, sellable, backlog);
  const progress = new FulfillmentProgressService();
  const invariant = new FulfillmentInvariantService();
  const shipmentReservations = new ShipmentReservationService(dbService, unified, progress, invariant);
  const fulfillments = new FulfillmentsService(
    dbService,
    lifecycle,
    productSkuMapping,
    fulfillmentOutbox,
    workflowGate,
    shipmentReservations,
    progress,
  );
  const retryWorker = new FulfillmentOrderReservationRetryWorker(dbService, workflowGate, shipmentReservations);
  const picking = new PickingProcessService(dbService);

  return {
    invOutbox,
    fulfillmentOutbox,
    sellable,
    eventStore,
    location,
    command,
    unified,
    lifecycle,
    barcode,
    policies,
    availability,
    backlog,
    productSkuMapping,
    fulfillments,
    shipmentReservations,
    retryWorker,
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
