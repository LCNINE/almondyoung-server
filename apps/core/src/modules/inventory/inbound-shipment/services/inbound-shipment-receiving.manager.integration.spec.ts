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
import { ReceiveBoxDto } from '../dto/receive.dto';

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
    return {
      drafts: new InboundShipmentDraftManager(dbService, matcher),
      reader: new InboundShipmentReader(dbService, matcher),
      receiving: new InboundShipmentReceivingManager(
        dbService,
        makeInboundReceiptKernel(db),
        new InventoryIdempotencyService(dbService),
        { recalculateAndPublishForSkus } as never,
      ),
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
});
