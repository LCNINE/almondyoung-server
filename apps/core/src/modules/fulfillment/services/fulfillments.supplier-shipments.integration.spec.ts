import { randomUUID } from 'crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { FulfillmentInvariantService } from './fulfillment-invariant.service';
import { DropShippedSkuSupplierUnresolvedError } from '../supplier-shipment/direct-suppliers-of-skus';
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

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/**
 * K3 PR4 — FO 생성은 직배분을 입점사마다 draft 상자 하나로 연다(스펙 §4.3-1, ADR-0050).
 * 창고분은 지금처럼 창고 draft 상자로 예약하고, 입점사 상자 라인은 예약하지 않는다.
 */
describeIfDb('FO 생성 — 직배분은 입점사 상자 (K3 PR4, PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  let wired: Wired;

  beforeAll(() => {
    wired = wireLogistics(makeDbService(db));
  });
  afterAll(async () => {
    await client.end();
  });

  async function seedDirectSupplier(tx: DbTx): Promise<string> {
    const [row] = await tx
      .insert(wmsTables.suppliers)
      .values({ name: `it-direct-${randomUUID().slice(0, 8)}`, isDirectDelivery: true })
      .returning();
    return row.id;
  }

  async function seedDropShippedSku(tx: DbTx, holderId: string, supplierId: string): Promise<string> {
    const { skuId } = await seedSku(tx, holderId);
    await tx.update(wmsTables.skus).set({ stockType: 'drop_shipped' }).where(eq(wmsTables.skus.id, skuId));
    await tx.insert(wmsTables.skuSuppliers).values({ skuId, supplierId });
    return skuId;
  }

  async function onHand(tx: DbTx, w: { warehouseId: string; locationId: string }, skuId: string, qty: number) {
    await tx
      .insert(wmsTables.stockLedgers)
      .values({ skuId, warehouseId: w.warehouseId, locationId: w.locationId, stockState: 'ON_HAND', qty });
  }

  /** 라인 하나 = SKU 하나(상품매칭 1:1). 공동현관 비번을 넣어 상자들이 같은 값을 받는지 본다. */
  async function orderOf(tx: DbTx, lines: Array<{ skuId: string; quantity: number }>) {
    const variants = lines.map(() => randomUUID());
    const { salesOrderId, lineIds } = await seedSalesOrder(tx, {
      lines: lines.map((line, i) => ({ variantId: variants[i], quantity: line.quantity })),
    });
    for (const [i, line] of lines.entries()) await seedMatching(tx, { variantId: variants[i], skuId: line.skuId });
    await tx
      .update(wmsTables.salesOrders)
      .set({ entrancePassword: '#1234' })
      .where(eq(wmsTables.salesOrders.id, salesOrderId));
    return { salesOrderId, lineIds };
  }

  async function world(tx: DbTx) {
    const w = await seedWarehouseWithZone(tx);
    const { holderId } = await seedHolder(tx);
    return { ...w, holderId };
  }

  /** 그 FO 의 상자와 라인·확정 예약 합. 입점사 id 순(창고 상자는 supplierId null 이라 맨 끝). */
  async function boxesOf(tx: DbTx, foId: string) {
    const lineRows = await tx
      .select({
        lineId: wmsTables.shipmentLines.id,
        shipmentId: wmsTables.shipmentLines.shipmentId,
        foiId: wmsTables.shipmentLines.fulfillmentOrderItemId,
        skuId: wmsTables.shipmentLines.skuId,
        qty: wmsTables.shipmentLines.qty,
      })
      .from(wmsTables.shipmentLines)
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, foId));
    const shipmentIds = [...new Set(lineRows.map((row) => row.shipmentId))];
    if (shipmentIds.length === 0) return [];
    const shipments = await tx
      .select({
        id: wmsTables.shipments.id,
        status: wmsTables.shipments.status,
        warehouseId: wmsTables.shipments.warehouseId,
        supplierId: wmsTables.shipments.supplierId,
        shippingProfileId: wmsTables.shipments.shippingProfileId,
        recipientSnapshot: wmsTables.shipments.recipientSnapshot,
        entrancePassword: wmsTables.shipments.entrancePassword,
      })
      .from(wmsTables.shipments)
      .where(inArray(wmsTables.shipments.id, shipmentIds))
      .orderBy(asc(wmsTables.shipments.supplierId));
    const reservations = await tx
      .select({ lineId: wmsTables.stockReservations.shipmentLineId, quantity: wmsTables.stockReservations.quantity })
      .from(wmsTables.stockReservations)
      .where(
        and(
          inArray(
            wmsTables.stockReservations.shipmentLineId,
            lineRows.map((row) => row.lineId),
          ),
          eq(wmsTables.stockReservations.status, 'confirmed'),
        ),
      );
    return shipments.map((shipment) => {
      const lines = lineRows.filter((row) => row.shipmentId === shipment.id);
      const lineIds = new Set(lines.map((line) => line.lineId));
      const confirmed = reservations
        .filter((row) => row.lineId !== null && lineIds.has(row.lineId))
        .reduce((total, row) => total + row.quantity, 0);
      return { ...shipment, lines, confirmed };
    });
  }

  async function foiIdOf(tx: DbTx, foId: string, skuId: string): Promise<string> {
    const [row] = await tx
      .select({ id: wmsTables.fulfillmentOrderItems.id })
      .from(wmsTables.fulfillmentOrderItems)
      .where(
        and(
          eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, foId),
          eq(wmsTables.fulfillmentOrderItems.skuId, skuId),
        ),
      );
    return row.id;
  }

  it('섞인 주문은 FO 하나에 창고 상자와 입점사 상자를 만든다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await world(tx);
      const supplierA = await seedDirectSupplier(tx);
      const { skuId: warehouseSku } = await seedSku(tx, w.holderId);
      const dropSku = await seedDropShippedSku(tx, w.holderId, supplierA);
      await onHand(tx, w, warehouseSku, 2);
      const { salesOrderId } = await orderOf(tx, [
        { skuId: warehouseSku, quantity: 2 },
        { skuId: dropSku, quantity: 1 },
      ]);

      const fo = await wired.fulfillments.create({ salesOrderId, warehouseId: w.warehouseId }, tx);
      if (!fo) throw new Error('expected a fulfillment order');
      expect(fo).toMatchObject({ fulfillmentMode: 'in_house', warehouseId: w.warehouseId });

      const fos = await tx
        .select({ id: wmsTables.fulfillmentOrders.id })
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId));
      expect(fos).toHaveLength(1);

      const boxes = await boxesOf(tx, fo.id);
      expect(boxes).toHaveLength(2);
      const [supplierBox, warehouseBox] = boxes;
      expect(warehouseBox).toMatchObject({
        status: 'draft',
        warehouseId: w.warehouseId,
        supplierId: null,
        confirmed: 2,
      });
      expect(warehouseBox.lines.map((line) => line.foiId)).toEqual([await foiIdOf(tx, fo.id, warehouseSku)]);
      expect(supplierBox).toMatchObject({
        status: 'draft',
        warehouseId: null,
        supplierId: supplierA,
        shippingProfileId: null,
        confirmed: 0,
        recipientSnapshot: warehouseBox.recipientSnapshot,
        entrancePassword: warehouseBox.entrancePassword,
      });
      expect(supplierBox.entrancePassword).toBe('#1234');
      expect(supplierBox.lines.map((line) => line.foiId)).toEqual([await foiIdOf(tx, fo.id, dropSku)]);

      const supplierLineReservations = await tx
        .select({ id: wmsTables.stockReservations.id })
        .from(wmsTables.stockReservations)
        .where(
          inArray(
            wmsTables.stockReservations.shipmentLineId,
            supplierBox.lines.map((line) => line.lineId),
          ),
        );
      expect(supplierLineReservations).toHaveLength(0);
    });
  });

  it('입점사 둘이면 상자도 둘, 같은 입점사의 SKU 둘은 상자 하나', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await world(tx);
      const supplierA = await seedDirectSupplier(tx);
      const supplierB = await seedDirectSupplier(tx);
      const a1 = await seedDropShippedSku(tx, w.holderId, supplierA);
      const a2 = await seedDropShippedSku(tx, w.holderId, supplierA);
      const b1 = await seedDropShippedSku(tx, w.holderId, supplierB);
      const { salesOrderId } = await orderOf(tx, [
        { skuId: a1, quantity: 1 },
        { skuId: b1, quantity: 3 },
        { skuId: a2, quantity: 2 },
      ]);

      const fo = await wired.fulfillments.create({ salesOrderId, warehouseId: w.warehouseId }, tx);
      if (!fo) throw new Error('expected a fulfillment order');

      const boxes = await boxesOf(tx, fo.id);
      expect(boxes).toHaveLength(2);
      const bySupplier = new Map(boxes.map((box) => [box.supplierId, box]));
      expect(
        bySupplier
          .get(supplierA)
          ?.lines.map((line) => line.skuId)
          .sort(),
      ).toEqual([a1, a2].sort());
      expect(bySupplier.get(supplierB)?.lines.map((line) => line.skuId)).toEqual([b1]);
      expect(boxes.every((box) => box.warehouseId === null && box.confirmed === 0)).toBe(true);
    });
  });

  it('직배분만이면 FO 창고 NULL, 입점사 상자만, FO ready', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await world(tx);
      const supplierA = await seedDirectSupplier(tx);
      const dropSku = await seedDropShippedSku(tx, w.holderId, supplierA);
      const { salesOrderId } = await orderOf(tx, [{ skuId: dropSku, quantity: 2 }]);

      // 창고를 넘겨도(백로그 워커는 늘 기본 창고를 넘긴다) 창고 몫이 없으니 FO 창고는 NULL
      const fo = await wired.fulfillments.create({ salesOrderId, warehouseId: w.warehouseId }, tx);
      if (!fo) throw new Error('expected a fulfillment order');
      expect(fo).toMatchObject({
        fulfillmentMode: 'in_house',
        warehouseId: null,
        status: 'ready',
        totalReservedQty: 0,
      });

      const boxes = await boxesOf(tx, fo.id);
      expect(boxes).toHaveLength(1);
      expect(boxes[0]).toMatchObject({ status: 'draft', warehouseId: null, supplierId: supplierA, confirmed: 0 });
    });
  });

  it('직배분만이면 창고 없이도 만든다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await world(tx);
      const supplierA = await seedDirectSupplier(tx);
      const dropSku = await seedDropShippedSku(tx, w.holderId, supplierA);
      const { salesOrderId } = await orderOf(tx, [{ skuId: dropSku, quantity: 1 }]);

      const fo = await wired.fulfillments.create({ salesOrderId }, tx);
      expect(fo).toMatchObject({ warehouseId: null, status: 'ready' });
    });
  });

  it('창고분이 다 예약되면 섞인 FO 는 ready', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await world(tx);
      const supplierA = await seedDirectSupplier(tx);
      const { skuId: warehouseSku } = await seedSku(tx, w.holderId);
      const dropSku = await seedDropShippedSku(tx, w.holderId, supplierA);
      await onHand(tx, w, warehouseSku, 3);
      const { salesOrderId } = await orderOf(tx, [
        { skuId: warehouseSku, quantity: 3 },
        { skuId: dropSku, quantity: 2 },
      ]);

      const fo = await wired.fulfillments.create({ salesOrderId, warehouseId: w.warehouseId }, tx);
      // 예약 합계는 확정 예약만 — 입점사 몫은 «예약된 것과 같다»로 판정에만 센다(N4)
      expect(fo).toMatchObject({ status: 'ready', totalReservedQty: 3 });
    });
  });

  it('창고분 재고 0 이면 partially_reserved, 입점사 라인은 그대로이고 예약 재시도 후보가 아니다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await world(tx);
      const supplierA = await seedDirectSupplier(tx);
      const { skuId: warehouseSku } = await seedSku(tx, w.holderId);
      const dropSku = await seedDropShippedSku(tx, w.holderId, supplierA);
      // 직배 SKU 에 창고 재고가 있어도 입점사 상자는 창고가 없어 후보 조인에 걸리지 않는다
      await onHand(tx, w, dropSku, 5);
      const { salesOrderId } = await orderOf(tx, [
        { skuId: warehouseSku, quantity: 2 },
        { skuId: dropSku, quantity: 1 },
      ]);

      const fo = await wired.fulfillments.create({ salesOrderId, warehouseId: w.warehouseId }, tx);
      if (!fo) throw new Error('expected a fulfillment order');
      expect(fo).toMatchObject({ status: 'partially_reserved', totalReservedQty: 0 });

      const [supplierBox, warehouseBox] = await boxesOf(tx, fo.id);
      expect(supplierBox).toMatchObject({ supplierId: supplierA, confirmed: 0 });
      expect(supplierBox.lines).toEqual([expect.objectContaining({ skuId: dropSku, qty: 1 })]);
      expect(warehouseBox).toMatchObject({ warehouseId: w.warehouseId, confirmed: 0 });

      const candidates = (await wired.retryWorker.findCandidates(100, tx)).map((row) => row.id);
      for (const line of supplierBox.lines) expect(candidates).not.toContain(line.lineId);
    });
  });

  it('창고 상자의 배송 프로필은 창고 SKU 로만 정한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await world(tx);
      const supplierA = await seedDirectSupplier(tx);
      const [profile] = await tx
        .insert(wmsTables.deliveryProfiles)
        .values({ name: `it-profile-${randomUUID()}`, sourceType: 'in_house' })
        .returning();
      const { skuId: warehouseSku } = await seedSku(tx, w.holderId);
      await tx.update(wmsTables.skus).set({ deliveryProfileId: profile.id }).where(eq(wmsTables.skus.id, warehouseSku));
      // 직배 SKU 는 배송 프로필이 없다 — 섞여도 창고 상자 프로필을 NULL 로 만들면 안 된다
      const dropSku = await seedDropShippedSku(tx, w.holderId, supplierA);
      const { salesOrderId } = await orderOf(tx, [
        { skuId: warehouseSku, quantity: 1 },
        { skuId: dropSku, quantity: 1 },
      ]);

      const fo = await wired.fulfillments.create({ salesOrderId, warehouseId: w.warehouseId }, tx);
      if (!fo) throw new Error('expected a fulfillment order');
      const [supplierBox, warehouseBox] = await boxesOf(tx, fo.id);
      expect(warehouseBox.shippingProfileId).toBe(profile.id);
      expect(supplierBox.shippingProfileId).toBeNull();
    });
  });

  async function expectNothingLeft(tx: DbTx, salesOrderId: string, lineIds: string[]) {
    const fos = await tx
      .select({ id: wmsTables.fulfillmentOrders.id })
      .from(wmsTables.fulfillmentOrders)
      .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId));
    expect(fos).toHaveLength(0);
    const lines = await tx
      .select({ id: wmsTables.shipmentLines.id })
      .from(wmsTables.shipmentLines)
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .where(eq(wmsTables.fulfillmentOrderItems.salesOrderId, salesOrderId));
    expect(lines).toHaveLength(0);
    const compositions = await tx
      .select({ id: wmsTables.salesOrderLineCompositions.salesOrderLineId })
      .from(wmsTables.salesOrderLineCompositions)
      .where(inArray(wmsTables.salesOrderLineCompositions.salesOrderLineId, lineIds));
    expect(compositions).toHaveLength(0);
  }

  it('직배 공급사 연결이 없으면 DROP_SHIPPED_SKU_SUPPLIER_UNRESOLVED 이고 아무것도 남지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await world(tx);
      const supplierA = await seedDirectSupplier(tx);
      const { skuId: warehouseSku } = await seedSku(tx, w.holderId);
      const dropSku = await seedDropShippedSku(tx, w.holderId, supplierA);
      await onHand(tx, w, warehouseSku, 1);
      await tx.delete(wmsTables.skuSuppliers).where(eq(wmsTables.skuSuppliers.skuId, dropSku));
      const { salesOrderId, lineIds } = await orderOf(tx, [
        { skuId: warehouseSku, quantity: 1 },
        { skuId: dropSku, quantity: 1 },
      ]);

      // 백로그 워커와 같은 savepoint — 실패하면 굳힌 라인 구성까지 되돌아가야 한다
      const error = await tx
        .transaction((savepoint) => wired.fulfillments.create({ salesOrderId, warehouseId: w.warehouseId }, savepoint))
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(DropShippedSkuSupplierUnresolvedError);
      expect((error as DropShippedSkuSupplierUnresolvedError).getErrorCode()).toBe(
        'DROP_SHIPPED_SKU_SUPPLIER_UNRESOLVED',
      );
      expect((error as DropShippedSkuSupplierUnresolvedError).getHttpStatus()).toBe(400);
      expect((error as DropShippedSkuSupplierUnresolvedError).skuIds).toEqual([dropSku]);

      await expectNothingLeft(tx, salesOrderId, lineIds);
    });
  });

  it('직배 공급사 연결이 둘이어도 정하지 못한 것으로 거절한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await world(tx);
      const supplierA = await seedDirectSupplier(tx);
      const supplierB = await seedDirectSupplier(tx);
      const dropSku = await seedDropShippedSku(tx, w.holderId, supplierA);
      await tx.insert(wmsTables.skuSuppliers).values({ skuId: dropSku, supplierId: supplierB });
      const { salesOrderId, lineIds } = await orderOf(tx, [{ skuId: dropSku, quantity: 1 }]);

      const error = await tx
        .transaction((savepoint) => wired.fulfillments.create({ salesOrderId, warehouseId: w.warehouseId }, savepoint))
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(DropShippedSkuSupplierUnresolvedError);
      expect((error as DropShippedSkuSupplierUnresolvedError).skuIds).toEqual([dropSku]);
      await expectNothingLeft(tx, salesOrderId, lineIds);
    });
  });

  it('직배가 아닌 공급사 연결은 세지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await world(tx);
      const supplierA = await seedDirectSupplier(tx);
      const [plain] = await tx
        .insert(wmsTables.suppliers)
        .values({ name: `it-plain-${randomUUID().slice(0, 8)}`, isDirectDelivery: false })
        .returning();
      const dropSku = await seedDropShippedSku(tx, w.holderId, supplierA);
      await tx.insert(wmsTables.skuSuppliers).values({ skuId: dropSku, supplierId: plain.id });
      const { salesOrderId } = await orderOf(tx, [{ skuId: dropSku, quantity: 1 }]);

      const fo = await wired.fulfillments.create({ salesOrderId, warehouseId: w.warehouseId }, tx);
      if (!fo) throw new Error('expected a fulfillment order');
      const boxes = await boxesOf(tx, fo.id);
      expect(boxes.map((box) => box.supplierId)).toEqual([supplierA]);
    });
  });

  it('정합성 점검이 섞인 FO 를 위반으로 보지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await world(tx);
      const supplierA = await seedDirectSupplier(tx);
      const { skuId: warehouseSku } = await seedSku(tx, w.holderId);
      const dropSku = await seedDropShippedSku(tx, w.holderId, supplierA);
      await onHand(tx, w, warehouseSku, 1);
      const { salesOrderId } = await orderOf(tx, [
        { skuId: warehouseSku, quantity: 2 },
        { skuId: dropSku, quantity: 1 },
      ]);

      const fo = await wired.fulfillments.create({ salesOrderId, warehouseId: w.warehouseId }, tx);
      if (!fo) throw new Error('expected a fulfillment order');
      // 위반이 하나라도 있으면 ConflictException(위반 목록) — ACTIVE_LINE_QUANTITY 포함 전부 0 이어야 통과
      await expect(new FulfillmentInvariantService().assertFulfillmentOrders([fo.id], tx)).resolves.toBeUndefined();
    });
  });
});
