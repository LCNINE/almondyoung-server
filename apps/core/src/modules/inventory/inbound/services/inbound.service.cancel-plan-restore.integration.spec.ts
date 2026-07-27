import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import { InboundService } from './inbound.service';
import { Database, inRollbackTx, makeInboundService } from './__fixtures__/inbound-harness';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('InboundService.cancelInbound 예정 연계 복원 (PostgreSQL integration)', () => {
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

  // 이 스펙은 예정 아이템 + 같은 SKU 의 개별입고까지 쓴다. Task 2 의 시드와
  // 필요한 행이 겹쳐 보이지만 반환 모양이 달라 각자 인라인으로 둔다.
  async function seedPlanItem(tx: DbTx, expectedQty: number) {
    const suffix = randomUUID();
    const [warehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `cancel-wh-${suffix.slice(0, 8)}` })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `cancel-holder-${suffix.slice(0, 8)}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'cancel sku', code: `CANCEL-${suffix}`, holderId: holder.id })
      .returning();
    const [supplier] = await tx
      .insert(wmsTables.suppliers)
      .values({ name: `cancel-supplier-${suffix.slice(0, 8)}` })
      .returning();
    const [po] = await tx
      .insert(wmsTables.purchaseOrders)
      .values({
        supplierId: supplier.id,
        type: 'domestic',
        // NOT NULL, no default — 발주는 반드시 출발/목적 창고를 갖는다. 같은
        // 창고로 채워 이전 없는 발주(same-warehouse)를 모델링한다.
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

  it('전량 입고 후 취소하면 예정 누계와 상태가 되돌아온다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { item } = await seedPlanItem(tx, 20);

      const received = await svc.receiveFromPlan(
        { planItemId: item.id, quantity: 20, idempotencyKey: randomUUID() },
        tx,
      );

      const afterReceive = await tx.query.inboundPlanItems.findFirst({
        where: eq(wmsTables.inboundPlanItems.id, item.id),
      });
      expect(afterReceive?.receivedQty).toBe(20);
      expect(afterReceive?.status).toBe('confirmed');

      await svc.cancelInbound({ lineId: received.lineId, quantity: 20, idempotencyKey: randomUUID() }, tx);

      const afterCancel = await tx.query.inboundPlanItems.findFirst({
        where: eq(wmsTables.inboundPlanItems.id, item.id),
      });
      expect(afterCancel?.receivedQty).toBe(0);
      expect(afterCancel?.status).toBe('pending');
    });
  });

  it('부분 입고 두 건 중 하나만 취소하면 나머지 누계는 남는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { item } = await seedPlanItem(tx, 20);

      await svc.receiveFromPlan({ planItemId: item.id, quantity: 8, idempotencyKey: randomUUID() }, tx);
      const second = await svc.receiveFromPlan({ planItemId: item.id, quantity: 12, idempotencyKey: randomUUID() }, tx);

      await svc.cancelInbound({ lineId: second.lineId, quantity: 12, idempotencyKey: randomUUID() }, tx);

      const afterCancel = await tx.query.inboundPlanItems.findFirst({
        where: eq(wmsTables.inboundPlanItems.id, item.id),
      });
      expect(afterCancel?.receivedQty).toBe(8);
      expect(afterCancel?.status).toBe('pending');
    });
  });

  it('부분 취소 후에도 남은 누계가 예정 수량을 채우면 confirmed 를 유지한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { item } = await seedPlanItem(tx, 20);

      const first = await svc.receiveFromPlan({ planItemId: item.id, quantity: 12, idempotencyKey: randomUUID() }, tx);
      await svc.receiveFromPlan({ planItemId: item.id, quantity: 20, idempotencyKey: randomUUID() }, tx);

      const afterReceive = await tx.query.inboundPlanItems.findFirst({
        where: eq(wmsTables.inboundPlanItems.id, item.id),
      });
      expect(afterReceive?.receivedQty).toBe(32);
      expect(afterReceive?.status).toBe('confirmed');

      // 32 중 12 를 취소해도 남은 20 이 expectedQty(20) 을 채우므로 confirmed 유지
      await svc.cancelInbound({ lineId: first.lineId, quantity: 12, idempotencyKey: randomUUID() }, tx);

      const afterCancel = await tx.query.inboundPlanItems.findFirst({
        where: eq(wmsTables.inboundPlanItems.id, item.id),
      });
      expect(afterCancel?.receivedQty).toBe(20);
      expect(afterCancel?.status).toBe('confirmed');
    });
  });

  it('예정과 무관한 간편입고 라인 취소는 예정을 건드리지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouse, sku, item } = await seedPlanItem(tx, 20);

      // 같은 SKU 를 예정과 무관하게 개별입고한 뒤 그 라인을 취소한다
      const individual = await svc.individualInbound(
        {
          warehouseId: warehouse.id,
          skuId: sku.id,
          quantity: 5,
          idempotencyKey: randomUUID(),
        },
        tx,
      );

      await svc.cancelInbound({ lineId: individual.line.id, quantity: 5, idempotencyKey: randomUUID() }, tx);

      const planItem = await tx.query.inboundPlanItems.findFirst({
        where: eq(wmsTables.inboundPlanItems.id, item.id),
      });
      expect(planItem?.receivedQty).toBe(0);
      expect(planItem?.status).toBe('pending');
    });
  });
});
