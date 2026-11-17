import { and, eq, inArray, isNull, or, sql, SQL } from 'drizzle-orm';
import { wmsTables } from '../../inventory/schema/inventory.schema';
import { FoConsolidationDto } from '../dto/fulfillment-order-response.dto';
import { assembleConsolidationBoard } from './consolidation-board.reader';
import { CONSOLIDATION_RECOVERY_CODE } from './consolidation-recovery';
import {
  loadInHouseProfileIds,
  loadShipmentLines,
  OPTION_STATUSES,
  OptionLine,
  ReadDb,
  ShipmentRow,
  summarizeShipmentWithoutRecipient,
  uniqueInOrder,
} from './consolidation-shipment-reads';

export type FoConsolidation = FoConsolidationDto;

export interface FoConsolidationBox {
  status: string;
  recoveryCode: string | null;
  orderNos: readonly string[];
}

export interface FoConsolidationInput {
  ownOrderNos: readonly string[];
  boxes: readonly FoConsolidationBox[];
  mergeableOrderNos: readonly string[];
}

const IGNORED_BOX_STATUSES = new Set(['superseded', 'canceled', 'failed']);

export function foConsolidationState(input: FoConsolidationInput): FoConsolidation {
  const own = new Set(input.ownOrderNos);
  const openBoxes = input.boxes.filter((box) => !IGNORED_BOX_STATUSES.has(box.status));
  const partnersOf = (boxes: readonly FoConsolidationBox[]) =>
    uniqueInOrder(boxes.flatMap((box) => box.orderNos).filter((orderNo) => !own.has(orderNo)));
  const merging = openBoxes.filter((box) => box.recoveryCode === CONSOLIDATION_RECOVERY_CODE);

  if (merging.length > 0) {
    return { state: 'merging', partnerOrderNos: partnersOf(merging) };
  }

  const merged = openBoxes.filter((box) => new Set(box.orderNos).size >= 2);

  if (merged.length > 0) {
    return { state: 'merged', partnerOrderNos: partnersOf(merged) };
  }

  const mergeable = uniqueInOrder(input.mergeableOrderNos.filter((orderNo) => !own.has(orderNo)));

  if (mergeable.length > 0) {
    return { state: 'mergeable', partnerOrderNos: mergeable };
  }

  return { state: 'none', partnerOrderNos: [] };
}

export interface FoConsolidationTarget {
  id: string;
  salesOrderId: string | null;
  warehouseId: string | null;
}

function digitsOf(column: typeof wmsTables.salesOrders.customerPhone): SQL<string> {
  return sql<string>`regexp_replace(coalesce(${column}, ''), '\\D', '', 'g')`;
}

async function loadCandidateShipmentIds(
  db: ReadDb,
  warehouseIds: string[],
  customerIds: string[],
  phones: string[],
): Promise<string[]> {
  const customerMatches = [
    customerIds.length > 0 ? inArray(wmsTables.salesOrders.customerId, customerIds) : undefined,
    phones.length > 0 ? inArray(digitsOf(wmsTables.salesOrders.customerPhone), phones) : undefined,
  ].filter((condition): condition is SQL => condition !== undefined);

  if (customerMatches.length === 0 || warehouseIds.length === 0) return [];

  const rows = await db
    .select({ shipmentId: wmsTables.shipmentLines.shipmentId })
    .from(wmsTables.shipmentLines)
    .innerJoin(wmsTables.shipments, eq(wmsTables.shipments.id, wmsTables.shipmentLines.shipmentId))
    .innerJoin(
      wmsTables.fulfillmentOrderItems,
      eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
    )
    .innerJoin(
      wmsTables.fulfillmentOrders,
      eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
    )
    .innerJoin(wmsTables.salesOrders, eq(wmsTables.salesOrders.id, wmsTables.fulfillmentOrders.salesOrderId))
    .where(
      and(
        inArray(wmsTables.shipments.status, OPTION_STATUSES),
        isNull(wmsTables.shipments.supplierId),
        inArray(wmsTables.shipments.warehouseId, warehouseIds),
        or(...customerMatches),
      ),
    );

  return [...new Set(rows.map((row) => row.shipmentId))];
}

function orderNosOf(lines: readonly OptionLine[]): string[] {
  return uniqueInOrder(
    lines.flatMap((line) => {
      const orderNo = line.displayOrderNo ?? line.channelOrderId;

      return orderNo ? [orderNo] : [];
    }),
  );
}

export async function loadFoConsolidations(
  db: ReadDb,
  fulfillmentOrders: readonly FoConsolidationTarget[],
): Promise<Map<string, FoConsolidation>> {
  const result = new Map<string, FoConsolidation>();
  const foIds = fulfillmentOrders.map((fo) => fo.id);

  if (foIds.length === 0) return result;

  const salesOrderIds = [...new Set(fulfillmentOrders.flatMap((fo) => (fo.salesOrderId ? [fo.salesOrderId] : [])))];
  const warehouseIds = [...new Set(fulfillmentOrders.flatMap((fo) => (fo.warehouseId ? [fo.warehouseId] : [])))];
  const [pairs, customers] = await Promise.all([
    db
      .select({
        foId: wmsTables.fulfillmentOrderItems.fulfillmentOrderId,
        shipmentId: wmsTables.shipmentLines.shipmentId,
      })
      .from(wmsTables.shipmentLines)
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .where(inArray(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, foIds)),
    salesOrderIds.length > 0
      ? db
          .select({
            customerId: wmsTables.salesOrders.customerId,
            phone: digitsOf(wmsTables.salesOrders.customerPhone),
          })
          .from(wmsTables.salesOrders)
          .where(inArray(wmsTables.salesOrders.id, salesOrderIds))
      : Promise.resolve([]),
  ]);
  const customerIds = [...new Set(customers.flatMap((row) => (row.customerId ? [row.customerId] : [])))];
  const phones = [...new Set(customers.flatMap((row) => (!row.customerId && row.phone ? [row.phone] : [])))];
  const candidateIds = await loadCandidateShipmentIds(db, warehouseIds, customerIds, phones);
  const shipmentIds = [...new Set([...pairs.map((pair) => pair.shipmentId), ...candidateIds])];

  if (shipmentIds.length === 0) {
    for (const fo of fulfillmentOrders) {
      result.set(fo.id, foConsolidationState({ ownOrderNos: [], boxes: [], mergeableOrderNos: [] }));
    }

    return result;
  }

  const shipments: ShipmentRow[] = await db
    .select()
    .from(wmsTables.shipments)
    .where(inArray(wmsTables.shipments.id, shipmentIds));
  const lines = await loadShipmentLines(db, shipmentIds);
  const emptyProgress = {
    batchByShipment: new Map<string, string>(),
    trackingByShipment: new Map<string, string>(),
    splitByShipment: new Map(),
  };
  const openShipments = shipments.filter((shipment) => OPTION_STATUSES.includes(shipment.status));
  const partitions = new Map<string, ShipmentRow[]>();

  for (const shipment of openShipments) {
    if (!shipment.shippingProfileId) continue;

    const key = `${shipment.warehouseId}|${shipment.shippingProfileId}`;

    partitions.set(key, [...(partitions.get(key) ?? []), shipment]);
  }

  const profileIds = uniqueInOrder(openShipments.flatMap((shipment) => shipment.shippingProfileId ?? []));
  const inHouseProfileIds = await loadInHouseProfileIds(db, profileIds);
  const groups = [...partitions.values()].flatMap((members) =>
    assembleConsolidationBoard(members, lines, emptyProgress, inHouseProfileIds),
  );
  const groupByShipment = new Map<string, string[]>();

  for (const group of groups) {
    const groupOrderNos = uniqueInOrder(group.shipments.flatMap((shipment) => shipment.salesOrderNos));

    for (const shipment of group.shipments) {
      groupByShipment.set(shipment.shipmentId, groupOrderNos);
    }
  }

  const shipmentById = new Map(shipments.map((shipment) => [shipment.id, shipment]));
  const linesByShipment = new Map<string, OptionLine[]>();

  for (const line of lines) {
    linesByShipment.set(line.shipmentId, [...(linesByShipment.get(line.shipmentId) ?? []), line]);
  }

  const shipmentIdsByFo = new Map<string, string[]>();

  for (const pair of pairs) {
    shipmentIdsByFo.set(pair.foId, [...(shipmentIdsByFo.get(pair.foId) ?? []), pair.shipmentId]);
  }

  for (const fo of fulfillmentOrders) {
    const ownIds = shipmentIdsByFo.get(fo.id) ?? [];
    const ownOrderNos = orderNosOf(
      ownIds.flatMap((id) => (linesByShipment.get(id) ?? []).filter((line) => line.salesOrderId === fo.salesOrderId)),
    );
    const boxes = ownIds.flatMap((id) => {
      const shipment = shipmentById.get(id);

      return shipment
        ? [
            {
              status: shipment.status,
              recoveryCode: shipment.recoveryCode,
              orderNos: summarizeShipmentWithoutRecipient(shipment, linesByShipment.get(id) ?? [], emptyProgress)
                .salesOrderNos,
            },
          ]
        : [];
    });
    const mergeableOrderNos = ownIds.flatMap((id) => groupByShipment.get(id) ?? []);

    result.set(fo.id, foConsolidationState({ ownOrderNos, boxes, mergeableOrderNos }));
  }

  return result;
}
