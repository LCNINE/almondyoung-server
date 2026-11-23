import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  ConsolidationBoardCountDto,
  ConsolidationBoardGroupDto,
  ConsolidationBoardResponseDto,
  ConsolidationBoardShipmentDto,
  ConsolidationRecipientSnapshotDto,
} from '../dto/consolidation.dto';
import { isEligibleInHouseBox } from './consolidation-eligibility';
import {
  canonicalConsolidationRecipient,
  consolidationCustomerKey,
  recipientAddressKey,
} from './consolidation-options';
import {
  asRecipient,
  loadInHouseProfileIds,
  loadShipmentLines,
  loadShipmentProgress,
  OPTION_STATUSES,
  OptionLine,
  ShipmentProgress,
  ShipmentRow,
  summarizeShipmentWithoutRecipient,
  uniqueInOrder,
} from './consolidation-shipment-reads';
import { loadSellmateShipmentIds } from './sellmate-handed-over-shipments';

export interface BoardRow {
  customerKey: string | null;
  shippingProfileId: string | null;
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
    if (!row.customerKey || !row.shippingProfileId) continue;

    const recipient = canonicalConsolidationRecipient(row.recipient);

    if (!recipient) continue;

    const key = `${row.customerKey}|${row.shippingProfileId}|${recipientAddressKey(recipient)}`;

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
  inHouseProfileIds: ReadonlySet<string>,
): BoardGroup[] {
  const linesByShipment = new Map<string, OptionLine[]>();

  for (const line of lines) {
    linesByShipment.set(line.shipmentId, [...(linesByShipment.get(line.shipmentId) ?? []), line]);
  }

  const rows: BoardRow[] = [];

  for (const shipment of shipments) {
    const shipmentLines = linesByShipment.get(shipment.id) ?? [];

    if (shipment.supplierId || shipmentLines.length === 0) continue;

    if (!isEligibleInHouseBox(shipmentLines, shipment.shippingProfileId, inHouseProfileIds)) continue;

    const summary = summarizeShipmentWithoutRecipient(shipment, shipmentLines, progress);

    rows.push({
      customerKey: consolidationCustomerKey(shipmentLines),
      shippingProfileId: shipment.shippingProfileId,
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
      const candidates = await trx
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
      // 드레인 중 셀메이트가 내보내는 주문의 상자는 합칠 상대가 아니다(#1412)
      const sellmate = await loadSellmateShipmentIds(
        trx,
        candidates.map((shipment) => shipment.id),
      );
      const shipments = candidates.filter((shipment) => !sellmate.has(shipment.id));
      const ids = shipments.map((shipment) => shipment.id);
      const lines = await loadShipmentLines(trx, ids);
      const progress = await loadShipmentProgress(trx, ids);
      const profileIds = uniqueInOrder(shipments.flatMap((shipment) => shipment.shippingProfileId ?? []));
      const inHouseProfileIds = await loadInHouseProfileIds(trx, profileIds);

      return { groups: assembleConsolidationBoard(shipments, lines, progress, inHouseProfileIds) };
    }, tx);
  }

  // 묶음은 보드와 같은 판정으로 세고, 받는 분은 싣지 않는다
  async countGroups(warehouseId: string, tx?: DbTx): Promise<ConsolidationBoardCountDto> {
    const board = await this.findBoard(warehouseId, tx);

    return { groupCount: board.groups.length };
  }
}
