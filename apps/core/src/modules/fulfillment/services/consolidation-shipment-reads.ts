import { and, asc, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { DbService } from '@app/db';
import { DbTx, StockAllocation, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  ConsolidationItemDto,
  ConsolidationOptionShipmentDto,
  ConsolidationRecipientSnapshotDto,
  ShipmentSplitShareDto,
} from '../dto/consolidation.dto';
import { supportsInHouse } from './consolidation-eligibility';
import { WAYBILL_TERMINAL_STATUSES } from '../waybill/waybill.constants';
import {
  KeptApartSplits,
  keptApartSplitsOf,
  SplitLink,
  SplitOperation,
  splitFamilyRoot,
  splitReasonOf,
} from './split-families';

export type ReadDb = DbTx | DbService<typeof wmsSchema>['db'];

export type ShipmentRow = typeof wmsTables.shipments.$inferSelect;
export interface OptionLine {
  shipmentId: string;
  qty: number;
  salesOrderId: string | null;
  fulfillmentMode: string | null;
  skuStockType: string;
  skuProfileId: string | null;
  skuId: string;
  skuName: string;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  displayOrderNo: string | null;
  channelOrderId: string | null;
  salesChannel: string | null;
  salesOrderCreatedAt: Date | null;
  // 위탁 업체 출고(3pl)면 그 화주. 자사 출고는 null
  ownerId?: string | null;
  ownerName?: string | null;
  stockAllocation?: StockAllocation;
}

export interface ShipmentProgress {
  batchByShipment: Map<string, string>;
  trackingByShipment: Map<string, string>;
  splitByShipment: Map<string, ShipmentSplitShareDto>;
}

export const OPTION_STATUSES: ShipmentRow['status'][] = ['draft', 'planned'];
const CLOSED_WORK_ITEM_STATUSES = ['excluded', 'completed'] as const;
const RETIRED_SHIPMENT_STATUSES: ShipmentRow['status'][] = ['canceled', 'superseded'];

export function asRecipient(value: unknown): ConsolidationRecipientSnapshotDto {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

export function uniqueInOrder(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export async function loadShipmentLines(trx: ReadDb, shipmentIds: string[]): Promise<OptionLine[]> {
  if (shipmentIds.length === 0) return [];

  return trx
    .select({
      shipmentId: wmsTables.shipmentLines.shipmentId,
      qty: wmsTables.shipmentLines.qty,
      salesOrderId: wmsTables.fulfillmentOrders.salesOrderId,
      fulfillmentMode: wmsTables.fulfillmentOrders.fulfillmentMode,
      skuStockType: wmsTables.skus.stockType,
      skuProfileId: wmsTables.skus.deliveryProfileId,
      skuId: wmsTables.shipmentLines.skuId,
      skuName: wmsTables.skus.name,
      customerId: wmsTables.salesOrders.customerId,
      customerName: wmsTables.salesOrders.customerName,
      customerPhone: wmsTables.salesOrders.customerPhone,
      displayOrderNo: wmsTables.salesOrders.displayOrderNo,
      channelOrderId: wmsTables.salesOrders.channelOrderId,
      salesChannel: wmsTables.salesOrders.salesChannel,
      salesOrderCreatedAt: wmsTables.salesOrders.orderDate,
      ownerId: wmsTables.fulfillmentOrders.ownerId,
      ownerName: wmsTables.holders.name,
      stockAllocation: wmsTables.fulfillmentOrders.stockAllocation,
    })
    .from(wmsTables.shipmentLines)
    .innerJoin(
      wmsTables.fulfillmentOrderItems,
      eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
    )
    .innerJoin(
      wmsTables.fulfillmentOrders,
      eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
    )
    .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.shipmentLines.skuId))
    .leftJoin(wmsTables.salesOrders, eq(wmsTables.salesOrders.id, wmsTables.fulfillmentOrders.salesOrderId))
    .leftJoin(wmsTables.holders, eq(wmsTables.holders.id, wmsTables.fulfillmentOrders.ownerId))
    .where(inArray(wmsTables.shipmentLines.shipmentId, shipmentIds))
    .orderBy(asc(wmsTables.shipmentLines.createdAt), asc(wmsTables.shipmentLines.id));
}

export async function loadInHouseProfileIds(trx: ReadDb, profileIds: readonly string[]): Promise<Set<string>> {
  if (profileIds.length === 0) return new Set();

  const rows = await trx
    .select({ id: wmsTables.deliveryProfiles.id, modes: wmsTables.deliveryProfiles.supportedFulfillmentModes })
    .from(wmsTables.deliveryProfiles)
    .where(inArray(wmsTables.deliveryProfiles.id, [...profileIds]));

  return new Set(rows.filter((row) => supportsInHouse(row.modes)).map((row) => row.id));
}

export async function loadShipmentProgress(
  trx: ReadDb,
  shipmentIds: string[],
  splitGraph?: SplitGraph,
): Promise<ShipmentProgress> {
  const [workItems, waybills] = await Promise.all([
    trx
      .select({
        shipmentId: wmsTables.outboundBatchWorkItems.shipmentId,
        batchId: wmsTables.outboundBatchWorkItems.batchId,
      })
      .from(wmsTables.outboundBatchWorkItems)
      .where(
        and(
          inArray(wmsTables.outboundBatchWorkItems.shipmentId, shipmentIds),
          notInArray(wmsTables.outboundBatchWorkItems.status, [...CLOSED_WORK_ITEM_STATUSES]),
        ),
      ),
    trx
      .select({ shipmentId: wmsTables.waybills.shipmentId, trackingNo: wmsTables.waybills.trackingNo })
      .from(wmsTables.waybills)
      .where(
        and(
          inArray(wmsTables.waybills.shipmentId, shipmentIds),
          notInArray(wmsTables.waybills.status, [...WAYBILL_TERMINAL_STATUSES]),
        ),
      )
      .orderBy(desc(wmsTables.waybills.createdAt)),
  ]);
  const batchByShipment = new Map<string, string>();

  for (const row of workItems) {
    batchByShipment.set(row.shipmentId, row.batchId);
  }

  const trackingByShipment = new Map<string, string>();

  for (const row of waybills) {
    if (row.trackingNo && !trackingByShipment.has(row.shipmentId)) {
      trackingByShipment.set(row.shipmentId, row.trackingNo);
    }
  }

  return {
    batchByShipment,
    trackingByShipment,
    splitByShipment: await loadSplitShares(trx, shipmentIds, splitGraph),
  };
}

export type SplitGraph = { links: SplitLink[]; operations: Map<string, SplitOperation>; shipmentIds: string[] };

// 나누기로 이어진 상자를 새 상자가 더 나오지 않을 때까지 따라가고, 그 나누기 작업들의 사유를 함께 읽는다.
export async function loadSplitGraph(trx: ReadDb, shipmentIds: string[]): Promise<SplitGraph> {
  const members = wmsTables.shipmentOperationMembers;
  const operations = wmsTables.shipmentOperations;
  const links: SplitLink[] = [];
  const found = new Map<string, SplitOperation>();
  const seen = new Set(shipmentIds);
  let frontier = shipmentIds;

  while (frontier.length > 0) {
    const rows = await trx
      .select({
        operationId: members.operationId,
        shipmentId: members.shipmentId,
        reason: operations.reason,
        reasonCode: operations.reasonCode,
        completedAtMicros: sql<
          number | null
        >`(extract(epoch from ${operations.completedAt}) * 1000000)::bigint`.mapWith((value) =>
          value === null ? null : Number(value),
        ),
      })
      .from(members)
      .innerJoin(operations, eq(operations.id, members.operationId))
      .where(
        inArray(
          members.operationId,
          trx
            .select({ operationId: members.operationId })
            .from(members)
            .innerJoin(operations, eq(operations.id, members.operationId))
            .where(
              and(
                inArray(members.shipmentId, frontier),
                eq(operations.type, 'split'),
                eq(operations.status, 'completed'),
              ),
            ),
        ),
      );

    for (const row of rows) {
      links.push({ operationId: row.operationId, shipmentId: row.shipmentId });
      found.set(row.operationId, {
        id: row.operationId,
        reason: row.reason,
        reasonCode: row.reasonCode,
        completedAtMicros: row.completedAtMicros,
      });
    }

    frontier = uniqueInOrder(rows.map((row) => row.shipmentId)).filter((id) => !seen.has(id));
    frontier.forEach((id) => seen.add(id));
  }

  return { links, operations: found, shipmentIds: [...seen] };
}

// «나누기»로 이어진 상자들을 한 묶음으로 보고, 상자마다 «묶음 전체 수량 중 이 상자 몫»과 묶음 안 순번,
// 이 상자를 나눈 이유를 준다. 이미 나간 상자도 묶음에 넣는다. 나뉜 적 없는 상자는 맵에 없다.
export async function loadSplitShares(
  trx: ReadDb,
  shipmentIds: string[],
  graph?: SplitGraph,
): Promise<Map<string, ShipmentSplitShareDto>> {
  if (shipmentIds.length === 0) return new Map();

  const { links, operations, shipmentIds: related } = graph ?? (await loadSplitGraph(trx, shipmentIds));

  if (links.length === 0) return new Map();

  const boxes = await trx
    .select({
      shipmentId: wmsTables.shipmentLines.shipmentId,
      createdAt: wmsTables.shipments.createdAt,
      qty: sql<number>`sum(${wmsTables.shipmentLines.qty})`.mapWith(Number),
    })
    .from(wmsTables.shipmentLines)
    .innerJoin(wmsTables.shipments, eq(wmsTables.shipments.id, wmsTables.shipmentLines.shipmentId))
    .where(
      and(
        inArray(wmsTables.shipmentLines.shipmentId, related),
        notInArray(wmsTables.shipments.status, RETIRED_SHIPMENT_STATUSES),
      ),
    )
    .groupBy(wmsTables.shipmentLines.shipmentId, wmsTables.shipments.createdAt)
    .orderBy(asc(wmsTables.shipments.createdAt), asc(wmsTables.shipmentLines.shipmentId));
  const shares = new Map<string, ShipmentSplitShareDto>();

  for (const [shipmentId, share] of splitSharesOf(links, boxes, shipmentIds)) {
    const reason = splitReasonOf(shipmentId, links, operations);

    shares.set(shipmentId, { ...share, reasonCode: reason?.reasonCode ?? null, reason: reason?.reason ?? null });
  }

  return shares;
}

// liveBoxes 는 만든 순서대로 온다 — 그 순서가 상자 번호가 된다.
export function splitSharesOf(
  links: readonly SplitLink[],
  liveBoxes: ReadonlyArray<{ shipmentId: string; qty: number }>,
  shipmentIds: readonly string[],
): Map<string, Omit<ShipmentSplitShareDto, 'reasonCode' | 'reason'>> {
  const root = splitFamilyRoot(links);
  const groups = new Map<string, Array<{ shipmentId: string; qty: number }>>();

  for (const box of liveBoxes) {
    const group = root(box.shipmentId);

    groups.set(group, [...(groups.get(group) ?? []), box]);
  }

  const shares = new Map<string, Omit<ShipmentSplitShareDto, 'reasonCode' | 'reason'>>();

  for (const shipmentId of shipmentIds) {
    const group = groups.get(root(shipmentId)) ?? [];
    const index = group.findIndex((box) => box.shipmentId === shipmentId);

    if (index < 0 || group.length < 2) continue;

    shares.set(shipmentId, {
      boxQty: group[index].qty,
      orderQty: group.reduce((total, box) => total + box.qty, 0),
      boxNo: index + 1,
      boxCount: group.length,
    });
  }

  return shares;
}

// 크기 때문에 나눈 상자 묶음(상자 id → 묶음 키). 합포장 제안이 이 묶음 안의 상자끼리는 잇지 않는다.
export async function loadKeptApartSplits(
  trx: ReadDb,
  shipmentIds: string[],
  graph?: SplitGraph,
): Promise<KeptApartSplits> {
  if (shipmentIds.length === 0) return new Map();

  const { links, operations } = graph ?? (await loadSplitGraph(trx, shipmentIds));

  return keptApartSplitsOf(links, operations);
}

// 같은 상품이 여러 줄에 나뉘어 있어도 한 줄로 합친다. 순서는 처음 나온 줄을 따른다.
export function itemsOf(lines: readonly OptionLine[]): ConsolidationItemDto[] {
  const items = new Map<string, ConsolidationItemDto>();

  for (const line of lines) {
    const item = items.get(line.skuId);

    if (item) {
      item.qty += line.qty;
    } else {
      items.set(line.skuId, { skuId: line.skuId, name: line.skuName, qty: line.qty });
    }
  }

  return [...items.values()];
}

export type ShipmentSummaryWithoutRecipient = Omit<ConsolidationOptionShipmentDto, 'recipientSnapshot'>;

export function summarizeShipmentWithoutRecipient(
  shipment: ShipmentRow,
  lines: readonly OptionLine[],
  progress: ShipmentProgress,
): ShipmentSummaryWithoutRecipient {
  const names = lines.map((line) => line.skuName);

  return {
    shipmentId: shipment.id,
    status: shipment.status,
    salesOrderNos: uniqueInOrder(
      lines.flatMap((line) => {
        const orderNo = line.displayOrderNo ?? line.channelOrderId;

        return orderNo ? [orderNo] : [];
      }),
    ),
    itemSummary: names.length > 1 ? `${names[0]} 외 ${names.length - 1}건` : (names[0] ?? ''),
    totalQty: lines.reduce((total, line) => total + line.qty, 0),
    items: itemsOf(lines),
    batchId: progress.batchByShipment.get(shipment.id) ?? null,
    waybillTrackingNo: progress.trackingByShipment.get(shipment.id) ?? null,
    manifestVersion: shipment.manifestVersion,
    reservationVersion: shipment.reservationVersion,
    createdAt: shipment.createdAt,
    split: progress.splitByShipment.get(shipment.id) ?? null,
  };
}

export function summarizeShipment(
  shipment: ShipmentRow,
  lines: readonly OptionLine[],
  progress: ShipmentProgress,
): ConsolidationOptionShipmentDto {
  return {
    ...summarizeShipmentWithoutRecipient(shipment, lines, progress),
    recipientSnapshot: asRecipient(shipment.recipientSnapshot),
  };
}
