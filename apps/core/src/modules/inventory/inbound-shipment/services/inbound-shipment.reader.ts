import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { and, asc, count, desc, eq, inArray, isNull, ne, SQL, sql } from 'drizzle-orm';
import { NotFoundError } from '@app/shared';
import { normalizeBarcode, ListCell } from './inbound-shipment-list.parser';
import { lineDifference, normalizeSingleBoxLabel } from './inbound-shipment.rules';
import { InboundShipmentSkuMatcherReader } from './inbound-shipment-sku-matcher.reader';
import { DbTx, InboundShipment, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import {
  InboundShipmentDetailView,
  InboundShipmentSummaryDto,
  InboundShipmentUnplannedItemDto,
} from '../dto/inbound-shipment-view.dto';
import { BoxCandidateView, BoxView } from '../dto/receive.dto';

type ShipmentStatus = InboundShipment['status'];

const PREVIEW_ITEMS = 3;

/** 원문 칸의 표시 문자열. `raw` 는 jsonb 라 칸마다 모양을 확인한다. */
function cellText(raw: Record<string, unknown>, key: string): string {
  const c = raw[key];
  if (c !== null && typeof c === 'object' && 'text' in c && typeof c.text === 'string') return c.text;
  return '';
}

const isCellValue = (v: unknown): v is ListCell['value'] =>
  v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

/** 원문 칸 하나를 `ListCell` 로 읽는다. `raw` 는 jsonb 라 모양이 다르면 `null`(칸이 없던 것과 같다). */
function cellOf(raw: Record<string, unknown>, key: string): ListCell | null {
  const c = raw[key];
  if (c === null || typeof c !== 'object' || !('text' in c) || typeof c.text !== 'string') return null;
  const value = 'value' in c ? c.value : null;
  if (!isCellValue(value)) return null;
  const formula = 'formula' in c && typeof c.formula === 'string' ? c.formula : undefined;
  return formula === undefined ? { text: c.text, value } : { text: c.text, value, formula };
}

@Injectable()
export class InboundShipmentReader {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly matcher: InboundShipmentSkuMatcherReader,
  ) {}

  async list(q: { warehouseId?: string; status?: ShipmentStatus[] }, tx?: DbTx): Promise<InboundShipmentSummaryDto[]> {
    return this.dbService.run(async (trx: DbTx) => {
      const s = wmsTables.inboundShipments;
      const conds: SQL[] = [];
      if (q.warehouseId) conds.push(eq(s.warehouseId, q.warehouseId));
      if (q.status && q.status.length > 0) conds.push(inArray(s.status, q.status));
      const boxes = wmsTables.inboundShipmentBoxes;
      const lines = wmsTables.inboundShipmentLines;
      // 선적마다 먼저 센 뒤 잇는다 — 상자·줄을 함께 LEFT JOIN 하면 상자 수 × 줄 수 행이 생긴다.
      // 별칭은 서로 달라야 한다 — drizzle 은 바깥에서 집계 열을 별칭만으로(테이블 없이) 부른다
      const boxCounts = trx
        .select({ shipmentId: boxes.shipmentId, n: count().as('box_count') })
        .from(boxes)
        .groupBy(boxes.shipmentId)
        .as('box_counts');
      const lineCounts = trx
        .select({ shipmentId: lines.shipmentId, n: count().as('line_count') })
        .from(lines)
        .groupBy(lines.shipmentId)
        .as('line_counts');
      return trx
        .select({
          id: s.id,
          warehouseId: s.warehouseId,
          status: s.status,
          name: s.name,
          expectedArrival: s.expectedArrival,
          createdAt: s.createdAt,
          boxCount: sql<number>`coalesce(${boxCounts.n}, 0)`.mapWith(Number),
          lineCount: sql<number>`coalesce(${lineCounts.n}, 0)`.mapWith(Number),
        })
        .from(s)
        .leftJoin(boxCounts, eq(boxCounts.shipmentId, s.id))
        .leftJoin(lineCounts, eq(lineCounts.shipmentId, s.id))
        .where(conds.length > 0 ? and(...conds) : undefined)
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
      const lineRows = await trx
        .select({ line: t.inboundShipmentLines, skuCode: t.skus.code, skuName: t.skus.name })
        .from(t.inboundShipmentLines)
        .leftJoin(t.skus, eq(t.skus.id, t.inboundShipmentLines.skuId))
        .where(eq(t.inboundShipmentLines.shipmentId, id))
        .orderBy(asc(t.inboundShipmentLines.rowNumber), asc(t.inboundShipmentLines.id));
      const lines = lineRows.map((r) => r.line);
      const skuOfLine = new Map(
        lineRows.flatMap((r) =>
          r.line.kind === 'sku' && r.skuCode !== null && r.skuName !== null
            ? [[r.line.id, { code: r.skuCode, name: r.skuName }] as const]
            : [],
        ),
      );

      const cover = await trx
        .select({
          lineId: t.inboundShipmentLineBoxes.lineId,
          label: t.inboundShipmentBoxes.label,
          sortKey: t.inboundShipmentBoxes.sortKey,
          status: t.inboundShipmentBoxes.status,
          disposition: t.inboundShipmentBoxes.disposition,
        })
        .from(t.inboundShipmentLineBoxes)
        .innerJoin(t.inboundShipmentBoxes, eq(t.inboundShipmentBoxes.id, t.inboundShipmentLineBoxes.boxId))
        .where(eq(t.inboundShipmentBoxes.shipmentId, id))
        .orderBy(asc(t.inboundShipmentBoxes.sortKey));
      const labelsByLine = new Map<string, string[]>();
      const coverStatusesByLine = new Map<string, ('open' | 'received')[]>();
      for (const c of cover) {
        labelsByLine.set(c.lineId, [...(labelsByLine.get(c.lineId) ?? []), c.label]);
        // 전달용 상자는 확정되지 않으므로 차이 판정에서 뺀다 — 전달용뿐인 줄은 늘 진행 중이다
        if (c.disposition === 'stock') {
          coverStatusesByLine.set(c.lineId, [...(coverStatusesByLine.get(c.lineId) ?? []), c.status]);
        }
      }

      const counts = await trx
        .select({
          boxId: t.inboundShipmentBoxCounts.boxId,
          boxLabel: t.inboundShipmentBoxes.label,
          lineId: t.inboundShipmentBoxCounts.lineId,
          skuId: t.inboundShipmentBoxCounts.skuId,
          skuCode: t.skus.code,
          skuName: t.skus.name,
          qty: t.inboundShipmentBoxCounts.countedQty,
        })
        .from(t.inboundShipmentBoxCounts)
        .innerJoin(t.inboundShipmentBoxes, eq(t.inboundShipmentBoxes.id, t.inboundShipmentBoxCounts.boxId))
        .leftJoin(t.skus, eq(t.skus.id, t.inboundShipmentBoxCounts.skuId))
        .where(and(eq(t.inboundShipmentBoxes.shipmentId, id), isNull(t.inboundShipmentBoxCounts.canceledAt)))
        .orderBy(
          asc(t.inboundShipmentBoxes.sortKey),
          asc(t.inboundShipmentBoxCounts.createdAt),
          asc(t.inboundShipmentBoxCounts.id),
        );
      const byBox = new Map<string, number>();
      const byLine = new Map<string, number[]>();
      const unplannedItems: InboundShipmentUnplannedItemDto[] = [];
      for (const c of counts) {
        byBox.set(c.boxId, (byBox.get(c.boxId) ?? 0) + c.qty);
        if (c.lineId) byLine.set(c.lineId, [...(byLine.get(c.lineId) ?? []), c.qty]);
        else if (c.skuId !== null) {
          // 리스트에 없던 물건 — CHECK 가 sku_id 를 보장한다
          unplannedItems.push({
            boxId: c.boxId,
            boxLabel: c.boxLabel,
            skuId: c.skuId,
            skuCode: c.skuCode ?? '',
            skuName: c.skuName ?? '',
            countedQty: c.qty,
          });
        }
      }

      // 미확인 줄은 예정 수량이 있어도 판정하지 않는다 — 무엇이 와야 하는지 아직 모른다
      const manuallyClosed = shipment.status === 'closed' && shipment.closedReason !== null;
      const differences = lines.map((l) =>
        lineDifference(
          l.kind === 'unresolved' ? null : l.expectedQty,
          byLine.get(l.id) ?? [],
          coverStatusesByLine.get(l.id) ?? [],
          manuallyClosed,
        ),
      );
      const stockBoxes = boxes.filter((b) => b.disposition === 'stock');

      const candidates = await this.candidatesFor(trx, lines);
      const aiSkus = await this.aiCandidateSkus(trx, lines);

      return {
        id: shipment.id,
        warehouseId: shipment.warehouseId,
        status: shipment.status,
        name: shipment.name,
        expectedArrival: shipment.expectedArrival,
        sourceFileId: shipment.sourceFileId,
        sourceFileName: shipment.sourceFileName,
        memo: shipment.memo,
        closedReason: shipment.closedReason,
        closedAt: shipment.closedAt,
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
          receivedAt: b.receivedAt,
          countedQty: byBox.get(b.id) ?? 0,
        })),
        lines: lines.map((l, index) => ({
          id: l.id,
          rowNumber: l.rowNumber,
          kind: l.kind,
          skuId: l.skuId,
          sku: skuOfLine.get(l.id) ?? null,
          expectedQty: l.expectedQty,
          resolution: l.resolution,
          issues: l.issues,
          coversBoxLabels: labelsByLine.get(l.id) ?? [],
          aiCandidates:
            l.aiCandidates === null
              ? null
              : l.aiCandidates.map((c) => ({
                  skuId: c.skuId,
                  reason: c.reason,
                  code: aiSkus.get(c.skuId)?.code ?? null,
                  name: aiSkus.get(c.skuId)?.name ?? null,
                })),
          raw: l.raw,
          countedQty: differences[index].counted,
          barcodeCandidates: candidates.get(l.id) ?? [],
          difference: differences[index],
        })),
        summary: {
          boxesReceived: stockBoxes.filter((b) => b.status === 'received').length,
          boxesTotalStock: stockBoxes.length,
          forwardBoxes: boxes.length - stockBoxes.length,
          addedBoxes: boxes.filter((b) => b.origin === 'added').length,
          shortLines: differences.filter((d) => d.state === 'short').length,
          overLines: differences.filter((d) => d.state === 'over').length,
          notArrivedLines: differences.filter((d) => d.state === 'not_arrived').length,
          unplannedCounts: unplannedItems.length,
        },
        unplannedItems,
      };
    }, tx);
  }

  /**
   * 그 창고의 열린 선적(`expected`·`receiving`)에서 이름이 같은 상자 전부 — spec §8.1.
   * 선적마다 이름이 `L1` 부터 다시 시작하므로 후보가 여럿일 수 있다. 기본 선택은 두지 않는다.
   */
  async findBoxes(warehouseId: string, label: string, tx?: DbTx): Promise<BoxCandidateView[]> {
    const normalized = normalizeSingleBoxLabel(label);
    return this.dbService.run(async (trx: DbTx) => {
      const s = wmsTables.inboundShipments;
      const b = wmsTables.inboundShipmentBoxes;
      const boxes = await trx
        .select({
          shipmentId: s.id,
          shipmentName: s.name,
          expectedArrival: s.expectedArrival,
          boxId: b.id,
          label: b.label,
          origin: b.origin,
          disposition: b.disposition,
          status: b.status,
        })
        .from(b)
        .innerJoin(s, eq(s.id, b.shipmentId))
        .where(
          and(eq(s.warehouseId, warehouseId), inArray(s.status, ['expected', 'receiving']), eq(b.label, normalized)),
        )
        .orderBy(asc(s.expectedArrival), asc(s.createdAt), asc(s.id));

      const listBoxIds = boxes.filter((x) => x.origin === 'list').map((x) => x.boxId);
      const preview = new Map<string, string[]>();
      if (listBoxIds.length > 0) {
        const rows = await trx
          .select({ boxId: wmsTables.inboundShipmentLineBoxes.boxId, raw: wmsTables.inboundShipmentLines.raw })
          .from(wmsTables.inboundShipmentLineBoxes)
          .innerJoin(
            wmsTables.inboundShipmentLines,
            eq(wmsTables.inboundShipmentLines.id, wmsTables.inboundShipmentLineBoxes.lineId),
          )
          .where(inArray(wmsTables.inboundShipmentLineBoxes.boxId, listBoxIds))
          .orderBy(asc(wmsTables.inboundShipmentLines.rowNumber), asc(wmsTables.inboundShipmentLines.id));
        for (const r of rows) {
          const items = preview.get(r.boxId) ?? [];
          const name = cellText(r.raw, 'productName').trim();
          if (name && items.length < PREVIEW_ITEMS) preview.set(r.boxId, [...items, name]);
        }
      }
      return boxes.map(({ origin, ...box }) => ({
        ...box,
        previewItems: origin === 'list' ? (preview.get(box.boxId) ?? []) : [],
      }));
    }, tx);
  }

  /** 상자 열기 — 그 상자를 덮는 줄과, 같은 줄을 다른 상자에서 이미 센 수량 (spec §8.1). */
  async openBox(shipmentId: string, boxId: string, tx?: DbTx): Promise<BoxView> {
    return this.dbService.run(async (trx: DbTx) => {
      const t = wmsTables;
      const [shipment] = await trx
        .select()
        .from(t.inboundShipments)
        .where(eq(t.inboundShipments.id, shipmentId))
        .limit(1);
      if (!shipment) throw new NotFoundError(`Inbound shipment not found: ${shipmentId}`);
      const [box] = await trx
        .select()
        .from(t.inboundShipmentBoxes)
        .where(and(eq(t.inboundShipmentBoxes.id, boxId), eq(t.inboundShipmentBoxes.shipmentId, shipmentId)))
        .limit(1);
      if (!box) throw new NotFoundError(`Inbound shipment box not found: ${boxId}`);

      const lines = await trx
        .select({
          id: t.inboundShipmentLines.id,
          kind: t.inboundShipmentLines.kind,
          skuId: t.inboundShipmentLines.skuId,
          expectedQty: t.inboundShipmentLines.expectedQty,
          raw: t.inboundShipmentLines.raw,
        })
        .from(t.inboundShipmentLineBoxes)
        .innerJoin(t.inboundShipmentLines, eq(t.inboundShipmentLines.id, t.inboundShipmentLineBoxes.lineId))
        .where(eq(t.inboundShipmentLineBoxes.boxId, boxId))
        .orderBy(asc(t.inboundShipmentLines.rowNumber), asc(t.inboundShipmentLines.id));
      const lineIds = lines.map((l) => l.id);

      const labelsByLine = new Map<string, string[]>();
      const countedElsewhere = new Map<string, number>();
      if (lineIds.length > 0) {
        const cover = await trx
          .select({ lineId: t.inboundShipmentLineBoxes.lineId, label: t.inboundShipmentBoxes.label })
          .from(t.inboundShipmentLineBoxes)
          .innerJoin(t.inboundShipmentBoxes, eq(t.inboundShipmentBoxes.id, t.inboundShipmentLineBoxes.boxId))
          .where(inArray(t.inboundShipmentLineBoxes.lineId, lineIds))
          .orderBy(asc(t.inboundShipmentBoxes.sortKey));
        for (const c of cover) labelsByLine.set(c.lineId, [...(labelsByLine.get(c.lineId) ?? []), c.label]);

        const elsewhere = await trx
          .select({
            lineId: t.inboundShipmentBoxCounts.lineId,
            qty: sql<number>`COALESCE(SUM(${t.inboundShipmentBoxCounts.countedQty}), 0)::int`,
          })
          .from(t.inboundShipmentBoxCounts)
          .where(
            and(
              inArray(t.inboundShipmentBoxCounts.lineId, lineIds),
              ne(t.inboundShipmentBoxCounts.boxId, boxId),
              isNull(t.inboundShipmentBoxCounts.canceledAt),
            ),
          )
          .groupBy(t.inboundShipmentBoxCounts.lineId);
        for (const e of elsewhere) if (e.lineId) countedElsewhere.set(e.lineId, Number(e.qty));
      }

      const counts = await trx
        .select({
          id: t.inboundShipmentBoxCounts.id,
          lineId: t.inboundShipmentBoxCounts.lineId,
          skuId: t.inboundShipmentBoxCounts.skuId,
          countedQty: t.inboundShipmentBoxCounts.countedQty,
        })
        .from(t.inboundShipmentBoxCounts)
        .where(and(eq(t.inboundShipmentBoxCounts.boxId, boxId), isNull(t.inboundShipmentBoxCounts.canceledAt)))
        .orderBy(asc(t.inboundShipmentBoxCounts.createdAt), asc(t.inboundShipmentBoxCounts.id));

      return {
        shipmentId: shipment.id,
        shipmentName: shipment.name,
        shipmentStatus: shipment.status,
        expectedArrival: shipment.expectedArrival,
        boxId: box.id,
        label: box.label,
        origin: box.origin,
        disposition: box.disposition,
        status: box.status,
        forwardNote: box.disposition === 'forward' ? box.forwardNote : null,
        receiptId: box.receiptId,
        lines: lines.map((l) => ({
          lineId: l.id,
          kind: l.kind,
          skuId: l.skuId,
          productName: cellText(l.raw, 'productName'),
          option: cellText(l.raw, 'option'),
          expectedQty: l.expectedQty,
          coversBoxLabels: labelsByLine.get(l.id) ?? [],
          alreadyCountedInOtherBoxes: countedElsewhere.get(l.id) ?? 0,
          remark: cellText(l.raw, 'remark'),
        })),
        counts,
      };
    }, tx);
  }

  /** AI 후보 SKU 의 코드·이름 — 모든 줄의 후보를 한 번에 읽는다. 지워진 SKU 는 맵에 없다. */
  private async aiCandidateSkus(
    trx: DbTx,
    lines: { aiCandidates: { skuId: string }[] | null }[],
  ): Promise<Map<string, { code: string; name: string }>> {
    const ids = [...new Set(lines.flatMap((l) => (l.aiCandidates ?? []).map((c) => c.skuId)))];
    if (ids.length === 0) return new Map();
    const rows = await trx
      .select({ id: wmsTables.skus.id, code: wmsTables.skus.code, name: wmsTables.skus.name })
      .from(wmsTables.skus)
      .where(inArray(wmsTables.skus.id, ids));
    return new Map(rows.map((r) => [r.id, { code: r.code, name: r.name }]));
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
      const { barcode } = normalizeBarcode(cellOf(l.raw, 'barcode'), cellOf(l.raw, 'remark'));
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
