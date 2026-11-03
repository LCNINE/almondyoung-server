import type {
  ConsolidationBoardGroup,
  PlannedShipment,
} from '@/lib/types/dto/fulfillment';

export const BATCH_ISSUE_LIMIT = 100;

export const PLANNED_LIST_LIMIT = 200;

export type MergePair = {
  key: string;
  shipmentIds: string[];
  labels: string[];
};

export function plannedOrderText(
  shipment: Pick<PlannedShipment, 'shipmentId' | 'orderNos'>
): string {
  if (shipment.orderNos.length === 0) {
    return `상자 ${shipment.shipmentId.slice(0, 8)}`;
  }

  return shipment.orderNos.map((no) => `#${no}`).join(', ');
}

export function isPlannedListCapped(count: number): boolean {
  return count >= PLANNED_LIST_LIMIT;
}

export function filterPlanned(
  shipments: readonly PlannedShipment[],
  query: string
): PlannedShipment[] {
  const needle = query.trim();

  if (!needle) {
    return [...shipments];
  }

  return shipments.filter(
    (shipment) =>
      shipment.shipmentId.includes(needle) ||
      shipment.orderNos.some((no) => no.includes(needle))
  );
}

export function mergePairs(
  selectedIds: readonly string[],
  groups: readonly ConsolidationBoardGroup[],
  planned: readonly PlannedShipment[]
): MergePair[] {
  const picked = new Set(selectedIds);
  const byId = new Map(
    planned.map((shipment) => [shipment.shipmentId, shipment])
  );
  const pairs: MergePair[] = [];

  for (const group of groups) {
    const shipmentIds = group.shipments
      .map((shipment) => shipment.shipmentId)
      .filter((shipmentId) => picked.has(shipmentId));

    if (shipmentIds.length < 2) {
      continue;
    }

    pairs.push({
      key: group.key,
      shipmentIds,
      labels: shipmentIds.map((shipmentId) =>
        plannedOrderText(byId.get(shipmentId) ?? { shipmentId, orderNos: [] })
      ),
    });
  }

  return pairs;
}
