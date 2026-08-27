import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DbService } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import { Database, inRollbackTx, makeInboundService } from '../../inbound/services/__fixtures__/inbound-harness';
import { InboundService } from '../../inbound/services/inbound.service';
import { PurchaseOrderService } from './purchase-order.service';
import { PurchaseOrderManager } from './purchase-order.manager';
import { PurchaseOrderReader } from './purchase-order.reader';

/**
 * items → plan → PO 단방향 파생을 고정한다 (#724 항목 7).
 *
 * 단위 테스트로는 아무것도 안 잡힌다 — 세 테이블에 걸친 상태 전이이고, 파생의
 * 트리거가 트랜잭션 경계를 넘어 포트로 건너간다.
 *
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- purchase-order-closure
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('발주 종결 파생 (DB integration)', () => {
  jest.setTimeout(120_000);

  let client: postgres.Sql;
  let db: Database;
  let inbound: InboundService;
  const ACTOR = randomUUID();

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(client, { schema: wmsSchema });
    inbound = makeInboundService(db);
  });

  afterAll(async () => {
    await client.end();
  });

  /** 롤백 트랜잭션에 묶인 DbService 대역 — tx 미지정 호출도 trx 로 흡수한다. */
  function boundDbService(trx: DbTx): DbService<typeof wmsSchema> {
    return {
      db: trx,
      run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
    } as unknown as DbService<typeof wmsSchema>;
  }

  function buildPoService(trx: DbTx): PurchaseOrderService {
    const dbService = boundDbService(trx);
    const reader = new PurchaseOrderReader(dbService);
    return new PurchaseOrderService(new PurchaseOrderManager(dbService, inbound, reader), reader);
  }

  /** 라인 1개짜리 발주. 계획은 라인 실행이 만든다 — 여기서 만들지 않는다. */
  async function seedPoWithOneLine(tx: DbTx, quantity: number) {
    const suffix = randomUUID();
    const [warehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `clo-wh-${suffix.slice(0, 8)}` })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `clo-holder-${suffix.slice(0, 8)}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'clo sku', code: `CLO-${suffix}`, holderId: holder.id })
      .returning();
    const [supplier] = await tx
      .insert(wmsTables.suppliers)
      .values({ name: `clo-supplier-${suffix.slice(0, 8)}` })
      .returning();
    const [po] = await tx
      .insert(wmsTables.purchaseOrders)
      .values({
        supplierId: supplier.id,
        type: 'domestic',
        sourceWarehouseId: warehouse.id,
        destinationWarehouseId: warehouse.id,
      })
      .returning();
    await tx.insert(wmsTables.purchaseOrderLines).values({ poId: po.id, skuId: sku.id, quantity, status: 'requested' });
    return { warehouseId: warehouse.id, poId: po.id, skuId: sku.id };
  }

  /** 라인 실행이 만든 계획 아이템의 id. 한 발주에 계획은 하나뿐이다. */
  async function planItemIdOf(tx: DbTx, poId: string): Promise<string> {
    const [row] = await tx
      .select({ id: wmsTables.inboundPlanItems.id })
      .from(wmsTables.inboundPlanItems)
      .innerJoin(wmsTables.inboundPlans, eq(wmsTables.inboundPlans.id, wmsTables.inboundPlanItems.planId))
      .where(eq(wmsTables.inboundPlans.linkedPurchaseOrderId, poId))
      .limit(1);
    return row.id;
  }

  async function planStatusOf(tx: DbTx, poId: string): Promise<string> {
    const [row] = await tx
      .select({ status: wmsTables.inboundPlans.status })
      .from(wmsTables.inboundPlans)
      .where(eq(wmsTables.inboundPlans.linkedPurchaseOrderId, poId))
      .limit(1);
    return row.status;
  }

  it('전량 입고되면 계획이 닫히고 발주가 received 로 파생된다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithOneLine(trx, 10);
      const po = buildPoService(trx);
      await po.orderLine(fx.poId, fx.skuId, { orderedQty: 10 }, ACTOR, trx);

      // 라인은 전부 실행됐지만 물건은 아직 안 들어왔다.
      expect((await po.getPurchaseOrderById(fx.poId, trx)).status).toBe('confirmed');

      const itemId = await planItemIdOf(trx, fx.poId);
      await inbound.receiveFromPlan({ planItemId: itemId, quantity: 10, idempotencyKey: randomUUID() }, trx);

      expect(await planStatusOf(trx, fx.poId)).toBe('confirmed');
      expect((await po.getPurchaseOrderById(fx.poId, trx)).status).toBe('received');
    });
  });

  it('미달 입고를 잎 종결하면 발주가 received 로 파생되고 미달 사실은 남는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithOneLine(trx, 10);
      const po = buildPoService(trx);
      await po.orderLine(fx.poId, fx.skuId, { orderedQty: 10 }, ACTOR, trx);

      const itemId = await planItemIdOf(trx, fx.poId);
      await inbound.receiveFromPlan({ planItemId: itemId, quantity: 7, idempotencyKey: randomUUID() }, trx);

      // 7/10 은 종결이 아니다.
      expect(await planStatusOf(trx, fx.poId)).toBe('pending');
      expect((await po.getPurchaseOrderById(fx.poId, trx)).status).toBe('confirmed');

      await inbound.closePlanItem(itemId, { reason: '공급처 결품' }, ACTOR, trx);

      expect(await planStatusOf(trx, fx.poId)).toBe('confirmed');
      expect((await po.getPurchaseOrderById(fx.poId, trx)).status).toBe('received');

      // 미달 사실은 지워지지 않는다 — 그게 잎 종결을 고른 이유다(스펙 §2.1).
      const [item] = await trx
        .select({
          expectedQty: wmsTables.inboundPlanItems.expectedQty,
          receivedQty: wmsTables.inboundPlanItems.receivedQty,
          status: wmsTables.inboundPlanItems.status,
          closedReason: wmsTables.inboundPlanItems.closedReason,
          closedBy: wmsTables.inboundPlanItems.closedBy,
        })
        .from(wmsTables.inboundPlanItems)
        .where(eq(wmsTables.inboundPlanItems.id, itemId))
        .limit(1);
      expect(item).toMatchObject({
        expectedQty: 10,
        receivedQty: 7,
        status: 'short_closed',
        closedReason: '공급처 결품',
        closedBy: ACTOR,
      });
    });
  });

  it('이미 종결된 아이템은 다시 종결되지 않는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithOneLine(trx, 10);
      const po = buildPoService(trx);
      await po.orderLine(fx.poId, fx.skuId, { orderedQty: 10 }, ACTOR, trx);
      const itemId = await planItemIdOf(trx, fx.poId);
      await inbound.closePlanItem(itemId, { reason: '결품' }, ACTOR, trx);

      await expect(inbound.closePlanItem(itemId, { reason: '결품' }, ACTOR, trx)).rejects.toThrow(/already closed/);
    });
  });

  it('입고가 있는 발주는 취소되지 않는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithOneLine(trx, 10);
      const po = buildPoService(trx);
      await po.orderLine(fx.poId, fx.skuId, { orderedQty: 10 }, ACTOR, trx);
      const itemId = await planItemIdOf(trx, fx.poId);
      await inbound.receiveFromPlan({ planItemId: itemId, quantity: 3, idempotencyKey: randomUUID() }, trx);

      // 이미 받은 물건이 있는 발주는 취소가 아니라 잔량 포기로 닫는다.
      await expect(po.cancelPurchaseOrder(fx.poId, { reason: '오발주' }, ACTOR, trx)).rejects.toThrow(/receipts/);
    });
  });

  it('입고 전 발주는 취소되고 다시 취소되지 않는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithOneLine(trx, 10);
      const po = buildPoService(trx);

      const cancelled = await po.cancelPurchaseOrder(fx.poId, { reason: '오발주' }, ACTOR, trx);
      expect(cancelled.status).toBe('cancelled');

      await expect(po.cancelPurchaseOrder(fx.poId, { reason: '오발주' }, ACTOR, trx)).rejects.toThrow(
        /already cancelled/,
      );
    });
  });

  it('취소된 발주는 입고가 들어와도 received 로 되살아나지 않는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithOneLine(trx, 10);
      const po = buildPoService(trx);
      await po.orderLine(fx.poId, fx.skuId, { orderedQty: 10 }, ACTOR, trx);
      const itemId = await planItemIdOf(trx, fx.poId);
      await po.cancelPurchaseOrder(fx.poId, { reason: '오발주' }, ACTOR, trx);

      await inbound.receiveFromPlan({ planItemId: itemId, quantity: 10, idempotencyKey: randomUUID() }, trx);

      // 계획은 닫히지만 발주는 종결 상태 그대로다 (canDeriveReceived 의 isTerminal 가드).
      expect(await planStatusOf(trx, fx.poId)).toBe('confirmed');
      expect((await po.getPurchaseOrderById(fx.poId, trx)).status).toBe('cancelled');
    });
  });
});
