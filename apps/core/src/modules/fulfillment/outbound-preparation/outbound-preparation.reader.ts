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
import { isRecipientComplete, recipientNameOf } from '../services/recipient-completeness';
import {
  classifyPreparation,
  isSingleItem,
  PREPARATION_BUCKETS,
  PreparationFacts,
} from './outbound-preparation-classify';
import { loadSellmateShipmentIds } from '../services/sellmate-handed-over-shipments';
import { waybillFailureText } from '../waybill/waybill-failure-text';
import { loadShortPickReturns } from './short-pick-returns';
import { batchExitReasonOf, loadNeedsNewWaybill, loadReturnedWorkItems } from './batch-returns';
import { OUR_HOLDER_KEY, preparationOwnerOf } from './preparation-owner';
import { loadNeedsInfoLines, loadUntrustedLineSkus, needsInfoIssues, needsInfoReasonText } from './needs-info';
import { loadWarehouseStock, readPipelineScope, shortageStockOf } from './shortage-stock';
import { InboundPipelineReader } from '../../inventory/stock-projection/services/inbound-pipeline.reader';
import {
  OutboundPreparationQueryDto,
  OutboundPreparationSummaryDto,
  PreparationBucketDto,
  PreparationHolderDto,
} from '../dto/outbound-preparation.dto';

type PreparationLineQuantity = PreparationFacts['lines'][number] & { name: string; skuId: string };

// 상자에 든 주문 중 가장 이른 주문일
function earliestOrderDates(lines: readonly OptionLine[]): Map<string, Date> {
  const earliest = new Map<string, Date>();

  for (const line of lines) {
    const at = line.salesOrderCreatedAt;
    const current = earliest.get(line.shipmentId);

    if (at && (!current || at < current)) {
      earliest.set(line.shipmentId, at);
    }
  }

  return earliest;
}

// 주문일이 없는 상자는 뒤로
function compareOrderedAt(a: Date | undefined, b: Date | undefined): number {
  if (a && b) return a.getTime() - b.getTime();
  if (a) return -1;
  if (b) return 1;
  return 0;
}

// 분류마다 한 번에 돌려주는 상자 수. 나머지는 화면이 `bucket`·`offset` 으로 더 부른다.
const BUCKET_PAGE_SIZE = 200;

@Injectable()
export class OutboundPreparationReader {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly consolidationBoard: ConsolidationBoardReader,
    private readonly inboundPipeline: InboundPipelineReader,
  ) {}

  async summarize(
    warehouseId: string,
    page?: Pick<OutboundPreparationQueryDto, 'bucket' | 'offset' | 'holders'>,
    tx?: DbTx,
  ): Promise<OutboundPreparationSummaryDto> {
    return this.dbService.run(async (trx) => {
      const buckets: PreparationBucketDto[] = PREPARATION_BUCKETS.map((bucket) => ({
        bucket,
        count: 0,
        singleCount: 0,
        multiCount: 0,
        shortPickCount: 0,
        batchReturnCount: 0,
        shipments: [],
      }));
      const holders = new Map<string, PreparationHolderDto>();
      const holderFilter = page?.holders?.length ? new Set(page.holders) : null;
      const [backlog] = await trx
        .select({ count: count() })
        .from(wmsTables.fulfillmentOrderCreationBacklogs)
        .where(eq(wmsTables.fulfillmentOrderCreationBacklogs.status, 'awaiting_matching'));
      const candidates = await trx
        .select({
          id: wmsTables.shipments.id,
          status: wmsTables.shipments.status,
          recipientSnapshot: wmsTables.shipments.recipientSnapshot,
          manifestVersion: wmsTables.shipments.manifestVersion,
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
      const kept = candidates.filter((shipment) => !sellmate.has(shipment.id));
      const ids = kept.map((shipment) => shipment.id);
      const returned = await loadReturnedWorkItems(trx, ids);
      const shortPicks = await loadShortPickReturns(trx, returned);
      const newWaybills = await loadNeedsNewWaybill(trx, [...returned.keys()]);
      if (ids.length === 0) {
        return { warehouseId, buckets, awaitingMatchingCount: backlog.count, holders: [] };
      }

      const lines = await loadShipmentLines(trx, ids);
      const orderedAt = earliestOrderDates(lines);
      // 분류마다 결품으로 돌아온 상자, 배치에서 빠져 돌아온 상자 순으로 앞에 모으고, 그 안에서는 오래된 주문부터 —
      // 쪽 나누기 전에 정렬해야 다음 쪽에 묻히지 않는다. 주문일이 없거나 같으면 상자를 만든 순서 그대로다
      const rank = (id: string) => (shortPicks.has(id) ? 0 : returned.has(id) ? 1 : 2);
      const shipments = [...kept].sort(
        (a, b) => rank(a.id) - rank(b.id) || compareOrderedAt(orderedAt.get(a.id), orderedAt.get(b.id)),
      );
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
      const untrustedIds = await loadUntrustedLineSkus(trx, ids);
      const board = await this.consolidationBoard.findBoard(warehouseId, trx);
      const groupByShipment = new Map(
        board.groups.flatMap((group) =>
          group.shipments.map((shipment) => [shipment.shipmentId, group] satisfies [string, typeof group]),
        ),
      );
      const activeIds = new Set(workItems.map((item) => item.shipmentId));
      const needsInfoTargets: { id: string; recipientSnapshot: unknown; manifestVersion: number }[] = [];
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

        const owner = preparationOwnerOf(shipmentLines);
        const holder = holders.get(owner.key) ?? { key: owner.key, name: owner.name, count: 0 };

        holder.count++;
        holders.set(owner.key, holder);

        if (holderFilter && !holderFilter.has(owner.key)) {
          continue;
        }

        const single = isSingleItem(quantities);
        const shortPick = shortPicks.get(shipment.id) ?? null;
        const exit = returned.get(shipment.id);

        bucket.count++;
        bucket.singleCount += single ? 1 : 0;
        bucket.multiCount += single ? 0 : 1;
        bucket.shortPickCount += shortPick ? 1 : 0;
        bucket.batchReturnCount += exit && !shortPick ? 1 : 0;

        if (
          (page?.bucket && bucketName !== page.bucket) ||
          bucket.count <= (page?.offset ?? 0) ||
          bucket.shipments.length >= BUCKET_PAGE_SIZE
        ) {
          continue;
        }

        if (bucketName === 'needs_info') {
          needsInfoTargets.push({
            id: shipment.id,
            recipientSnapshot: shipment.recipientSnapshot,
            manifestVersion: shipment.manifestVersion,
          });
        }

        const names = shipmentLines.map((line) => line.skuName);

        const recipientName = bucketName === 'ready' ? recipientNameOf(shipment.recipientSnapshot) : null;

        bucket.shipments.push({
          shipmentId: shipment.id,
          orderNos: uniqueInOrder(shipmentLines.flatMap((line) => line.displayOrderNo ?? line.channelOrderId ?? [])),
          orderedAt: orderedAt.get(shipment.id)?.toISOString() ?? null,
          ...(recipientName && { recipient: { shipmentId: shipment.id, name: recipientName } }),
          itemSummary: names.length > 1 ? `${names[0]} 외 ${names.length - 1}건` : (names[0] ?? ''),
          totalQty: shipmentLines.reduce((total, line) => total + line.qty, 0),
          single,
          reason: null,
          lines: quantities.map((line) => ({
            name: line.name,
            qty: line.qty,
            reservedQty: Math.min(line.qty, line.confirmedQty),
          })),
          split: splits.get(shipment.id) ?? null,
          shortPick,
          batchReturn: exit
            ? {
                batchNumber: exit.batchNumber,
                exitedAt: exit.exitedAt.toISOString(),
                ...batchExitReasonOf(exit.exclusionReason),
                needsNewWaybill: newWaybills.has(shipment.id),
              }
            : null,
          owner: owner.key === OUR_HOLDER_KEY ? null : { id: owner.key, name: owner.name },
        });
      }

      await this.fillWaybillFailures(trx, buckets.find((entry) => entry.bucket === 'resume')?.shipments ?? []);
      await this.fillNeedsInfo(trx, buckets.find((entry) => entry.bucket === 'needs_info')?.shipments ?? [], {
        targets: needsInfoTargets,
        untrusted: untrustedIds,
      });
      await this.fillShortageStock(
        trx,
        warehouseId,
        buckets.find((entry) => entry.bucket === 'unavailable')?.shipments ?? [],
        quantitiesByShipment,
      );

      return {
        warehouseId,
        buckets,
        awaitingMatchingCount: backlog.count,
        // 자사를 맨 앞에, 업체는 이름순
        holders: [...holders.values()].sort(
          (a, b) => Number(b.key === OUR_HOLDER_KEY) - Number(a.key === OUR_HOLDER_KEY) || a.name.localeCompare(b.name),
        ),
      };
    }, tx);
  }

  // 정보 부족 상자에 고쳐야 할 것을 모두 싣는다. 첫 항목이 사유다 — 분류와 같은 판정이다.
  private async fillNeedsInfo(
    trx: DbTx,
    shipments: PreparationBucketDto['shipments'],
    input: {
      targets: { id: string; recipientSnapshot: unknown; manifestVersion: number }[];
      untrusted: Map<string, Set<string>>;
    },
  ): Promise<void> {
    if (shipments.length === 0) {
      return;
    }

    const lines = await loadNeedsInfoLines(
      trx,
      shipments.map((shipment) => shipment.shipmentId),
    );
    const targets = new Map(input.targets.map((target) => [target.id, target]));

    for (const shipment of shipments) {
      const target = targets.get(shipment.shipmentId);
      const shipmentLines = lines.get(shipment.shipmentId) ?? [];
      const issues = needsInfoIssues({
        lines: shipmentLines,
        recipientSnapshot: target?.recipientSnapshot,
        untrustedSkuIds: input.untrusted.get(shipment.shipmentId) ?? new Set(),
      });

      shipment.needsInfo = issues;
      shipment.reason = issues[0] ? needsInfoReasonText(issues[0]) : null;

      if (target && issues.some((issue) => issue.kind === 'shipping_profile_mixed')) {
        shipment.profileSplit = {
          manifestVersion: target.manifestVersion,
          lines: shipmentLines.map((line) => ({
            id: line.lineId,
            lineVersion: line.lineVersion,
            qty: line.qty,
            skuId: line.skuId,
            skuName: line.skuName,
            skuCode: line.skuCode,
            deliveryProfile: line.profileId ? { id: line.profileId, name: line.profileName ?? '' } : null,
          })),
        };
      }
    }
  }

  // 출고불가 상자의 줄마다 이 창고 재고·다른 상자 몫과 들어올 예정을 싣는다.
  private async fillShortageStock(
    trx: DbTx,
    warehouseId: string,
    shipments: PreparationBucketDto['shipments'],
    quantitiesByShipment: Map<string, PreparationLineQuantity[]>,
  ): Promise<void> {
    if (shipments.length === 0) {
      return;
    }

    const skuIds = uniqueInOrder(
      shipments.flatMap((shipment) => (quantitiesByShipment.get(shipment.shipmentId) ?? []).map((line) => line.skuId)),
    );
    const stock = await loadWarehouseStock(trx, warehouseId, skuIds);
    const scope = await readPipelineScope(trx, warehouseId);
    const pipeline = new Map(
      scope.elsewhere
        ? (await this.inboundPipeline.read(trx, { skuIds, toWarehouseId: warehouseId })).map((row) => [row.skuId, row])
        : [],
    );

    for (const shipment of shipments) {
      const quantities = quantitiesByShipment.get(shipment.shipmentId) ?? [];

      shipment.lines = shipment.lines.map((line, index) => {
        const skuId = quantities[index]?.skuId;

        return skuId
          ? {
              ...line,
              stock: { skuId, ...shortageStockOf(stock.get(skuId), pipeline.get(skuId), line.reservedQty, scope) },
            }
          : line;
      });
    }
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
          skuId: wmsTables.shipmentLines.skuId,
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

        shipmentLines.push({
          name: line.name,
          skuId: line.skuId,
          qty: line.qty,
          confirmedQty: confirmedByLine.get(line.id) ?? 0,
        });
        quantitiesByShipment.set(line.shipmentId, shipmentLines);
      }

      return quantitiesByShipment;
    }, tx);
  }
}
