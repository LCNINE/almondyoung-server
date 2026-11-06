import { Injectable } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { and, asc, count, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { ConsolidationBoardReader } from '../services/consolidation-board.reader';
import { loadShipmentLines, OptionLine, uniqueInOrder } from '../services/consolidation-shipment-reads';
import { isRecipientComplete } from '../services/recipient-completeness';
import {
  classifyPreparation,
  isSingleItem,
  PreparationBucket,
  PreparationFacts,
  resolvePlanProfileId,
} from './outbound-preparation-classify';
import { OutboundPreparationSummaryDto, PreparationBucketDto } from '../dto/outbound-preparation.dto';

@Injectable()
export class OutboundPreparationReader {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly consolidationBoard: ConsolidationBoardReader,
  ) {}

  async summarize(warehouseId: string, tx?: DbTx): Promise<OutboundPreparationSummaryDto> {
    return this.dbService.run(async (trx) => {
      const bucketNames: PreparationBucket[] = ['ready', 'partial', 'unavailable', 'mergeable', 'resume', 'needs_info'];
      const buckets: PreparationBucketDto[] = bucketNames.map((bucket) => ({
        bucket,
        count: 0,
        singleCount: 0,
        multiCount: 0,
        shipments: [],
      }));
      const [backlog] = await trx
        .select({ count: count() })
        .from(wmsTables.fulfillmentOrderCreationBacklogs)
        .where(eq(wmsTables.fulfillmentOrderCreationBacklogs.status, 'awaiting_matching'));
      const shipments = await trx
        .select({
          id: wmsTables.shipments.id,
          status: wmsTables.shipments.status,
          recipientSnapshot: wmsTables.shipments.recipientSnapshot,
        })
        .from(wmsTables.shipments)
        .where(
          and(
            eq(wmsTables.shipments.warehouseId, warehouseId),
            isNull(wmsTables.shipments.supplierId),
            inArray(wmsTables.shipments.status, ['draft', 'planned']),
          ),
        )
        .orderBy(asc(wmsTables.shipments.createdAt), asc(wmsTables.shipments.id));
      const ids = shipments.map((shipment) => shipment.id);

      if (ids.length === 0) {
        return { warehouseId, buckets, awaitingMatchingCount: backlog.count };
      }

      const lines = await loadShipmentLines(trx, ids);
      const quantityLines = await trx
        .select({
          id: wmsTables.shipmentLines.id,
          shipmentId: wmsTables.shipmentLines.shipmentId,
          qty: wmsTables.shipmentLines.qty,
        })
        .from(wmsTables.shipmentLines)
        .where(inArray(wmsTables.shipmentLines.shipmentId, ids));
      const reservations = await trx
        .select({
          lineId: wmsTables.stockReservations.targetId,
          quantity: sql`sum(${wmsTables.stockReservations.quantity})`.mapWith(Number),
        })
        .from(wmsTables.stockReservations)
        .innerJoin(wmsTables.shipmentLines, eq(wmsTables.shipmentLines.id, wmsTables.stockReservations.targetId))
        .where(
          and(
            inArray(wmsTables.shipmentLines.shipmentId, ids),
            eq(wmsTables.stockReservations.status, 'confirmed'),
            eq(wmsTables.stockReservations.targetType, 'SHIPMENT_LINE'),
          ),
        )
        .groupBy(wmsTables.stockReservations.targetId);
      const workItems = await trx
        .select({ shipmentId: wmsTables.outboundBatchWorkItems.shipmentId })
        .from(wmsTables.outboundBatchWorkItems)
        .where(
          and(
            inArray(wmsTables.outboundBatchWorkItems.shipmentId, ids),
            notInArray(wmsTables.outboundBatchWorkItems.status, ['excluded', 'completed']),
          ),
        );
      const board = await this.consolidationBoard.findBoard(warehouseId, trx);
      const groupByShipment = new Map(
        board.groups.flatMap((group) =>
          group.shipments.map((shipment) => [shipment.shipmentId, group] satisfies [string, typeof group]),
        ),
      );
      const activeIds = new Set(workItems.map((item) => item.shipmentId));
      const confirmedByLine = new Map(reservations.map((reservation) => [reservation.lineId, reservation.quantity]));
      const quantitiesByShipment = new Map<string, PreparationFacts['lines']>();
      const linesByShipment = new Map<string, OptionLine[]>();

      for (const line of quantityLines) {
        const shipmentLines = quantitiesByShipment.get(line.shipmentId) ?? [];

        shipmentLines.push({ qty: line.qty, confirmedQty: confirmedByLine.get(line.id) ?? 0 });
        quantitiesByShipment.set(line.shipmentId, shipmentLines);
      }

      for (const line of lines) {
        const shipmentLines = linesByShipment.get(line.shipmentId) ?? [];

        shipmentLines.push(line);
        linesByShipment.set(line.shipmentId, shipmentLines);
      }

      for (const shipment of shipments) {
        if (shipment.status !== 'draft' && shipment.status !== 'planned') {
          continue;
        }

        const shipmentLines = linesByShipment.get(shipment.id) ?? [];
        const quantities = quantitiesByShipment.get(shipment.id) ?? [];
        const profileIds = shipmentLines.map((line) => line.skuProfileId);
        const bucketName = classifyPreparation({
          status: shipment.status,
          hasActiveWorkItem: activeIds.has(shipment.id),
          lines: quantities,
          profileIds,
          recipientComplete: isRecipientComplete(shipment.recipientSnapshot),
          consolidationPeerLines: (groupByShipment.get(shipment.id)?.shipments ?? [])
            .filter(
              (peer) => peer.shipmentId !== shipment.id && peer.status === 'draft' && !activeIds.has(peer.shipmentId),
            )
            .map((peer) => quantitiesByShipment.get(peer.shipmentId) ?? []),
        });
        const bucket = buckets.find((entry) => entry.bucket === bucketName);

        if (!bucket) {
          continue;
        }

        const single = isSingleItem(quantities);

        bucket.count++;
        bucket.singleCount += single ? 1 : 0;
        bucket.multiCount += single ? 0 : 1;

        if (bucket.shipments.length >= 200) {
          continue;
        }

        let reason: string | null = null;

        if (bucketName === 'needs_info') {
          if (resolvePlanProfileId(profileIds) === null) {
            reason =
              profileIds.includes(null) || profileIds.length === 0
                ? '배송 프로필이 없는 상품이 있어요'
                : '배송 프로필이 상품마다 달라요';
          } else {
            reason = '수령인 정보가 비어 있어요';
          }
        }

        const names = shipmentLines.map((line) => line.skuName);

        bucket.shipments.push({
          shipmentId: shipment.id,
          orderNos: uniqueInOrder(shipmentLines.flatMap((line) => line.displayOrderNo ?? line.channelOrderId ?? [])),
          itemSummary: names.length > 1 ? `${names[0]} 외 ${names.length - 1}건` : (names[0] ?? ''),
          totalQty: shipmentLines.reduce((total, line) => total + line.qty, 0),
          single,
          reason,
        });
      }

      return { warehouseId, buckets, awaitingMatchingCount: backlog.count };
    }, tx);
  }
}
