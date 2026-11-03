import {
  needsUnwindSteps,
  orderNoText,
  progressLabel,
} from '@/features/order/fulfillments/detail/consolidation-sheet-model';
import type {
  ConsolidationBoardGroup,
  ConsolidationBoardShipment,
  CreateShipmentConsolidationRequest,
  ShipmentConsolidationResponse,
} from '@/lib/types/dto/fulfillment';

export const DEFAULT_MERGE_REASON = '동일 수령인 합포장';

export const BOARD_EMPTY_TEXT = '지금 합칠 수 있는 주문이 없어요.';

const DEFAULT_WAREHOUSE_NAME = '부천';

export type BoardRowAction = 'merge' | 'unwind_merge';

export function boardRowAction(group: ConsolidationBoardGroup): BoardRowAction {
  return group.shipments.some(needsUnwindSteps) ? 'unwind_merge' : 'merge';
}

export function isBulkSelectable(group: ConsolidationBoardGroup): boolean {
  return boardRowAction(group) === 'merge' && !group.memoDiffers;
}

export function buildBoardRequest(
  group: ConsolidationBoardGroup,
  reason: string
): CreateShipmentConsolidationRequest {
  return {
    sources: group.shipments.map((shipment) => ({
      shipmentId: shipment.shipmentId,
      expectedManifestVersion: shipment.manifestVersion,
      expectedReservationVersion: shipment.reservationVersion,
    })),
    recipientSourceShipmentId: group.shipments[0].shipmentId,
    reason,
  };
}

export function shipmentBadge(shipment: ConsolidationBoardShipment): {
  label: string;
  tone: 'ok' | 'warn';
} {
  if (!needsUnwindSteps(shipment)) {
    return { label: '바로 합칠 수 있음', tone: 'ok' };
  }

  return { label: progressLabel(shipment), tone: 'warn' };
}

export function defaultWarehouseId(
  warehouses: ReadonlyArray<{ id: string; name: string }>
): string {
  const preferred = warehouses.find((warehouse) =>
    warehouse.name.includes(DEFAULT_WAREHOUSE_NAME)
  );

  return (preferred ?? warehouses[0])?.id ?? '';
}

export type BoardFilters = {
  todayOnly: boolean;
  beforeWaybillOnly: boolean;
};

function sameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export function filterBoardGroups(
  groups: readonly ConsolidationBoardGroup[],
  filters: BoardFilters,
  now: Date
): ConsolidationBoardGroup[] {
  return groups.filter((group) => {
    if (
      filters.beforeWaybillOnly &&
      group.shipments.some((shipment) => shipment.waybillTrackingNo !== null)
    ) {
      return false;
    }

    if (!filters.todayOnly) {
      return true;
    }

    return group.shipments.some(
      (shipment) =>
        shipment.orderedAt !== null &&
        sameDay(new Date(shipment.orderedAt), now)
    );
  });
}

export function boardFooterText(
  groups: readonly ConsolidationBoardGroup[]
): string {
  const orders = groups.reduce((sum, group) => sum + group.shipments.length, 0);
  const pairsOnly = groups.every((group) => group.shipments.length === 2);

  return `${groups.length}${pairsOnly ? '쌍' : '묶음'} · 주문 ${orders}건`;
}

export function groupOrderNos(group: ConsolidationBoardGroup): string {
  return group.shipments.map(orderNoText).join(', ');
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function boardRecipientView(snapshot: Record<string, unknown>): {
  name: string;
  address: string;
  addressNote: string;
} {
  const road = text(snapshot.roadAddress);
  const detail = text(snapshot.detailAddress);
  const memo = text(snapshot.deliveryNote) || '없음';

  return {
    name: text(snapshot.recipientName) || '-',
    address: [road, detail].filter((part) => part !== '').join(', ') || '-',
    addressNote: detail ? `메모 ${memo}` : `상세주소 없음 · 메모 ${memo}`,
  };
}

export type BulkResult = {
  key: string;
  orderNos: string;
  ok: boolean;
  message: string;
};

export function summarizeBulk(results: readonly BulkResult[]): string {
  const succeeded = results.filter((result) => result.ok).length;

  if (succeeded === results.length) {
    return `${results.length}건을 모두 합쳤어요.`;
  }

  return `${results.length}건 중 ${succeeded}건을 합쳤고 ${results.length - succeeded}건은 실패했어요.`;
}

export async function runBulkMerge(
  groups: readonly ConsolidationBoardGroup[],
  send: (
    request: CreateShipmentConsolidationRequest
  ) => Promise<ShipmentConsolidationResponse>,
  describeError: (error: unknown) => string
): Promise<BulkResult[]> {
  const results: BulkResult[] = [];

  for (const group of groups) {
    const orderNos = groupOrderNos(group);

    try {
      const response = await send(
        buildBoardRequest(group, DEFAULT_MERGE_REASON)
      );

      results.push({
        key: group.key,
        orderNos,
        ok: true,
        message:
          response.operationStatus === 'completed'
            ? '합쳤어요.'
            : '요청했어요. 상자 화면에서 다음 할 일을 알려 줘요.',
      });
    } catch (error) {
      results.push({
        key: group.key,
        orderNos,
        ok: false,
        message: describeError(error),
      });
    }
  }

  return results;
}
