import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq, inArray, like } from 'drizzle-orm';
import { DbService } from '@app/db';
import { BadRequestError, ConflictError } from '@app/shared';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import { Database, inRollbackTx, makeInboundReceiptKernel } from '../../inbound/services/__fixtures__/inbound-harness';
import { InventoryIdempotencyService } from '../../core/services/inventory-idempotency.service';
import { InboundShipmentSkuMatcherReader } from './inbound-shipment-sku-matcher.reader';
import { InboundShipmentDraftManager } from './inbound-shipment-draft.manager';
import { InboundShipmentReader } from './inbound-shipment.reader';
import { InboundShipmentReceivingManager } from './inbound-shipment-receiving.manager';
import { ListCell } from './inbound-shipment-list.parser';
import { BadRequestException } from '@nestjs/common';
import { CancelBoxReceiptDto, ReceiveBoxDto } from '../dto/receive.dto';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const HEADER = ['박스번호', 'NO', '제품명', '수량', '옵션', '바코드', '총수량', '비고'];
const ENDPOINT = 'inbound_shipment.box.receive.v2';
const cell = (text: string, value: string | number | null = text): ListCell => ({ text, value });

/** 상자 확정 — spec §8.1·§8.2·§8.4·§8.7. 커널은 실물, 판매가능수량 재계산만 mock. */
describeIfDb('InboundShipmentReceivingManager (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: Database;
  const ACTOR = randomUUID();

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(client, { schema: wmsSchema });
  });
  afterAll(async () => {
    await client.end();
  });

  function build(trx: DbTx) {
    const dbService = {
      db: trx,
      run: <T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
    } as unknown as DbService<typeof wmsSchema>;
    const matcher = new InboundShipmentSkuMatcherReader(dbService);
    const recalculateAndPublishForSkus = jest.fn<Promise<unknown[]>, [string[], DbTx?]>().mockResolvedValue([]);
    const kernel = makeInboundReceiptKernel(db);
    return {
      kernel,
      drafts: new InboundShipmentDraftManager(dbService, matcher),
      reader: new InboundShipmentReader(dbService, matcher),
      receiving: new InboundShipmentReceivingManager(dbService, kernel, new InventoryIdempotencyService(dbService), {
        recalculateAndPublishForSkus,
      } as never),
      recalculateAndPublishForSkus,
    };
  }

  type Built = ReturnType<typeof build>;

  function row(rowNumber: number, box: string, qty: number, barcode: string, remark = '') {
    return {
      rowNumber,
      cells: [
        cell(box),
        cell(String(rowNumber)),
        cell(`prod-${rowNumber}`),
        cell(String(qty), qty),
        cell('opt'),
        cell(barcode),
        cell(String(qty), qty),
        cell(remark),
      ],
    };
  }

  async function seed(trx: DbTx) {
    const [warehouse] = await trx
      .insert(wmsTables.warehouses)
      .values({ name: `rc-wh-${randomUUID().slice(0, 8)}` })
      .returning();
    const [holder] = await trx
      .insert(wmsTables.holders)
      .values({ name: `rc-h-${randomUUID().slice(0, 8)}` })
      .returning();
    const skuIds: string[] = [];
    const barcodes: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const [sku] = await trx
        .insert(wmsTables.skus)
        .values({ name: `rc-sku-${i}`, code: `RC-${randomUUID().toUpperCase()}`.slice(0, 40), holderId: holder.id })
        .returning();
      const barcode = `8${Math.floor(Math.random() * 1e11)
        .toString()
        .padStart(11, '0')}`;
      await trx.insert(wmsTables.skuBarcodes).values({ skuId: sku.id, barcode });
      skuIds.push(sku.id);
      barcodes.push(barcode);
    }
    return { warehouseId: warehouse.id, skuIds, barcodes };
  }

  async function shipment(
    trx: DbTx,
    built: Built,
    warehouseId: string,
    rows: ReturnType<typeof row>[],
    opts: { confirm?: boolean; expectedArrival?: string | null; freeRows?: number[] } = {},
  ) {
    const { shipmentId } = await built.drafts.createDraft(
      {
        warehouseId,
        name: `synthetic-${randomUUID().slice(0, 6)}`,
        expectedArrival: opts.expectedArrival ?? null,
        sourceFileId: null,
        sourceFileName: 'a.xlsx',
        list: { header: HEADER, rows },
      },
      ACTOR,
      trx,
    );
    const lines = await trx
      .select()
      .from(wmsTables.inboundShipmentLines)
      .where(eq(wmsTables.inboundShipmentLines.shipmentId, shipmentId));
    const lineOf = (rowNumber: number) => {
      const found = lines.find((l) => l.rowNumber === rowNumber);
      if (!found) throw new Error(`no line for row ${rowNumber}`);
      return found.id;
    };
    for (const rowNumber of opts.freeRows ?? []) {
      await built.drafts.editLine(shipmentId, lineOf(rowNumber), { kind: 'free' }, {}, ACTOR, trx);
    }
    if (opts.confirm !== false) await built.drafts.confirm(shipmentId, ACTOR, trx);
    const boxes = await trx
      .select()
      .from(wmsTables.inboundShipmentBoxes)
      .where(eq(wmsTables.inboundShipmentBoxes.shipmentId, shipmentId));
    const boxOf = (label: string) => {
      const found = boxes.find((b) => b.label === label);
      if (!found) throw new Error(`no box ${label}`);
      return found.id;
    };
    return { shipmentId, lineOf, boxOf };
  }

  const dto = (
    counts: { lineId: string; countedQty: number }[],
    unplanned: { skuId: string; quantity: number }[] = [],
    idempotencyKey = randomUUID(),
  ): ReceiveBoxDto => ({ contractVersion: 2, idempotencyKey, counts, unplanned });

  const cancelDto = (idempotencyKey = randomUUID()): CancelBoxReceiptDto => ({ contractVersion: 2, idempotencyKey });

  async function boxRow(trx: DbTx, boxId: string) {
    const [b] = await trx
      .select()
      .from(wmsTables.inboundShipmentBoxes)
      .where(eq(wmsTables.inboundShipmentBoxes.id, boxId));
    return b;
  }

  async function shipmentRow(trx: DbTx, id: string) {
    const [s] = await trx.select().from(wmsTables.inboundShipments).where(eq(wmsTables.inboundShipments.id, id));
    return s;
  }

  async function shipmentStatus(trx: DbTx, id: string) {
    const [s] = await trx
      .select({ status: wmsTables.inboundShipments.status })
      .from(wmsTables.inboundShipments)
      .where(eq(wmsTables.inboundShipments.id, id));
    return s.status;
  }

  async function countsOf(trx: DbTx, boxId: string) {
    return trx
      .select()
      .from(wmsTables.inboundShipmentBoxCounts)
      .where(eq(wmsTables.inboundShipmentBoxCounts.boxId, boxId));
  }

  async function receiveEventsFor(trx: DbTx, key: string) {
    return trx
      .select()
      .from(wmsTables.stockEvents)
      .where(
        and(
          eq(wmsTables.stockEvents.transitionType, 'RECEIVE'),
          like(wmsTables.stockEvents.idempotencyKey, `${ENDPOINT}:${key}:%`),
        ),
      );
  }

  it('receives a box into the inbound default zone', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const built = build(trx);
      const s = await shipment(trx, built, f.warehouseId, [
        row(1, 'L1', 20, f.barcodes[0]),
        row(2, 'L1', 5, f.barcodes[1]),
        row(3, 'L2', 7, f.barcodes[2]),
      ]);
      const request = dto([
        { lineId: s.lineOf(1), countedQty: 20 },
        { lineId: s.lineOf(2), countedQty: 5 },
      ]);

      const result = await built.receiving.receiveBox(s.shipmentId, s.boxOf('L1'), request, ACTOR, trx);

      expect(result.boxId).toBe(s.boxOf('L1'));
      expect(result.shipmentStatus).toBe('receiving');
      expect(result.countIds).toHaveLength(2);
      expect(result.receiptId).not.toBeNull();
      const [receipt] = await trx
        .select()
        .from(wmsTables.inboundReceipts)
        .where(eq(wmsTables.inboundReceipts.id, result.receiptId ?? ''));
      const [zone] = await trx
        .select({ id: wmsTables.locations.id })
        .from(wmsTables.locations)
        .where(
          and(
            eq(wmsTables.locations.warehouseId, f.warehouseId),
            eq(wmsTables.locations.systemRole, 'inbound_default'),
          ),
        );
      expect(receipt).toMatchObject({ method: 'planned', totalQuantity: 25, locationId: zone.id });
      const receiptLines = await trx
        .select()
        .from(wmsTables.inboundReceiptLines)
        .where(eq(wmsTables.inboundReceiptLines.receiptId, receipt.id));
      expect(receiptLines.map((l) => l.source)).toEqual(['inbound_shipment', 'inbound_shipment']);
      const events = await receiveEventsFor(trx, request.idempotencyKey ?? '');
      expect(events.map((e) => e.idempotencyKey).sort()).toEqual([
        `${ENDPOINT}:${request.idempotencyKey}:0`,
        `${ENDPOINT}:${request.idempotencyKey}:1`,
      ]);
      const [box] = await trx
        .select()
        .from(wmsTables.inboundShipmentBoxes)
        .where(eq(wmsTables.inboundShipmentBoxes.id, s.boxOf('L1')));
      expect(box).toMatchObject({ status: 'received', receiptId: receipt.id, receivedBy: ACTOR });
      expect(await shipmentStatus(trx, s.shipmentId)).toBe('receiving');
      const counts = await countsOf(trx, s.boxOf('L1'));
      expect(counts.every((c) => c.receiptLineId !== null)).toBe(true);
      expect(built.recalculateAndPublishForSkus).toHaveBeenCalledTimes(1);
      expect([...built.recalculateAndPublishForSkus.mock.calls[0][0]].sort()).toEqual(
        [f.skuIds[0], f.skuIds[1]].sort(),
      );
    });
  });

  it('counts must cover every line of the box exactly once', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const built = build(trx);
      const s = await shipment(trx, built, f.warehouseId, [
        row(1, 'L1', 20, f.barcodes[0]),
        row(2, 'L1', 5, f.barcodes[1]),
        row(3, 'L2', 7, f.barcodes[2]),
      ]);
      const box = s.boxOf('L1');
      const missing = dto([{ lineId: s.lineOf(1), countedQty: 20 }]);
      await expect(built.receiving.receiveBox(s.shipmentId, box, missing, ACTOR, trx)).rejects.toBeInstanceOf(
        BadRequestError,
      );
      const foreign = dto([
        { lineId: s.lineOf(1), countedQty: 20 },
        { lineId: s.lineOf(2), countedQty: 5 },
        { lineId: s.lineOf(3), countedQty: 7 },
      ]);
      await expect(built.receiving.receiveBox(s.shipmentId, box, foreign, ACTOR, trx)).rejects.toBeInstanceOf(
        BadRequestError,
      );
      const duplicate = dto([
        { lineId: s.lineOf(1), countedQty: 20 },
        { lineId: s.lineOf(1), countedQty: 20 },
        { lineId: s.lineOf(2), countedQty: 5 },
      ]);
      await expect(built.receiving.receiveBox(s.shipmentId, box, duplicate, ACTOR, trx)).rejects.toBeInstanceOf(
        BadRequestError,
      );
      expect(await countsOf(trx, box)).toHaveLength(0);
    });
  });

  it('zero is recorded, not skipped', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const built = build(trx);
      const s = await shipment(trx, built, f.warehouseId, [
        row(1, 'L1', 20, f.barcodes[0]),
        row(2, 'L1', 5, f.barcodes[1]),
        row(3, 'L2', 7, f.barcodes[2]),
      ]);
      const request = dto([
        { lineId: s.lineOf(1), countedQty: 0 },
        { lineId: s.lineOf(2), countedQty: 5 },
      ]);
      await built.receiving.receiveBox(s.shipmentId, s.boxOf('L1'), request, ACTOR, trx);

      const counts = await countsOf(trx, s.boxOf('L1'));
      const zero = counts.find((c) => c.lineId === s.lineOf(1));
      expect(zero).toMatchObject({ countedQty: 0, receiptLineId: null, skuId: f.skuIds[0] });
      expect(await receiveEventsFor(trx, request.idempotencyKey ?? '')).toHaveLength(1);

      // 상자 전체가 0 이면 회차 자체가 없다
      const allZero = dto([{ lineId: s.lineOf(3), countedQty: 0 }]);
      const result = await built.receiving.receiveBox(s.shipmentId, s.boxOf('L2'), allZero, ACTOR, trx);
      expect(result.receiptId).toBeNull();
      expect(await receiveEventsFor(trx, allZero.idempotencyKey ?? '')).toHaveLength(0);
      expect(built.recalculateAndPublishForSkus).toHaveBeenCalledTimes(1);
    });
  });

  it('free line is counted without ledger', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const built = build(trx);
      const s = await shipment(trx, built, f.warehouseId, [row(1, 'L1', 3, '8000000000000')], { freeRows: [1] });
      const request = dto([{ lineId: s.lineOf(1), countedQty: 3 }]);

      const result = await built.receiving.receiveBox(s.shipmentId, s.boxOf('L1'), request, ACTOR, trx);

      expect(result.receiptId).toBeNull();
      const counts = await countsOf(trx, s.boxOf('L1'));
      expect(counts).toHaveLength(1);
      expect(counts[0]).toMatchObject({ lineId: s.lineOf(1), skuId: null, countedQty: 3, receiptLineId: null });
      expect(await receiveEventsFor(trx, request.idempotencyKey ?? '')).toHaveLength(0);
      expect(built.recalculateAndPublishForSkus).not.toHaveBeenCalled();
    });
  });

  it('unplanned item becomes a count without a line', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const built = build(trx);
      const s = await shipment(trx, built, f.warehouseId, [row(1, 'L1', 4, f.barcodes[0])]);
      const request = dto([{ lineId: s.lineOf(1), countedQty: 0 }], [{ skuId: f.skuIds[2], quantity: 2 }]);

      const result = await built.receiving.receiveBox(s.shipmentId, s.boxOf('L1'), request, ACTOR, trx);

      const counts = await countsOf(trx, s.boxOf('L1'));
      const unplanned = counts.find((c) => c.lineId === null);
      expect(unplanned).toMatchObject({ skuId: f.skuIds[2], countedQty: 2 });
      expect(unplanned?.receiptLineId).not.toBeNull();
      expect(result.countIds).toHaveLength(2);
      expect(await receiveEventsFor(trx, request.idempotencyKey ?? '')).toHaveLength(1);
    });
  });

  it('same SKU on two lines in one box gets two receipt lines', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const built = build(trx);
      const s = await shipment(trx, built, f.warehouseId, [
        row(1, 'L1', 10, f.barcodes[0]),
        row(2, 'L1', 4, f.barcodes[0]),
      ]);
      const request = dto([
        { lineId: s.lineOf(1), countedQty: 10 },
        { lineId: s.lineOf(2), countedQty: 4 },
      ]);

      const result = await built.receiving.receiveBox(s.shipmentId, s.boxOf('L1'), request, ACTOR, trx);

      const receiptLines = await trx
        .select()
        .from(wmsTables.inboundReceiptLines)
        .where(eq(wmsTables.inboundReceiptLines.receiptId, result.receiptId ?? ''));
      expect(receiptLines).toHaveLength(2);
      expect(receiptLines.every((l) => l.skuId === f.skuIds[0])).toBe(true);
      const qtyOf = new Map(receiptLines.map((l) => [l.id, l.quantity]));
      const counts = await countsOf(trx, s.boxOf('L1'));
      for (const c of counts) expect(qtyOf.get(c.receiptLineId ?? '')).toBe(c.countedQty);
      expect(new Set(counts.map((c) => c.receiptLineId)).size).toBe(2);
      expect(await receiveEventsFor(trx, request.idempotencyKey ?? '')).toHaveLength(2);
    });
  });

  it('forward box cannot be received', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const built = build(trx);
      const s = await shipment(trx, built, f.warehouseId, [
        row(1, 'L1', 10, f.barcodes[0]),
        row(2, 'L2', 5, f.barcodes[1], 'acme 에 발송바람'),
      ]);
      await expect(
        built.receiving.receiveBox(
          s.shipmentId,
          s.boxOf('L2'),
          dto([{ lineId: s.lineOf(2), countedQty: 5 }]),
          ACTOR,
          trx,
        ),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  it('retry with same key replays; a second key is 409', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const built = build(trx);
      const s = await shipment(trx, built, f.warehouseId, [row(1, 'L1', 10, f.barcodes[0])]);
      const request = dto([{ lineId: s.lineOf(1), countedQty: 10 }]);

      const first = await built.receiving.receiveBox(s.shipmentId, s.boxOf('L1'), request, ACTOR, trx);
      const replay = await built.receiving.receiveBox(s.shipmentId, s.boxOf('L1'), { ...request }, ACTOR, trx);

      expect(replay).toEqual(first);
      expect(await receiveEventsFor(trx, request.idempotencyKey ?? '')).toHaveLength(1);
      expect(await countsOf(trx, s.boxOf('L1'))).toHaveLength(1);
      await expect(
        built.receiving.receiveBox(
          s.shipmentId,
          s.boxOf('L1'),
          dto([{ lineId: s.lineOf(1), countedQty: 10 }]),
          ACTOR,
          trx,
        ),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  it('last stock box closes the shipment', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const built = build(trx);
      const s = await shipment(trx, built, f.warehouseId, [
        row(1, 'L1', 10, f.barcodes[0]),
        row(2, 'L2', 5, f.barcodes[1]),
        row(3, 'L3', 2, f.barcodes[2], 'acme 에 발송바람'),
      ]);
      const r1 = await built.receiving.receiveBox(
        s.shipmentId,
        s.boxOf('L1'),
        dto([{ lineId: s.lineOf(1), countedQty: 10 }]),
        ACTOR,
        trx,
      );
      expect(r1.shipmentStatus).toBe('receiving');
      const r2 = await built.receiving.receiveBox(
        s.shipmentId,
        s.boxOf('L2'),
        dto([{ lineId: s.lineOf(2), countedQty: 5 }]),
        ACTOR,
        trx,
      );
      expect(r2.shipmentStatus).toBe('closed');
      expect(await shipmentStatus(trx, s.shipmentId)).toBe('closed');
    });
  });

  it('findBoxes returns both shipments for a shared label', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const built = build(trx);
      const later = await shipment(
        trx,
        built,
        f.warehouseId,
        [
          row(1, 'L3', 1, f.barcodes[0]),
          row(2, 'L3', 1, f.barcodes[1]),
          row(3, 'L3', 1, f.barcodes[2]),
          row(4, 'L3', 1, f.barcodes[0]),
        ],
        { expectedArrival: '2026-12-01' },
      );
      const sooner = await shipment(trx, built, f.warehouseId, [row(7, 'L3', 2, f.barcodes[1])], {
        expectedArrival: '2026-11-20',
      });

      const found = await built.reader.findBoxes(f.warehouseId, ' l3 ', trx);

      expect(found.map((c) => c.shipmentId)).toEqual([sooner.shipmentId, later.shipmentId]);
      expect(found.map((c) => c.label)).toEqual(['L3', 'L3']);
      expect(found[1].previewItems).toEqual(['prod-1', 'prod-2', 'prod-3']);
      expect(found[0].previewItems).toEqual(['prod-7']);
      for (const c of found) expect(c.previewItems.length).toBeLessThanOrEqual(3);

      await trx
        .update(wmsTables.inboundShipments)
        .set({ status: 'closed' })
        .where(eq(wmsTables.inboundShipments.id, later.shipmentId));
      const afterClose = await built.reader.findBoxes(f.warehouseId, 'L3', trx);
      expect(afterClose.map((c) => c.shipmentId)).toEqual([sooner.shipmentId]);

      await expect(built.reader.findBoxes(f.warehouseId, 'L3-L5', trx)).rejects.toBeInstanceOf(BadRequestError);
    });
  });

  it('openBox shows lines with counts already taken from other boxes', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const built = build(trx);
      const s = await shipment(trx, built, f.warehouseId, [
        row(1, 'L1-L2', 30, f.barcodes[0]),
        row(2, 'L3', 4, f.barcodes[1], 'acme 에 발송바람'),
      ]);
      await built.receiving.receiveBox(
        s.shipmentId,
        s.boxOf('L1'),
        dto([{ lineId: s.lineOf(1), countedQty: 12 }]),
        ACTOR,
        trx,
      );

      const view = await built.reader.openBox(s.shipmentId, s.boxOf('L2'), trx);
      expect(view.lines).toEqual([
        expect.objectContaining({
          lineId: s.lineOf(1),
          kind: 'sku',
          skuId: f.skuIds[0],
          productName: 'prod-1',
          expectedQty: 30,
          coversBoxLabels: ['L1', 'L2'],
          alreadyCountedInOtherBoxes: 12,
        }),
      ]);
      expect(view.forwardNote).toBeNull();
      const forward = await built.reader.openBox(s.shipmentId, s.boxOf('L3'), trx);
      expect(forward.forwardNote).toBe('acme 에 발송바람');
    });
  });

  it('added box receives unplanned only', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const built = build(trx);
      const s = await shipment(trx, built, f.warehouseId, [row(1, 'L1', 10, f.barcodes[0])]);

      const added = await built.receiving.addBox(s.shipmentId, 'l99', ACTOR, trx);
      expect(added.label).toBe('L99');
      await expect(built.receiving.addBox(s.shipmentId, 'L99', ACTOR, trx)).rejects.toBeInstanceOf(ConflictError);
      await expect(built.receiving.addBox(s.shipmentId, 'L5-L9', ACTOR, trx)).rejects.toBeInstanceOf(BadRequestError);

      const result = await built.receiving.receiveBox(
        s.shipmentId,
        added.boxId,
        dto([], [{ skuId: f.skuIds[1], quantity: 1 }]),
        ACTOR,
        trx,
      );
      expect(result.receiptId).not.toBeNull();
      const [box] = await trx
        .select()
        .from(wmsTables.inboundShipmentBoxes)
        .where(eq(wmsTables.inboundShipmentBoxes.id, added.boxId));
      expect(box).toMatchObject({ origin: 'added', status: 'received' });
      const found = await built.reader.findBoxes(f.warehouseId, 'L99', trx);
      expect(found).toEqual([expect.objectContaining({ boxId: added.boxId, previewItems: [] })]);
    });
  });

  it('coverage is checked before an unresolved line is refused', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const built = build(trx);
      const s = await shipment(trx, built, f.warehouseId, [
        row(1, 'L1', 10, f.barcodes[0]),
        row(2, 'L1', 5, f.barcodes[1]),
      ]);
      // 확정이 막았어야 할 상태를 DB 에서 직접 만든다(방어선 확인)
      await trx
        .update(wmsTables.inboundShipmentLines)
        .set({ kind: 'unresolved', skuId: null })
        .where(eq(wmsTables.inboundShipmentLines.id, s.lineOf(1)));
      const box = s.boxOf('L1');

      await expect(
        built.receiving.receiveBox(s.shipmentId, box, dto([{ lineId: s.lineOf(1), countedQty: 10 }]), ACTOR, trx),
      ).rejects.toBeInstanceOf(BadRequestError);
      await expect(
        built.receiving.receiveBox(
          s.shipmentId,
          box,
          dto([
            { lineId: s.lineOf(1), countedQty: 10 },
            { lineId: s.lineOf(1), countedQty: 10 },
            { lineId: s.lineOf(2), countedQty: 5 },
          ]),
          ACTOR,
          trx,
        ),
      ).rejects.toBeInstanceOf(BadRequestError);
      await expect(
        built.receiving.receiveBox(
          s.shipmentId,
          box,
          dto([
            { lineId: s.lineOf(1), countedQty: 10 },
            { lineId: s.lineOf(2), countedQty: 5 },
          ]),
          ACTOR,
          trx,
        ),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(await countsOf(trx, box)).toHaveLength(0);
    });
  });

  it('a closed shipment refuses receive and addBox', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const built = build(trx);
      const s = await shipment(trx, built, f.warehouseId, [
        row(1, 'L1', 10, f.barcodes[0]),
        row(2, 'L2', 5, f.barcodes[1]),
      ]);
      await trx
        .update(wmsTables.inboundShipments)
        .set({ status: 'closed', closedReason: 'lost box (synthetic)' })
        .where(eq(wmsTables.inboundShipments.id, s.shipmentId));

      await expect(
        built.receiving.receiveBox(
          s.shipmentId,
          s.boxOf('L1'),
          dto([{ lineId: s.lineOf(1), countedQty: 10 }]),
          ACTOR,
          trx,
        ),
      ).rejects.toBeInstanceOf(ConflictError);
      await expect(built.receiving.addBox(s.shipmentId, 'L9', ACTOR, trx)).rejects.toBeInstanceOf(ConflictError);
    });
  });

  it('auto close stamps closed_at and closed_by with no reason', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const built = build(trx);
      const s = await shipment(trx, built, f.warehouseId, [row(1, 'L1', 10, f.barcodes[0])]);
      const before = new Date(Date.now() - 1000);

      const result = await built.receiving.receiveBox(
        s.shipmentId,
        s.boxOf('L1'),
        dto([{ lineId: s.lineOf(1), countedQty: 10 }]),
        ACTOR,
        trx,
      );

      expect(result.shipmentStatus).toBe('closed');
      const [row1] = await trx
        .select()
        .from(wmsTables.inboundShipments)
        .where(eq(wmsTables.inboundShipments.id, s.shipmentId));
      expect(row1).toMatchObject({ status: 'closed', closedBy: ACTOR, closedReason: null });
      expect(row1.closedAt).not.toBeNull();
      expect((row1.closedAt ?? new Date(0)).getTime()).toBeGreaterThanOrEqual(before.getTime());
    });
  });

  it('draft shipment boxes cannot be received', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const built = build(trx);
      const s = await shipment(trx, built, f.warehouseId, [row(1, 'L1', 10, f.barcodes[0])], { confirm: false });
      await expect(
        built.receiving.receiveBox(
          s.shipmentId,
          s.boxOf('L1'),
          dto([{ lineId: s.lineOf(1), countedQty: 10 }]),
          ACTOR,
          trx,
        ),
      ).rejects.toBeInstanceOf(ConflictError);
      await expect(built.receiving.addBox(s.shipmentId, 'L9', ACTOR, trx)).rejects.toBeInstanceOf(ConflictError);
    });
  });

  it('unplanned SKU must exist', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const built = build(trx);
      const s = await shipment(trx, built, f.warehouseId, [row(1, 'L1', 10, f.barcodes[0])]);
      await expect(
        built.receiving.receiveBox(
          s.shipmentId,
          s.boxOf('L1'),
          dto([{ lineId: s.lineOf(1), countedQty: 10 }], [{ skuId: randomUUID(), quantity: 1 }]),
          ACTOR,
          trx,
        ),
      ).rejects.toBeInstanceOf(BadRequestError);
      const remaining = await trx
        .select()
        .from(wmsTables.inboundShipmentBoxCounts)
        .where(inArray(wmsTables.inboundShipmentBoxCounts.boxId, [s.boxOf('L1')]));
      expect(remaining).toHaveLength(0);
    });
  });
  it('cancel restores the box and reverses the ledger', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const built = build(trx);
      const s = await shipment(trx, built, f.warehouseId, [
        row(1, 'L1', 20, f.barcodes[0]),
        row(2, 'L1', 5, f.barcodes[1]),
        row(3, 'L2', 7, f.barcodes[2]),
      ]);
      const box = s.boxOf('L1');
      const counts = [
        { lineId: s.lineOf(1), countedQty: 20 },
        { lineId: s.lineOf(2), countedQty: 5 },
      ];
      const received = await built.receiving.receiveBox(s.shipmentId, box, dto(counts), ACTOR, trx);
      built.recalculateAndPublishForSkus.mockClear();

      const request = cancelDto();
      const result = await built.receiving.cancelBoxReceipt(s.shipmentId, box, request, ACTOR, trx);

      expect(result).toMatchObject({ boxId: box, shipmentStatus: 'expected' });
      expect(await boxRow(trx, box)).toMatchObject({ status: 'open', receiptId: null, receivedAt: null });
      const receiptLines = await trx
        .select()
        .from(wmsTables.inboundReceiptLines)
        .where(eq(wmsTables.inboundReceiptLines.receiptId, received.receiptId ?? ''));
      expect(receiptLines).toHaveLength(2);
      for (const l of receiptLines) expect(l.canceledQty).toBe(l.quantity);
      const rows = await countsOf(trx, box);
      expect(rows).toHaveLength(2);
      expect(rows.every((c) => c.canceledAt !== null && c.canceledBy === ACTOR)).toBe(true);
      expect(await shipmentStatus(trx, s.shipmentId)).toBe('expected');
      expect(built.recalculateAndPublishForSkus).toHaveBeenCalledTimes(1);
      expect([...built.recalculateAndPublishForSkus.mock.calls[0][0]].sort()).toEqual(
        [f.skuIds[0], f.skuIds[1]].sort(),
      );

      // 같은 키 재시도는 같은 응답
      expect(await built.receiving.cancelBoxReceipt(s.shipmentId, box, { ...request }, ACTOR, trx)).toEqual(result);
      // 열린 상자를 또 취소하면 409
      await expect(built.receiving.cancelBoxReceipt(s.shipmentId, box, cancelDto(), ACTOR, trx)).rejects.toBeInstanceOf(
        ConflictError,
      );

      // 같은 상자를 다시 확정할 수 있다
      const again = await built.receiving.receiveBox(s.shipmentId, box, dto(counts), ACTOR, trx);
      expect(again.shipmentStatus).toBe('receiving');
      const live = (await countsOf(trx, box)).filter((c) => c.canceledAt === null);
      expect(live).toHaveLength(2);
      const view = await built.reader.detail(s.shipmentId, trx);
      expect(view.lines.find((l) => l.id === s.lineOf(1))?.countedQty).toBe(20);
    });
  });

  it('cancel on a closed shipment returns it to receiving', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const built = build(trx);
      const s = await shipment(trx, built, f.warehouseId, [
        row(1, 'L1', 10, f.barcodes[0]),
        row(2, 'L2', 5, f.barcodes[1]),
      ]);
      await built.receiving.receiveBox(
        s.shipmentId,
        s.boxOf('L1'),
        dto([{ lineId: s.lineOf(1), countedQty: 10 }]),
        ACTOR,
        trx,
      );
      const closed = await built.receiving.receiveBox(
        s.shipmentId,
        s.boxOf('L2'),
        dto([{ lineId: s.lineOf(2), countedQty: 5 }]),
        ACTOR,
        trx,
      );
      expect(closed.shipmentStatus).toBe('closed');

      const result = await built.receiving.cancelBoxReceipt(s.shipmentId, s.boxOf('L2'), cancelDto(), ACTOR, trx);

      expect(result.shipmentStatus).toBe('receiving');
      expect(await shipmentRow(trx, s.shipmentId)).toMatchObject({
        status: 'receiving',
        closedAt: null,
        closedBy: null,
        closedReason: null,
      });

      // 사람이 닫은 선적도 취소하면 다시 열린다
      await built.drafts.close(s.shipmentId, 'lost box (synthetic)', ACTOR, trx);
      const reopened = await built.receiving.cancelBoxReceipt(s.shipmentId, s.boxOf('L1'), cancelDto(), ACTOR, trx);
      expect(reopened.shipmentStatus).toBe('expected');
      expect(await shipmentRow(trx, s.shipmentId)).toMatchObject({ status: 'expected', closedReason: null });
    });
  });

  it('cancel after putaway is refused by the kernel', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const built = build(trx);
      const s = await shipment(trx, built, f.warehouseId, [
        row(1, 'L1', 10, f.barcodes[0]),
        row(2, 'L2', 5, f.barcodes[1]),
      ]);
      const box = s.boxOf('L1');
      await built.receiving.receiveBox(s.shipmentId, box, dto([{ lineId: s.lineOf(1), countedQty: 10 }]), ACTOR, trx);
      const [count] = await countsOf(trx, box);
      const [shelf] = await trx
        .insert(wmsTables.locations)
        .values({
          warehouseId: f.warehouseId,
          code: `RC-PUT-${randomUUID().slice(0, 8)}`,
          locationType: 'zone',
          isSystem: false,
          systemRole: null,
          isActive: true,
        })
        .returning();
      await makeInboundReceiptKernel(db).putaway(
        {
          receiptLineId: count.receiptLineId ?? '',
          toLocationId: shelf.id,
          quantity: 1,
          eventKey: `rc-put-${randomUUID()}`,
        },
        trx,
      );
      built.recalculateAndPublishForSkus.mockClear();

      const attempt = built.receiving.cancelBoxReceipt(s.shipmentId, box, cancelDto(), ACTOR, trx);
      await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
      await expect(attempt).rejects.toThrow('cannot cancel: putaway exists; move all back to origin first');
      expect(await boxRow(trx, box)).toMatchObject({ status: 'received' });
      expect((await countsOf(trx, box)).every((c) => c.canceledAt === null)).toBe(true);
      expect(built.recalculateAndPublishForSkus).not.toHaveBeenCalled();
    });
  });

  it('cancel of a box received without ledger rows reopens it without the kernel', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const built = build(trx);
      const s = await shipment(
        trx,
        built,
        f.warehouseId,
        [row(1, 'L1', 4, f.barcodes[0]), row(2, 'L2', 3, '8000000000000')],
        { freeRows: [2] },
      );
      await built.receiving.receiveBox(
        s.shipmentId,
        s.boxOf('L1'),
        dto([{ lineId: s.lineOf(1), countedQty: 0 }]),
        ACTOR,
        trx,
      );
      await built.receiving.receiveBox(
        s.shipmentId,
        s.boxOf('L2'),
        dto([{ lineId: s.lineOf(2), countedQty: 3 }]),
        ACTOR,
        trx,
      );
      expect(await shipmentStatus(trx, s.shipmentId)).toBe('closed');

      const result = await built.receiving.cancelBoxReceipt(s.shipmentId, s.boxOf('L2'), cancelDto(), ACTOR, trx);

      expect(result.shipmentStatus).toBe('receiving');
      expect(await boxRow(trx, s.boxOf('L2'))).toMatchObject({ status: 'open', receiptId: null });
      expect((await countsOf(trx, s.boxOf('L2'))).every((c) => c.canceledAt !== null)).toBe(true);
      expect(built.recalculateAndPublishForSkus).not.toHaveBeenCalled();
    });
  });

  it('manual close blocks receive; reopen allows it', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const built = build(trx);
      const s = await shipment(trx, built, f.warehouseId, [
        row(1, 'L1', 10, f.barcodes[0]),
        row(2, 'L2', 5, f.barcodes[1]),
      ]);
      await built.receiving.receiveBox(
        s.shipmentId,
        s.boxOf('L1'),
        dto([{ lineId: s.lineOf(1), countedQty: 10 }]),
        ACTOR,
        trx,
      );

      await expect(built.drafts.close(s.shipmentId, '   ', ACTOR, trx)).rejects.toBeInstanceOf(BadRequestError);
      await expect(built.drafts.close(s.shipmentId, 'x'.repeat(501), ACTOR, trx)).rejects.toBeInstanceOf(
        BadRequestError,
      );
      await expect(built.drafts.reopen(s.shipmentId, ACTOR, trx)).rejects.toBeInstanceOf(ConflictError);

      const closed = await built.drafts.close(s.shipmentId, '  lost box (synthetic)  ', ACTOR, trx);
      expect(closed).toEqual({ shipmentId: s.shipmentId, status: 'closed' });
      const row1 = await shipmentRow(trx, s.shipmentId);
      expect(row1).toMatchObject({ status: 'closed', closedBy: ACTOR, closedReason: 'lost box (synthetic)' });
      expect(row1.closedAt).not.toBeNull();
      await expect(built.drafts.close(s.shipmentId, 'again', ACTOR, trx)).rejects.toBeInstanceOf(ConflictError);

      const l2 = dto([{ lineId: s.lineOf(2), countedQty: 5 }]);
      await expect(built.receiving.receiveBox(s.shipmentId, s.boxOf('L2'), l2, ACTOR, trx)).rejects.toBeInstanceOf(
        ConflictError,
      );

      const reopened = await built.drafts.reopen(s.shipmentId, ACTOR, trx);
      expect(reopened).toEqual({ shipmentId: s.shipmentId, status: 'receiving' });
      expect(await shipmentRow(trx, s.shipmentId)).toMatchObject({
        status: 'receiving',
        closedAt: null,
        closedBy: null,
        closedReason: null,
      });

      const done = await built.receiving.receiveBox(
        s.shipmentId,
        s.boxOf('L2'),
        dto([{ lineId: s.lineOf(2), countedQty: 5 }]),
        ACTOR,
        trx,
      );
      expect(done.shipmentStatus).toBe('closed');
      // 저절로 닫힌 선적은 다시 열지 않는다 — 확정 취소로 연다
      await expect(built.drafts.reopen(s.shipmentId, ACTOR, trx)).rejects.toBeInstanceOf(ConflictError);
    });
  });

  it('reopen with no received stock box goes back to expected', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const built = build(trx);
      const s = await shipment(trx, built, f.warehouseId, [row(1, 'L1', 10, f.barcodes[0])]);
      await built.drafts.close(s.shipmentId, 'never shipped (synthetic)', ACTOR, trx);
      expect(await built.drafts.reopen(s.shipmentId, ACTOR, trx)).toEqual({
        shipmentId: s.shipmentId,
        status: 'expected',
      });
      const draft = await shipment(trx, built, f.warehouseId, [row(2, 'L1', 1, f.barcodes[1])], { confirm: false });
      await expect(built.drafts.close(draft.shipmentId, 'nope', ACTOR, trx)).rejects.toBeInstanceOf(ConflictError);
    });
  });

  it('detail reports short, over and unplanned', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const built = build(trx);
      const s = await shipment(trx, built, f.warehouseId, [
        row(1, 'L1', 10, f.barcodes[0]),
        row(2, 'L2', 5, f.barcodes[1]),
        row(3, 'L3', 4, f.barcodes[2]),
        row(4, 'L4', 2, f.barcodes[2], 'acme 에 발송바람'),
      ]);
      await built.receiving.receiveBox(
        s.shipmentId,
        s.boxOf('L1'),
        dto([{ lineId: s.lineOf(1), countedQty: 8 }]),
        ACTOR,
        trx,
      );
      await built.receiving.receiveBox(
        s.shipmentId,
        s.boxOf('L2'),
        dto([{ lineId: s.lineOf(2), countedQty: 7 }], [{ skuId: f.skuIds[2], quantity: 1 }]),
        ACTOR,
        trx,
      );
      const added = await built.receiving.addBox(s.shipmentId, 'L99', ACTOR, trx);

      const view = await built.reader.detail(s.shipmentId, trx);

      const diffOf = (rowNumber: number) => view.lines.find((l) => l.id === s.lineOf(rowNumber))?.difference;
      expect(diffOf(1)).toEqual({ state: 'short', counted: 8, expected: 10 });
      expect(diffOf(2)).toEqual({ state: 'over', counted: 7, expected: 5 });
      expect(diffOf(3)).toEqual({ state: 'pending', counted: 0, expected: 4 });
      expect(diffOf(4)).toEqual({ state: 'pending', counted: 0, expected: 2 });
      expect(view.summary).toEqual({
        boxesReceived: 2,
        boxesTotalStock: 4,
        forwardBoxes: 1,
        addedBoxes: 1,
        shortLines: 1,
        overLines: 1,
        notArrivedLines: 0,
        unplannedCounts: 1,
      });
      expect(added.label).toBe('L99');
    });
  });
  /** 두 SKU 줄을 한 상자로 받는다. 회차 라인 id 순서가 SKU 순서와 반대가 될 때까지 새 선적으로 다시 만든다. */
  async function receivedTwoSkuBox(trx: DbTx, built: Built, f: Awaited<ReturnType<typeof seed>>, opposite: boolean) {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const s = await shipment(trx, built, f.warehouseId, [
        row(1, 'L1', 6, f.barcodes[0]),
        row(2, 'L1', 4, f.barcodes[1]),
        row(3, 'L2', 1, f.barcodes[2]),
      ]);
      const box = s.boxOf('L1');
      const received = await built.receiving.receiveBox(
        s.shipmentId,
        box,
        dto([
          { lineId: s.lineOf(1), countedQty: 6 },
          { lineId: s.lineOf(2), countedQty: 4 },
        ]),
        ACTOR,
        trx,
      );
      const lines = await trx
        .select()
        .from(wmsTables.inboundReceiptLines)
        .where(eq(wmsTables.inboundReceiptLines.receiptId, received.receiptId ?? ''));
      const [lo, hi] = [...lines].sort((a, b) => (a.skuId < b.skuId ? -1 : 1));
      if (!opposite || lo.id > hi.id) return { s, box, lo, hi };
    }
    throw new Error('could not build receipt lines whose id order is opposite to their sku order');
  }

  it('cancel calls the kernel in sku order, not receipt line order', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const built = build(trx);
      const { s, box, lo, hi } = await receivedTwoSkuBox(trx, built, f, true);
      expect(lo.id > hi.id).toBe(true);
      const spy = jest.spyOn(built.kernel, 'cancelLine');

      await built.receiving.cancelBoxReceipt(s.shipmentId, box, cancelDto(), ACTOR, trx);

      expect(spy.mock.calls.map(([input]) => input.receiptLineId)).toEqual([lo.id, hi.id]);
    });
  });

  it('a refusal on the second line leaves the first line uncanceled', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const built = build(trx);
      const { s, box, lo, hi } = await receivedTwoSkuBox(trx, built, f, false);
      const [shelf] = await trx
        .insert(wmsTables.locations)
        .values({
          warehouseId: f.warehouseId,
          code: `RC-PUT-${randomUUID().slice(0, 8)}`,
          locationType: 'zone',
          isSystem: false,
          systemRole: null,
          isActive: true,
        })
        .returning();
      // 커널이 두 번째로 취소할 줄(SKU 가 큰 쪽)에 적치를 걸어 둔다
      await built.kernel.putaway(
        { receiptLineId: hi.id, toLocationId: shelf.id, quantity: 1, eventKey: `rc-put-${randomUUID()}` },
        trx,
      );
      const spy = jest.spyOn(built.kernel, 'cancelLine');

      // 호출자가 준 트랜잭션 안에서는 세이브포인트가 있어야 첫 줄의 취소가 함께 되돌아간다
      await expect(
        trx.transaction((sp) => built.receiving.cancelBoxReceipt(s.shipmentId, box, cancelDto(), ACTOR, sp)),
      ).rejects.toThrow('cannot cancel: putaway exists; move all back to origin first');

      expect(spy.mock.calls.map(([input]) => input.receiptLineId)).toEqual([lo.id, hi.id]);
      const [first] = await trx
        .select()
        .from(wmsTables.inboundReceiptLines)
        .where(eq(wmsTables.inboundReceiptLines.id, lo.id));
      expect(first.canceledQty).toBe(0);
      const reversals = await trx
        .select()
        .from(wmsTables.stockEvents)
        .where(eq(wmsTables.stockEvents.reversalOfEventId, lo.eventId ?? ''));
      expect(reversals).toHaveLength(0);
      expect(await boxRow(trx, box)).toMatchObject({ status: 'received' });
      expect((await countsOf(trx, box)).every((c) => c.canceledAt === null)).toBe(true);
    });
  });

  it('manual close shows lines of open boxes as not arrived; reopen makes them pending again', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const built = build(trx);
      const s = await shipment(trx, built, f.warehouseId, [
        row(1, 'L1', 10, f.barcodes[0]),
        row(2, 'L2', 5, f.barcodes[1]),
        row(3, 'L3', 2, f.barcodes[2], 'acme 에 발송바람'),
      ]);
      await built.receiving.receiveBox(
        s.shipmentId,
        s.boxOf('L1'),
        dto([{ lineId: s.lineOf(1), countedQty: 10 }]),
        ACTOR,
        trx,
      );
      await built.drafts.close(s.shipmentId, 'lost box (synthetic)', ACTOR, trx);

      const closed = await built.reader.detail(s.shipmentId, trx);
      const diffOf = (view: typeof closed, rowNumber: number) =>
        view.lines.find((l) => l.id === s.lineOf(rowNumber))?.difference;
      expect(diffOf(closed, 1)).toEqual({ state: 'match', counted: 10, expected: 10 });
      expect(diffOf(closed, 2)).toEqual({ state: 'not_arrived', counted: 0, expected: 5 });
      // 전달용 상자의 줄은 받지 않으므로 «안 옴»이 아니다
      expect(diffOf(closed, 3)).toEqual({ state: 'pending', counted: 0, expected: 2 });
      expect(closed.summary).toMatchObject({ notArrivedLines: 1, shortLines: 0, overLines: 0 });

      await built.drafts.reopen(s.shipmentId, ACTOR, trx);
      const reopened = await built.reader.detail(s.shipmentId, trx);
      expect(diffOf(reopened, 2)).toEqual({ state: 'pending', counted: 0, expected: 5 });
      expect(reopened.summary.notArrivedLines).toBe(0);
    });
  });
});
