import { createCheckpointsForTesting } from '@app/authorization';
import { assembleLabels } from '../../waybill/__support__/label-fixtures';
import { outboxPublisherFor } from '../../outbox/__support__/outbox-publisher.factory';
import {
  FULFILLMENT_STREAM,
  FULFILLMENT_V2_STREAM,
  INVENTORY_STREAM,
  SHIPMENT_STREAM,
  CORE_ORDER_STREAM,
} from '@packages/event-contracts/streams';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbService } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../../inventory/schema/inventory.schema';
import { BatchControlledStockGuard } from '../../../inventory/core/services/batch-controlled-stock.guard';
import { InventoryCommandService } from '../../../inventory/core/services/inventory-command.service';
import { LocationService } from '../../../inventory/core/services/location.service';
import { StockEventStore } from '../../../inventory/core/repositories/stock-event.store';
import { ProductSellableQuantityService } from '../../../inventory/product-sellable-quantity/services/product-sellable-quantity.service';
import { AuditService } from '../../../inventory/shared/services/audit.service';
import { BarcodeService } from '../../../inventory/shared/services/barcode.service';
import { UnifiedReservationService } from '../../../inventory/shared/services/unified-reservation.service';
import { AggregateThenSortPickingStrategy } from '../../picking/aggregate-then-sort.strategy';
import { DiscretePickingStrategy } from '../../picking/discrete-picking.strategy';
import { PickToTotePickingStrategy } from '../../picking/pick-to-tote.strategy';
import { PickingStrategyRegistry } from '../../picking/picking-strategy.registry';
import { seedHolder, seedSku, seedWarehouseWithZone } from '.';
import { BatchInventorySessionService } from '../batch-inventory-session.service';
import { canonicalFulfillmentRequestHash, FulfillmentCommandService } from '../fulfillment-command.service';
import { FulfillmentInvariantService } from '../fulfillment-invariant.service';
import { FulfillmentProgressService } from '../fulfillment-progress.service';
import { FulfillmentWorkflowGate } from '../fulfillment-workflow-gate.service';
import { OutboundBatchOrchestrator } from '../outbound-batch-orchestrator.service';
import { PickingProcessService } from '../picking-process.service';
import { ShipmentDispatchService } from '../shipment-dispatch.service';
import { ShipmentReservationService } from '../shipment-reservation.service';
import { ShipmentShortPickService } from '../shipment-short-pick.service';
import { CarrierGatewayRegistry } from '../../waybill/carrier/carrier-gateway.registry';
import type { HanjinConfig } from '../../waybill/carrier/hanjin/hanjin.config';
import { WaybillIssueMachine } from '../../waybill/waybill-issue.machine';
import { WaybillManager } from '../../waybill/waybill.manager';
import { WaybillReader } from '../../waybill/waybill.reader';
import { WaybillRepository } from '../../waybill/waybill.repository';
import { WaybillService } from '../../waybill/waybill.service';
import { BoxAllocationManager } from '../box-allocation.manager';
import { assembleBoxWithdrawal } from './box-withdrawal-wiring';

export const RECIPIENT = {
  recipientName: 'Outbound V2 Warehouse',
  phone: '010-1111-2222',
  postalCode: '01234',
  roadAddress: 'Seoul release road 1',
  detailAddress: '101',
};

export type Database = PostgresJsDatabase<typeof wmsSchema>;
export type Actor = { id: string; roles: string[] };

// assertDispatchable/void(읽기+CAS)만 소비 — carrier I/O 로 이어지는 필드는 이 경로들에서 쓰이지 않는다(더미).
const HANJIN_TEST_CONFIG: HanjinConfig = {
  clientId: 'CID',
  apiKey: 'AK',
  secretKey: 'SK',
  contractNo: 'CN',
  orderBaseUrl: 'https://o',
  printBaseUrl: 'https://p',
  timeoutMs: 15000,
  sender: { name: '보내는이', zip: '06236', baseAddress: '테헤란로 1', detailAddress: '10층', tel: '02-100-2000' },
  boxType: 'A',
  payType: 'PP',
  returnPayType: 'CT',
  labelType: 'NS',
};

export interface SeededShipment {
  variantId: string;
  shipment: typeof wmsTables.shipments.$inferSelect;
  line: typeof wmsTables.shipmentLines.$inferSelect;
  item: typeof wmsTables.fulfillmentOrderItems.$inferSelect;
  fulfillmentOrder: typeof wmsTables.fulfillmentOrders.$inferSelect;
  reservation: typeof wmsTables.stockReservations.$inferSelect;
}

export interface WarehouseWorld {
  warehouseId: string;
  locationId: string;
  skuId: string;
  barcode: string;
  profileId: string;
  ledgerVersion: number;
  stockQty: number;
  shipments: SeededShipment[];
}

export function ambientDbService(db: Database, tx: DbTx): DbService<typeof wmsSchema> {
  return {
    db,
    run: <T>(fn: (trx: DbTx) => Promise<T>, explicit?: DbTx): Promise<T> => {
      if (explicit) return fn(explicit);
      return (tx as unknown as { transaction<R>(callback: (nested: unknown) => Promise<R>): Promise<R> }).transaction(
        (nested) => fn(nested as DbTx),
      );
    },
  } as unknown as DbService<typeof wmsSchema>;
}

export function makeServices(db: Database, tx: DbTx) {
  const dbService = ambientDbService(db, tx);
  const commands = new FulfillmentCommandService(dbService);
  const invariant = new FulfillmentInvariantService();
  const audit = new AuditService(dbService);
  const workflow = new FulfillmentWorkflowGate(
    new ConfigService({ FULFILLMENT_WORKFLOW_MODE: 'v2', FULFILLMENT_V2_CUTOVER_AT: new Date().toISOString() }),
  );
  const controlled = new BatchControlledStockGuard();
  const sessions = new BatchInventorySessionService(dbService, audit);
  const moduleRef = {
    get: jest.fn(() => ({ resumePending: jest.fn().mockResolvedValue(undefined) }) as never),
  };
  // 플랜3: batch add·dispatch·picking 은 assertDispatchable/markUsed 를 소비한다(실제 WaybillService).
  // 결품은 박스 철회 서비스(withdrawals)가 송장 void 를 맡는다. registry/issue machine 은 이 경로들에서 실행되지 않지만 구조적
  // 의존이라 empty registry + issue machine + HANJIN stub 으로 배선한다(batch-orchestrator.integration 패턴).
  const waybillRepo = new WaybillRepository(dbService);
  const waybillRegistry = new CarrierGatewayRegistry([]);
  const waybills = new WaybillService(
    new WaybillManager(
      new WaybillReader(dbService),
      waybillRepo,
      new WaybillIssueMachine(waybillRepo, waybillRegistry, dbService),
      waybillRegistry,
      commands,
      HANJIN_TEST_CONFIG,
      dbService,
    ),
  );
  const boxes = new BoxAllocationManager(sessions, new BatchControlledStockGuard());
  const withdrawals = assembleBoxWithdrawal(dbService);
  const batches = new OutboundBatchOrchestrator(
    dbService,
    commands,
    invariant,
    waybills,
    audit,
    workflow,
    moduleRef as never,
    boxes,
    withdrawals,
    createCheckpointsForTesting(),
  );
  const labelGuard = assembleLabels(dbService).guard;
  const aggregate = new AggregateThenSortPickingStrategy(
    commands,
    workflow,
    sessions,
    batches,
    labelGuard,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    createCheckpointsForTesting(),
  );
  const discrete = new DiscretePickingStrategy(
    commands,
    workflow,
    sessions,
    batches,
    labelGuard,
    createCheckpointsForTesting(),
  );
  const tote = new PickToTotePickingStrategy(
    commands,
    workflow,
    sessions,
    batches,
    audit,
    labelGuard,
    createCheckpointsForTesting(),
  );
  const registry = new PickingStrategyRegistry(dbService, [discrete, aggregate, tote]);
  const picking = new PickingProcessService(
    dbService,
    commands,
    workflow,
    sessions,
    invariant,
    controlled,
    waybills,
    {} as never,
    registry,
  );

  const inventoryOutbox = outboxPublisherFor(INVENTORY_STREAM, dbService);
  const sellable = new ProductSellableQuantityService(dbService as never, inventoryOutbox);
  const eventStore = new StockEventStore(dbService, sellable, controlled);
  const inventory = new InventoryCommandService(
    dbService,
    eventStore,
    inventoryOutbox,
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
  const shortPick = new ShipmentShortPickService(
    commands,
    audit,
    workflow,
    boxes,
    withdrawals,
    createCheckpointsForTesting(),
  );
  const dispatch = new ShipmentDispatchService(
    dbService,
    commands,
    inventory,
    sessions,
    shipmentReservations,
    waybills,
    new BarcodeService(dbService),
    outboxPublisherFor(SHIPMENT_STREAM, dbService),
    outboxPublisherFor(FULFILLMENT_V2_STREAM, dbService),
    outboxPublisherFor(FULFILLMENT_STREAM, dbService),
    audit,
    workflow,
    outboxPublisherFor(CORE_ORDER_STREAM, dbService),
    labelGuard,
  );
  return { batches, dispatch, waybills, picking, sessions, shortPick };
}

export async function seedWorld(
  tx: DbTx,
  quantities: number[],
  strategies: Array<'discrete' | 'aggregate_then_sort' | 'pick_to_tote'> = [
    'discrete',
    'aggregate_then_sort',
    'pick_to_tote',
  ],
) {
  const suffix = randomUUID();
  const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
  await tx
    .update(wmsTables.warehouses)
    .set({ supportedPickingStrategies: strategies })
    .where(eq(wmsTables.warehouses.id, warehouseId));
  const { holderId } = await seedHolder(tx);
  const { skuId } = await seedSku(tx, holderId);
  const [profile] = await tx
    .insert(wmsTables.deliveryProfiles)
    .values({
      name: `release-profile-${suffix}`,
      sourceType: 'in_house',
      senderSnapshot: { name: 'Release Sender', phone: '02-0000-0000' },
      originAddressSnapshot: { address: 'Origin' },
      returnAddressSnapshot: { address: 'Return' },
      carrierAccountRef: 'goodsflow-center',
      supportedFulfillmentModes: ['in_house'],
    })
    .returning();
  await tx.update(wmsTables.skus).set({ deliveryProfileId: profile.id }).where(eq(wmsTables.skus.id, skuId));
  const barcode = `880${suffix.replaceAll('-', '').slice(0, 10)}`;
  await tx.insert(wmsTables.skuBarcodes).values({ skuId, barcode, isPrimary: true });
  const total = quantities.reduce((sum, quantity) => sum + quantity, 0);
  const [ledger] = await tx
    .insert(wmsTables.stockLedgers)
    .values({ skuId, warehouseId, locationId, stockState: 'ON_HAND', qty: total })
    .returning();
  const shipments: SeededShipment[] = [];
  for (const [index, quantity] of quantities.entries()) {
    const [salesOrder] = await tx
      .insert(wmsTables.salesOrders)
      .values({
        channelOrderId: `release-${index}-${suffix}`,
        salesChannel: 'medusa',
        status: 'confirmed',
        shippingAddress: RECIPIENT,
        orderDate: new Date(),
      })
      .returning();
    const variantId = randomUUID();
    const [salesLine] = await tx
      .insert(wmsTables.salesOrderLines)
      .values({
        salesOrderId: salesOrder.id,
        variantId,
        productName: `Release product ${index}`,
        quantity,
        channelOrderItemId: `release-item-${index}-${suffix}`,
        channelProductId: `release-product-${index}-${suffix}`,
      })
      .returning();
    const [fulfillmentOrder] = await tx
      .insert(wmsTables.fulfillmentOrders)
      .values({
        salesOrderId: salesOrder.id,
        warehouseId,
        ownerId: holderId,
        status: 'processing',
        fulfillmentMode: 'in_house',
        totalItems: 1,
        totalQty: quantity,
        totalReservedQty: quantity,
      })
      .returning();
    const [item] = await tx
      .insert(wmsTables.fulfillmentOrderItems)
      .values({
        fulfillmentOrderId: fulfillmentOrder.id,
        salesOrderId: salesOrder.id,
        salesOrderLineId: salesLine.id,
        skuId,
        qty: quantity,
        reservedQty: quantity,
        status: 'processing',
      })
      .returning();
    const [shipment] = await tx
      .insert(wmsTables.shipments)
      .values({
        warehouseId,
        openedForFulfillmentOrderId: fulfillmentOrder.id,
        status: 'planned',
        shippingProfileId: profile.id,
        recipientSnapshot: RECIPIENT,
        plannedAt: new Date(),
      })
      .returning();
    const [line] = await tx
      .insert(wmsTables.shipmentLines)
      .values({
        shipmentId: shipment.id,
        fulfillmentOrderItemId: item.id,
        skuId,
        qty: quantity,
        reservedQty: quantity,
      })
      .returning();
    const [reservation] = await tx
      .insert(wmsTables.stockReservations)
      .values({
        targetType: 'SHIPMENT_LINE',
        targetId: line.id,
        fulfillmentOrderItemId: item.id,
        shipmentLineId: line.id,
        skuId,
        warehouseId,
        quantity,
        status: 'confirmed',
        requestedAt: new Date(),
      })
      .returning();
    shipments.push({ variantId, shipment, line, item, fulfillmentOrder, reservation });
  }
  return {
    warehouseId,
    locationId,
    skuId,
    barcode,
    profileId: profile.id,
    ledgerVersion: ledger.version,
    stockQty: total,
    shipments,
  } satisfies WarehouseWorld;
}

// 플랜3: batch add 는 issued invoice 대신 registered waybill 을 게이트한다(assertDispatchable). shipment 와
// manifestVersion/recipientHash 가 일치하는 registered waybill 을 1행 시드한다.
export async function seedRegisteredWaybill(tx: DbTx, shipmentId: string) {
  const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, shipmentId));
  const [waybill] = await tx
    .insert(wmsTables.waybills)
    .values({
      shipmentId,
      source: 'manual',
      carrier: 'HANJIN',
      status: 'registered',
      trackingNo: `release-tracking-${randomUUID()}`,
      manifestVersion: shipment.manifestVersion,
      recipientHash: canonicalFulfillmentRequestHash(shipment.recipientSnapshot),
    })
    .returning();
  return waybill;
}

export async function seedRegisteredWaybills(tx: DbTx, world: WarehouseWorld) {
  for (const member of world.shipments) {
    await seedRegisteredWaybill(tx, member.shipment.id);
  }
}

export async function createBatchWithShipments(
  services: ReturnType<typeof makeServices>,
  world: WarehouseWorld,
  actor: Actor,
  pickingMethod: 'individual' | 'total_picking' | 'multi_order' = 'individual',
  cartCapacity?: number,
) {
  const batch = await services.batches.createBatch(
    { warehouseId: world.warehouseId, pickingMethod, cartCapacity, name: `Release batch ${randomUUID()}` },
    `release-batch-${randomUUID()}`,
    actor,
  );
  const added: Array<Awaited<ReturnType<OutboundBatchOrchestrator['addShipment']>>> = [];
  for (const member of world.shipments) {
    added.push(
      await services.batches.addShipment(batch.batchId, member.shipment.id, `release-add-${randomUUID()}`, actor),
    );
  }
  return { batch, added };
}

export async function discretePickAfterHandoff(
  services: ReturnType<typeof makeServices>,
  world: WarehouseWorld,
  batchId: string,
  workItemId: string,
  worker: Actor,
  expectedLeaseVersion: number,
) {
  const member = world.shipments[0];
  const started = await services.picking.start({
    batchId,
    actorId: worker.id,
    idempotencyKey: `discrete-start-${randomUUID()}`,
  });
  expect(started.state).toBe('started');
  await services.picking.scan({
    strategy: 'discrete',
    stage: 'source',
    batchId,
    sessionId: started.sessionId,
    workItemId,
    shipmentId: member.shipment.id,
    shipmentLineId: member.line.id,
    skuId: world.skuId,
    sourceLocationId: world.locationId,
    quantity: member.line.qty,
    actor: worker,
    expectedLeaseVersion,
    idempotencyKey: `discrete-scan-${randomUUID()}`,
  });
  const completed = await services.picking.completePick({
    batchId,
    sessionId: started.sessionId,
    workItemId,
    shipmentId: member.shipment.id,
    actor: worker,
    expectedLeaseVersion,
    idempotencyKey: `discrete-complete-${randomUUID()}`,
  });
  return { completed, sessionId: started.sessionId };
}

export async function aggregatePick(
  services: ReturnType<typeof makeServices>,
  world: WarehouseWorld,
  batchId: string,
  workItemId: string,
  worker: Actor,
  expectedLeaseVersion = 0,
) {
  const member = world.shipments[0];
  const claim = await services.batches.claimPicker(
    workItemId,
    { expectedLeaseVersion },
    `aggregate-claim-${randomUUID()}`,
    worker,
  );
  const started = await services.picking.start({
    batchId,
    actorId: worker.id,
    idempotencyKey: `aggregate-start-${randomUUID()}`,
  });
  expect(started.state).toBe('started');
  const cartId = `cart-${randomUUID()}`;
  await services.picking.aggregateBulkCartScan({
    strategy: 'aggregate_then_sort',
    stage: 'bulk_collect',
    batchId,
    sessionId: started.sessionId,
    skuId: world.skuId,
    sourceLocationId: world.locationId,
    quantity: member.line.qty,
    cartId,
    actor: worker,
    idempotencyKey: `aggregate-collect-${randomUUID()}`,
  });
  await services.picking.aggregateSortScan({
    strategy: 'aggregate_then_sort',
    stage: 'sort',
    batchId,
    sessionId: started.sessionId,
    workItemId,
    shipmentId: member.shipment.id,
    shipmentLineId: member.line.id,
    skuId: world.skuId,
    cartId,
    quantity: member.line.qty,
    destinationCustody: 'SORTING',
    actor: worker,
    expectedLeaseVersion: claim.workItem.leaseVersion,
    idempotencyKey: `aggregate-sort-${randomUUID()}`,
  });
  const completed = await services.picking.completePick({
    batchId,
    sessionId: started.sessionId,
    workItemId,
    shipmentId: member.shipment.id,
    actor: worker,
    expectedLeaseVersion: claim.workItem.leaseVersion,
    idempotencyKey: `aggregate-complete-${randomUUID()}`,
  });
  return { claim, completed, sessionId: started.sessionId };
}

export async function totePick(
  services: ReturnType<typeof makeServices>,
  world: WarehouseWorld,
  batchId: string,
  workItemId: string,
  worker: Actor,
  toteQuantities: number[],
) {
  const member = world.shipments[0];
  const claim = await services.batches.claimPicker(
    workItemId,
    { expectedLeaseVersion: 0 },
    `tote-claim-${randomUUID()}`,
    worker,
  );
  const started = await services.picking.start({
    batchId,
    actorId: worker.id,
    idempotencyKey: `tote-start-${randomUUID()}`,
  });
  expect(started.state).toBe('started');
  const toteIds: string[] = [];
  for (const [index, quantity] of toteQuantities.entries()) {
    const toteBarcode = `TOTE-${index}-${randomUUID()}`;
    const registered = await services.picking.registerTote({
      warehouseId: world.warehouseId,
      toteBarcode,
      actor: worker,
      idempotencyKey: `tote-register-${randomUUID()}`,
    });
    toteIds.push(registered.toteId);
    await services.picking.assignTote({
      batchId,
      sessionId: started.sessionId,
      workItemId,
      shipmentId: member.shipment.id,
      toteBarcode,
      actor: worker,
      expectedLeaseVersion: claim.workItem.leaseVersion,
      idempotencyKey: `tote-assign-${randomUUID()}`,
    });
    await services.picking.toteScan({
      strategy: 'pick_to_tote',
      stage: 'source',
      batchId,
      sessionId: started.sessionId,
      workItemId,
      shipmentId: member.shipment.id,
      shipmentLineId: member.line.id,
      skuId: world.skuId,
      sourceLocationId: world.locationId,
      quantity,
      toteBarcode,
      actor: worker,
      expectedLeaseVersion: claim.workItem.leaseVersion,
      idempotencyKey: `tote-scan-${randomUUID()}`,
    });
  }
  const completed = await services.picking.completePick({
    batchId,
    sessionId: started.sessionId,
    workItemId,
    shipmentId: member.shipment.id,
    actor: worker,
    expectedLeaseVersion: claim.workItem.leaseVersion,
    idempotencyKey: `tote-complete-${randomUUID()}`,
  });
  return { claim, completed, sessionId: started.sessionId, toteIds };
}
