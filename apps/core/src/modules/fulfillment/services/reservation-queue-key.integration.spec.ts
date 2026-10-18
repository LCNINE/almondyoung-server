import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { and, eq } from 'drizzle-orm';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import {
  inRollbackTx,
  makeDb,
  makeDbService,
  seedHolder,
  seedMatching,
  seedSalesOrder,
  seedSku,
  seedWarehouseWithZone,
  wireLogistics,
  Wired,
} from './__support__';
import { assembleBoxWithdrawal } from './__support__/box-withdrawal-wiring';
import { FulfillmentCommandService } from './fulfillment-command.service';
import { FulfillmentInvariantService } from './fulfillment-invariant.service';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';
import { ShipmentPlanningService } from './shipment-planning.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const COMPLETE_RECIPIENT = {
  recipientName: 'Integration Tester',
  phone: '010-0000-0000',
  postalCode: '01234',
  roadAddress: 'Seoul test road 1',
  detailAddress: '101',
};

describeIfDb('재고 대기 순번 (reservation queue key, DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let wired: Wired;
  let planning: ShipmentPlanningService;
  const actor = { id: randomUUID(), roles: ['master'] };

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
    const dbService = makeDbService(db);
    wired = wireLogistics(dbService, 'v2');
    planning = new ShipmentPlanningService(
      dbService,
      new FulfillmentCommandService(dbService),
      wired.shipmentReservations,
      new FulfillmentInvariantService(),
      new AuditService(dbService),
      { getScopesByRoles: () => Promise.resolve(new Set(['master'])) } as never,
      new FulfillmentWorkflowGate(new ConfigService({ FULFILLMENT_WORKFLOW_MODE: 'v2' })),
      assembleBoxWithdrawal(dbService),
    );
  });

  afterAll(async () => {
    await client.end();
  });

  /** 한 SKU·창고에 재고 `onHand` 와 주문 하나(수량 `quantity`)를 심는다. 예약은 생성 시점에 재고만큼 잡힌다. */
  async function seedWorld(tx: DbTx, quantity: number, onHand: number) {
    const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
    const { holderId } = await seedHolder(tx);
    const { skuId } = await seedSku(tx, holderId);
    const world = { warehouseId, locationId, skuId };
    if (onHand > 0) await addStock(tx, world, onHand);
    const order = await addOrder(tx, world, quantity);
    return { ...world, ...order };
  }

  /** 같은 SKU·창고에 주문 하나를 더한다 — 재고 경쟁 상대. */
  async function addOrder(tx: DbTx, where: { warehouseId: string; skuId: string }, quantity: number) {
    const variantId = randomUUID();
    const { salesOrderId, lineIds } = await seedSalesOrder(tx, { lines: [{ variantId, quantity }] });
    await tx
      .update(wmsTables.salesOrders)
      .set({ shippingAddress: COMPLETE_RECIPIENT })
      .where(eq(wmsTables.salesOrders.id, salesOrderId));
    await tx
      .update(wmsTables.salesOrderLines)
      .set({ channelOrderItemId: `item-${randomUUID()}`, channelProductId: `product-${randomUUID()}` })
      .where(eq(wmsTables.salesOrderLines.id, lineIds[0]));
    await seedMatching(tx, { variantId, skuId: where.skuId });
    await wired.fulfillments.create({ salesOrderId, warehouseId: where.warehouseId }, tx);
    const [item] = await tx
      .select({ id: wmsTables.fulfillmentOrderItems.id })
      .from(wmsTables.fulfillmentOrderItems)
      .innerJoin(
        wmsTables.fulfillmentOrders,
        eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
      )
      .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId));
    const [line] = await tx
      .select()
      .from(wmsTables.shipmentLines)
      .where(eq(wmsTables.shipmentLines.fulfillmentOrderItemId, item.id));
    const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, line.shipmentId));
    return { line, shipment };
  }

  async function setCreatedAt(tx: DbTx, lineId: string, at: Date) {
    await tx.update(wmsTables.shipmentLines).set({ createdAt: at }).where(eq(wmsTables.shipmentLines.id, lineId));
  }

  /** 재고를 `qty` 만큼 더한다 — (sku, 창고, 위치, 상태) 한 행이라 있으면 올리고 없으면 만든다. */
  async function addStock(tx: DbTx, world: { skuId: string; warehouseId: string; locationId: string }, qty: number) {
    const key = and(
      eq(wmsTables.stockLedgers.skuId, world.skuId),
      eq(wmsTables.stockLedgers.warehouseId, world.warehouseId),
      eq(wmsTables.stockLedgers.locationId, world.locationId),
      eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
    );
    const [existing] = await tx.select().from(wmsTables.stockLedgers).where(key);
    if (existing) {
      await tx
        .update(wmsTables.stockLedgers)
        .set({ qty: existing.qty + qty })
        .where(key);
      return;
    }
    await tx.insert(wmsTables.stockLedgers).values({
      skuId: world.skuId,
      warehouseId: world.warehouseId,
      locationId: world.locationId,
      stockState: 'ON_HAND',
      qty,
    });
  }

  async function candidateIds(tx: DbTx): Promise<string[]> {
    return (await wired.retryWorker.findCandidates(100_000, tx)).map((row) => row.id);
  }

  it('나눠 옮긴 미예약 몫이 원래 라인의 순번을 이어받는다 — 뒤에 온 주문보다 먼저 재고를 받는다', async () => {
    await inRollbackTx(db, async (tx) => {
      // 주문 A(2026-10-01): 수량 3, 재고 2 → 확정 예약 2 · 미예약 1
      const world = await seedWorld(tx, 3, 2);
      const a = world;
      await setCreatedAt(tx, a.line.id, new Date('2026-10-01T00:00:00Z'));
      await tx
        .update(wmsTables.stockReservations)
        .set({ requestedAt: new Date('2026-10-01T00:00:00Z') })
        .where(eq(wmsTables.stockReservations.shipmentLineId, a.line.id));

      // 미예약 1 을 새 상자로 나눈다. 이 시점의 target 라인 created_at 은 «지금» 이다.
      const split = await planning.split(
        a.shipment.id,
        {
          expectedManifestVersion: a.shipment.manifestVersion,
          reason: '재고 부족 나눠 보내기',
          moves: [{ shipmentLineId: a.line.id, expectedLineVersion: a.line.lineVersion, qty: 1, targetReservedQty: 0 }],
        },
        `split-${randomUUID()}`,
        actor,
        tx,
      );
      const aTargetLineId = split.target.lines[0].id;

      // 주문 B(2026-10-05): 같은 SKU 수량 1, 예약 0 (재고는 A 가 다 가져갔다)
      const b = await addOrder(tx, world, 1);
      await setCreatedAt(tx, b.line.id, new Date('2026-10-05T00:00:00Z'));

      await addStock(tx, world, 1);

      const ids = (await candidateIds(tx)).filter((id) => id === aTargetLineId || id === b.line.id);
      expect(ids).toEqual([aTargetLineId, b.line.id]);
    });
  });

  it('라인 통째 이동은 칼럼을 쓰지 않는다 — 라인 id 가 그대로라 순번도 그대로다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 4, 0);
      // 원본 상자에 남는 라인이 있어야 통째 이동이 허용된다.
      const other = await addOrder(tx, world, 2);
      await tx
        .update(wmsTables.shipmentLines)
        .set({ shipmentId: world.shipment.id })
        .where(eq(wmsTables.shipmentLines.id, other.line.id));
      const split = await planning.split(
        world.shipment.id,
        {
          expectedManifestVersion: world.shipment.manifestVersion,
          reason: '통째 이동',
          moves: [{ shipmentLineId: world.line.id, expectedLineVersion: world.line.lineVersion, qty: 4 }],
        },
        `split-${randomUUID()}`,
        actor,
        tx,
      );

      const [movedLine] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, world.line.id));
      expect(movedLine.shipmentId).toBe(split.target.shipmentId);
      expect(movedLine.demandRequestedAt).toBeNull();
    });
  });

  it('demand_requested_at 이 NULL 인 옛 라인은 created_at 순 그대로다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 1, 0);
      const second = await addOrder(tx, world, 1);
      // 일부러 생성 순서와 반대로 심는다 — 정렬이 id 나 삽입 순이 아니라 created_at 이라는 증거.
      await setCreatedAt(tx, world.line.id, new Date('2026-10-05T00:00:00Z'));
      await setCreatedAt(tx, second.line.id, new Date('2026-10-01T00:00:00Z'));
      await addStock(tx, world, 1);

      const ids = (await candidateIds(tx)).filter((id) => id === world.line.id || id === second.line.id);
      expect(ids).toEqual([second.line.id, world.line.id]);
    });
  });
});
