import { Injectable } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { and, asc, count, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { ConsolidationBoardReader } from '../services/consolidation-board.reader';
import {
  loadShipmentLines,
  loadSplitShares,
  OptionLine,
  uniqueInOrder,
} from '../services/consolidation-shipment-reads';
import { isRecipientComplete } from '../services/recipient-completeness';
import {
  classifyPreparation,
  isSingleItem,
  PREPARATION_BUCKETS,
  PreparationFacts,
} from './outbound-preparation-classify';
import { compatibleShippingProfileId } from '../services/shipping-profile';
import { isUntrustedExternalLine } from '../services/external-line-identity';
import { loadSellmateShipmentIds } from '../services/sellmate-handed-over-shipments';
import { waybillFailureText } from '../waybill/waybill-failure-text';
import {
  OutboundPreparationQueryDto,
  OutboundPreparationSummaryDto,
  PreparationBucketDto,
} from '../dto/outbound-preparation.dto';

type PreparationLineQuantity = PreparationFacts['lines'][number] & { name: string };

// 분류마다 한 번에 돌려주는 상자 수. 나머지는 화면이 `bucket`·`offset` 으로 더 부른다.
const BUCKET_PAGE_SIZE = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// 바인드 변수 한도 안에서 판매주문 품목을 나눠 찾는다
const LINE_LOOKUP_CHUNK = 5000;

@Injectable()
export class OutboundPreparationReader {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly consolidationBoard: ConsolidationBoardReader,
  ) {}

  async summarize(
    warehouseId: string,
    page?: Pick<OutboundPreparationQueryDto, 'bucket' | 'offset'>,
    tx?: DbTx,
  ): Promise<OutboundPreparationSummaryDto> {
    return this.dbService.run(async (trx) => {
      const buckets: PreparationBucketDto[] = PREPARATION_BUCKETS.map((bucket) => ({
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
      const candidates = await trx
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
      // 드레인 중 셀메이트가 내보내는 주문의 상자는 앱 출고 대상이 아니다(#1412)
      const sellmate = await loadSellmateShipmentIds(
        trx,
        candidates.map((shipment) => shipment.id),
      );
      const shipments = candidates.filter((shipment) => !sellmate.has(shipment.id));
      const ids = shipments.map((shipment) => shipment.id);

      if (ids.length === 0) {
        return { warehouseId, buckets, awaitingMatchingCount: backlog.count };
      }

      const lines = await loadShipmentLines(trx, ids);
      const quantitiesByShipment = await this.lineQuantities(ids, trx);
      const splits = await loadSplitShares(trx, ids);
      const workItems = await trx
        .select({ shipmentId: wmsTables.outboundBatchWorkItems.shipmentId })
        .from(wmsTables.outboundBatchWorkItems)
        .where(
          and(
            inArray(wmsTables.outboundBatchWorkItems.shipmentId, ids),
            notInArray(wmsTables.outboundBatchWorkItems.status, ['excluded', 'completed']),
          ),
        );
      const untrustedIds = await this.untrustedExternalLineShipments(trx, ids);
      const board = await this.consolidationBoard.findBoard(warehouseId, trx);
      const groupByShipment = new Map(
        board.groups.flatMap((group) =>
          group.shipments.map((shipment) => [shipment.shipmentId, group] satisfies [string, typeof group]),
        ),
      );
      const activeIds = new Set(workItems.map((item) => item.shipmentId));
      const linesByShipment = new Map<string, OptionLine[]>();

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
          externalLinesTrusted: !untrustedIds.has(shipment.id),
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

        if (
          (page?.bucket && bucketName !== page.bucket) ||
          bucket.count <= (page?.offset ?? 0) ||
          bucket.shipments.length >= BUCKET_PAGE_SIZE
        ) {
          continue;
        }

        let reason: string | null = null;

        if (bucketName === 'needs_info') {
          if (compatibleShippingProfileId(profileIds) === null) {
            reason =
              profileIds.includes(null) || profileIds.length === 0
                ? '배송 프로필이 없는 상품이 있어요'
                : '배송 프로필이 상품마다 달라요';
          } else if (!isRecipientComplete(shipment.recipientSnapshot)) {
            reason = '수령인 정보가 비어 있어요';
          } else {
            reason = '쇼핑몰 품목 번호가 없거나 맞지 않아요';
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
          lines: quantities.map((line) => ({
            name: line.name,
            qty: line.qty,
            reservedQty: Math.min(line.qty, line.confirmedQty),
          })),
          split: splits.get(shipment.id) ?? null,
        });
      }

      await this.fillWaybillFailures(trx, buckets.find((entry) => entry.bucket === 'resume')?.shipments ?? []);

      return { warehouseId, buckets, awaitingMatchingCount: backlog.count };
    }, tx);
  }

  // 상자 확정이 같은 판정으로 거절하는 상자. 다시 눌러도 같으니 «정보 필요»로 둔다.
  // 판매주문 품목은 기본키로 찾는다 — 출고 품목의 참조는 문자열이라 조인하면 인덱스를 못 쓴다.
  private async untrustedExternalLineShipments(trx: DbTx, shipmentIds: string[]): Promise<Set<string>> {
    const links = await trx
      .select({
        shipmentId: wmsTables.shipmentLines.shipmentId,
        salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
      })
      .from(wmsTables.shipmentLines)
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .where(inArray(wmsTables.shipmentLines.shipmentId, shipmentIds));
    // 상자 확정은 `id::text` 와 그대로 견준다 — 같은 판정이 되도록 소문자 uuid 꼴만 찾는다
    const lineIds = uniqueInOrder(
      links.flatMap(({ salesOrderLineId }) =>
        salesOrderLineId && UUID.test(salesOrderLineId) ? [salesOrderLineId] : [],
      ),
    );
    const untrusted = new Set<string>();

    for (let start = 0; start < lineIds.length; start += LINE_LOOKUP_CHUNK) {
      const origins = await trx
        .select({
          id: wmsTables.salesOrderLines.id,
          salesChannel: wmsTables.salesOrders.salesChannel,
          channelOrderItemId: wmsTables.salesOrderLines.channelOrderItemId,
          channelProductId: wmsTables.salesOrderLines.channelProductId,
          exchangeReturnLineId: wmsTables.salesOrderLines.exchangeReturnLineId,
        })
        .from(wmsTables.salesOrderLines)
        .innerJoin(wmsTables.salesOrders, eq(wmsTables.salesOrders.id, wmsTables.salesOrderLines.salesOrderId))
        .where(inArray(wmsTables.salesOrderLines.id, lineIds.slice(start, start + LINE_LOOKUP_CHUNK)));

      for (const origin of origins.filter(isUntrustedExternalLine)) {
        untrusted.add(origin.id);
      }
    }

    return new Set(
      links.flatMap(({ shipmentId, salesOrderLineId }) =>
        salesOrderLineId && untrusted.has(salesOrderLineId) ? [shipmentId] : [],
      ),
    );
  }

  // «이어서 하기» 상자는 송장 단계에서 멈춘 것이다 — 마지막 송장 기록으로 이유를 보인다.
  private async fillWaybillFailures(trx: DbTx, shipments: PreparationBucketDto['shipments']): Promise<void> {
    if (shipments.length === 0) {
      return;
    }

    const rows = await trx
      .select({
        shipmentId: wmsTables.waybills.shipmentId,
        status: wmsTables.waybills.status,
        lastError: wmsTables.waybills.lastError,
      })
      .from(wmsTables.waybills)
      .where(
        inArray(
          wmsTables.waybills.shipmentId,
          shipments.map((shipment) => shipment.shipmentId),
        ),
      )
      .orderBy(desc(wmsTables.waybills.createdAt), desc(wmsTables.waybills.id));
    const latest = new Map<string, (typeof rows)[number]>();

    for (const row of rows) {
      if (!latest.has(row.shipmentId)) {
        latest.set(row.shipmentId, row);
      }
    }

    for (const shipment of shipments) {
      const waybill = latest.get(shipment.shipmentId);

      shipment.reason = waybill ? waybillFailureText(waybill) : null;
    }
  }

  // 상자별 라인의 주문 수량과 confirmed 예약 합. 분류와 «있는 것만 먼저 보내기»가 같은 계산을 쓴다.
  async lineQuantities(shipmentIds: string[], tx?: DbTx): Promise<Map<string, PreparationLineQuantity[]>> {
    return this.dbService.run(async (trx) => {
      const quantityLines = await trx
        .select({
          id: wmsTables.shipmentLines.id,
          shipmentId: wmsTables.shipmentLines.shipmentId,
          qty: wmsTables.shipmentLines.qty,
          name: wmsTables.skus.name,
        })
        .from(wmsTables.shipmentLines)
        .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.shipmentLines.skuId))
        .where(inArray(wmsTables.shipmentLines.shipmentId, shipmentIds))
        .orderBy(asc(wmsTables.shipmentLines.createdAt), asc(wmsTables.shipmentLines.id));
      const reservations = await trx
        .select({
          lineId: wmsTables.stockReservations.targetId,
          quantity: sql`sum(${wmsTables.stockReservations.quantity})`.mapWith(Number),
        })
        .from(wmsTables.stockReservations)
        .innerJoin(wmsTables.shipmentLines, eq(wmsTables.shipmentLines.id, wmsTables.stockReservations.targetId))
        .where(
          and(
            inArray(wmsTables.shipmentLines.shipmentId, shipmentIds),
            eq(wmsTables.stockReservations.status, 'confirmed'),
            eq(wmsTables.stockReservations.targetType, 'SHIPMENT_LINE'),
          ),
        )
        .groupBy(wmsTables.stockReservations.targetId);
      const confirmedByLine = new Map(reservations.map((reservation) => [reservation.lineId, reservation.quantity]));
      const quantitiesByShipment = new Map<string, PreparationLineQuantity[]>();

      for (const line of quantityLines) {
        const shipmentLines = quantitiesByShipment.get(line.shipmentId) ?? [];

        shipmentLines.push({ name: line.name, qty: line.qty, confirmedQty: confirmedByLine.get(line.id) ?? 0 });
        quantitiesByShipment.set(line.shipmentId, shipmentLines);
      }

      return quantitiesByShipment;
    }, tx);
  }
}
