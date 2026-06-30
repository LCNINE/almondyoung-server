import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import { OutboundConsumptionService } from './outbound-consumption.service';
import { ShipmentService } from './shipment.service';
import { InventoryCommandService } from '../../inventory/core/services/inventory-command.service';
import { LocationService } from '../../inventory/core/services/location.service';
import { StockEventStore } from '../../inventory/core/repositories/stock-event.store';
import { OutboxService as InventoryOutboxService } from '../../inventory/shared/outbox/outbox.service';
import { OutboxService as FulfillmentOutboxService } from '../outbox/outbox.service';
import { ProductSellableQuantityService } from '../../inventory/product-sellable-quantity/services/product-sellable-quantity.service';
import { UnifiedReservationService } from '../../inventory/shared/services/unified-reservation.service';
import { ReservationLifecycleService } from '../../inventory/shared/services/reservation-lifecycle.service';
import { FifoLocationStrategy } from '../../inventory/core/services/location-resolution.strategy';
import { BarcodeService } from '../../inventory/shared/services/barcode.service';

/**
 * Cluster A 출고 고리 닫기 — 상자(shipment) 단위 소진(consume) 통합 테스트. rollback 전용 트랜잭션.
 *
 * 성공 기준 (RFC / Cluster A): 상자 N개 출고(`consumeShipment`)는 출고를 **전체 종결**한다 —
 *   - on_hand 가 출고 수량(N)만큼 감소하고,
 *   - 예약이 소진되며(release 아님),
 *   - **available 는 불변**이고 (← 옛 버그면 살아남),
 *   - 상자 라인별 SHIP stock_event 가 1건씩 남고,
 *   - 그 SHIP 들이 작업자(shipment.openedBy)에게 귀속된 한 journal 로 묶이며,
 *   - FOI.shippedQty 가 누적되고 FOI/FO/박스 status 가 'shipped' 로 전이한다.
 *
 * ⚠️ 통합검증 빚: 이 spec 은 `describeIfDb`(DATABASE_URL 게이트)로 현재 **skip**. dev 환경 삭제로
 * 실행 불가 — DATABASE_URL 닿는 환경에서 실행해 위 성공 기준을 실증해야 한다.
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
  let shipmentService: ShipmentService;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: wmsSchema });

    const dbService = { db } as unknown as DbService<typeof wmsSchema>;
    // 원장/예약 쪽은 inventory outbox, 종결(FulfillmentShipped) 발행은 fulfillment outbox 를 쓴다.
    const invOutbox = new InventoryOutboxService(dbService);
    const fulfillmentOutbox = new FulfillmentOutboxService(dbService);

    const sellable = new ProductSellableQuantityService(dbService as never, invOutbox);
    const eventStore = new StockEventStore(dbService, sellable);
    const location = new LocationService(dbService);
    command = new InventoryCommandService(dbService, eventStore, invOutbox, location);

    const unified = new UnifiedReservationService(dbService, sellable);
    const lifecycle = new ReservationLifecycleService(dbService, unified, sellable);
    const strategy = new FifoLocationStrategy();

    consumption = new OutboundConsumptionService(dbService, strategy, command, lifecycle, fulfillmentOutbox);

    const barcode = new BarcodeService(dbService);
    shipmentService = new ShipmentService(dbService, barcode, consumption);
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

  interface OrderSeed {
    warehouseId: string;
    skuId: string;
    skuCode: string;
    foId: string;
    foiId: string;
    operatorId: string;
    qty: number;
  }

  interface Fixture extends OrderSeed {
    shipmentId: string;
  }

  /**
   * 창고/SKU/FO/FOI/예약 + on_hand 시드. 상자/송장은 만들지 않는다 (호출자가 흐름에 맞게 생성).
   * FOI.shippedQty 는 0 (검수가 직접 세팅 안 함 — consume 가 박스 소진마다 누적).
   * sku.code 는 대문자 — 검수 스캔(barcode→code 매칭, parseBarcode 가 uppercase) 가 닿게.
   */
  async function seedOrder(tx: DbTx, options: { onHand?: number; qty?: number } = {}): Promise<OrderSeed> {
    const onHand = options.onHand ?? 100;
    const qty = options.qty ?? 10;
    const operatorId = randomUUID();
    const skuCode = `IT-${randomUUID().toUpperCase()}`;

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
      .values({ name: 'it-sku', code: skuCode, holderId: holder.id })
      .returning();

    // on_hand 시드 — 시스템 기본존으로 ADJUST_UP (FIFO 전략이 읽을 ON_HAND ledger 행).
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
    // shippedQty=0 — consume 가 누적한다 (옛 모델은 ship() 이 직접 세팅했으나 폐기).
    const [foi] = await tx
      .insert(wmsTables.fulfillmentOrderItems)
      .values({ fulfillmentOrderId: fo.id, skuId: sku.id, qty, reservedQty: qty, shippedQty: 0 })
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

    return { warehouseId: warehouse.id, skuId: sku.id, skuCode, foId: fo.id, foiId: foi.id, operatorId, qty };
  }

  /**
   * seedOrder + 검수 완료 상태의 열린 상자 한 개 (`consumeShipment` 직접 호출용).
   * 상자는 새 컬럼(warehouseId/openedForFulfillmentOrderId/status/openedBy)으로 insert 하고,
   * 상자 라인은 직접 insert (ensureShipmentLines 폐기) — inspectedQty=qty(검수완료), forced=false.
   */
  async function createFixture(tx: DbTx, options: { onHand?: number; qty?: number } = {}): Promise<Fixture> {
    const seed = await seedOrder(tx, options);

    const [shipment] = await tx
      .insert(wmsTables.shipments)
      .values({
        warehouseId: seed.warehouseId,
        openedForFulfillmentOrderId: seed.foId,
        status: 'open',
        openedBy: seed.operatorId,
        openedAt: new Date(),
      })
      .returning();

    await tx.insert(wmsTables.shipmentLines).values({
      shipmentId: shipment.id,
      fulfillmentOrderItemId: seed.foiId,
      skuId: seed.skuId,
      qty: seed.qty,
      inspectedQty: seed.qty,
      forced: false,
    });

    return { ...seed, shipmentId: shipment.id };
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
      .where(and(eq(wmsTables.stockSummary.skuId, skuId), eq(wmsTables.stockSummary.warehouseId, warehouseId)));
    return row?.availableQty ?? 0;
  }

  async function shipEvents(tx: DbTx, skuId: string) {
    return tx
      .select()
      .from(wmsTables.stockEvents)
      .where(and(eq(wmsTables.stockEvents.skuId, skuId), eq(wmsTables.stockEvents.transitionType, 'SHIP')));
  }

  async function shipmentStatus(tx: DbTx, shipmentId: string) {
    const [row] = await tx
      .select({ status: wmsTables.shipments.status })
      .from(wmsTables.shipments)
      .where(eq(wmsTables.shipments.id, shipmentId))
      .limit(1);
    return row?.status ?? null;
  }

  async function foStatus(tx: DbTx, foId: string) {
    const [row] = await tx
      .select({ status: wmsTables.fulfillmentOrders.status })
      .from(wmsTables.fulfillmentOrders)
      .where(eq(wmsTables.fulfillmentOrders.id, foId))
      .limit(1);
    return row?.status ?? null;
  }

  it('상자 출고: on_hand 가 출고 수량만큼 감소·available 불변·SHIP 1건/라인, FOI/FO/박스 전체 종결', async () => {
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
      expect(journal).toMatchObject({ sourceType: 'SHIPMENT', actorId: f.operatorId });

      // 예약 소진 확인: confirmed 예약이 사라지고 FOI.reservedQty=0
      const confirmed = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(
          and(eq(wmsTables.stockReservations.targetId, f.foId), eq(wmsTables.stockReservations.status, 'confirmed')),
        );
      expect(confirmed).toHaveLength(0);

      const [foi] = await tx
        .select({
          reservedQty: wmsTables.fulfillmentOrderItems.reservedQty,
          shippedQty: wmsTables.fulfillmentOrderItems.shippedQty,
          status: wmsTables.fulfillmentOrderItems.status,
        })
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.id, f.foiId));
      expect(foi.reservedQty).toBe(0);
      // 전체 종결: FOI.shippedQty 누적(10) + FOI/FO/박스 status='shipped'
      expect(foi.shippedQty).toBe(10);
      expect(foi.status).toBe('shipped');
      expect(await foStatus(tx, f.foId)).toBe('shipped');
      expect(await shipmentStatus(tx, f.shipmentId)).toBe('shipped');
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
      // 1회차로 박스 status='shipped' → 2회차는 early-return (no-op).
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

  it('end-to-end 박스 스캔: openBoxByScan → inspectScan(자동완료) 가 출고를 전체 종결한다', async () => {
    await inRollbackTx(async (tx) => {
      const seed = await seedOrder(tx, { onHand: 100, qty: 10 });

      // 선발급 송장(issued) — 박스 스캔(open)의 입구.
      const trackingNo = `IT-TRK-${randomUUID().slice(0, 8)}`;
      await tx.insert(wmsTables.invoices).values({
        trackingNo,
        carrier: 'CJ',
        issueMethod: 'self',
        issuedForFulfillmentOrderId: seed.foId,
        status: 'issued',
      });

      // 송장 스캔 → 박스 lazy open (라인 qty=잔량, inspectedQty=0).
      const { shipmentId } = await shipmentService.openBoxByScan(trackingNo, seed.operatorId, tx);
      expect(await shipmentStatus(tx, shipmentId)).toBe('open');

      // 상품 검수 스캔 (qty 전량) → 전 라인 검수완료 → consumeShipment 자동발사.
      await shipmentService.inspectScan(shipmentId, seed.skuCode, seed.qty, seed.operatorId, tx);

      // 전체 종결: on_hand 감소·available 불변·박스/FO shipped.
      expect(await onHandTotal(tx, seed.skuId, seed.warehouseId)).toBe(90);
      expect(await availableQty(tx, seed.skuId, seed.warehouseId)).toBe(90);
      expect(await shipmentStatus(tx, shipmentId)).toBe('shipped');
      expect(await foStatus(tx, seed.foId)).toBe('shipped');
      expect(await shipEvents(tx, seed.skuId)).toHaveLength(1);

      // 박스에 매인 송장이 'used' 로 전이.
      const [invoice] = await tx
        .select({ status: wmsTables.invoices.status, shipmentId: wmsTables.invoices.shipmentId })
        .from(wmsTables.invoices)
        .where(eq(wmsTables.invoices.trackingNo, trackingNo))
        .limit(1);
      expect(invoice).toMatchObject({ status: 'used', shipmentId });
    });
  });
});
