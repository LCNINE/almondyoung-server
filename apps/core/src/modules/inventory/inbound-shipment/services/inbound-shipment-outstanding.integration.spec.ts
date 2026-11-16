import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import { Database, inRollbackTx, makeInboundReceiptKernel } from '../../inbound/services/__fixtures__/inbound-harness';
import { InventoryIdempotencyService } from '../../core/services/inventory-idempotency.service';
import { InboundShipmentSkuMatcherReader } from './inbound-shipment-sku-matcher.reader';
import { InboundShipmentDraftManager } from './inbound-shipment-draft.manager';
import { InboundShipmentReader } from './inbound-shipment.reader';
import { InboundShipmentReceivingManager } from './inbound-shipment-receiving.manager';
import { ListCell } from './inbound-shipment-list.parser';
import { outstandingShipmentLineWhere, outstandingShipmentQtySql } from './inbound-shipment-outstanding.sql';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const HEADER = ['박스번호', 'NO', '제품명', '수량', '옵션', '바코드', '총수량', '비고'];
const cell = (text: string, value: string | number | null = text): ListCell => ({ text, value });

/** «오는 중» 조각 — 설계 §5. 외부 선적만 센다. 상세 화면(reader.detail)과의 파리티도 여기서 고정한다. */
describeIfDb('inbound shipment outstanding SQL (DB integration)', () => {
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
    const kernel = makeInboundReceiptKernel(db);
    return {
      drafts: new InboundShipmentDraftManager(dbService, matcher, {
        recalculateAndPublishForSkus: jest.fn().mockResolvedValue([]),
      } as never),
      reader: new InboundShipmentReader(dbService, matcher),
      receiving: new InboundShipmentReceivingManager(kernel, new InventoryIdempotencyService(dbService), {
        recalculateAndPublishForSkus: jest.fn().mockResolvedValue([]),
      } as never),
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
      .values({ name: `os-wh-${randomUUID().slice(0, 8)}` })
      .returning();
    const [holder] = await trx
      .insert(wmsTables.holders)
      .values({ name: `os-h-${randomUUID().slice(0, 8)}` })
      .returning();
    const skuIds: string[] = [];
    const barcodes: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const [sku] = await trx
        .insert(wmsTables.skus)
        .values({ name: `os-sku-${i}`, code: `OS-${randomUUID().toUpperCase()}`.slice(0, 40), holderId: holder.id })
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
    opts: { confirm?: boolean; expectedArrival?: string | null } = {},
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
    if (opts.confirm !== false) {
      const forwardIds = (
        await trx
          .select({ id: wmsTables.inboundShipmentBoxes.id })
          .from(wmsTables.inboundShipmentBoxes)
          .where(
            and(
              eq(wmsTables.inboundShipmentBoxes.shipmentId, shipmentId),
              eq(wmsTables.inboundShipmentBoxes.disposition, 'forward'),
            ),
          )
      ).map((r) => r.id);
      await built.drafts.confirm(shipmentId, forwardIds, ACTOR, trx);
    }
    const boxes = await trx
      .select()
      .from(wmsTables.inboundShipmentBoxes)
      .where(eq(wmsTables.inboundShipmentBoxes.shipmentId, shipmentId));
    const lineOf = (rowNumber: number) => {
      const found = lines.find((l) => l.rowNumber === rowNumber);
      if (!found) throw new Error(`no line for row ${rowNumber}`);
      return found.id;
    };
    const boxOf = (label: string) => {
      const found = boxes.find((b) => b.label === label);
      if (!found) throw new Error(`no box ${label}`);
      return found.id;
    };
    return { shipmentId, lineOf, boxOf };
  }

  const dto = (counts: { lineId: string; countedQty: number; method: 'counted' | 'list' }[]) => ({
    contractVersion: 2 as const,
    idempotencyKey: randomUUID(),
    counts,
    unplanned: [],
  });

  async function outstanding(trx: DbTx, shipmentId: string) {
    const l = wmsTables.inboundShipmentLines;
    const s = wmsTables.inboundShipments;
    return trx
      .select({ lineId: l.id, skuId: l.skuId, qty: outstandingShipmentQtySql() })
      .from(l)
      .innerJoin(s, eq(s.id, l.shipmentId))
      .where(and(outstandingShipmentLineWhere(), eq(s.id, shipmentId)));
  }

  it('counts full expected qty for a confirmed shipment with no receipts', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const built = build(trx);
      const s = await shipment(trx, built, f.warehouseId, [row(1, 'L1', 10, f.barcodes[0])]);
      const rows = await outstanding(trx, s.shipmentId);
      expect(rows).toEqual([{ lineId: s.lineOf(1), skuId: f.skuIds[0], qty: 10 }]);
    });
  });

  it('range line partially received keeps line-level remainder', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const built = build(trx);
      const s = await shipment(trx, built, f.warehouseId, [row(1, 'L5-L9', 1076, f.barcodes[0])]);
      await built.receiving.receiveBox(
        s.shipmentId,
        s.boxOf('L5'),
        dto([{ lineId: s.lineOf(1), countedQty: 300, method: 'counted' }]),
        ACTOR,
        trx,
      );
      const rows = await outstanding(trx, s.shipmentId);
      expect(rows).toEqual([{ lineId: s.lineOf(1), skuId: f.skuIds[0], qty: 776 }]);
    });
  });

  it('drops a line when its last stock box is confirmed with zero', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const built = build(trx);
      const s = await shipment(trx, built, f.warehouseId, [row(1, 'L1', 5, f.barcodes[0])]);
      await built.receiving.receiveBox(
        s.shipmentId,
        s.boxOf('L1'),
        dto([{ lineId: s.lineOf(1), countedQty: 0, method: 'counted' }]),
        ACTOR,
        trx,
      );
      expect(await outstanding(trx, s.shipmentId)).toEqual([]);
    });
  });

  it('excludes lines covering only forward boxes', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const built = build(trx);
      const s = await shipment(trx, built, f.warehouseId, [
        row(1, 'L1', 10, f.barcodes[0], 'acme 에 발송바람'),
        row(2, 'L2', 4, f.barcodes[1]),
      ]);
      const rows = await outstanding(trx, s.shipmentId);
      expect(rows).toEqual([{ lineId: s.lineOf(2), skuId: f.skuIds[1], qty: 4 }]);
    });
  });

  it('excludes draft, manually closed, canceled shipments', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const built = build(trx);
      const draft = await shipment(trx, built, f.warehouseId, [row(1, 'L1', 3, f.barcodes[0])], { confirm: false });
      const closed = await shipment(trx, built, f.warehouseId, [row(1, 'L1', 3, f.barcodes[0])]);
      await built.drafts.close(closed.shipmentId, 'never arrived', ACTOR, trx);
      const canceled = await shipment(trx, built, f.warehouseId, [row(1, 'L1', 3, f.barcodes[0])], { confirm: false });
      await built.drafts.cancel(canceled.shipmentId, ACTOR, trx);
      expect(await outstanding(trx, draft.shipmentId)).toEqual([]);
      expect(await outstanding(trx, closed.shipmentId)).toEqual([]);
      expect(await outstanding(trx, canceled.shipmentId)).toEqual([]);
    });
  });

  it('canceled box receipt restores the remainder', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const built = build(trx);
      const s = await shipment(trx, built, f.warehouseId, [
        row(1, 'L1', 10, f.barcodes[0]),
        row(2, 'L2', 2, f.barcodes[1]),
      ]);
      await built.receiving.receiveBox(
        s.shipmentId,
        s.boxOf('L1'),
        dto([{ lineId: s.lineOf(1), countedQty: 10, method: 'counted' }]),
        ACTOR,
        trx,
      );
      expect((await outstanding(trx, s.shipmentId)).map((r) => r.lineId)).toEqual([s.lineOf(2)]);
      await built.receiving.cancelBoxReceipt(
        s.shipmentId,
        s.boxOf('L1'),
        { contractVersion: 2, idempotencyKey: randomUUID() },
        ACTOR,
        trx,
      );
      const rows = await outstanding(trx, s.shipmentId);
      expect(rows.find((r) => r.lineId === s.lineOf(1))?.qty).toBe(10);
    });
  });

  it('includes shipments with null expected_arrival and past expected_arrival', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const built = build(trx);
      const noDate = await shipment(trx, built, f.warehouseId, [row(1, 'L1', 6, f.barcodes[0])], {
        expectedArrival: null,
      });
      const late = await shipment(trx, built, f.warehouseId, [row(1, 'L1', 7, f.barcodes[0])], {
        expectedArrival: '2000-01-01',
      });
      expect((await outstanding(trx, noDate.shipmentId)).map((r) => r.qty)).toEqual([6]);
      expect((await outstanding(trx, late.shipmentId)).map((r) => r.qty)).toEqual([7]);
    });
  });

  it('matches detail view line remainders', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const built = build(trx);
      const s = await shipment(trx, built, f.warehouseId, [
        row(1, 'L1-L2', 100, f.barcodes[0]),
        row(2, 'L3', 20, f.barcodes[1]),
        row(3, 'L4', 9, f.barcodes[2], 'acme 에 발송바람'),
        row(4, 'L5', 8, f.barcodes[2]),
      ]);
      await built.receiving.receiveBox(
        s.shipmentId,
        s.boxOf('L1'),
        dto([{ lineId: s.lineOf(1), countedQty: 40, method: 'counted' }]),
        ACTOR,
        trx,
      );
      await built.receiving.receiveBox(
        s.shipmentId,
        s.boxOf('L5'),
        dto([{ lineId: s.lineOf(4), countedQty: 8, method: 'counted' }]),
        ACTOR,
        trx,
      );

      const detail = await built.reader.detail(s.shipmentId, trx);
      const openStock = new Set(
        detail.boxes.filter((b) => b.disposition === 'stock' && b.status === 'open').map((b) => b.label),
      );
      const fromDetail = detail.lines
        .filter((l) => l.kind === 'sku' && l.coversBoxLabels.some((label) => openStock.has(label)))
        .reduce((sum, l) => sum + Math.max((l.difference.expected ?? 0) - l.difference.counted, 0), 0);
      const fromSql = (await outstanding(trx, s.shipmentId)).reduce((sum, r) => sum + Number(r.qty), 0);
      expect(fromDetail).toBe(80);
      expect(fromSql).toBe(fromDetail);
    });
  });
});
