import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import { InboundService } from './inbound.service';
import { Database, inRollbackTx, makeInboundService } from './__fixtures__/inbound-harness';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('InboundService.receiveFromPlan (PostgreSQL integration)', () => {
  jest.setTimeout(120_000);

  let client: postgres.Sql;
  let db: Database;
  let svc: InboundService;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(client, { schema: wmsSchema });
    svc = makeInboundService(db);
  });

  afterAll(async () => {
    await client.end();
  });

  // 시드는 이 스펙 전용이다 — 예정 아이템 1건만 있으면 되고, 하네스로 올리면
  // 다른 스펙의 필요와 뒤섞여 과매개변수 함수가 된다.
  async function seedPlanItem(tx: DbTx, expectedQty: number) {
    const suffix = randomUUID();
    const [warehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `plan-wh-${suffix.slice(0, 8)}` })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `plan-holder-${suffix.slice(0, 8)}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'plan sku', code: `PLAN-${suffix}`, holderId: holder.id })
      .returning();
    const [supplier] = await tx
      .insert(wmsTables.suppliers)
      .values({ name: `plan-supplier-${suffix.slice(0, 8)}` })
      .returning();
    const [po] = await tx
      .insert(wmsTables.purchaseOrders)
      .values({
        supplierId: supplier.id,
        type: 'domestic',
        // NOT NULL, no default — 스키마상 발주는 반드시 출발/목적 창고를 갖는다
        sourceWarehouseId: warehouse.id,
        destinationWarehouseId: warehouse.id,
      })
      .returning();
    const [plan] = await tx
      .insert(wmsTables.inboundPlans)
      .values({
        warehouseId: warehouse.id,
        // NOT NULL, no default — stockSummary 집계 기준 창고
        destinationWarehouseId: warehouse.id,
        linkedPurchaseOrderId: po.id,
        status: 'pending',
      })
      .returning();
    const [item] = await tx
      .insert(wmsTables.inboundPlanItems)
      .values({ planId: plan.id, skuId: sku.id, expectedQty, receivedQty: 0, status: 'pending' })
      .returning();
    return { warehouse, sku, plan, item };
  }

  it('실입고 라인의 lineId 를 반환한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { item } = await seedPlanItem(tx, 20);

      const result = await svc.receiveFromPlan({ planItemId: item.id, quantity: 20, idempotencyKey: randomUUID() }, tx);

      expect(result.lineId).toEqual(expect.any(String));

      const line = await tx.query.inboundReceiptLines.findFirst({
        where: eq(wmsTables.inboundReceiptLines.id, result.lineId),
      });
      expect(line).toBeDefined();
      expect(line?.planItemId).toBe(item.id);
      expect(line?.quantity).toBe(20);
      expect(line?.receiptId).toBe(result.receiptId);
    });
  });
});
