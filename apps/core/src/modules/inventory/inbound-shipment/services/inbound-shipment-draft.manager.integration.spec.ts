import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import { Database, inRollbackTx } from '../../inbound/services/__fixtures__/inbound-harness';
import { InboundShipmentSkuMatcherReader } from './inbound-shipment-sku-matcher.reader';
import { InboundShipmentDraftManager, CreateDraftInput } from './inbound-shipment-draft.manager';
import { InboundShipmentReader } from './inbound-shipment.reader';
import { ListCell, ListInput } from './inbound-shipment-list.parser';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const HEADER = ['박스번호', 'NO', '제품명', '수량', '옵션', '바코드', '총수량', '비고'];
const cell = (text: string, value: string | number | null = text): ListCell => ({ text, value });

describeIfDb('InboundShipmentDraftManager (DB integration)', () => {
  jest.setTimeout(60_000);
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
    return {
      manager: new InboundShipmentDraftManager(dbService, new InboundShipmentSkuMatcherReader(dbService)),
      reader: new InboundShipmentReader(dbService),
    };
  }

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
    const [warehouse] = await trx.insert(wmsTables.warehouses).values({ name: `ds-wh-${randomUUID().slice(0, 8)}` }).returning();
    const [holder] = await trx.insert(wmsTables.holders).values({ name: `ds-h-${randomUUID().slice(0, 8)}` }).returning();
    const skuIds: string[] = [];
    const barcodes: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const [sku] = await trx
        .insert(wmsTables.skus)
        .values({ name: `ds-sku-${i}`, code: `DS-${randomUUID().toUpperCase()}`.slice(0, 40), holderId: holder.id })
        .returning();
      const barcode = `8${Math.floor(Math.random() * 1e11).toString().padStart(11, '0')}`;
      await trx.insert(wmsTables.skuBarcodes).values({ skuId: sku.id, barcode });
      skuIds.push(sku.id);
      barcodes.push(barcode);
    }
    return { warehouseId: warehouse.id, skuIds, barcodes };
  }

  function input(warehouseId: string, list: ListInput): CreateDraftInput {
    return { warehouseId, name: 'synthetic', expectedArrival: null, sourceFileId: null, sourceFileName: 'a.xlsx', list };
  }

  it('creates boxes, lines and coverage', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const { manager } = build(trx);
      const { shipmentId } = await manager.createDraft(
        input(f.warehouseId, {
          header: HEADER,
          rows: [row(1, 'L1', 10, f.barcodes[0]), row(2, 'L1', 5, f.barcodes[1]), row(3, 'L5-L9', 20, f.barcodes[2])],
        }),
        ACTOR,
        trx,
      );
      const [shipment] = await trx.select().from(wmsTables.inboundShipments).where(eq(wmsTables.inboundShipments.id, shipmentId));
      expect(shipment.status).toBe('draft');
      const boxes = await trx.select().from(wmsTables.inboundShipmentBoxes).where(eq(wmsTables.inboundShipmentBoxes.shipmentId, shipmentId));
      expect(boxes).toHaveLength(6);
      expect(boxes.every((b) => b.origin === 'list')).toBe(true);
      const lines = await trx.select().from(wmsTables.inboundShipmentLines).where(eq(wmsTables.inboundShipmentLines.shipmentId, shipmentId));
      expect(lines).toHaveLength(3);
      expect(lines.every((l) => l.kind === 'sku' && l.resolution === 'barcode')).toBe(true);
      const rangeLine = lines.find((l) => l.rowNumber === 3);
      const cover = await trx.select().from(wmsTables.inboundShipmentLineBoxes).where(eq(wmsTables.inboundShipmentLineBoxes.lineId, rangeLine!.id));
      expect(cover).toHaveLength(5);

      const { reader } = build(trx);
      const detail = await reader.detail(shipmentId, trx);
      expect(detail.boxes).toHaveLength(6);
      expect(detail.lines).toHaveLength(3);
      expect(detail.lines.find((l) => l.rowNumber === 3)?.coversBoxLabels).toHaveLength(5);
      expect(detail.lines[0].difference).toBeNull();
    });
  });

  it('unmatched barcode stays unresolved with issue', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const { manager } = build(trx);
      const { shipmentId } = await manager.createDraft(
        input(f.warehouseId, { header: HEADER, rows: [row(1, 'L1', 10, '7000000000001')] }),
        ACTOR,
        trx,
      );
      const [line] = await trx.select().from(wmsTables.inboundShipmentLines).where(eq(wmsTables.inboundShipmentLines.shipmentId, shipmentId));
      expect(line.kind).toBe('unresolved');
      expect(line.skuId).toBeNull();
      expect(line.issues).toContain('barcode_not_found');
    });
  });

  it('forward hint marks the box forward', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const { manager } = build(trx);
      const note = 'acme 에 발송바람';
      const { shipmentId } = await manager.createDraft(
        input(f.warehouseId, {
          header: HEADER,
          rows: [row(1, 'L1', 10, f.barcodes[0], note), row(2, 'L2', 5, f.barcodes[1])],
        }),
        ACTOR,
        trx,
      );
      const boxes = await trx.select().from(wmsTables.inboundShipmentBoxes).where(eq(wmsTables.inboundShipmentBoxes.shipmentId, shipmentId));
      const l1 = boxes.find((b) => b.label === 'L1');
      const l2 = boxes.find((b) => b.label === 'L2');
      expect(l1?.disposition).toBe('forward');
      expect(l1?.forwardNote).toBe(note);
      expect(l2?.disposition).toBe('stock');
    });
  });

  it('keeps raw cells', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const { manager } = build(trx);
      const { shipmentId } = await manager.createDraft(
        input(f.warehouseId, { header: HEADER, rows: [row(1, 'L1', 10, f.barcodes[0])] }),
        ACTOR,
        trx,
      );
      const [line] = await trx.select().from(wmsTables.inboundShipmentLines).where(eq(wmsTables.inboundShipmentLines.shipmentId, shipmentId));
      expect((line.raw as { option: { text: string } }).option.text).toBe('opt');
    });
  });
});
