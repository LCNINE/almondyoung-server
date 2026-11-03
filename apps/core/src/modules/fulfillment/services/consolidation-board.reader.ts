import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  ConsolidationBoardGroupDto,
  ConsolidationBoardResponseDto,
  ConsolidationBoardShipmentDto,
  ConsolidationRecipientSnapshotDto,
} from '../dto/consolidation.dto';
import {
  canonicalConsolidationRecipient,
  consolidationCustomerKey,
  recipientAddressKey,
} from './consolidation-options';
import {
  asRecipient,
  loadShipmentLines,
  loadShipmentProgress,
  OPTION_STATUSES,
  OptionLine,
  ShipmentProgress,
  ShipmentRow,
  summarizeShipmentWithoutRecipient,
} from './consolidation-shipment-reads';

export interface BoardRow {
  customerKey: string | null;
  recipient: ConsolidationRecipientSnapshotDto;
  shipment: ConsolidationBoardShipmentDto;
}

export type BoardGroup = ConsolidationBoardGroupDto;

function opaqueKey(groupingKey: string): string {
  return createHash('sha256').update(groupingKey).digest('hex');
}

export function groupConsolidationBoard(rows: readonly BoardRow[]): BoardGroup[] {
  const buckets = new Map<string, BoardRow[]>();

  for (const row of rows) {
    if (!row.customerKey) continue;

    const recipient = canonicalConsolidationRecipient(row.recipient);

    if (!recipient) continue;

    const key = `${row.customerKey}|${recipientAddressKey(recipient)}`;

    buckets.set(key, [...(buckets.get(key) ?? []), row]);
  }

  const groups: BoardGroup[] = [];

  for (const [key, members] of buckets) {
    if (members.length < 2) continue;

    const shipments = members.map((member) => member.shipment);
    const notes = new Set(
      members.map((member) => canonicalConsolidationRecipient(member.recipient)?.deliveryNote ?? ''),
    );

    groups.push({
      key: opaqueKey(key),
      recipientSnapshot: members[0].recipient,
      memoDiffers: notes.size > 1,
      canMergeNow: shipments.every(
        (shipment) => shipment.status === 'draft' && !shipment.batchId && !shipment.waybillTrackingNo,
      ),
      shipments,
    });
  }

  return groups;
}

function earliest(lines: readonly OptionLine[]): Date | null {
  const times = lines.flatMap((line) => (line.salesOrderCreatedAt ? [line.salesOrderCreatedAt] : []));

  return times.length > 0 ? times.reduce((first, time) => (time < first ? time : first)) : null;
}

export function assembleConsolidationBoard(
  shipments: readonly ShipmentRow[],
  lines: readonly OptionLine[],
  progress: ShipmentProgress,
): BoardGroup[] {
  const linesByShipment = new Map<string, OptionLine[]>();

  for (const line of lines) {
    linesByShipment.set(line.shipmentId, [...(linesByShipment.get(line.shipmentId) ?? []), line]);
  }

  const rows: BoardRow[] = [];

  for (const shipment of shipments) {
    const shipmentLines = linesByShipment.get(shipment.id) ?? [];

    if (shipment.supplierId || shipmentLines.length === 0) continue;

    if (shipmentLines.some((line) => line.fulfillmentMode !== 'in_house' || line.skuStockType === 'drop_shipped')) {
      continue;
    }

    const summary = summarizeShipmentWithoutRecipient(shipment, shipmentLines, progress);

    rows.push({
      customerKey: consolidationCustomerKey(shipmentLines),
      recipient: asRecipient(shipment.recipientSnapshot),
      shipment: {
        ...summary,
        orderedAt: earliest(shipmentLines),
        salesChannels: [...new Set(shipmentLines.flatMap((line) => (line.salesChannel ? [line.salesChannel] : [])))],
      },
    });
  }

  return groupConsolidationBoard(rows);
}

@Injectable()
export class ConsolidationBoardReader {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
  ) {}

  async findBoard(warehouseId: string, tx?: DbTx): Promise<ConsolidationBoardResponseDto> {
    return this.dbService.run(async (trx) => {
      const shipments = await trx
        .select()
        .from(wmsTables.shipments)
        .where(
          and(
            eq(wmsTables.shipments.warehouseId, warehouseId),
            isNull(wmsTables.shipments.supplierId),
            inArray(wmsTables.shipments.status, OPTION_STATUSES),
          ),
        )
        .orderBy(asc(wmsTables.shipments.createdAt), asc(wmsTables.shipments.id));
      const ids = shipments.map((shipment) => shipment.id);
      const lines = await loadShipmentLines(trx, ids);
      const progress = await loadShipmentProgress(trx, ids);

      return { groups: assembleConsolidationBoard(shipments, lines, progress) };
    }, tx);
  }
}
