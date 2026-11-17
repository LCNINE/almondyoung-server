import { createCheckpointsForTesting } from '@app/authorization';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import {
  consolidationBase,
  ConsolidationSource,
  consolidationSources,
  createConsolidationSource,
  inRollbackTx,
  makeConsolidationService,
  makeDb,
  makeDbService,
  wireLogistics,
  Wired,
} from './__support__';
import { assembleBoxWithdrawal } from './__support__/box-withdrawal-wiring';
import { ConsolidationService } from './consolidation.service';
import { FulfillmentCommandService } from './fulfillment-command.service';
import { FulfillmentInvariantService } from './fulfillment-invariant.service';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';
import { ShipmentPlanningService } from './shipment-planning.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('ShipmentPlanningService.getFulfillmentShipments (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let wired: Wired;
  let planning: ShipmentPlanningService;
  let consolidation: ConsolidationService;
  const actor = { id: randomUUID(), roles: ['logistics_manager'] };

  beforeAll(() => {
    if (!DATABASE_URL) throw new Error('DATABASE_URL is required');

    ({ sql: client, db } = makeDb(DATABASE_URL));
    const dbService = makeDbService(db);

    wired = wireLogistics(dbService, 'v2');
    consolidation = makeConsolidationService(dbService, wired);
    planning = new ShipmentPlanningService(
      dbService,
      new FulfillmentCommandService(dbService),
      wired.shipmentReservations,
      new FulfillmentInvariantService(),
      new AuditService(dbService),
      new FulfillmentWorkflowGate(new ConfigService({ FULFILLMENT_WORKFLOW_MODE: 'v2' })),
      assembleBoxWithdrawal(dbService),
      createCheckpointsForTesting(),
    );
  });

  afterAll(async () => {
    await client.end();
  });

  async function mergedBox(tx: DbTx, a: ConsolidationSource, b: ConsolidationSource) {
    const result = await consolidation.consolidate(
      {
        sources: consolidationSources(a, b),
        recipientSourceShipmentId: a.shipment.id,
        reason: 'shipment totals',
      },
      `shipment-totals-${randomUUID()}`,
      actor,
      tx,
    );

    if (!result.targetShipmentId) throw new Error('consolidation produced no target shipment');

    return result.targetShipmentId;
  }

  async function addLinesOfOrder(tx: DbTx, source: ConsolidationSource, shipmentId: string, count: number) {
    const [item] = await tx
      .select()
      .from(wmsTables.fulfillmentOrderItems)
      .where(eq(wmsTables.fulfillmentOrderItems.id, source.fulfillmentOrderItemId));

    for (let index = 0; index < count; index += 1) {
      const [extraItem] = await tx
        .insert(wmsTables.fulfillmentOrderItems)
        .values({
          fulfillmentOrderId: item.fulfillmentOrderId,
          salesOrderId: item.salesOrderId,
          salesOrderLineId: item.salesOrderLineId,
          skuId: item.skuId,
          qty: 1,
          reservedQty: 1,
          status: item.status,
        })
        .returning();

      await tx.insert(wmsTables.shipmentLines).values({
        shipmentId,
        fulfillmentOrderItemId: extraItem.id,
        skuId: item.skuId,
        qty: 1,
        reservedQty: 1,
        inspectedQty: 0,
      });
    }
  }

  async function linesOf(tx: DbTx, shipmentId: string) {
    return tx.select().from(wmsTables.shipmentLines).where(eq(wmsTables.shipmentLines.shipmentId, shipmentId));
  }

  it('합쳐진 상자는 어느 출고주문으로 물어도 상자 전체 수량과 줄 수를 돌려준다', async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await consolidationBase(tx);
      const customerId = randomUUID();
      const a = await createConsolidationSource(tx, wired, base, { quantity: 1, customerId });
      const b = await createConsolidationSource(tx, wired, base, { quantity: 1, customerId });
      const boxId = await mergedBox(tx, a, b);

      await addLinesOfOrder(tx, a, boxId, 3);

      const boxLines = await linesOf(tx, boxId);
      expect(boxLines).toHaveLength(5);

      const forA = await planning.getFulfillmentShipments(a.fulfillmentOrderId, tx);
      const forB = await planning.getFulfillmentShipments(b.fulfillmentOrderId, tx);
      const activeA = forA.find((shipment) => shipment.id === boxId);
      const activeB = forB.find((shipment) => shipment.id === boxId);

      expect(activeA).toMatchObject({ id: boxId, totalQty: 5, reservedQty: 5, inspectedQty: 0 });
      expect(activeB).toMatchObject({ id: boxId, totalQty: 5, reservedQty: 5, inspectedQty: 0 });
    });
  });

  it('대체된 옛 상자는 새 상자 수량에 섞이지 않고 자기 상태와 수량으로 따로 나온다', async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await consolidationBase(tx);
      const customerId = randomUUID();
      const a = await createConsolidationSource(tx, wired, base, { quantity: 1, customerId });
      const b = await createConsolidationSource(tx, wired, base, { quantity: 1, customerId });
      const boxId = await mergedBox(tx, a, b);

      const forA = await planning.getFulfillmentShipments(a.fulfillmentOrderId, tx);
      const active = forA.find((shipment) => shipment.id === boxId);
      const old = forA.find((shipment) => shipment.id === a.shipment.id);

      expect(active).toMatchObject({ totalQty: 2 });
      expect(old).toMatchObject({ status: 'superseded', totalQty: 1 });
      expect(forA.map((shipment) => shipment.id).sort()).toEqual([boxId, a.shipment.id].sort());
    });
  });

  it('합치지 않은 보통 상자는 자기 줄만큼만 센다', async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await consolidationBase(tx);
      const source = await createConsolidationSource(tx, wired, base, { quantity: 3, customerId: randomUUID() });

      await tx
        .update(wmsTables.shipmentLines)
        .set({ reservedQty: 2, inspectedQty: 1 })
        .where(eq(wmsTables.shipmentLines.id, source.shipmentLineId));

      const summaries = await planning.getFulfillmentShipments(source.fulfillmentOrderId, tx);

      expect(summaries).toEqual([
        {
          id: source.shipment.id,
          status: source.shipment.status,
          warehouseId: source.shipment.warehouseId,
          supplierId: source.shipment.supplierId,
          manifestVersion: source.shipment.manifestVersion,
          reservationVersion: source.shipment.reservationVersion,
          totalQty: 3,
          reservedQty: 2,
          inspectedQty: 1,
          recoveryCode: source.shipment.recoveryCode,
        },
      ]);
    });
  });

  it('상자 상세의 줄마다 상품명과 고객이 아는 주문번호를 싣는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await consolidationBase(tx);
      const customerId = randomUUID();
      const a = await createConsolidationSource(tx, wired, base, { quantity: 1, customerId });
      const b = await createConsolidationSource(tx, wired, base, { quantity: 2, customerId });

      await tx.update(wmsTables.skus).set({ name: '샘플 상품 (빨강)' }).where(eq(wmsTables.skus.id, base.skuId));
      await tx
        .update(wmsTables.salesOrders)
        .set({ displayOrderNo: 'ORDER-A' })
        .where(eq(wmsTables.salesOrders.id, a.salesOrderId));

      const boxId = await mergedBox(tx, a, b);
      const detail = await planning.getShipmentDetail(boxId, tx);
      const byQty = new Map(detail.lines.map((line) => [line.qty, line]));

      expect(detail.lines).toHaveLength(2);
      expect(byQty.get(1)).toMatchObject({ skuName: '샘플 상품 (빨강)', origin: { displayOrderNo: 'ORDER-A' } });
      expect(byQty.get(2)).toMatchObject({ skuName: '샘플 상품 (빨강)', origin: { displayOrderNo: null } });
    });
  });
});
