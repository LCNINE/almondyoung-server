import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import { InboundShipmentSkuMatcherReader, SkuMatch } from './inbound-shipment-sku-matcher.reader';
import { ListInput, ParsedLine, parseShipmentList } from './inbound-shipment-list.parser';

export interface CreateDraftInput {
  warehouseId: string;
  name: string;
  expectedArrival: string | null;
  sourceFileId: string | null;
  sourceFileName: string;
  list: ListInput;
}

const BOX_CHUNK = 2_000;
const LINE_CHUNK = 1_000;
const COVER_CHUNK = 10_000;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const MATCH_ISSUE: Record<'none' | 'many' | 'packing_unit', string> = {
  none: 'barcode_not_found',
  many: 'barcode_ambiguous',
  packing_unit: 'packing_unit_barcode',
};

/** 파싱된 리스트로 선적 초안(draft)을 한 트랜잭션에 만든다 — spec §6.1. */
@Injectable()
export class InboundShipmentDraftManager {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly matcher: InboundShipmentSkuMatcherReader,
  ) {}

  async createDraft(input: CreateDraftInput, actorId: string, tx?: DbTx): Promise<{ shipmentId: string }> {
    const parsed = parseShipmentList(input.list);
    return this.dbService.run(async (trx: DbTx) => {
      const barcodes = parsed.lines.flatMap((l) => (l.barcode ? [l.barcode] : []));
      const matches = await this.matcher.match(barcodes, trx);

      const [shipment] = await trx
        .insert(wmsTables.inboundShipments)
        .values({
          warehouseId: input.warehouseId,
          status: 'draft',
          name: input.name,
          expectedArrival: input.expectedArrival,
          sourceFileId: input.sourceFileId,
          sourceFileName: input.sourceFileName,
          createdBy: actorId,
        })
        .returning({ id: wmsTables.inboundShipments.id });

      const boxIdByLabel = new Map<string, string>();
      for (const part of chunks(parsed.boxes, BOX_CHUNK)) {
        const rows = await trx
          .insert(wmsTables.inboundShipmentBoxes)
          .values(
            part.map((b) => ({
              shipmentId: shipment.id,
              label: b.label,
              sortKey: b.sortKey,
              origin: 'list' as const,
              disposition: b.forwardHint === null ? ('stock' as const) : ('forward' as const),
              forwardNote: b.forwardHint,
            })),
          )
          .returning({ id: wmsTables.inboundShipmentBoxes.id, label: wmsTables.inboundShipmentBoxes.label });
        for (const r of rows) boxIdByLabel.set(r.label, r.id);
      }

      const drafts = parsed.lines.map((line) => this.lineValues(shipment.id, line, matches));
      const lineIdByRow = new Map<number, string>();
      for (const part of chunks(drafts, LINE_CHUNK)) {
        const rows = await trx
          .insert(wmsTables.inboundShipmentLines)
          .values(part)
          .returning({ id: wmsTables.inboundShipmentLines.id, rowNumber: wmsTables.inboundShipmentLines.rowNumber });
        for (const r of rows) lineIdByRow.set(r.rowNumber, r.id);
      }

      const cover = parsed.lines.flatMap((line) => {
        const lineId = lineIdByRow.get(line.rowNumber);
        if (!lineId) return [];
        return [...new Set(line.boxLabels)].flatMap((label) => {
          const boxId = boxIdByLabel.get(label);
          return boxId ? [{ lineId, boxId }] : [];
        });
      });
      for (const part of chunks(cover, COVER_CHUNK)) {
        await trx.insert(wmsTables.inboundShipmentLineBoxes).values(part);
      }
      return { shipmentId: shipment.id };
    }, tx);
  }

  private lineValues(shipmentId: string, line: ParsedLine, matches: Map<string, SkuMatch>) {
    const match = line.barcode ? matches.get(line.barcode) : undefined;
    const issues: string[] = [...line.issues];
    if (match && match.kind !== 'one') issues.push(MATCH_ISSUE[match.kind]);

    const resolved = match?.kind === 'one' && line.expectedQty !== null && line.boxLabels.length > 0;
    return {
      shipmentId,
      rowNumber: line.rowNumber,
      raw: line.raw,
      kind: resolved ? ('sku' as const) : ('unresolved' as const),
      skuId: resolved ? match.skuId : null,
      expectedQty: line.expectedQty,
      resolution: resolved ? ('barcode' as const) : null,
      issues: [...new Set(issues)],
    };
  }
}
