import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import { makeDb, inRollbackTx } from '../../../fulfillment/services/__support__';
import { PurchaseOrderService } from './purchase-order.service';
import { InboundService } from './inbound.service';
import { TransactionService } from '../../shared/services/transaction.service';
import { PurchaseOrderStatus, PurchaseOrderType } from '../dto/purchase-order.dto';
import { InboundPipelineReader } from '../../stock-projection/services/inbound-pipeline.reader';
import { WarehouseTransferReader } from '../../warehouse-transfer/services/warehouse-transfer.reader';

/**
 * 발주 라인을 하나씩 실제 발주 실행하는 경로를 고정한다.
 *
 * 실무: 발주서를 만든 뒤 직원이 라인을 하나씩 실제로 산다. 그 순간 수량·단가·도착예정일이
 * 확정되고, 아예 못 사는 라인도 생긴다. 한 라인을 나눠 사는 일은 없다(단방향 종결).
 *
 * 일괄 확정(`updatePurchaseOrderStatus(confirmed)`)도 **같은 라인 실행 경로**를 지난다.
 * 두 경로가 각자 `inbound_plan_items` 를 쓰면, 두 화면을 번갈아 쓰는 운영자에게
 * 입고예정이 두 벌로 잡힌다 — 그 사고가 이미 한 번 났다(purchase-order-single-plan 스펙).
 *
 * 단위 테스트로는 아무것도 안 잡힌다 — 전부 다중 테이블 상태 전이다.
 *
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- purchase-order-line-execution
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('발주 라인 실행 (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  const ACTOR = randomUUID();

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  /**
   * 롤백 트랜잭션에 묶인 DbService 대역. tx 미지정 호출도 trx 로 흡수해 스펙 밖으로
   * 새는 커밋을 막는다.
   */
  function boundDbService(trx: DbTx): DbService<typeof wmsSchema> {
    return {
      db: trx,
      run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
    } as unknown as DbService<typeof wmsSchema>;
  }

  /**
   * InboundService 의 나머지 협력자(5개)는 `{} as never` 로 대역한다 —
   * ensurePlanForPurchaseOrder → createInboundPlan/addInboundPlanItems 경로는
   * dbService 만 쓰므로 본문에 도달하지 않는다(purchase-order-single-plan,
   * inbound-plan-port-invariant 스펙과 같은 패턴).
   */
  function buildService(trx: DbTx): PurchaseOrderService {
    const dbService = boundDbService(trx);
    const inboundService = new InboundService(
      dbService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return new PurchaseOrderService(dbService, new TransactionService(dbService), inboundService);
  }

  interface Fixture {
    poId: string;
    warehouseId: string;
    skuIds: string[];
  }

  interface SeedOptions {
    /** 발주 헤더의 도착예정일. 라인에는 심지 않는다. */
    headerExpectedArrival?: Date;
    /** 라인마다 심을 도착예정일 (마이그레이션 백필이 만든 상태를 흉내낸다). */
    lineExpectedArrival?: string;
    /** 기본은 approved — 심사를 통과한 발주여야 라인을 실행할 수 있다. */
    auditStatus?: 'draft' | 'pending_audit' | 'approved' | 'rejected';
  }

  interface Prerequisites {
    warehouseId: string;
    supplierId: string;
    skuIds: string[];
  }

  /** 창고·공급사·SKU 3개. 발주 헤더는 심지 않는다 — 서비스로 만드는 스펙이 있다. */
  async function seedPrerequisites(trx: DbTx): Promise<Prerequisites> {
    const suffix = randomUUID().slice(0, 8);
    const [wh] = await trx
      .insert(wmsTables.warehouses)
      .values({ name: `it-wh-${suffix}` })
      .returning();
    const [supplier] = await trx
      .insert(wmsTables.suppliers)
      .values({ name: `it-sup-${suffix}`, defaultWarehouseId: wh.id })
      .returning();
    const [holder] = await trx
      .insert(wmsTables.holders)
      .values({ name: `it-h-${suffix}` })
      .returning();

    const skuIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const [sku] = await trx
        .insert(wmsTables.skus)
        .values({ name: `it-sku-${i}`, code: `IT-${randomUUID().toUpperCase()}`, holderId: holder.id })
        .returning();
      skuIds.push(sku.id);
    }
    return { warehouseId: wh.id, supplierId: supplier.id, skuIds };
  }

  /** 국내 발주(출발=목적지) + SKU 3개 라인, 각 요청 10개. */
  async function seedPoWithThreeLines(trx: DbTx, options: SeedOptions = {}): Promise<Fixture> {
    const { warehouseId, supplierId, skuIds } = await seedPrerequisites(trx);
    const wh = { id: warehouseId };

    // auditStatus 는 approved 여야 라인을 실행할 수 있다(감사 워크플로).
    const [po] = await trx
      .insert(wmsTables.purchaseOrders)
      .values({
        type: 'domestic',
        supplierId,
        status: 'created',
        auditStatus: options.auditStatus ?? 'approved',
        sourceWarehouseId: wh.id,
        destinationWarehouseId: wh.id,
        requiresTransfer: false,
        expectedArrival: options.headerExpectedArrival ?? null,
      })
      .returning();

    await trx.insert(wmsTables.purchaseOrderLines).values(
      skuIds.map((skuId) => ({
        poId: po.id,
        skuId,
        quantity: 10,
        expectedArrival: options.lineExpectedArrival ?? null,
      })),
    );

    return { poId: po.id, warehouseId: wh.id, skuIds };
  }

  interface ForeignFixture {
    poId: string;
    skuIds: string[];
    sellableWarehouseId: string;
  }

  /**
   * 해외 발주(출발=비판매 창고, 목적지=판매 창고) + SKU 3개 라인, 각 요청 10개.
   *
   * 파이프라인 ①(`InboundPipelineReader`)은 `not(inSellableWarehouse(plans.warehouseId))`
   * 로 좁혀지므로, `seedPoWithThreeLines`(출발=목적지=같은 창고)로 만든 국내 발주는
   * 그 창고가 판매 창고인 이상 절대 ①에 잡히지 않는다 — 그래서 창고를 둘로 나눈
   * 별도 헬퍼가 필요하다.
   */
  async function seedForeignPoWithThreeLines(trx: DbTx): Promise<ForeignFixture> {
    const suffix = randomUUID().slice(0, 8);
    const [source] = await trx
      .insert(wmsTables.warehouses)
      // DEFAULT is_sellable=false — 비판매 창고(중국 역할)
      .values({ name: `it-wh-src-${suffix}` })
      .returning();
    const [dest] = await trx
      .insert(wmsTables.warehouses)
      .values({ name: `it-wh-dst-${suffix}`, isSellable: true }) // 판매 창고(부천 역할)
      .returning();
    const [supplier] = await trx
      .insert(wmsTables.suppliers)
      .values({ name: `it-sup-${suffix}`, defaultWarehouseId: source.id })
      .returning();
    const [holder] = await trx
      .insert(wmsTables.holders)
      .values({ name: `it-h-${suffix}` })
      .returning();

    const skuIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const [sku] = await trx
        .insert(wmsTables.skus)
        .values({ name: `it-sku-${i}`, code: `IT-${randomUUID().toUpperCase()}`, holderId: holder.id })
        .returning();
      skuIds.push(sku.id);
    }

    // auditStatus 는 approved 여야 라인을 실행할 수 있다(감사 워크플로).
    const [po] = await trx
      .insert(wmsTables.purchaseOrders)
      .values({
        type: 'foreign',
        supplierId: supplier.id,
        status: 'created',
        auditStatus: 'approved',
        sourceWarehouseId: source.id,
        destinationWarehouseId: dest.id,
        requiresTransfer: true,
      })
      .returning();

    await trx
      .insert(wmsTables.purchaseOrderLines)
      .values(skuIds.map((skuId) => ({ poId: po.id, skuId, quantity: 10 })));

    return { poId: po.id, skuIds, sellableWarehouseId: dest.id };
  }

  async function readLine(trx: DbTx, poId: string, skuId: string) {
    const [row] = await trx
      .select({
        status: wmsTables.purchaseOrderLines.status,
        quantity: wmsTables.purchaseOrderLines.quantity,
        orderedQty: wmsTables.purchaseOrderLines.orderedQty,
        unitPrice: wmsTables.purchaseOrderLines.unitPrice,
        expectedArrival: wmsTables.purchaseOrderLines.expectedArrival,
        orderedBy: wmsTables.purchaseOrderLines.orderedBy,
        unavailableReason: wmsTables.purchaseOrderLines.unavailableReason,
      })
      .from(wmsTables.purchaseOrderLines)
      .where(and(eq(wmsTables.purchaseOrderLines.poId, poId), eq(wmsTables.purchaseOrderLines.skuId, skuId)));
    return row;
  }

  async function readHeaderStatus(trx: DbTx, poId: string): Promise<string> {
    const [row] = await trx
      .select({ status: wmsTables.purchaseOrders.status })
      .from(wmsTables.purchaseOrders)
      .where(eq(wmsTables.purchaseOrders.id, poId));
    return row.status;
  }

  async function readPlans(trx: DbTx, poId: string) {
    return trx
      .select({ id: wmsTables.inboundPlans.id, expectedDate: wmsTables.inboundPlans.expectedDate })
      .from(wmsTables.inboundPlans)
      .where(eq(wmsTables.inboundPlans.linkedPurchaseOrderId, poId));
  }

  async function readPlanItems(trx: DbTx, poId: string) {
    return trx
      .select({
        skuId: wmsTables.inboundPlanItems.skuId,
        expectedQty: wmsTables.inboundPlanItems.expectedQty,
        expectedDate: wmsTables.inboundPlanItems.expectedDate,
      })
      .from(wmsTables.inboundPlanItems)
      .innerJoin(wmsTables.inboundPlans, eq(wmsTables.inboundPlanItems.planId, wmsTables.inboundPlans.id))
      .where(eq(wmsTables.inboundPlans.linkedPurchaseOrderId, poId));
  }

  it('발주서를 만들기만 하면 계획이 없다 — 아직 아무것도 주문 안 했다', async () => {
    await inRollbackTx(db, async (trx) => {
      // 발주서를 **서비스로** 만든다. 픽스처를 raw insert 로 심으면 누가
      // createPurchaseOrder 에 계획 생성을 도로 넣어도 이 스펙이 빨개지지 않는다.
      const { warehouseId, supplierId, skuIds } = await seedPrerequisites(trx);
      const created = await buildService(trx).createPurchaseOrder(
        {
          type: PurchaseOrderType.DOMESTIC,
          supplierId,
          destinationWarehouseId: warehouseId,
          lines: skuIds.map((skuId) => ({ skuId, quantity: 10 })),
        },
        trx,
      );

      expect(await readPlans(trx, created.id)).toHaveLength(0);
    });
  });

  it('심사를 통과하지 않은 발주는 라인 실행을 거부한다', async () => {
    await inRollbackTx(db, async (trx) => {
      // 라인별 실행이 심사 게이트를 우회하면, draft 발주를 라인 하나씩 전부 실행해
      // 헤더를 confirmed 로 만들 수 있다 — PUT /:id/status 는 같은 발주를 거부하는데.
      const fx = await seedPoWithThreeLines(trx, { auditStatus: 'draft' });
      const service = buildService(trx);

      await expect(service.orderLine(fx.poId, fx.skuIds[0], { orderedQty: 6 }, ACTOR, trx)).rejects.toMatchObject({
        name: 'BadRequestError',
      });
      await expect(service.markLineUnavailable(fx.poId, fx.skuIds[0], {}, ACTOR, trx)).rejects.toMatchObject({
        name: 'BadRequestError',
      });
      expect(await readLine(trx, fx.poId, fx.skuIds[0])).toMatchObject({ status: 'requested' });
      expect(await readPlans(trx, fx.poId)).toHaveLength(0);
    });
  });

  it('이미 received 인 발주는 라인 실행을 거부한다', async () => {
    await inRollbackTx(db, async (trx) => {
      // received 는 입고 경로가 소유한 종결 상태다. auditStatus 검사만으로는 이걸
      // 못 막는다 — received 로 넘어간 뒤에도 auditStatus 는 여전히 approved 이므로
      // 라인 실행이 통과해 계획에 아이템을 더 붙이고 inbound_pending_qty 를 부풀린다.
      // refreshHeaderStatus 는 header.status === 'received' 를 보면 일찍 반환하므로
      // 그 뒤로는 아무것도 이 상태를 되돌리지 못한다.
      const fx = await seedPoWithThreeLines(trx);
      await trx
        .update(wmsTables.purchaseOrders)
        .set({ status: 'received' })
        .where(eq(wmsTables.purchaseOrders.id, fx.poId));
      const service = buildService(trx);

      await expect(service.orderLine(fx.poId, fx.skuIds[0], { orderedQty: 6 }, ACTOR, trx)).rejects.toMatchObject({
        name: 'BadRequestError',
      });
      await expect(service.markLineUnavailable(fx.poId, fx.skuIds[0], {}, ACTOR, trx)).rejects.toMatchObject({
        name: 'BadRequestError',
      });
      expect(await readLine(trx, fx.poId, fx.skuIds[0])).toMatchObject({ status: 'requested' });
      expect(await readPlans(trx, fx.poId)).toHaveLength(0);
    });
  });

  it('라인 실행이 요청과 다른 수량·단가·ETA 를 기록한다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      await buildService(trx).orderLine(
        fx.poId,
        fx.skuIds[0],
        { orderedQty: 6, unitPrice: 1200, expectedArrival: '2026-09-17' },
        ACTOR,
        trx,
      );

      expect(await readLine(trx, fx.poId, fx.skuIds[0])).toMatchObject({
        status: 'ordered',
        quantity: 10, // 요청은 그대로 남는다
        orderedQty: 6,
        unitPrice: 1200,
        expectedArrival: '2026-09-17',
        orderedBy: ACTOR,
      });
    });
  });

  it('계획은 첫 실행에서 한 번만 생기고, 이후 라인은 아이템으로 붙는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      const service = buildService(trx);
      await service.orderLine(fx.poId, fx.skuIds[0], { orderedQty: 6, expectedArrival: '2026-09-17' }, ACTOR, trx);
      await service.orderLine(fx.poId, fx.skuIds[1], { orderedQty: 10 }, ACTOR, trx);

      expect(await readPlans(trx, fx.poId)).toHaveLength(1);

      const items = await readPlanItems(trx, fx.poId);
      expect(items).toHaveLength(2);
      // 계획에 잡히는 것은 요청(10)이 아니라 실발주(6)다.
      expect(items.find((i) => i.skuId === fx.skuIds[0])?.expectedQty).toBe(6);
      expect(items.find((i) => i.skuId === fx.skuIds[1])?.expectedQty).toBe(10);
      // 라인이 확정한 날짜가 아이템에도 실린다 — 파이프라인 ETA 의 진실은 아이템이다.
      expect(items.find((i) => i.skuId === fx.skuIds[0])?.expectedDate).toBe('2026-09-17');
    });
  });

  it('발주불가 라인은 계획에 아무것도 남기지 않는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      await buildService(trx).markLineUnavailable(fx.poId, fx.skuIds[0], { reason: '품절' }, ACTOR, trx);

      expect(await readLine(trx, fx.poId, fx.skuIds[0])).toMatchObject({
        status: 'unavailable',
        orderedQty: null,
        unavailableReason: '품절',
        orderedBy: ACTOR,
      });
      expect(await readPlans(trx, fx.poId)).toHaveLength(0);
    });
  });

  it('종결된 라인은 재실행도 번복도 안 된다 (단방향)', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      const service = buildService(trx);
      await service.orderLine(fx.poId, fx.skuIds[0], { orderedQty: 6 }, ACTOR, trx);

      await expect(service.orderLine(fx.poId, fx.skuIds[0], { orderedQty: 4 }, ACTOR, trx)).rejects.toMatchObject({
        name: 'ConflictError',
      });
      await expect(service.markLineUnavailable(fx.poId, fx.skuIds[0], {}, ACTOR, trx)).rejects.toMatchObject({
        name: 'ConflictError',
      });
    });
  });

  it('없는 라인은 404 다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      await expect(
        buildService(trx).orderLine(fx.poId, randomUUID(), { orderedQty: 1 }, ACTOR, trx),
      ).rejects.toMatchObject({ name: 'NotFoundError' });
    });
  });

  it('실발주 수량 0 은 거부된다 — unavailable 과 의미가 겹친다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      await expect(
        buildService(trx).orderLine(fx.poId, fx.skuIds[0], { orderedQty: 0 }, ACTOR, trx),
      ).rejects.toMatchObject({ name: 'BadRequestError' });
    });
  });

  it('헤더 상태는 라인에서 파생된다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      const service = buildService(trx);

      await service.orderLine(fx.poId, fx.skuIds[0], { orderedQty: 6 }, ACTOR, trx);
      expect(await readHeaderStatus(trx, fx.poId)).toBe('created'); // 아직 requested 가 남았다

      await service.orderLine(fx.poId, fx.skuIds[1], { orderedQty: 10 }, ACTOR, trx);
      await service.markLineUnavailable(fx.poId, fx.skuIds[2], {}, ACTOR, trx);
      expect(await readHeaderStatus(trx, fx.poId)).toBe('confirmed'); // 전부 종결
    });
  });

  it('실행이 물려받은 도착예정일을 지우지 않는다', async () => {
    await inRollbackTx(db, async (trx) => {
      // 마이그레이션 백필이 헤더 날짜를 라인에 심어둔 상태 — 실행자가 새 날짜를 안 주면
      // 그 값이 진실이다. `?? null` 로 덮으면 살아있는 ETA 가 조용히 사라진다.
      const fx = await seedPoWithThreeLines(trx, { lineExpectedArrival: '2026-09-15' });
      await buildService(trx).orderLine(fx.poId, fx.skuIds[0], { orderedQty: 6 }, ACTOR, trx);

      expect(await readLine(trx, fx.poId, fx.skuIds[0])).toMatchObject({ expectedArrival: '2026-09-15' });
      const items = await readPlanItems(trx, fx.poId);
      expect(items[0].expectedDate).toBe('2026-09-15');
    });
  });

  it('라인별 실행이 첫 계획을 만들 때도 헤더 도착예정일을 씨드로 쓴다', async () => {
    await inRollbackTx(db, async (trx) => {
      // 헤더에는 도착예정일이 있지만 라인에는 없다 — 일괄 확정 경로(§4)와 달리
      // 라인별 실행은 계획 생성 시 헤더 날짜를 무시하고 라인의(여기선 없는) ETA 만
      // 넘겼었다. 그러면 이 계획은 expected_date NULL 로 태어나
      // GET /inbound/plan-items?startDate=… 필터에서 통째로 빠진다.
      const fx = await seedPoWithThreeLines(trx, { headerExpectedArrival: new Date('2026-11-11T00:00:00Z') });
      await buildService(trx).orderLine(fx.poId, fx.skuIds[0], { orderedQty: 6 }, ACTOR, trx);

      const plans = await readPlans(trx, fx.poId);
      expect(plans).toHaveLength(1);
      expect(plans[0].expectedDate?.toISOString().slice(0, 10)).toBe('2026-11-11');
    });
  });

  it('일괄 확정도 라인 실행 경로를 지난다 — 라인이 ordered 가 되고 실행자가 남는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      await buildService(trx).updatePurchaseOrderStatus(fx.poId, { status: PurchaseOrderStatus.CONFIRMED }, ACTOR, trx);

      for (const skuId of fx.skuIds) {
        expect(await readLine(trx, fx.poId, skuId)).toMatchObject({
          status: 'ordered',
          orderedQty: 10, // 일괄 확정은 요청 수량 그대로 발주한 것으로 본다
          orderedBy: ACTOR,
        });
      }
      expect(await readPlanItems(trx, fx.poId)).toHaveLength(3);
      expect(await readHeaderStatus(trx, fx.poId)).toBe('confirmed');
    });
  });

  it('라인을 하나 실행한 뒤 일괄 확정해도 아이템은 라인당 하나다 (두 writer 제거)', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      const service = buildService(trx);
      await service.orderLine(fx.poId, fx.skuIds[0], { orderedQty: 6 }, ACTOR, trx);

      await service.updatePurchaseOrderStatus(fx.poId, { status: PurchaseOrderStatus.CONFIRMED }, ACTOR, trx);

      const items = await readPlanItems(trx, fx.poId);
      // 옛 경로는 확정 시 라인 전체를 다시 꽂아 sku[0] 이 6 + 10 두 행이 됐다.
      expect(items).toHaveLength(3);
      expect(items.find((i) => i.skuId === fx.skuIds[0])?.expectedQty).toBe(6);
    });
  });

  it('이미 입고된 발주를 다시 confirmed 로 불러도 아이템이 늘지 않는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      const service = buildService(trx);
      await service.updatePurchaseOrderStatus(fx.poId, { status: PurchaseOrderStatus.CONFIRMED }, ACTOR, trx);

      // 입고가 끝나 received 로 넘어간 상태를 만든다.
      await trx
        .update(wmsTables.purchaseOrders)
        .set({ status: 'received' })
        .where(eq(wmsTables.purchaseOrders.id, fx.poId));

      // 옛 가드는 `status !== 'confirmed'` 였다 — received 는 그 조건을 통과해
      // 이미 처리된 계획에 라인을 한 벌 더 꽂았다.
      await service.updatePurchaseOrderStatus(fx.poId, { status: PurchaseOrderStatus.CONFIRMED }, ACTOR, trx);

      expect(await readPlanItems(trx, fx.poId)).toHaveLength(3);
    });
  });

  it('라인별 날짜가 없어도 헤더 날짜가 계획에 실린다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithThreeLines(trx, { headerExpectedArrival: new Date('2026-11-11T00:00:00Z') });
      await buildService(trx).updatePurchaseOrderStatus(fx.poId, { status: PurchaseOrderStatus.CONFIRMED }, ACTOR, trx);

      const plans = await readPlans(trx, fx.poId);
      expect(plans).toHaveLength(1);
      // 라인 실행에만 계획 생성을 맡기면 여기가 null 이 된다 — 오늘보다 나빠진다.
      expect(plans[0].expectedDate?.toISOString().slice(0, 10)).toBe('2026-11-11');
    });
  });

  it('확정 요청의 새 도착예정일이 계획·아이템·라인에 모두 실린다', async () => {
    await inRollbackTx(db, async (trx) => {
      // 백필이 심어둔 옛 날짜를 라인이 들고 있다. 확정 요청이 새 날짜를 실으면 그게
      // 진실이다 — 아이템이 옛 날짜를 붙들면 파이프라인 ETA(아이템 우선)가 방금
      // 바꾼 날짜를 무시하고 옛 날짜를 보여준다.
      const fx = await seedPoWithThreeLines(trx, {
        headerExpectedArrival: new Date('2026-09-15T00:00:00Z'),
        lineExpectedArrival: '2026-09-15',
      });
      await buildService(trx).updatePurchaseOrderStatus(
        fx.poId,
        { status: PurchaseOrderStatus.CONFIRMED, expectedArrival: '2026-12-25' },
        ACTOR,
        trx,
      );

      const plans = await readPlans(trx, fx.poId);
      expect(plans[0].expectedDate?.toISOString().slice(0, 10)).toBe('2026-12-25');
      for (const item of await readPlanItems(trx, fx.poId)) {
        expect(item.expectedDate).toBe('2026-12-25');
      }
      for (const skuId of fx.skuIds) {
        expect(await readLine(trx, fx.poId, skuId)).toMatchObject({ expectedArrival: '2026-12-25' });
      }
    });
  });

  it('오프셋이 붙은 확정 날짜도 달력 하루가 밀리지 않는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      // `@IsDateString()` 은 오프셋이 붙은 값을 통과시킨다. new Date(...).toISOString()
      // 을 거치면 '2026-08-25' 가 되어 달력 하루가 밀린다 — 날짜 부분만 잘라 쓴다.
      await buildService(trx).updatePurchaseOrderStatus(
        fx.poId,
        { status: PurchaseOrderStatus.CONFIRMED, expectedArrival: '2026-08-26T00:00:00+09:00' },
        ACTOR,
        trx,
      );

      const plans = await readPlans(trx, fx.poId);
      expect(plans[0].expectedDate?.toISOString().slice(0, 10)).toBe('2026-08-26');
      for (const item of await readPlanItems(trx, fx.poId)) {
        expect(item.expectedDate).toBe('2026-08-26');
      }
      for (const skuId of fx.skuIds) {
        expect(await readLine(trx, fx.poId, skuId)).toMatchObject({ expectedArrival: '2026-08-26' });
      }
      // 헤더 컬럼도 같은 달력 날짜다. 여기만 오프셋 원본을 저장하면 다음 확정의 폴백이
      // 하루 밀린 값을 읽어 계획·라인까지 드리프트를 퍼뜨린다.
      const [header] = await trx
        .select({ expectedArrival: wmsTables.purchaseOrders.expectedArrival })
        .from(wmsTables.purchaseOrders)
        .where(eq(wmsTables.purchaseOrders.id, fx.poId));
      expect(header.expectedArrival?.toISOString().slice(0, 10)).toBe('2026-08-26');
    });
  });

  it('전 라인이 발주불가면 빈 계획을 만들지 않는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      const service = buildService(trx);
      for (const skuId of fx.skuIds) {
        await service.markLineUnavailable(fx.poId, skuId, { reason: '품절' }, ACTOR, trx);
      }

      // 실행할 라인이 하나도 없다 — 아이템 0개짜리 계획 행은 입고 화면의 유령이다.
      await service.updatePurchaseOrderStatus(fx.poId, { status: PurchaseOrderStatus.CONFIRMED }, ACTOR, trx);

      expect(await readPlans(trx, fx.poId)).toHaveLength(0);
    });
  });

  // 이 자리에 있던 "종결된 라인이 하나라도 있으면 라인 일괄 수정을 거부한다" 테스트는
  // 지웠다 — 그건 라인 생명주기가 생기기 전, 이 태스크가 오기 전까지의 임시 조치
  // (거친 가드: 종결 라인이 하나라도 있으면 통째로 거부)를 고정하던 테스트였다. 이제
  // 그 가드는 "종결 라인은 건드리지 않고 요청 라인만 갈아끼운다"는 촘촘한 규칙으로
  // 바뀌었으므로 더 이상 거부하지 않는다. 아래 두 테스트가 새 규칙을 고정한다.

  it('부분 실행이 파이프라인 ①에 실발주분만큼만 나타난다', async () => {
    await inRollbackTx(db, async (trx) => {
      // 해외 발주: 출발=중국(비판매) ≠ 목적지=부천(판매)
      const fx = await seedForeignPoWithThreeLines(trx);
      const service = buildService(trx);
      const dbService = boundDbService(trx);
      const reader = new InboundPipelineReader(dbService, new WarehouseTransferReader(dbService));

      await service.orderLine(fx.poId, fx.skuIds[0], { orderedQty: 6 }, ACTOR, trx); // 요청 10 → 6개만
      await service.markLineUnavailable(fx.poId, fx.skuIds[1], { reason: '품절' }, ACTOR, trx);
      // fx.skuIds[2] 는 손대지 않는다 (아직 requested)

      const rows = await reader.read(trx, { skuIds: fx.skuIds, toWarehouseId: fx.sellableWarehouseId });
      const bySku = new Map(rows.map((r) => [r.skuId, r]));

      expect(bySku.get(fx.skuIds[0])?.onOrderQty).toBe(6); // 요청 10 이 아니라 실발주 6
      expect(bySku.get(fx.skuIds[1])?.onOrderQty).toBe(0); // 발주불가는 세지 않는다
      expect(bySku.get(fx.skuIds[2])?.onOrderQty).toBe(0); // 아직 주문 안 함 = 안 보인다
    });
  });

  it('라인 수정은 아직 실행 안 된 라인만 건드린다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      const service = buildService(trx);
      await service.orderLine(fx.poId, fx.skuIds[0], { orderedQty: 6 }, ACTOR, trx);

      // 세 라인 전부를 수량 99 로 바꾸려 시도한다.
      await service.updatePurchaseOrderLines(
        fx.poId,
        { lines: fx.skuIds.map((skuId) => ({ skuId, quantity: 99 })) },
        trx,
      );

      // 실행된 라인은 요청 수량도 실발주 수량도 그대로다.
      expect(await readLine(trx, fx.poId, fx.skuIds[0])).toMatchObject({
        status: 'ordered',
        quantity: 10,
        orderedQty: 6,
      });
      // 아직 요청 상태인 라인은 바뀐다.
      expect(await readLine(trx, fx.poId, fx.skuIds[1])).toMatchObject({ status: 'requested', quantity: 99 });
    });
  });

  it('라인 수정이 이미 붙은 계획 아이템을 늘리지 않는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      const service = buildService(trx);
      // 세 라인을 전부 실행해 헤더가 실제로 confirmed 에 닿게 한다 — 옛
      // syncInboundPlanItems 호출은 `po.status === 'confirmed'` 일 때만 돌았다.
      // 하나만 실행하면(헤더가 created 에 머무르면) 그 분기 자체가 안 돌아서,
      // 이 테스트가 정작 잡아야 할 결함(진단 문서 ④)을 전혀 검증하지 못한 채
      // 통과해버린다.
      await service.orderLine(fx.poId, fx.skuIds[0], { orderedQty: 6 }, ACTOR, trx);
      await service.orderLine(fx.poId, fx.skuIds[1], { orderedQty: 8 }, ACTOR, trx);
      await service.orderLine(fx.poId, fx.skuIds[2], { orderedQty: 3 }, ACTOR, trx);
      expect(await readHeaderStatus(trx, fx.poId)).toBe('confirmed');

      await service.updatePurchaseOrderLines(
        fx.poId,
        { lines: fx.skuIds.map((skuId) => ({ skuId, quantity: 99 })) },
        trx,
      );

      const items = await readPlanItems(trx, fx.poId);
      expect(items).toHaveLength(3); // 실행된 라인 셋 그대로. 재삽입 없음.
      // 개수만 보면 옛 버그도 우연히 통과한다 — pending 아이템 3개를 지우고 요청
      // 수량(99)으로 3개를 다시 꽂아도 개수는 3 그대로다. 합계까지 봐야 "재삽입
      // 없음"이 실제로 증명된다: 옛 코드라면 합계가 6+8+3=17 이 아니라 99*3=297 이 된다.
      expect(items.reduce((sum, i) => sum + i.expectedQty, 0)).toBe(6 + 8 + 3);
    });
  });

  it('라인 수정으로 새 requested 라인을 더하면 확정된 헤더가 다시 created 로 내려간다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      const service = buildService(trx);
      // 세 라인을 전부 실행해 헤더를 confirmed 로 만든다.
      await service.orderLine(fx.poId, fx.skuIds[0], { orderedQty: 10 }, ACTOR, trx);
      await service.orderLine(fx.poId, fx.skuIds[1], { orderedQty: 10 }, ACTOR, trx);
      await service.orderLine(fx.poId, fx.skuIds[2], { orderedQty: 10 }, ACTOR, trx);
      expect(await readHeaderStatus(trx, fx.poId)).toBe('confirmed');

      const newSkuId = randomUUID();
      // 신규 SKU 는 실제 존재해야 FK 를 만족한다 — 최소한으로 하나 심는다.
      const [holder] = await trx
        .select({ id: wmsTables.holders.id })
        .from(wmsTables.holders)
        .innerJoin(wmsTables.skus, eq(wmsTables.skus.holderId, wmsTables.holders.id))
        .where(eq(wmsTables.skus.id, fx.skuIds[0]))
        .limit(1);
      const [newSku] = await trx
        .insert(wmsTables.skus)
        .values({ id: newSkuId, name: 'it-sku-new', code: `IT-${randomUUID().toUpperCase()}`, holderId: holder.id })
        .returning();

      // 기존 세 라인(전부 종결) + 신규 requested 라인 하나를 요청한다.
      await service.updatePurchaseOrderLines(
        fx.poId,
        {
          lines: [...fx.skuIds.map((skuId) => ({ skuId, quantity: 10 })), { skuId: newSku.id, quantity: 5 }],
        },
        trx,
      );

      expect(await readHeaderStatus(trx, fx.poId)).toBe('created'); // 새 requested 라인이 되돌렸다
      expect(await readLine(trx, fx.poId, newSku.id)).toMatchObject({ status: 'requested', quantity: 5 });
      // 종결된 라인 셋은 그대로 남아 있다.
      for (const skuId of fx.skuIds) {
        expect(await readLine(trx, fx.poId, skuId)).toMatchObject({ status: 'ordered', orderedQty: 10 });
      }
    });
  });

  it('라인 수정이 아직 requested 인 채로 목록에서 빠진 라인을 지운다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      const service = buildService(trx);
      await service.orderLine(fx.poId, fx.skuIds[0], { orderedQty: 6 }, ACTOR, trx);

      // skuIds[1] 을 목록에서 빼고 요청한다 — 아직 requested 이므로 편집 대상이고,
      // 빠졌다는 건 그 라인을 없애 달라는 뜻이다.
      await service.updatePurchaseOrderLines(fx.poId, { lines: [{ skuId: fx.skuIds[2], quantity: 20 }] }, trx);

      expect(await readLine(trx, fx.poId, fx.skuIds[1])).toBeUndefined();
      // 종결 라인은 목록에서 빠져도 살아남는다.
      expect(await readLine(trx, fx.poId, fx.skuIds[0])).toMatchObject({ status: 'ordered', orderedQty: 6 });
      expect(await readLine(trx, fx.poId, fx.skuIds[2])).toMatchObject({ status: 'requested', quantity: 20 });
    });
  });

  it('응답이 심사 상태와 라인 실행 정보를 싣는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      const response = await buildService(trx).orderLine(
        fx.poId,
        fx.skuIds[0],
        { orderedQty: 6, expectedArrival: '2026-09-17' },
        ACTOR,
        trx,
      );

      expect(response.auditStatus).toBe('approved');
      const executed = response.lines.find((l) => l.skuId === fx.skuIds[0]);
      expect(executed).toMatchObject({
        status: 'ordered',
        quantity: 10,
        orderedQty: 6,
        expectedArrival: '2026-09-17',
      });
      const untouched = response.lines.find((l) => l.skuId === fx.skuIds[1]);
      expect(untouched).toMatchObject({ status: 'requested', orderedQty: null });
    });
  });
});
