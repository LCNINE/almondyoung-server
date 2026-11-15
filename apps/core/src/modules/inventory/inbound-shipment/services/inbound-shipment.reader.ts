import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { and, asc, countDistinct, desc, eq, inArray, isNull, SQL } from 'drizzle-orm';
import { NotFoundError } from '@app/shared';
import { normalizeBarcode, ListCell } from './inbound-shipment-list.parser';
import { InboundShipmentSkuMatcherReader } from './inbound-shipment-sku-matcher.reader';
import { DbTx, InboundShipment, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import {
  InboundShipmentDetailView,
  InboundShipmentSummaryDto,
} from '../dto/inbound-shipment-view.dto';

type ShipmentStatus = InboundShipment['status'];

@Injectable()
export class InboundShipmentReader {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly matcher: InboundShipmentSkuMatcherReader,
  ) {}

  async list(
    q: { warehouseId?: string; status?: ShipmentStatus[] },
    tx?: DbTx,
  ): Promise<InboundShipmentSummaryDto[]> {
    return this.dbService.run(async (trx: DbTx) => {
      const s = wmsTables.inboundShipments;
      const conds: SQL[] = [];
      if (q.warehouseId) conds.push(eq(s.warehouseId, q.warehouseId));
      if (q.status && q.status.length > 0) conds.push(inArray(s.status, q.status));
      const boxes = wmsTables.inboundShipmentBoxes;
      const lines = wmsTables.inboundShipmentLines;
      return trx
        .select({
          id: s.id,
          warehouseId: s.warehouseId,
          status: s.status,
          name: s.name,
          expectedArrival: s.expectedArrival,
          createdAt: s.createdAt,
          boxCount: countDistinct(boxes.id),
          lineCount: countDistinct(lines.id),
        })
        .from(s)
        .leftJoin(boxes, eq(boxes.shipmentId, s.id))
        .leftJoin(lines, eq(lines.shipmentId, s.id))
        .where(conds.length > 0 ? and(...conds) : undefined)
        .groupBy(s.id)
        .orderBy(desc(s.createdAt));

    }, tx);
  }

  async detail(id: string, tx?: DbTx): Promise<InboundShipmentDetailView> {
    return this.dbService.run(async (trx: DbTx) => {
      const t = wmsTables;
      const [shipment] = await trx.select().from(t.inboundShipments).where(eq(t.inboundShipments.id, id)).limit(1);
      if (!shipment) throw new NotFoundError(`Inbound shipment not found: ${id}`);

      const boxes = await trx
        .select()
        .from(t.inboundShipmentBoxes)
        .where(eq(t.inboundShipmentBoxes.shipmentId, id))
        .orderBy(asc(t.inboundShipmentBoxes.sortKey));
      const lines = await trx
        .select()
        .from(t.inboundShipmentLines)
        .where(eq(t.inboundShipmentLines.shipmentId, id))
        .orderBy(asc(t.inboundShipmentLines.rowNumber), asc(t.inboundShipmentLines.id));

      const cover = await trx
        .select({ lineId: t.inboundShipmentLineBoxes.lineId, label: t.inboundShipmentBoxes.label, sortKey: t.inboundShipmentBoxes.sortKey })
        .from(t.inboundShipmentLineBoxes)
        .innerJoin(t.inboundShipmentBoxes, eq(t.inboundShipmentBoxes.id, t.inboundShipmentLineBoxes.boxId))
        .where(eq(t.inboundShipmentBoxes.shipmentId, id))
        .orderBy(asc(t.inboundShipmentBoxes.sortKey));
      const labelsByLine = new Map<string, string[]>();
      for (const c of cover) labelsByLine.set(c.lineId, [...(labelsByLine.get(c.lineId) ?? []), c.label]);

      const counts = await trx
        .select({
          boxId: t.inboundShipmentBoxCounts.boxId,
          lineId: t.inboundShipmentBoxCounts.lineId,
          qty: t.inboundShipmentBoxCounts.countedQty,
        })
        .from(t.inboundShipmentBoxCounts)
        .innerJoin(t.inboundShipmentBoxes, eq(t.inboundShipmentBoxes.id, t.inboundShipmentBoxCounts.boxId))
        .where(and(eq(t.inboundShipmentBoxes.shipmentId, id), isNull(t.inboundShipmentBoxCounts.canceledAt)));
      const byBox = new Map<string, number>();
      const byLine = new Map<string, number>();
      for (const c of counts) {
        byBox.set(c.boxId, (byBox.get(c.boxId) ?? 0) + c.qty);
        if (c.lineId) byLine.set(c.lineId, (byLine.get(c.lineId) ?? 0) + c.qty);
      }

      const candidates = await this.candidatesFor(trx, lines);

      return {
        id: shipment.id,
        warehouseId: shipment.warehouseId,
        status: shipment.status,
        name: shipment.name,
        expectedArrival: shipment.expectedArrival,
        sourceFileName: shipment.sourceFileName,
        memo: shipment.memo,
        createdAt: shipment.createdAt,
        boxCount: boxes.length,
        lineCount: lines.length,
        boxes: boxes.map((b) => ({
          id: b.id,
          label: b.label,
          sortKey: b.sortKey,
          origin: b.origin,
          disposition: b.disposition,
          forwardNote: b.forwardNote,
          status: b.status,
          countedQty: byBox.get(b.id) ?? 0,
        })),
        lines: lines.map((l) => ({
          id: l.id,
          rowNumber: l.rowNumber,
          kind: l.kind,
          skuId: l.skuId,
          expectedQty: l.expectedQty,
          resolution: l.resolution,
          issues: l.issues,
          coversBoxLabels: labelsByLine.get(l.id) ?? [],
          aiCandidates: l.aiCandidates,
          raw: l.raw,
          countedQty: byLine.get(l.id) ?? 0,
          barcodeCandidates: candidates.get(l.id) ?? [],
          difference: null,
        })),
      };
    }, tx);
  }

  /** unresolved 줄의 원문 바코드를 다시 읽어 매처를 한 번만 불러 후보 SKU 를 붙인다 (spec §6.3). */
  private async candidatesFor(
    trx: DbTx,
    lines: { id: string; kind: string; raw: Record<string, unknown> }[],
  ): Promise<Map<string, { skuId: string; code: string; name: string }[]>> {
    const out = new Map<string, { skuId: string; code: string; name: string }[]>();
    const barcodeOf = new Map<string, string>();
    for (const l of lines) {
      if (l.kind !== 'unresolved') continue;
      const { barcode } = normalizeBarcode(l.raw.barcode as ListCell | null, l.raw.remark as ListCell | null);
      if (barcode) barcodeOf.set(l.id, barcode);
    }
    if (barcodeOf.size === 0) return out;

    const matches = await this.matcher.match([...barcodeOf.values()], trx);
    const idsOf = (barcode: string): string[] => {
      const m = matches.get(barcode);
      if (!m || m.kind === 'none') return [];
      return m.kind === 'many' ? m.skuIds : [m.skuId];
    };
    const allIds = [...new Set([...barcodeOf.values()].flatMap(idsOf))];
    if (allIds.length === 0) return out;
    const skuRows = await trx
      .select({ id: wmsTables.skus.id, code: wmsTables.skus.code, name: wmsTables.skus.name })
      .from(wmsTables.skus)
      .where(inArray(wmsTables.skus.id, allIds));
    const skuById = new Map(skuRows.map((r) => [r.id, r]));
    for (const [lineId, barcode] of barcodeOf) {
      out.set(
        lineId,
        idsOf(barcode).flatMap((id) => {
          const r = skuById.get(id);
          return r ? [{ skuId: r.id, code: r.code, name: r.name }] : [];
        }),
      );
    }
    return out;
  }
}
