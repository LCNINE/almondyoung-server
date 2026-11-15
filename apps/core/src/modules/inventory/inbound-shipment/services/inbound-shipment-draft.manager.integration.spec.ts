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
import { ConflictError, NotFoundError, BadRequestError } from '@app/shared';
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
    const matcher = new InboundShipmentSkuMatcherReader(dbService);
    return {
      manager: new InboundShipmentDraftManager(dbService, matcher),
      reader: new InboundShipmentReader(dbService, matcher),
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
    const [warehouse] = await trx
      .insert(wmsTables.warehouses)
      .values({ name: `ds-wh-${randomUUID().slice(0, 8)}` })
      .returning();
    const [holder] = await trx
      .insert(wmsTables.holders)
      .values({ name: `ds-h-${randomUUID().slice(0, 8)}` })
      .returning();
    const skuIds: string[] = [];
    const barcodes: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const [sku] = await trx
        .insert(wmsTables.skus)
        .values({ name: `ds-sku-${i}`, code: `DS-${randomUUID().toUpperCase()}`.slice(0, 40), holderId: holder.id })
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

  function input(warehouseId: string, list: ListInput): CreateDraftInput {
    return {
      warehouseId,
      name: 'synthetic',
      expectedArrival: null,
      sourceFileId: null,
      sourceFileName: 'a.xlsx',
      list,
    };
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
      const [shipment] = await trx
        .select()
        .from(wmsTables.inboundShipments)
        .where(eq(wmsTables.inboundShipments.id, shipmentId));
      expect(shipment.status).toBe('draft');
      const boxes = await trx
        .select()
        .from(wmsTables.inboundShipmentBoxes)
        .where(eq(wmsTables.inboundShipmentBoxes.shipmentId, shipmentId));
      expect(boxes).toHaveLength(6);
      expect(boxes.every((b) => b.origin === 'list')).toBe(true);
      const lines = await trx
        .select()
        .from(wmsTables.inboundShipmentLines)
        .where(eq(wmsTables.inboundShipmentLines.shipmentId, shipmentId));
      expect(lines).toHaveLength(3);
      expect(lines.every((l) => l.kind === 'sku' && l.resolution === 'barcode')).toBe(true);
      const rangeLine = lines.find((l) => l.rowNumber === 3);
      const cover = await trx
        .select()
        .from(wmsTables.inboundShipmentLineBoxes)
        .where(eq(wmsTables.inboundShipmentLineBoxes.lineId, rangeLine!.id));
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
      const [line] = await trx
        .select()
        .from(wmsTables.inboundShipmentLines)
        .where(eq(wmsTables.inboundShipmentLines.shipmentId, shipmentId));
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
      const boxes = await trx
        .select()
        .from(wmsTables.inboundShipmentBoxes)
        .where(eq(wmsTables.inboundShipmentBoxes.shipmentId, shipmentId));
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
      const [line] = await trx
        .select()
        .from(wmsTables.inboundShipmentLines)
        .where(eq(wmsTables.inboundShipmentLines.shipmentId, shipmentId));
      expect((line.raw as { option: { text: string } }).option.text).toBe('opt');
    });
  });

  it('packing_unit barcode stays unresolved but detail shows the candidate', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      await trx
        .update(wmsTables.skuBarcodes)
        .set({ packingUnit: 12 })
        .where(eq(wmsTables.skuBarcodes.skuId, f.skuIds[0]));
      const { manager, reader } = build(trx);
      const { shipmentId } = await manager.createDraft(
        input(f.warehouseId, { header: HEADER, rows: [row(1, 'L1', 10, f.barcodes[0])] }),
        ACTOR,
        trx,
      );
      const detail = await reader.detail(shipmentId, trx);
      expect(detail.lines[0].kind).toBe('unresolved');
      expect(detail.lines[0].issues).toContain('packing_unit_barcode');
      expect(detail.lines[0].barcodeCandidates.map((c) => c.skuId)).toEqual([f.skuIds[0]]);
      expect(detail.lines[0].barcodeCandidates[0].name).toBe('ds-sku-0');
    });
  });

  it('ambiguous barcode lists both SKUs', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const [other] = await trx.select().from(wmsTables.skus).where(eq(wmsTables.skus.id, f.skuIds[1]));
      await trx.update(wmsTables.skus).set({ code: f.barcodes[0] }).where(eq(wmsTables.skus.id, other.id));
      const { manager, reader } = build(trx);
      const { shipmentId } = await manager.createDraft(
        input(f.warehouseId, { header: HEADER, rows: [row(1, 'L1', 10, f.barcodes[0])] }),
        ACTOR,
        trx,
      );
      const detail = await reader.detail(shipmentId, trx);
      expect(detail.lines[0].issues).toContain('barcode_ambiguous');
      expect(detail.lines[0].barcodeCandidates.map((c) => c.skuId).sort()).toEqual([f.skuIds[0], f.skuIds[1]].sort());
    });
  });

  it('matched barcode with invalid qty is unresolved but keeps the candidate', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const { manager, reader } = build(trx);
      const bad = row(1, 'L1', 10, f.barcodes[0]);
      bad.cells[3] = cell('abc', 'abc');
      const { shipmentId } = await manager.createDraft(
        input(f.warehouseId, { header: HEADER, rows: [bad] }),
        ACTOR,
        trx,
      );
      const detail = await reader.detail(shipmentId, trx);
      expect(detail.lines[0].kind).toBe('unresolved');
      expect(detail.lines[0].issues).toContain('qty_invalid');
      expect(detail.lines[0].barcodeCandidates.map((c) => c.skuId)).toEqual([f.skuIds[0]]);
    });
  });

  it('sku lines have no barcode candidates', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const { manager, reader } = build(trx);
      const { shipmentId } = await manager.createDraft(
        input(f.warehouseId, { header: HEADER, rows: [row(1, 'L1', 10, f.barcodes[0])] }),
        ACTOR,
        trx,
      );
      expect((await reader.detail(shipmentId, trx)).lines[0].barcodeCandidates).toEqual([]);
    });
  });

  it('unknown warehouse is NotFound', async () => {
    await inRollbackTx(db, async (trx) => {
      const f = await seed(trx);
      const { manager } = build(trx);
      await expect(
        manager.createDraft(
          input(randomUUID(), { header: HEADER, rows: [row(1, 'L1', 10, f.barcodes[0])] }),
          ACTOR,
          trx,
        ),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('draft editing and confirm', () => {
    async function draftWithUnresolved(trx: DbTx) {
      const f = await seed(trx);
      const { manager } = build(trx);
      const { shipmentId } = await manager.createDraft(
        input(f.warehouseId, {
          header: HEADER,
          rows: [row(1, 'L1', 10, f.barcodes[0]), row(2, 'L2', 5, '7000000000001')],
        }),
        ACTOR,
        trx,
      );
      const lines = await trx
        .select()
        .from(wmsTables.inboundShipmentLines)
        .where(eq(wmsTables.inboundShipmentLines.shipmentId, shipmentId));
      const unresolved = lines.find((l) => l.kind === 'unresolved')!;
      return { f, manager, shipmentId, unresolved, lines };
    }

    it('resolving the last unresolved line lets confirm pass', async () => {
      await inRollbackTx(db, async (trx) => {
        const { manager, shipmentId, unresolved } = await draftWithUnresolved(trx);
        await expect(manager.confirm(shipmentId, ACTOR, trx)).rejects.toThrow(ConflictError);
        await manager.editLine(shipmentId, unresolved.id, { kind: 'free' }, {}, ACTOR, trx);
        const result = await manager.confirm(shipmentId, ACTOR, trx);
        expect(result.status).toBe('expected');
        const [s] = await trx
          .select()
          .from(wmsTables.inboundShipments)
          .where(eq(wmsTables.inboundShipments.id, shipmentId));
        expect(s.status).toBe('expected');
        expect(s.confirmedBy).toBe(ACTOR);
        const [line] = await trx
          .select()
          .from(wmsTables.inboundShipmentLines)
          .where(eq(wmsTables.inboundShipmentLines.id, unresolved.id));
        expect(line.kind).toBe('free');
        expect(line.resolution).toBe('manual');
      });
    });

    it('ai candidates do not resolve a line', async () => {
      await inRollbackTx(db, async (trx) => {
        const { f, manager, shipmentId, unresolved } = await draftWithUnresolved(trx);
        await manager.setAiCandidates(shipmentId, unresolved.id, [{ skuId: f.skuIds[1], reason: 'name match' }], trx);
        const [line] = await trx
          .select()
          .from(wmsTables.inboundShipmentLines)
          .where(eq(wmsTables.inboundShipmentLines.id, unresolved.id));
        expect(line.kind).toBe('unresolved');
        expect(line.aiCandidates).toEqual([{ skuId: f.skuIds[1], reason: 'name match' }]);
        await expect(manager.confirm(shipmentId, ACTOR, trx)).rejects.toThrow(ConflictError);
        await expect(
          manager.setAiCandidates(shipmentId, unresolved.id, [{ skuId: randomUUID(), reason: 'x' }], trx),
        ).rejects.toThrow(BadRequestError);
      });
    });

    it('line edit after confirm is allowed only before any covered box is received', async () => {
      await inRollbackTx(db, async (trx) => {
        const { f, manager, shipmentId, lines, unresolved } = await draftWithUnresolved(trx);
        await manager.editLine(shipmentId, unresolved.id, { kind: 'free' }, {}, ACTOR, trx);
        await manager.confirm(shipmentId, ACTOR, trx);
        const target = lines.find((l) => l.kind === 'sku')!;
        await manager.editLine(
          shipmentId,
          target.id,
          { kind: 'sku', skuId: f.skuIds[2] },
          { expectedQty: 7 },
          ACTOR,
          trx,
        );
        const [edited] = await trx
          .select()
          .from(wmsTables.inboundShipmentLines)
          .where(eq(wmsTables.inboundShipmentLines.id, target.id));
        expect(edited.skuId).toBe(f.skuIds[2]);
        expect(edited.expectedQty).toBe(7);
        await expect(
          manager.editLine(
            shipmentId,
            target.id,
            { kind: 'sku', skuId: f.skuIds[2] },
            { boxLabels: ['L9'] },
            ACTOR,
            trx,
          ),
        ).rejects.toThrow(ConflictError);
        const cover = await trx
          .select()
          .from(wmsTables.inboundShipmentLineBoxes)
          .where(eq(wmsTables.inboundShipmentLineBoxes.lineId, target.id));
        await trx
          .update(wmsTables.inboundShipmentBoxes)
          .set({ status: 'received' })
          .where(eq(wmsTables.inboundShipmentBoxes.id, cover[0].boxId));
        await expect(
          manager.editLine(shipmentId, target.id, { kind: 'sku', skuId: f.skuIds[0] }, {}, ACTOR, trx),
        ).rejects.toThrow(ConflictError);
      });
    });

    it('draft box label edit on a line replaces coverage and creates missing boxes', async () => {
      await inRollbackTx(db, async (trx) => {
        const { manager, shipmentId, unresolved } = await draftWithUnresolved(trx);
        await manager.editLine(
          shipmentId,
          unresolved.id,
          { kind: 'free' },
          { expectedQty: 3, boxLabels: ['L1', 'L7-L8'] },
          ACTOR,
          trx,
        );
        const boxes = await trx
          .select()
          .from(wmsTables.inboundShipmentBoxes)
          .where(eq(wmsTables.inboundShipmentBoxes.shipmentId, shipmentId));
        expect(boxes.map((b) => b.label).sort()).toEqual(['L1', 'L2', 'L7', 'L8']);
        expect(boxes.find((b) => b.label === 'L7')?.origin).toBe('list');
        const cover = await trx
          .select()
          .from(wmsTables.inboundShipmentLineBoxes)
          .where(eq(wmsTables.inboundShipmentLineBoxes.lineId, unresolved.id));
        expect(cover).toHaveLength(3);
        // L2 is now empty and list-origin
        await expect(manager.confirm(shipmentId, ACTOR, trx)).rejects.toThrow(/L2|빈 상자|상자/);
      });
    });

    it('confirm reports label overlap with another open shipment', async () => {
      await inRollbackTx(db, async (trx) => {
        const f = await seed(trx);
        const { manager } = build(trx);
        const make = async (label: string) =>
          (
            await manager.createDraft(
              input(f.warehouseId, { header: HEADER, rows: [row(1, label, 10, f.barcodes[0])] }),
              ACTOR,
              trx,
            )
          ).shipmentId;
        const first = await make('L1');
        expect((await manager.confirm(first, ACTOR, trx)).labelOverlaps).toEqual([]);
        const second = await make('L1');
        const result = await manager.confirm(second, ACTOR, trx);
        expect(result.labelOverlaps).toEqual(['L1']);
      });
    });

    it('cancel is refused once a box is received', async () => {
      await inRollbackTx(db, async (trx) => {
        const f = await seed(trx);
        const { manager } = build(trx);
        const { shipmentId } = await manager.createDraft(
          input(f.warehouseId, { header: HEADER, rows: [row(1, 'L1', 10, f.barcodes[0])] }),
          ACTOR,
          trx,
        );
        await manager.confirm(shipmentId, ACTOR, trx);
        await trx
          .update(wmsTables.inboundShipmentBoxes)
          .set({ status: 'received' })
          .where(eq(wmsTables.inboundShipmentBoxes.shipmentId, shipmentId));
        await expect(manager.cancel(shipmentId, ACTOR, trx)).rejects.toThrow(ConflictError);
      });
    });

    it('cancels a draft and edits the header; canceled header is refused', async () => {
      await inRollbackTx(db, async (trx) => {
        const f = await seed(trx);
        const { manager } = build(trx);
        const { shipmentId } = await manager.createDraft(
          input(f.warehouseId, { header: HEADER, rows: [row(1, 'L1', 10, f.barcodes[0])] }),
          ACTOR,
          trx,
        );
        await manager.updateHeader(shipmentId, { name: 'renamed', expectedArrival: '2026-12-01', memo: 'm' }, trx);
        const [s] = await trx
          .select()
          .from(wmsTables.inboundShipments)
          .where(eq(wmsTables.inboundShipments.id, shipmentId));
        expect([s.name, s.expectedArrival, s.memo]).toEqual(['renamed', '2026-12-01', 'm']);
        await manager.cancel(shipmentId, ACTOR, trx);
        await expect(manager.updateHeader(shipmentId, { name: 'x' }, trx)).rejects.toThrow(ConflictError);
      });
    });

    it('editBox: disposition on open box, label only in draft', async () => {
      await inRollbackTx(db, async (trx) => {
        const f = await seed(trx);
        const { manager } = build(trx);
        const { shipmentId } = await manager.createDraft(
          input(f.warehouseId, { header: HEADER, rows: [row(1, 'L1', 10, f.barcodes[0])] }),
          ACTOR,
          trx,
        );
        const [box] = await trx
          .select()
          .from(wmsTables.inboundShipmentBoxes)
          .where(eq(wmsTables.inboundShipmentBoxes.shipmentId, shipmentId));
        await manager.editBox(
          shipmentId,
          box.id,
          { disposition: 'forward', forwardNote: 'acme', label: 'l9' },
          ACTOR,
          trx,
        );
        const [after] = await trx
          .select()
          .from(wmsTables.inboundShipmentBoxes)
          .where(eq(wmsTables.inboundShipmentBoxes.id, box.id));
        expect([after.disposition, after.forwardNote, after.label]).toEqual(['forward', 'acme', 'L9']);
        await manager.confirm(shipmentId, ACTOR, trx);
        await expect(manager.editBox(shipmentId, box.id, { label: 'L10' }, ACTOR, trx)).rejects.toThrow(ConflictError);
      });
    });
  });
});
