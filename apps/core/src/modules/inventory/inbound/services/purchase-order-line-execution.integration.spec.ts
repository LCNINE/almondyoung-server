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
  function buildInboundService(trx: DbTx): InboundService {
    return new InboundService(boundDbService(trx), {} as never, {} as never, {} as never, {} as never, {} as never);
  }

  function buildService(trx: DbTx): PurchaseOrderService {
    const dbService = boundDbService(trx);
    return new PurchaseOrderService(dbService, new TransactionService(dbService), buildInboundService(trx));
  }

  interface Fixture {
    poId: string;
    warehouseId: string;
    skuIds: string[];
  }

  interface SeedOptions {
    /** 라인마다 심을 도착예정일. 예정일은 헤더가 아니라 라인이 갖는다(#724 항목 9). */
    lineExpectedArrival?: string;
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

    const [po] = await trx
      .insert(wmsTables.purchaseOrders)
      .values({
        type: 'domestic',
        supplierId,
        status: 'created',
        sourceWarehouseId: wh.id,
        destinationWarehouseId: wh.id,
        requiresTransfer: false,
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
      .select({ id: wmsTables.inboundPlans.id })
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

  it('심사 축이 없으므로 draft 발주도 라인을 실행할 수 있다', async () => {
    await inRollbackTx(db, async (trx) => {
      // D1=(b) 로 심사 워크플로를 제거했다(#724 항목 3). 예전에는 이 자리에
      // "draft 면 BadRequestError" 를 고정하는 케이스가 있었다 — 그 계약은 없다.
      const fx = await seedPoWithThreeLines(trx);
      const service = buildService(trx);

      await service.orderLine(fx.poId, fx.skuIds[0], { orderedQty: 6 }, ACTOR, trx);

      expect(await readLine(trx, fx.poId, fx.skuIds[0])).toMatchObject({ status: 'ordered', orderedQty: 6 });
      expect(await readPlans(trx, fx.poId)).toHaveLength(1);
    });
  });

  it('이미 received 인 발주는 라인 실행을 거부한다', async () => {
    await inRollbackTx(db, async (trx) => {
      // received 는 입고 경로가 소유한 종결 상태다. 라인 실행 경로가 이걸 막지 않으면
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

  it('입고예정 기간 필터가 아이템 예정일을 본다', async () => {
    await inRollbackTx(db, async (trx) => {
      // 계획은 날짜를 갖지 않는다. 라인마다 ETA 가 다른데 계획 단위 컬럼으로 거르면
      // 한 계획 안의 아이템이 전부 같이 걸리거나 같이 빠진다 — 이 API 의 요약이
      // "헤더 무시, 아이템 기준" 인데도 그랬다.
      const fx = await seedPoWithThreeLines(trx);
      const service = buildService(trx);
      await service.orderLine(fx.poId, fx.skuIds[0], { orderedQty: 6, expectedArrival: '2026-11-11' }, ACTOR, trx);
      await service.orderLine(fx.poId, fx.skuIds[1], { orderedQty: 6, expectedArrival: '2026-12-25' }, ACTOR, trx);

      const november = await buildInboundService(trx).listInboundPlanItems(
        { startDate: '2026-11-01', endDate: '2026-11-30' },
        trx,
      );

      expect(november.items).toHaveLength(1);
      expect(november.items[0].skuId).toBe(fx.skuIds[0]);
      expect(november.items[0].expectedDate).toBe('2026-11-11');
    });
  });

  it('발주서 생성의 도착예정일이 모든 라인에 심긴다', async () => {
    await inRollbackTx(db, async (trx) => {
      // seedPrerequisites 의 공급사는 이 창고를 기본 창고로 갖는다 = 국내 발주(출발＝목적지).
      const { warehouseId, supplierId, skuIds } = await seedPrerequisites(trx);

      const created = await buildService(trx).createPurchaseOrder(
        {
          type: PurchaseOrderType.DOMESTIC,
          supplierId,
          destinationWarehouseId: warehouseId,
          expectedArrival: '2026-11-03',
          lines: skuIds.map((skuId) => ({ skuId, quantity: 10 })),
        },
        trx,
      );

      expect(created.lines).toHaveLength(3);
      created.lines.forEach((line) => expect(line.expectedArrival).toBe('2026-11-03'));
      // 헤더 값은 **실발주된 라인**에서만 파생된다. 아직 한 라인도 실행 안 했으므로
      // 라인이 계획상 날짜를 들고 있어도 헤더는 비어 있다 — 입고 계획이 아직 없는 것과
      // 같은 상태를 말해야 한다(purchaseOrderExpectedArrival docstring).
      expect(created.expectedArrival).toBeNull();
    });
  });

  it('헤더 도착예정일은 실발주된 라인 중 가장 이른 날짜다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      const service = buildService(trx);

      await service.orderLine(fx.poId, fx.skuIds[0], { orderedQty: 10, expectedArrival: '2026-12-01' }, ACTOR, trx);
      await service.orderLine(fx.poId, fx.skuIds[1], { orderedQty: 10, expectedArrival: '2026-09-15' }, ACTOR, trx);
      const result = await service.orderLine(
        fx.poId,
        fx.skuIds[2],
        { orderedQty: 10, expectedArrival: '2026-10-20' },
        ACTOR,
        trx,
      );

      expect(result.expectedArrival?.toISOString()).toBe('2026-09-15T00:00:00.000Z');
    });
  });

  /**
   * dev 스모크(2026-08-26)에서 잡힌 실제 발주(`0e687ae7…`)를 그대로 고정한다.
   *
   * 발주 목록·상세는 「2026-09-15」를, 입고 대기는 「2026-10-01」을 말했다. 09-15 는
   * **단종되어 구매 불가**로 종결된 라인이 들고 있던 날짜다 — 영영 안 오는 물건의
   * 예정일이 발주 전체의 입고 예정일 행세를 했다. 입고 계획 쪽은 애초에 불가 라인을
   * 아이템으로 안 만들어서 맞게 나왔다.
   */
  it('발주불가 라인의 예정일은 헤더 도착예정일에 들어가지 않는다', async () => {
    await inRollbackTx(db, async (trx) => {
      // 세 라인 모두 생성 시 예정일 2026-09-15 를 물려받는다.
      const fx = await seedPoWithThreeLines(trx, { lineExpectedArrival: '2026-09-15' });
      const service = buildService(trx);

      // 요청 10 → 실발주 6, 실제 도착은 10-01
      await service.orderLine(fx.poId, fx.skuIds[0], { orderedQty: 6, expectedArrival: '2026-10-01' }, ACTOR, trx);
      // 단종 — 09-15 를 든 채 종결된다
      await service.markLineUnavailable(fx.poId, fx.skuIds[1], { reason: '단종되어 구매 불가' }, ACTOR, trx);
      const result = await service.orderLine(
        fx.poId,
        fx.skuIds[2],
        { orderedQty: 30, expectedArrival: '2026-11-01' },
        ACTOR,
        trx,
      );

      // 불가 라인은 09-15 를 그대로 들고 있다 — 지운 게 아니라 헤더 산식에서 뺀 것이다.
      expect(result.lines.find((line) => line.skuId === fx.skuIds[1])).toMatchObject({
        status: 'unavailable',
        expectedArrival: '2026-09-15',
      });
      expect(result.expectedArrival?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    });
  });

  /**
   * 위 불일치를 구조적으로 막는다. 헤더 도착예정일과 입고 계획 예정일은 **같은 발주에
   * 대해 같은 날짜**여야 한다 — 운영자가 발주 목록과 입고 대기를 번갈아 보기 때문이다.
   *
   * 두 값을 각각 손으로 계산해 비교하지 않는다. 실제 두 화면이 부르는 서비스 메서드의
   * 응답끼리 맞춘다. 한쪽 산식만 바꾸면 여기가 빨개진다.
   */
  it('헤더 도착예정일이 그 발주에서 파생된 입고 계획의 예정일과 같다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithThreeLines(trx, { lineExpectedArrival: '2026-09-15' });
      const service = buildService(trx);

      await service.orderLine(fx.poId, fx.skuIds[0], { orderedQty: 6, expectedArrival: '2026-10-01' }, ACTOR, trx);
      await service.markLineUnavailable(fx.poId, fx.skuIds[1], { reason: '단종되어 구매 불가' }, ACTOR, trx);
      const header = await service.orderLine(
        fx.poId,
        fx.skuIds[2],
        { orderedQty: 30, expectedArrival: '2026-11-01' },
        ACTOR,
        trx,
      );

      const pending = await buildInboundService(trx).getInboundPending(fx.warehouseId, trx);
      const plan = pending.pendingPlans.find((p) => p.purchaseOrder?.id === fx.poId);

      expect(plan).toBeDefined();
      expect(header.expectedArrival?.toISOString()).toBe(plan?.expectedDate?.toISOString());
      // 미입고 수량도 실발주분만 센다 — 불가 처리한 요청분은 빠진다.
      expect(plan?.totalPendingQuantity).toBe(36);
    });
  });

  /**
   * 아직 실행 안 된 라인은 계획 아이템이 없다. 그 라인이 생성 시 물려받은 "계획상" 날짜를
   * 헤더가 말하면, 위와 똑같이 두 화면이 갈린다 — 불가 라인만 빼는 것으로는 안 잠긴다.
   */
  it('아직 실행 안 된 라인의 예정일은 헤더 도착예정일에 들어가지 않는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithThreeLines(trx, { lineExpectedArrival: '2026-09-01' });
      const service = buildService(trx);

      const result = await service.orderLine(
        fx.poId,
        fx.skuIds[0],
        { orderedQty: 10, expectedArrival: '2026-10-01' },
        ACTOR,
        trx,
      );

      expect(result.lines.filter((line) => line.status === 'requested')).toHaveLength(2);
      expect(result.expectedArrival?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    });
  });

  it('전 라인이 종결된 발주만 received 로 간다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      const service = buildService(trx);
      for (const skuId of fx.skuIds) {
        await service.orderLine(fx.poId, skuId, { orderedQty: 10 }, ACTOR, trx);
      }

      const result = await service.updatePurchaseOrderStatus(
        fx.poId,
        { status: PurchaseOrderStatus.RECEIVED },
        ACTOR,
        trx,
      );

      expect(result.status).toBe('received');
    });
  });

  it('아직 실행 안 된 라인이 남은 발주는 종결을 거부한다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      const service = buildService(trx);
      // 라인 하나만 실행 — 헤더는 여전히 created 로 파생된다.
      await service.orderLine(fx.poId, fx.skuIds[0], { orderedQty: 10 }, ACTOR, trx);

      await expect(
        service.updatePurchaseOrderStatus(fx.poId, { status: PurchaseOrderStatus.RECEIVED }, ACTOR, trx),
      ).rejects.toThrow(/created/);
    });
  });

  // #735 가 심사 게이트를 걷어내며 열린 역방향 전이. 종결은 한 번뿐이다.
  it('이미 종결된 발주는 다시 종결되지 않는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      const service = buildService(trx);
      for (const skuId of fx.skuIds) {
        await service.orderLine(fx.poId, skuId, { orderedQty: 10 }, ACTOR, trx);
      }
      await service.updatePurchaseOrderStatus(fx.poId, { status: PurchaseOrderStatus.RECEIVED }, ACTOR, trx);

      await expect(
        service.updatePurchaseOrderStatus(fx.poId, { status: PurchaseOrderStatus.RECEIVED }, ACTOR, trx),
      ).rejects.toThrow(/received/);
    });
  });

  it('전 라인이 발주불가면 빈 계획을 만들지 않는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      const service = buildService(trx);
      for (const skuId of fx.skuIds) {
        await service.markLineUnavailable(fx.poId, skuId, { reason: '품절' }, ACTOR, trx);
      }

      // 실행된 라인이 하나도 없다 — 아이템 0개짜리 계획 행은 입고 화면의 유령이다.
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

  it('응답이 라인 실행 정보를 싣는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      const response = await buildService(trx).orderLine(
        fx.poId,
        fx.skuIds[0],
        { orderedQty: 6, expectedArrival: '2026-09-17' },
        ACTOR,
        trx,
      );

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
