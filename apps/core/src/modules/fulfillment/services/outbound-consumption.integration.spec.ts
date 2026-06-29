import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import { OutboundConsumptionService } from './outbound-consumption.service';
import { InventoryCommandService } from '../../inventory/core/services/inventory-command.service';
import { LocationService } from '../../inventory/core/services/location.service';
import { StockEventStore } from '../../inventory/core/repositories/stock-event.store';
import { OutboxService } from '../../inventory/shared/outbox/outbox.service';
import { ProductSellableQuantityService } from '../../inventory/product-sellable-quantity/services/product-sellable-quantity.service';
import { UnifiedReservationService } from '../../inventory/shared/services/unified-reservation.service';
import { ReservationLifecycleService } from '../../inventory/shared/services/reservation-lifecycle.service';
import { FifoLocationStrategy } from '../../inventory/core/services/location-resolution.strategy';

/**
 * Phase 1 출고 고리 닫기 — 상자(shipment) 단위 소진(consume) 통합 테스트. rollback 전용 트랜잭션.
 *
 * 성공 기준 (RFC / Phase 1): 예약된 재고를 가진 상자를 소진하면
 *   - on_hand 가 출고 수량만큼 감소하고,
 *   - 예약이 소진되며,
 *   - **available 는 불변**이고 (← 옛 버그면 살아남),
 *   - 상자 라인별 SHIP stock_event 가 1건씩 남고,
 *   - 그 SHIP 들이 작업자(shipment.openedBy)에게 귀속된 한 journal 로 묶인다.
 *
 * 실행 (core dev DB는 VPC 내부 — 터널 필요):
 *   1) 별도 터미널: ./scripts/sst-tunnel.sh deployments/lcnine/services dev
 *   2) ./scripts/test-core-integration.sh dev outbound-consumption.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

class Rollback extends Error {}

describeIfDb('OutboundConsumptionService (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);

  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let command: InventoryCommandService;
  let consumption: OutboundConsumptionService;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: wmsSchema });

    const dbService = { db } as unknown as DbService<typeof wmsSchema>;
    const outbox = new OutboxService(dbService);
    const sellable = new ProductSellableQuantityService(dbService as never, outbox);
    const eventStore = new StockEventStore(dbService, sellable);
    const location = new LocationService(dbService);
    command = new InventoryCommandService(dbService, eventStore, outbox, location);

    const unified = new UnifiedReservationService(dbService, sellable);
    const lifecycle = new ReservationLifecycleService(dbService, unified, sellable);
    const strategy = new FifoLocationStrategy();

    consumption = new OutboundConsumptionService(dbService, strategy, command, lifecycle);
  });

  afterAll(async () => {
    await sql.end();
  });

  async function inRollbackTx(fn: (tx: DbTx) => Promise<void>) {
    await expect(
      db.transaction(async (tx) => {
        await fn(tx as unknown as DbTx);
        throw new Rollback('intentional rollback');
      }),
    ).rejects.toThrow(Rollback);
  }

  interface Fixture {
    warehouseId: string;
    skuId: string;
    foId: string;
    foiId: string;
    shipmentId: string;
    openedBy: string;
  }

  /**
   * 창고/SKU/FO/FOI/예약/상자(shipment)+상자라인 생성 + on_hand 시드.
   * reservedQty=shippedQty=qty, on_hand=onHand. 상자 라인은 실제 packing 연산(ensureShipmentLines)으로 생성.
   */
  async function createFixture(tx: DbTx, options: { onHand?: number; qty?: number } = {}): Promise<Fixture> {
    const onHand = options.onHand ?? 100;
    const qty = options.qty ?? 10;
    const openedBy = randomUUID();

    const [warehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `it-wh-${randomUUID().slice(0, 8)}` })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `it-holder-${randomUUID().slice(0, 8)}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'it-sku', code: `IT-${randomUUID()}`, holderId: holder.id })
      .returning();

    // on_hand 시드 — 시스템 기본존으로 RECEIVE/ADJUST_UP (FIFO 전략이 읽을 ON_HAND ledger 행).
    if (onHand > 0) {
      await command.adjustUp({ skuId: sku.id, warehouseId: warehouse.id, quantity: onHand, reason: 'SEED' }, tx);
    }

    const [fo] = await tx
      .insert(wmsTables.fulfillmentOrders)
      .values({
        warehouseId: warehouse.id,
        status: 'invoiced',
        totalReservedQty: qty,
        totalItems: 1,
        totalQty: qty,
      })
      .returning();
    // shippedQty 는 호출자 ship() 가 consume 직전에 세팅하는 값 — 여기서 직접 세팅해 소진 수량을 고정.
    const [foi] = await tx
      .insert(wmsTables.fulfillmentOrderItems)
      .values({ fulfillmentOrderId: fo.id, skuId: sku.id, qty, reservedQty: qty, shippedQty: qty })
      .returning();

    await tx.insert(wmsTables.stockReservations).values({
      targetType: 'FULFILLMENT_ORDER',
      targetId: fo.id,
      fulfillmentOrderItemId: foi.id,
      skuId: sku.id,
      warehouseId: warehouse.id,
      quantity: qty,
      status: 'confirmed',
    });

    // 상자(shipment) — 자사 출고는 송장/라벨 선발급으로 상자가 선행한다. openedBy = 박스 연 작업자.
    const [shipment] = await tx
      .insert(wmsTables.shipments)
      .values({ fulfillmentOrderId: fo.id, trackingNo: `IT-TRK-${randomUUID().slice(0, 8)}`, carrier: 'CJ', openedBy })
      .returning();

    // packing 연산 — FOI(shippedQty) 를 미러한 상자 라인 생성.
    await consumption.ensureShipmentLines(shipment.id, fo.id, tx);

    return { warehouseId: warehouse.id, skuId: sku.id, foId: fo.id, foiId: foi.id, shipmentId: shipment.id, openedBy };
  }

  async function onHandTotal(tx: DbTx, skuId: string, warehouseId: string) {
    const rows = await tx
      .select({ qty: wmsTables.stockLedgers.qty })
      .from(wmsTables.stockLedgers)
      .where(
        and(
          eq(wmsTables.stockLedgers.skuId, skuId),
          eq(wmsTables.stockLedgers.warehouseId, warehouseId),
          eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
        ),
      );
    return rows.reduce((sum, r) => sum + r.qty, 0);
  }

  async function availableQty(tx: DbTx, skuId: string, warehouseId: string) {
    const [row] = await tx
      .select({ availableQty: wmsTables.stockSummary.availableQty })
      .from(wmsTables.stockSummary)
      .where(
        and(eq(wmsTables.stockSummary.skuId, skuId), eq(wmsTables.stockSummary.warehouseId, warehouseId)),
      );
    return row?.availableQty ?? 0;
  }

  async function shipEvents(tx: DbTx, skuId: string) {
    return tx
      .select()
      .from(wmsTables.stockEvents)
      .where(and(eq(wmsTables.stockEvents.skuId, skuId), eq(wmsTables.stockEvents.transitionType, 'SHIP')));
  }

  it('출고 소진: on_hand 가 출고 수량만큼 감소하고 available 는 불변, SHIP 이벤트가 1건 남는다', async () => {
    await inRollbackTx(async (tx) => {
      const f = await createFixture(tx, { onHand: 100, qty: 10 });

      // 소진 전: on_hand=100, reserved=10 → available=90
      expect(await onHandTotal(tx, f.skuId, f.warehouseId)).toBe(100);
      expect(await availableQty(tx, f.skuId, f.warehouseId)).toBe(90);

      await consumption.consumeShipment(f.shipmentId, tx);

      // 소진 후: on_hand 10 감소(=90), 예약 소진(reserved=0) → available 그대로 90
      expect(await onHandTotal(tx, f.skuId, f.warehouseId)).toBe(90);
      expect(await availableQty(tx, f.skuId, f.warehouseId)).toBe(90);

      // SHIP 이벤트 1건 (qty=10, fromState=ON_HAND) + 작업자(openedBy) 귀속 journal 로 묶임
      const events = await shipEvents(tx, f.skuId);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ transitionType: 'SHIP', quantity: 10, fromState: 'ON_HAND' });
      expect(events[0].journalId).toBeTruthy();
      const [journal] = await tx
        .select({ actorId: wmsTables.stockJournals.actorId, sourceType: wmsTables.stockJournals.sourceType })
        .from(wmsTables.stockJournals)
        .where(eq(wmsTables.stockJournals.id, events[0].journalId as string));
      expect(journal).toMatchObject({ sourceType: 'SHIPMENT', actorId: f.openedBy });

      // 예약 소진 확인: confirmed 예약이 사라지고 FOI.reservedQty=0
      const confirmed = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(
          and(eq(wmsTables.stockReservations.targetId, f.foId), eq(wmsTables.stockReservations.status, 'confirmed')),
        );
      expect(confirmed).toHaveLength(0);

      const [foi] = await tx
        .select({ reservedQty: wmsTables.fulfillmentOrderItems.reservedQty })
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.id, f.foiId));
      expect(foi.reservedQty).toBe(0);
    });
  });

  it('available 불변 회귀: 소진 전/후 stock_summary_view.availableQty 가 동일하다 (옛 버그면 100으로 튐)', async () => {
    await inRollbackTx(async (tx) => {
      const f = await createFixture(tx, { onHand: 100, qty: 10 });

      const before = await availableQty(tx, f.skuId, f.warehouseId);
      await consumption.consumeShipment(f.shipmentId, tx);
      const after = await availableQty(tx, f.skuId, f.warehouseId);

      expect(after).toBe(before);
      expect(after).toBe(90);
    });
  });

  it('멱등: consume 를 2회 호출해도 on_hand 는 1회만 차감되고 SHIP 이벤트가 중복되지 않는다', async () => {
    await inRollbackTx(async (tx) => {
      const f = await createFixture(tx, { onHand: 100, qty: 10 });

      await consumption.consumeShipment(f.shipmentId, tx);
      await consumption.consumeShipment(f.shipmentId, tx);

      expect(await onHandTotal(tx, f.skuId, f.warehouseId)).toBe(90);
      expect(await shipEvents(tx, f.skuId)).toHaveLength(1);
    });
  });

  it('재고 부족: on_hand 가 출고 수량보다 적으면 불변식 위반으로 throw 하고 ledger 는 변하지 않는다', async () => {
    await inRollbackTx(async (tx) => {
      const f = await createFixture(tx, { onHand: 5, qty: 10 });

      await expect(consumption.consumeShipment(f.shipmentId, tx)).rejects.toThrow();

      expect(await onHandTotal(tx, f.skuId, f.warehouseId)).toBe(5);
    });
  });
});
