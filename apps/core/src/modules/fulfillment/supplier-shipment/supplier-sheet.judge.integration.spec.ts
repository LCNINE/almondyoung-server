import { randomUUID } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { ApplicationException } from '@app/shared';
import {
  CORE_ORDER_STREAM,
  FULFILLMENT_STREAM,
  FULFILLMENT_V2_STREAM,
  SHIPMENT_STREAM,
} from '@packages/event-contracts/streams';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { seedHandoff } from '../order-progress/__support__/order-progress.fixtures';
import { FulfillmentInvariantService } from '../services/fulfillment-invariant.service';
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
} from '../services/__support__';
import { outboxPublisherFor } from '../outbox/__support__/outbox-publisher.factory';
import { ManifestEditDeps } from '../shipment/shipment-manifest-edit';
import { WaybillRepository } from '../waybill/waybill.repository';
import { shipSupplierShipment, SupplierDispatchDeps } from './supplier-dispatch';
import { reportUnfulfillable } from './supplier-line-reports';
import { mergeSupplierShipments } from './supplier-manifest';
import { judgeSupplierSheet, type RowVerdict } from './supplier-sheet.judge';
import type { ParsedSupplierRow } from './supplier-sheet.parser';
import { orderNoSql } from './supplier-shipment-queue.reader';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const RECIPIENT = {
  recipientName: '홍길동',
  phone: '010-1234-5678',
  postalCode: '06236',
  roadAddress: '서울 강남구 테헤란로 1',
  detailAddress: '101호',
};
const OTHER_RECIPIENT = { ...RECIPIENT, recipientName: '김철수' };

type SheetLine = { lineId: string; foiId: string; qty: number; orderNo: string; supplierSku: string };

/** K3 PR5 Task 9 — 올린 시트의 줄 판정(미리보기·적용 공용). 판정은 아무것도 쓰지 않는다. */
describeIfDb('직배 시트 줄 판정 (K3 PR5, PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  let wired: Wired;
  let manifestDeps: ManifestEditDeps;
  let dispatchDeps: SupplierDispatchDeps;
  const at = new Date('2026-10-25T03:00:00.000Z');
  const actorId = 'op-sheet-judge';

  beforeAll(() => {
    const dbService = makeDbService(db);
    wired = wireLogistics(dbService);
    manifestDeps = { invariant: new FulfillmentInvariantService(), reservations: wired.shipmentReservations };
    dispatchDeps = {
      shipments: outboxPublisherFor(SHIPMENT_STREAM, dbService),
      fulfillmentsV2: outboxPublisherFor(FULFILLMENT_V2_STREAM, dbService),
      fulfillmentsV1: outboxPublisherFor(FULFILLMENT_STREAM, dbService),
      coreOrders: outboxPublisherFor(CORE_ORDER_STREAM, dbService),
      audit: new AuditService(dbService),
      invariant: new FulfillmentInvariantService(),
      waybills: new WaybillRepository(dbService),
    };
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

  async function seedDropSku(tx: DbTx, holderId: string, supplierId: string): Promise<string> {
    const { skuId } = await seedSku(tx, holderId);
    await tx.update(wmsTables.skus).set({ stockType: 'drop_shipped' }).where(eq(wmsTables.skus.id, skuId));
    await tx.insert(wmsTables.skuSuppliers).values({ skuId, supplierId, supplierSku: `SUP-${skuId.slice(0, 6)}` });
    return skuId;
  }

  /** 입점사 직배 라인만(또는 창고 라인 하나를 더한) 주문 하나를 FO 로 만든다. 상자는 넘긴 채(handOff=false 면 안 넘김). */
  async function order(
    tx: DbTx,
    supplierId: string,
    opts: { dropQtys: number[]; withWarehouseLine?: boolean; handOff?: boolean; recipient?: object },
  ) {
    const w = await seedWarehouseWithZone(tx);
    const { holderId } = await seedHolder(tx);
    const lines: Array<{ skuId: string; quantity: number }> = [];
    for (const quantity of opts.dropQtys) lines.push({ skuId: await seedDropSku(tx, holderId, supplierId), quantity });
    if (opts.withWarehouseLine) {
      const { skuId } = await seedSku(tx, holderId);
      await tx.insert(wmsTables.stockLedgers).values({
        skuId,
        warehouseId: w.warehouseId,
        locationId: w.locationId,
        stockState: 'ON_HAND',
        qty: 3,
      });
      lines.push({ skuId, quantity: 3 });
    }
    const variants = lines.map(() => randomUUID());
    const { salesOrderId, lineIds } = await seedSalesOrder(tx, {
      lines: lines.map((line, i) => ({ variantId: variants[i], quantity: line.quantity })),
    });
    for (const lineId of lineIds) {
      await tx
        .update(wmsTables.salesOrderLines)
        .set({ channelOrderItemId: `item-${lineId.slice(0, 8)}` })
        .where(eq(wmsTables.salesOrderLines.id, lineId));
    }
    for (const [i, line] of lines.entries()) await seedMatching(tx, { variantId: variants[i], skuId: line.skuId });
    await tx
      .update(wmsTables.salesOrders)
      .set({ customerId: randomUUID(), customerEmail: 'it@example.com', customerName: '고객' })
      .where(eq(wmsTables.salesOrders.id, salesOrderId));
    const fo = await wired.fulfillments.create({ salesOrderId, warehouseId: w.warehouseId }, tx);
    if (!fo) throw new Error('expected a fulfillment order');
    const rows = await tx
      .select({
        lineId: wmsTables.shipmentLines.id,
        foiId: wmsTables.shipmentLines.fulfillmentOrderItemId,
        qty: wmsTables.shipmentLines.qty,
        shipmentId: wmsTables.shipments.id,
        supplierId: wmsTables.shipments.supplierId,
        supplierSku: wmsTables.skuSuppliers.supplierSku,
        orderNo: orderNoSql(),
      })
      .from(wmsTables.shipmentLines)
      .innerJoin(wmsTables.shipments, eq(wmsTables.shipments.id, wmsTables.shipmentLines.shipmentId))
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .innerJoin(
        wmsTables.fulfillmentOrders,
        eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
      )
      .innerJoin(wmsTables.salesOrders, eq(wmsTables.salesOrders.id, wmsTables.fulfillmentOrders.salesOrderId))
      .leftJoin(wmsTables.skuSuppliers, eq(wmsTables.skuSuppliers.skuId, wmsTables.shipmentLines.skuId))
      .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fo.id))
      .orderBy(wmsTables.shipmentLines.qty);
    const supplierRows = rows.filter((r) => r.supplierId !== null);
    if (supplierRows.length === 0) throw new Error('expected a supplier box');
    const supplierBox = supplierRows[0].shipmentId;
    const warehouseLine = rows.find((r) => r.supplierId === null) ?? null;
    await tx
      .update(wmsTables.shipments)
      .set({ recipientSnapshot: opts.recipient ?? RECIPIENT })
      .where(eq(wmsTables.shipments.id, supplierBox));
    if (opts.handOff !== false) {
      const handoffId = await seedHandoff(tx, supplierId);
      await tx
        .update(wmsTables.shipments)
        .set({ supplierHandoffId: handoffId })
        .where(eq(wmsTables.shipments.id, supplierBox));
    }
    const lineOut = (r: (typeof rows)[number]): SheetLine => ({
      lineId: r.lineId,
      foiId: r.foiId,
      qty: r.qty,
      orderNo: r.orderNo,
      supplierSku: r.supplierSku ?? '',
    });
    return {
      salesOrderId,
      foId: fo.id,
      supplierBox,
      lines: supplierRows.map(lineOut),
      warehouseLine: warehouseLine ? lineOut(warehouseLine) : null,
    };
  }

  let rowNo = 1;
  const row = (line: SheetLine, over: Partial<ParsedSupplierRow> = {}): ParsedSupplierRow => ({
    rowNumber: ++rowNo,
    rowKey: line.foiId,
    orderNo: line.orderNo,
    supplierSku: line.supplierSku,
    qty: line.qty,
    carrierRaw: '',
    trackingNo: '',
    reason: '',
    ...over,
  });
  const tracked = (line: SheetLine, trackingNo: string, carrierRaw = '우체국', over: Partial<ParsedSupplierRow> = {}) =>
    row(line, { carrierRaw, trackingNo, ...over });

  const judge = (tx: DbTx, supplierId: string, rows: ParsedSupplierRow[], lock = false) =>
    judgeSupplierSheet(tx, supplierId, rows, { lock });
  const ship = (tx: DbTx, shipmentId: string, trackingNo: string) =>
    shipSupplierShipment(dispatchDeps, tx, { shipmentId, carrier: 'EPOST', trackingNo, actorId, at });
  const verdictOf = (rows: readonly RowVerdict[], r: ParsedSupplierRow) => {
    const v = rows.find((x) => x.rowNumber === r.rowNumber);
    if (!v) throw new Error(`no verdict for row ${r.rowNumber}`);
    return v;
  };
  const codes = (rows: readonly RowVerdict[]) => rows.map((v) => v.code ?? v.verdict);
  const EMPTY_PLAN = { shipGroups: [], corrections: [], reports: [] };

  it('ship: 상자 하나의 줄 전부가 같은 송장 → ship, plan 의 묶음에 그 상자의 라인 전부, 판정은 아무것도 쓰지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const supplierId = await seedDirectSupplier(tx);
      const o = await order(tx, supplierId, { dropQtys: [1, 2] });
      const rows = o.lines.map((l) => tracked(l, 'EP-1'));
      const [before] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, o.supplierBox));

      const j = await judge(tx, supplierId, rows, true);

      expect(j.rows.map((v) => v.verdict)).toEqual(['ship', 'ship']);
      expect(j.rows[0]).toEqual({
        rowNumber: rows[0].rowNumber,
        rowKey: o.lines[0].foiId,
        orderNo: o.lines[0].orderNo,
        verdict: 'ship',
        carrier: 'EPOST',
        trackingNo: 'EP1',
      });
      expect(j.plan).toEqual({
        shipGroups: [
          {
            carrier: 'EPOST',
            trackingNo: 'EP1',
            boxes: [{ shipmentId: o.supplierBox, lineIds: o.lines.map((l) => l.lineId).sort() }],
          },
        ],
        corrections: [],
        reports: [],
      });
      const [after] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, o.supplierBox));
      expect(after).toEqual(before);
      expect(
        await tx.select().from(wmsTables.waybills).where(eq(wmsTables.waybills.shipmentId, o.supplierBox)),
      ).toHaveLength(0);
    });
  });

  it('한 상자의 줄 셋 중 둘만 송장 T → ship 둘·waiting 하나, plan 은 그 상자에서 두 라인', async () => {
    await inRollbackTx(db, async (tx) => {
      const supplierId = await seedDirectSupplier(tx);
      const o = await order(tx, supplierId, { dropQtys: [1, 2, 3] });
      const rows = [tracked(o.lines[0], 'T-1'), tracked(o.lines[1], 'T-1'), row(o.lines[2])];
      const j = await judge(tx, supplierId, rows);
      expect(j.rows.map((v) => v.verdict)).toEqual(['ship', 'ship', 'waiting']);
      expect(j.plan.shipGroups).toEqual([
        {
          carrier: 'EPOST',
          trackingNo: 'T1',
          boxes: [{ shipmentId: o.supplierBox, lineIds: [o.lines[0].lineId, o.lines[1].lineId].sort() }],
        },
      ]);
    });
  });

  it('두 주문 상자의 줄이 같은 T → merge, plan 의 묶음에 상자 둘', async () => {
    await inRollbackTx(db, async (tx) => {
      const supplierId = await seedDirectSupplier(tx);
      const a = await order(tx, supplierId, { dropQtys: [1] });
      const b = await order(tx, supplierId, { dropQtys: [2, 3] });
      const rows = [tracked(a.lines[0], 'M-1'), tracked(b.lines[0], 'M-1'), tracked(b.lines[1], 'M 1')];
      const j = await judge(tx, supplierId, rows, true);
      expect(j.rows.map((v) => v.verdict)).toEqual(['merge', 'merge', 'merge']);
      expect(j.plan.shipGroups).toEqual([
        {
          carrier: 'EPOST',
          trackingNo: 'M1',
          boxes: [
            { shipmentId: a.supplierBox, lineIds: [a.lines[0].lineId] },
            { shipmentId: b.supplierBox, lineIds: b.lines.map((l) => l.lineId).sort() },
          ].sort((x, y) => x.shipmentId.localeCompare(y.shipmentId)),
        },
      ]);
    });
  });

  it('MERGE_RECIPIENT_MISMATCH: 수령인이 다른 두 상자에 같은 T → 묶음 전 줄, plan 에 묶음 없음', async () => {
    await inRollbackTx(db, async (tx) => {
      const supplierId = await seedDirectSupplier(tx);
      const a = await order(tx, supplierId, { dropQtys: [1] });
      const b = await order(tx, supplierId, { dropQtys: [2], recipient: OTHER_RECIPIENT });
      const j = await judge(tx, supplierId, [tracked(a.lines[0], 'M-2'), tracked(b.lines[0], 'M-2')]);
      expect(codes(j.rows)).toEqual(['MERGE_RECIPIENT_MISMATCH', 'MERGE_RECIPIENT_MISMATCH']);
      expect(j.rows.every((v) => v.verdict === 'error')).toBe(true);
      expect(j.plan).toEqual(EMPTY_PLAN);
    });
  });

  it('묶음 한 줄이 QTY_MISMATCH 면 나머지는 GROUP_HAS_ERROR, plan 에 그 묶음 없음', async () => {
    await inRollbackTx(db, async (tx) => {
      const supplierId = await seedDirectSupplier(tx);
      const a = await order(tx, supplierId, { dropQtys: [1] });
      const b = await order(tx, supplierId, { dropQtys: [2, 3] });
      const other = await order(tx, supplierId, { dropQtys: [1] });
      const rows = [
        tracked(a.lines[0], 'G-1'),
        tracked(b.lines[0], 'G-1', '우체국', { qty: 1 }),
        tracked(b.lines[1], 'G-1'),
        tracked(other.lines[0], 'G-2'),
      ];
      const j = await judge(tx, supplierId, rows);
      expect(codes(j.rows)).toEqual(['GROUP_HAS_ERROR', 'QTY_MISMATCH', 'GROUP_HAS_ERROR', 'ship']);
      expect(j.plan.shipGroups.map((g) => g.trackingNo)).toEqual(['G2']);
    });
  });

  it('unfulfillable: 사유 → unfulfillable 과 plan.reports, 이미 같은 사유면 unchanged, 바뀐 사유는 다시 unfulfillable', async () => {
    await inRollbackTx(db, async (tx) => {
      const supplierId = await seedDirectSupplier(tx);
      const o = await order(tx, supplierId, { dropQtys: [1, 2, 3] });
      await reportUnfulfillable(tx, { shipmentLineId: o.lines[1].lineId, reason: '품절', actorId, at });
      await reportUnfulfillable(tx, { shipmentLineId: o.lines[2].lineId, reason: '품절', actorId, at });
      const rows = [
        row(o.lines[0], { reason: ' 단종 ' }),
        row(o.lines[1], { reason: '품절' }),
        row(o.lines[2], { reason: '입고 지연' }),
      ];
      const j = await judge(tx, supplierId, rows);
      expect(j.rows.map((v) => v.verdict)).toEqual(['unfulfillable', 'unchanged', 'unfulfillable']);
      expect(j.plan).toEqual({
        shipGroups: [],
        corrections: [],
        reports: [
          { shipmentLineId: o.lines[0].lineId, reason: '단종' },
          { shipmentLineId: o.lines[2].lineId, reason: '입고 지연' },
        ].sort((x, y) => x.shipmentLineId.localeCompare(y.shipmentLineId)),
      });
    });
  });

  it('waiting: 빈 줄은 waiting, 이미 «못 보냄» 기록이 있어도 waiting 이고 plan 은 지우지 않는다(N8)', async () => {
    await inRollbackTx(db, async (tx) => {
      const supplierId = await seedDirectSupplier(tx);
      const o = await order(tx, supplierId, { dropQtys: [1, 2] });
      await reportUnfulfillable(tx, { shipmentLineId: o.lines[1].lineId, reason: '품절', actorId, at });
      const j = await judge(tx, supplierId, [row(o.lines[0]), row(o.lines[1])]);
      expect(j.rows.map((v) => v.verdict)).toEqual(['waiting', 'waiting']);
      expect(j.plan).toEqual(EMPTY_PLAN);
    });
  });

  it('correct·unchanged·REASON_ON_SHIPPED: 발송된 상자에 다른 번호/같은 번호(정규화)/사유', async () => {
    await inRollbackTx(db, async (tx) => {
      const supplierId = await seedDirectSupplier(tx);
      const a = await order(tx, supplierId, { dropQtys: [1] });
      const b = await order(tx, supplierId, { dropQtys: [1] });
      const c = await order(tx, supplierId, { dropQtys: [1] });
      await ship(tx, a.supplierBox, 'A-1');
      await ship(tx, b.supplierBox, 'B-1');
      await ship(tx, c.supplierBox, 'C-1');
      const rows = [
        tracked(a.lines[0], 'A-2', 'CJ대한통운'),
        tracked(b.lines[0], ' B 1 '),
        row(c.lines[0], { reason: '품절' }),
      ];
      const j = await judge(tx, supplierId, rows, true);
      expect(codes(j.rows)).toEqual(['correct', 'unchanged', 'REASON_ON_SHIPPED']);
      expect(verdictOf(j.rows, rows[0])).toMatchObject({ carrier: 'CJ', trackingNo: 'A2' });
      expect(j.plan).toEqual({
        shipGroups: [],
        corrections: [{ shipmentId: a.supplierBox, carrier: 'CJ', trackingNo: 'A2' }],
        reports: [],
      });
    });
  });

  it('합포장 뒤 발송된 상자의 옛 행 키 + 새 번호 → correct; 그 상자 줄 일부만 새 번호 → CORRECTION_PARTIAL', async () => {
    await inRollbackTx(db, async (tx) => {
      const supplierId = await seedDirectSupplier(tx);
      const a = await order(tx, supplierId, { dropQtys: [1] });
      const b = await order(tx, supplierId, { dropQtys: [2] });
      const merged = await mergeSupplierShipments(manifestDeps, tx, [a.supplierBox, b.supplierBox]);
      await ship(tx, merged, 'OLD-1');
      // 입점사는 합포장 전 시트(옛 상자 라인)를 그대로 채워 온다 — 행 키는 FOI id 라 새 상자로 찾아간다
      const full = await judge(tx, supplierId, [tracked(a.lines[0], 'NEW-1'), tracked(b.lines[0], 'NEW-1')]);
      expect(full.rows.map((v) => v.verdict)).toEqual(['correct', 'correct']);
      expect(full.plan.corrections).toEqual([{ shipmentId: merged, carrier: 'EPOST', trackingNo: 'NEW1' }]);

      const partial = await judge(tx, supplierId, [tracked(a.lines[0], 'NEW-1'), tracked(b.lines[0], 'OLD-1')]);
      expect(codes(partial.rows)).toEqual(['CORRECTION_PARTIAL', 'CORRECTION_PARTIAL']);
      const halfBlank = await judge(tx, supplierId, [tracked(a.lines[0], 'NEW-1'), row(b.lines[0])]);
      expect(codes(halfBlank.rows)).toEqual(['CORRECTION_PARTIAL', 'CORRECTION_PARTIAL']);
      const twoNumbers = await judge(tx, supplierId, [tracked(a.lines[0], 'NEW-1'), tracked(b.lines[0], 'NEW-2')]);
      expect(codes(twoNumbers.rows)).toEqual(['CORRECTION_PARTIAL', 'CORRECTION_PARTIAL']);
      expect(partial.plan).toEqual(EMPTY_PLAN);
    });
  });

  it('같은 시트를 발송 뒤 다시 → 전부 unchanged/waiting, plan 빔', async () => {
    await inRollbackTx(db, async (tx) => {
      const supplierId = await seedDirectSupplier(tx);
      const a = await order(tx, supplierId, { dropQtys: [1, 2] });
      const b = await order(tx, supplierId, { dropQtys: [1, 2] });
      const rows = [
        tracked(a.lines[0], '55-66'),
        tracked(a.lines[1], '55-66'),
        row(b.lines[0], { reason: '품절' }),
        row(b.lines[1]),
      ];
      const first = await judge(tx, supplierId, rows);
      expect(first.rows.map((v) => v.verdict)).toEqual(['ship', 'ship', 'unfulfillable', 'waiting']);
      await ship(tx, a.supplierBox, first.plan.shipGroups[0].trackingNo);
      await reportUnfulfillable(tx, { shipmentLineId: b.lines[0].lineId, reason: '품절', actorId, at });

      const again = await judge(tx, supplierId, rows);
      expect(again.rows.map((v) => v.verdict)).toEqual(['unchanged', 'unchanged', 'unchanged', 'waiting']);
      expect(again.plan).toEqual(EMPTY_PLAN);
    });
  });

  it("'우체국' 은 EPOST, '12-34 56' 은 '123456'", async () => {
    await inRollbackTx(db, async (tx) => {
      const supplierId = await seedDirectSupplier(tx);
      const o = await order(tx, supplierId, { dropQtys: [1] });
      const j = await judge(tx, supplierId, [tracked(o.lines[0], ' 12-34 56 ', ' 우체국 ')]);
      expect(j.rows[0]).toMatchObject({ verdict: 'ship', carrier: 'EPOST', trackingNo: '123456' });
      expect(j.plan.shipGroups[0]).toMatchObject({ carrier: 'EPOST', trackingNo: '123456' });
    });
  });

  it('UNKNOWN_ROW_KEY: uuid 아님·FOI 없음·살아 있는 입점사 라인 없음(창고 라인) / DUPLICATE_ROW: 같은 키 두 줄', async () => {
    await inRollbackTx(db, async (tx) => {
      const supplierId = await seedDirectSupplier(tx);
      const o = await order(tx, supplierId, { dropQtys: [1, 2], withWarehouseLine: true });
      if (!o.warehouseLine) throw new Error('expected a warehouse line');
      const rows = [
        row(o.lines[0], { rowKey: 'not-a-uuid' }),
        row(o.lines[0], { rowKey: randomUUID() }),
        row(o.warehouseLine),
        tracked(o.lines[1], 'D-1'),
        tracked(o.lines[1], 'D-1'),
      ];
      const j = await judge(tx, supplierId, rows);
      expect(codes(j.rows)).toEqual([
        'UNKNOWN_ROW_KEY',
        'UNKNOWN_ROW_KEY',
        'UNKNOWN_ROW_KEY',
        'DUPLICATE_ROW',
        'DUPLICATE_ROW',
      ]);
      expect(j.plan).toEqual(EMPTY_PLAN);
    });
  });

  it('OTHER_SUPPLIER: 다른 입점사 상자의 행 키', async () => {
    await inRollbackTx(db, async (tx) => {
      const supplierId = await seedDirectSupplier(tx);
      const otherSupplier = await seedDirectSupplier(tx);
      const o = await order(tx, otherSupplier, { dropQtys: [1] });
      const j = await judge(tx, supplierId, [tracked(o.lines[0], 'X-1')]);
      expect(codes(j.rows)).toEqual(['OTHER_SUPPLIER']);
    });
  });

  it('CANCELED: FOI 미결 0 — 라인이 상자에 남아 있어도, 묘비 상자로 빠졌어도', async () => {
    await inRollbackTx(db, async (tx) => {
      const supplierId = await seedDirectSupplier(tx);
      const o = await order(tx, supplierId, { dropQtys: [1, 2] });
      for (const line of o.lines) {
        await tx
          .update(wmsTables.fulfillmentOrderItems)
          .set({ canceledQty: sql`${wmsTables.fulfillmentOrderItems.qty}` })
          .where(eq(wmsTables.fulfillmentOrderItems.id, line.foiId));
      }
      // 둘째 라인은 묘비(canceled) 상자로 옮긴 것처럼 — 살아 있는 라인이 없다
      const [tomb] = await tx
        .insert(wmsTables.shipments)
        .values({ status: 'canceled', supplierId, recipientSnapshot: RECIPIENT })
        .returning();
      await tx
        .update(wmsTables.shipmentLines)
        .set({ shipmentId: tomb.id })
        .where(eq(wmsTables.shipmentLines.id, o.lines[1].lineId));
      const j = await judge(tx, supplierId, [tracked(o.lines[0], 'C-1'), row(o.lines[1])]);
      expect(codes(j.rows)).toEqual(['CANCELED', 'CANCELED']);
    });
  });

  it('NOT_HANDED_OFF·IN_RECOVERY: 넘기지 않은 상자, recovery_code 있는 상자', async () => {
    await inRollbackTx(db, async (tx) => {
      const supplierId = await seedDirectSupplier(tx);
      const a = await order(tx, supplierId, { dropQtys: [1], handOff: false });
      const b = await order(tx, supplierId, { dropQtys: [1] });
      await tx
        .update(wmsTables.shipments)
        .set({ recoveryCode: 'DISPATCH_RECALL_PENDING' })
        .where(eq(wmsTables.shipments.id, b.supplierBox));
      const j = await judge(tx, supplierId, [tracked(a.lines[0], 'N-1'), tracked(b.lines[0], 'N-2')]);
      expect(codes(j.rows)).toEqual(['NOT_HANDED_OFF', 'IN_RECOVERY']);
    });
  });

  it('ROW_MISMATCH(주문번호·공급사 상품코드) / QTY_MISMATCH(고친 수량·빈 수량)', async () => {
    await inRollbackTx(db, async (tx) => {
      const supplierId = await seedDirectSupplier(tx);
      const o = await order(tx, supplierId, { dropQtys: [1, 2, 3, 4] });
      const rows = [
        row(o.lines[0], { orderNo: 'WRONG' }),
        row(o.lines[1], { supplierSku: 'WRONG' }),
        row(o.lines[2], { qty: 1 }),
        row(o.lines[3], { qty: null }),
      ];
      const j = await judge(tx, supplierId, rows);
      expect(codes(j.rows)).toEqual(['ROW_MISMATCH', 'ROW_MISMATCH', 'QTY_MISMATCH', 'QTY_MISMATCH']);
    });
  });

  it('칸 조합: UNKNOWN_CARRIER · CARRIER_WITHOUT_TRACKING · TRACKING_WITHOUT_CARRIER · TRACKING_AND_REASON', async () => {
    await inRollbackTx(db, async (tx) => {
      const supplierId = await seedDirectSupplier(tx);
      const o = await order(tx, supplierId, { dropQtys: [1, 2, 3, 4] });
      const rows = [
        tracked(o.lines[0], 'K-1', '없는택배'),
        row(o.lines[1], { carrierRaw: 'CJ', trackingNo: ' - ' }),
        row(o.lines[2], { trackingNo: 'K-3' }),
        tracked(o.lines[3], 'K-4', '우체국', { reason: '품절' }),
      ];
      const j = await judge(tx, supplierId, rows);
      expect(codes(j.rows)).toEqual([
        'UNKNOWN_CARRIER',
        'CARRIER_WITHOUT_TRACKING',
        'TRACKING_WITHOUT_CARRIER',
        'TRACKING_AND_REASON',
      ]);
      expect(j.plan).toEqual(EMPTY_PLAN);
    });
  });

  it('TRACKING_IN_USE: 묶음 밖 상자에 그 번호의 살아 있는 송장이 있다(이미 발송된 상자) / 파일 안의 정정과 겹친다 / 같은 번호에 택배사 둘', async () => {
    await inRollbackTx(db, async (tx) => {
      const supplierId = await seedDirectSupplier(tx);
      const shipped = await order(tx, supplierId, { dropQtys: [1] });
      const draft = await order(tx, supplierId, { dropQtys: [1] });
      const corrected = await order(tx, supplierId, { dropQtys: [1] });
      const draft2 = await order(tx, supplierId, { dropQtys: [1] });
      const draft3 = await order(tx, supplierId, { dropQtys: [1] });
      const draft4 = await order(tx, supplierId, { dropQtys: [1] });
      await ship(tx, shipped.supplierBox, 'U-1');
      await ship(tx, corrected.supplierBox, 'U-9');
      const rows = [
        tracked(shipped.lines[0], 'U-1'),
        tracked(draft.lines[0], 'U-1'),
        tracked(corrected.lines[0], 'U-2'),
        tracked(draft2.lines[0], 'U-2'),
        tracked(draft3.lines[0], 'U-3', '우체국'),
        tracked(draft4.lines[0], 'U-3', 'CJ'),
      ];
      const j = await judge(tx, supplierId, rows);
      expect(codes(j.rows)).toEqual([
        'unchanged',
        'TRACKING_IN_USE',
        'TRACKING_IN_USE',
        'TRACKING_IN_USE',
        'TRACKING_IN_USE',
        'TRACKING_IN_USE',
      ]);
      expect(j.plan).toEqual(EMPTY_PLAN);
    });
  });

  it('토큰은 같은 입력에 같고(잠금 여부 무관), 상자 manifest_version 이 바뀌면 다르다', async () => {
    await inRollbackTx(db, async (tx) => {
      const supplierId = await seedDirectSupplier(tx);
      const o = await order(tx, supplierId, { dropQtys: [1, 2] });
      const rows = [tracked(o.lines[0], 'TK-1'), row(o.lines[1])];
      const a = await judge(tx, supplierId, rows);
      const b = await judge(tx, supplierId, rows, true);
      expect(a.token).toMatch(/^[0-9a-f]{64}$/);
      expect(b.token).toBe(a.token);
      await tx
        .update(wmsTables.shipments)
        .set({ manifestVersion: sql`${wmsTables.shipments.manifestVersion} + 1` })
        .where(eq(wmsTables.shipments.id, o.supplierBox));
      const c = await judge(tx, supplierId, rows);
      expect(c.rows).toEqual(a.rows);
      expect(c.token).not.toBe(a.token);
    });
  });
  it('발송된 상자의 정정 줄 중 하나라도 오류면 나머지는 GROUP_HAS_ERROR, plan 에 정정 없음(N4)', async () => {
    await inRollbackTx(db, async (tx) => {
      const supplierId = await seedDirectSupplier(tx);
      const a = await order(tx, supplierId, { dropQtys: [1, 2] });
      const b = await order(tx, supplierId, { dropQtys: [1, 2] });
      await ship(tx, a.supplierBox, 'A-1');
      await ship(tx, b.supplierBox, 'B-1');
      const rows = [
        tracked(a.lines[0], 'A-2'),
        tracked(a.lines[1], 'A-2', '우체국', { qty: 1 }),
        tracked(b.lines[0], 'B-2'),
        row(b.lines[1], { reason: '품절' }),
      ];
      const j = await judge(tx, supplierId, rows);
      expect(codes(j.rows)).toEqual(['GROUP_HAS_ERROR', 'QTY_MISMATCH', 'GROUP_HAS_ERROR', 'REASON_ON_SHIPPED']);
      expect(j.plan).toEqual(EMPTY_PLAN);
    });
  });

  it('입점사 상자가 타지 않는 상태(in_transit)면 프로그래밍 Error — 상자 id 를 담는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const supplierId = await seedDirectSupplier(tx);
      const o = await order(tx, supplierId, { dropQtys: [1] });
      await ship(tx, o.supplierBox, 'IT-1');
      await tx
        .update(wmsTables.shipments)
        .set({ status: 'in_transit' })
        .where(eq(wmsTables.shipments.id, o.supplierBox));
      const err = await judge(tx, supplierId, [tracked(o.lines[0], 'IT-1')]).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(ApplicationException);
      expect((err as Error).message).toContain(o.supplierBox);
    });
  });

  it('토큰은 판정이 같아도 사유가 다르면 다르다(사유는 응답 판정에 없다)', async () => {
    await inRollbackTx(db, async (tx) => {
      const supplierId = await seedDirectSupplier(tx);
      const o = await order(tx, supplierId, { dropQtys: [1] });
      const r1 = row(o.lines[0], { reason: '품절' });
      const a = await judge(tx, supplierId, [r1]);
      const b = await judge(tx, supplierId, [{ ...r1, reason: '단종' }]);
      const c = await judge(tx, supplierId, [{ ...r1, reason: '  품절 ' }]);
      expect(b.rows).toEqual(a.rows);
      expect(a.rows[0]).not.toHaveProperty('reason');
      expect(b.token).not.toBe(a.token);
      expect(c.token).toBe(a.token);
    });
  });

  it('ROW_MISMATCH 는 DB 쪽도 앞뒤 공백을 지우고 비교한다(supplier_sku 가 공백을 품고 저장돼도)', async () => {
    await inRollbackTx(db, async (tx) => {
      const supplierId = await seedDirectSupplier(tx);
      const o = await order(tx, supplierId, { dropQtys: [1] });
      const [line] = await tx
        .select({ skuId: wmsTables.shipmentLines.skuId })
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, o.lines[0].lineId));
      await tx
        .update(wmsTables.skuSuppliers)
        .set({ supplierSku: '  SUP-SPACED  ' })
        .where(eq(wmsTables.skuSuppliers.skuId, line.skuId));
      const j = await judge(tx, supplierId, [row(o.lines[0], { supplierSku: 'SUP-SPACED' })]);
      expect(codes(j.rows)).toEqual(['waiting']);
      const wrong = await judge(tx, supplierId, [row(o.lines[0], { supplierSku: 'SUP-OTHER' })]);
      expect(codes(wrong.rows)).toEqual(['ROW_MISMATCH']);
    });
  });
});
