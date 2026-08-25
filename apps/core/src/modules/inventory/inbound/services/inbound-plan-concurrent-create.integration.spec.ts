import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import { InboundService } from './inbound.service';
import { Database, makeInboundService } from './__fixtures__/inbound-harness';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/**
 * 한 발주에 입고 계획은 하나뿐이다 — **동시 생성에서도** (#724 항목 10-a).
 *
 * 이 스펙이 존재하는 이유: `createInboundPlan` 이 발주 행을 잠그지 않고 "계획 있나?" 를
 * 읽었다. 같은 PO 로 동시 `POST /inbound/plans` 2건이면 둘 다 "없음"을 보고 계획을 2행
 * 만든다 → 그 PO 전 SKU 의 `inbound_pending` 이 2배가 된다. `ensurePlanForPurchaseOrder`
 * 는 이미 `FOR UPDATE` 로 막고 있었지만 공개 API 는 그 경로를 안 거친다.
 *
 * ⚠️ **커밋형 스펙이다.** 다른 inbound 스펙들의 롤백 하네스로는 이 버그가 재현되지 않는다
 * (동시 트랜잭션이 필요하다). 선례: stocktaking-scan-product-concurrency.integration.spec.ts.
 * 그래서 시드 행을 직접 지운다.
 *
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- inbound-plan-concurrent-create
 */
describeIfDb('createInboundPlan 동시 생성 (DB integration, commit-type)', () => {
  jest.setTimeout(120_000);

  let client: postgres.Sql;
  let db: Database;
  let svc: InboundService;

  beforeAll(() => {
    // 동시 트랜잭션을 재현해야 하므로 커넥션이 여러 개 필요하다.
    client = postgres(DATABASE_URL as string, { max: 4 });
    db = drizzle(client, { schema: wmsSchema });
    svc = makeInboundService(db);
  });

  afterAll(async () => {
    await client.end();
  });

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /** Promise.withResolvers 는 이 저장소의 lib 타깃(< es2024)에 없다. */
  function deferred() {
    let resolve: () => void = () => undefined;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  async function seedPurchaseOrder() {
    const suffix = randomUUID();
    const [warehouse] = await db
      .insert(wmsTables.warehouses)
      .values({ name: `cc-wh-${suffix.slice(0, 8)}` })
      .returning();
    const [supplier] = await db
      .insert(wmsTables.suppliers)
      .values({ name: `cc-supplier-${suffix.slice(0, 8)}` })
      .returning();
    const [po] = await db
      .insert(wmsTables.purchaseOrders)
      .values({
        supplierId: supplier.id,
        type: 'domestic',
        sourceWarehouseId: warehouse.id,
        destinationWarehouseId: warehouse.id,
      })
      .returning();
    return { warehouseId: warehouse.id, supplierId: supplier.id, poId: po.id };
  }

  async function cleanup(ids: { warehouseId: string; supplierId: string; poId: string }) {
    await db.delete(wmsTables.inboundPlans).where(eq(wmsTables.inboundPlans.linkedPurchaseOrderId, ids.poId));
    await db.delete(wmsTables.purchaseOrders).where(eq(wmsTables.purchaseOrders.id, ids.poId));
    await db.delete(wmsTables.suppliers).where(eq(wmsTables.suppliers.id, ids.supplierId));
    await db.delete(wmsTables.warehouses).where(eq(wmsTables.warehouses.id, ids.warehouseId));
  }

  it('같은 발주로 동시에 두 번 생성해도 계획은 한 행뿐이다', async () => {
    const ids = await seedPurchaseOrder();
    try {
      const aHeld = deferred();
      const aEntered = deferred();

      // A: 계획을 만들고 커밋하지 않은 채 붙잡는다.
      const a = db.transaction(async (txA) => {
        await svc.createInboundPlan({ linkedPurchaseOrderId: ids.poId }, txA as unknown as DbTx);
        aEntered.resolve();
        await aHeld.promise;
      });
      await aEntered.promise;

      // B: A 가 아직 커밋하지 않은 동안 같은 발주로 들어온다.
      const b = db
        .transaction(async (txB) => svc.createInboundPlan({ linkedPurchaseOrderId: ids.poId }, txB as unknown as DbTx))
        .then(
          () => 'created' as const,
          (e: Error) => e,
        );

      // 잠금이 없으면 B 는 여기서 이미 끝나 있다(A 의 미커밋 행이 안 보이므로).
      // 잠금이 있으면 B 는 발주 행에서 막혀 있다.
      await sleep(300);
      aHeld.resolve();
      await a;

      const outcome = await b;
      expect(outcome).not.toBe('created');
      expect((outcome as Error).message).toContain('already has an inbound plan');

      const plans = await db
        .select({ id: wmsTables.inboundPlans.id })
        .from(wmsTables.inboundPlans)
        .where(eq(wmsTables.inboundPlans.linkedPurchaseOrderId, ids.poId));
      expect(plans).toHaveLength(1);
    } finally {
      await cleanup(ids);
    }
  });
});
