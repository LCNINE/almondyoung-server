import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import { makeDb, inRollbackTx } from '../../../fulfillment/services/__support__';
import { InboundService } from './inbound.service';
import { PurchaseOrderClosureAdapter } from '../../procurement/services/purchase-order-closure.adapter';

/**
 * 계획 생성 포트가 해외/국내 불변식을 스스로 지키는지 고정한다.
 *
 * 이 스펙이 존재하는 이유: 불변식이 `PurchaseOrderService.createInboundPlanFromPO`(자동
 * 경로)에만 있었다. 수동 API `POST /inbound/plans` 는 호출자가 넘긴 planType 을 그대로
 * 믿어서, 해외 발주에 destination 계획을 붙이면 입고예정이 2배로 잡히고 목적지에 재고를
 * 창조하면서 출발 창고를 안 깎는 이중계상이 났다.
 *
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- inbound-plan-port-invariant
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('입고 계획 포트가 불변식을 소유한다 (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  function boundDbService(trx: DbTx): DbService<typeof wmsSchema> {
    return {
      db: trx,
      run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
    } as unknown as DbService<typeof wmsSchema>;
  }

  /**
   * createInboundPlan 은 dbService 만 사용하므로, 나머지 협력자는 본문에 도달하지 않는다
   * (inbound.service.idempotency.spec.ts 와 같은 패턴).
   */
  function buildInboundService(trx: DbTx): InboundService {
    return new InboundService(
      boundDbService(trx),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      new PurchaseOrderClosureAdapter(),
    );
  }

  interface Fixture {
    poId: string;
    sourceWarehouseId: string;
    destinationWarehouseId: string;
  }

  /** 해외 발주 = 출발 창고(중국) ≠ 목적지 창고(부천). */
  async function seedForeignPo(trx: DbTx): Promise<Fixture> {
    const suffix = randomUUID().slice(0, 8);
    const [source] = await trx
      .insert(wmsTables.warehouses)
      .values({ name: `it-src-${suffix}` })
      .returning();
    const [dest] = await trx
      .insert(wmsTables.warehouses)
      .values({ name: `it-dst-${suffix}` })
      .returning();
    const [supplier] = await trx
      .insert(wmsTables.suppliers)
      .values({ name: `it-sup-${suffix}`, defaultWarehouseId: source.id })
      .returning();
    const [po] = await trx
      .insert(wmsTables.purchaseOrders)
      .values({
        type: 'foreign',
        supplierId: supplier.id,
        status: 'created',
        sourceWarehouseId: source.id,
        destinationWarehouseId: dest.id,
        requiresTransfer: true,
      })
      .returning();
    return { poId: po.id, sourceWarehouseId: source.id, destinationWarehouseId: dest.id };
  }

  it('해외 발주에 destination 계획을 요청해도 source 계획이 만들어진다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedForeignPo(trx);
      const service = buildInboundService(trx);

      // 호출자가 거짓말을 한다 — 최종 목적지를 입고 창고로, 타입을 destination 으로.
      const plan = await service.createInboundPlan(
        {
          warehouseId: fx.destinationWarehouseId,
          destinationWarehouseId: fx.destinationWarehouseId,
          linkedPurchaseOrderId: fx.poId,
          planType: 'destination',
          requiresTransfer: false,
        },
        trx,
      );

      expect(plan.planType).toBe('source');
      expect(plan.warehouseId).toBe(fx.sourceWarehouseId);
      expect(plan.destinationWarehouseId).toBe(fx.destinationWarehouseId);
      expect(plan.requiresTransfer).toBe(true);
    });
  });

  it('없는 발주를 가리키면 500 이 아니라 NotFoundError 다', async () => {
    await inRollbackTx(db, async (trx) => {
      const service = buildInboundService(trx);
      await expect(
        service.createInboundPlan(
          {
            warehouseId: randomUUID(),
            linkedPurchaseOrderId: randomUUID(),
          },
          trx,
        ),
      ).rejects.toMatchObject({ name: 'NotFoundError' });
    });
  });

  it('ensurePlanForPurchaseOrder 는 멱등하다 — 두 번 불러도 계획은 하나', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedForeignPo(trx);
      const service = buildInboundService(trx);

      const first = await service.ensurePlanForPurchaseOrder(fx.poId, trx);
      const second = await service.ensurePlanForPurchaseOrder(fx.poId, trx);

      expect(second.id).toBe(first.id);

      const plans = await trx
        .select({ id: wmsTables.inboundPlans.id })
        .from(wmsTables.inboundPlans)
        .where(eq(wmsTables.inboundPlans.linkedPurchaseOrderId, fx.poId));
      expect(plans).toHaveLength(1);
    });
  });

  it('createInboundPlan 을 같은 발주로 두 번 부르면 두 번째가 ConflictError 다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedForeignPo(trx);
      const service = buildInboundService(trx);

      await service.createInboundPlan({ linkedPurchaseOrderId: fx.poId }, trx);

      await expect(service.createInboundPlan({ linkedPurchaseOrderId: fx.poId }, trx)).rejects.toMatchObject({
        name: 'ConflictError',
      });

      const plans = await trx
        .select({ id: wmsTables.inboundPlans.id })
        .from(wmsTables.inboundPlans)
        .where(eq(wmsTables.inboundPlans.linkedPurchaseOrderId, fx.poId));
      expect(plans).toHaveLength(1);
    });
  });

  it('아이템에 품목별 예정일을 적을 수 있다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedForeignPo(trx);
      const suffix = randomUUID().slice(0, 8);
      const [holder] = await trx
        .insert(wmsTables.holders)
        .values({ name: `it-h-${suffix}` })
        .returning();
      const [sku] = await trx
        .insert(wmsTables.skus)
        .values({ name: 'it-sku', code: `IT-${randomUUID().toUpperCase()}`, holderId: holder.id })
        .returning();

      const service = buildInboundService(trx);
      const plan = await service.ensurePlanForPurchaseOrder(fx.poId, trx);
      await service.addInboundPlanItems(
        { planId: plan.id, items: [{ skuId: sku.id, expectedQty: 5, expectedDate: '2026-09-17' }] },
        trx,
      );

      const [item] = await trx
        .select({ expectedDate: wmsTables.inboundPlanItems.expectedDate })
        .from(wmsTables.inboundPlanItems)
        .where(eq(wmsTables.inboundPlanItems.planId, plan.id));
      expect(item.expectedDate).toBe('2026-09-17');
    });
  });
});
