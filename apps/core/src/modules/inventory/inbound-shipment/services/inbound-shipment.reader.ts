import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { and, asc, desc, eq, inArray, isNull, sql, SQL } from 'drizzle-orm';
import { NotFoundError } from '@app/shared';
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
      const rows = await trx
        .select({
          id: s.id,
          warehouseId: s.warehouseId,
          status: s.status,
          name: s.name,
          expectedArrival: s.expectedArrival,
          createdAt: s.createdAt,
          boxCount: sql<number>`(SELECT count(*)::int FROM inbound_shipment_boxes b WHERE b.shipment_id = ${s.id})`,
          lineCount: sql<number>`(SELECT count(*)::int FROM inbound_shipment_lines l WHERE l.shipment_id = ${s.id})`,
        })
        .from(s)
        .where(conds.length > 0 ? and(...conds) : undefined)
        .orderBy(desc(s.createdAt));
      return rows;
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
          difference: null,
        })),
      };
    }, tx);
  }
}
