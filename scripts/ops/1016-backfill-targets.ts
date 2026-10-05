/**
 * #1016 5번 행 백필의 대상 선별 (스펙 §9.2). 순수 함수 — DB·HTTP 는 실행 스크립트가 한다.
 *
 * channel-adapter 는 core DB 를 못 읽으므로 «끝나지 않은 판매주문» 판정은 여기서 한다.
 * core diff 는 cancelled·timeout 만 건너뛰고 shipped·delivered 는 건너뛰지 않는다 — 셀메이트가
 * shipped 로 찍은 주문(2026-10-05 기준 격리의 96%)을 보내면 대기 목록을 출고된 주문으로 채운다.
 */

export const FINISHED_SALES_ORDER_STATUSES: readonly string[] = ['cancelled', 'timeout', 'shipped', 'delivered'];
const SYNCABLE_CHANNELS: readonly string[] = ['medusa', 'naver'];

export interface QuarantinedModification {
  channel: string;
  externalOrderId: string;
}

export interface CoreSalesOrderStatus {
  salesChannel: string;
  channelOrderId: string;
  status: string;
}

export interface BackfillSelection {
  targets: QuarantinedModification[];
  skipped: Array<QuarantinedModification & { reason: string }>;
}

export function selectBackfillTargets(
  quarantined: QuarantinedModification[],
  salesOrders: CoreSalesOrderStatus[],
): BackfillSelection {
  const statusByKey = new Map(salesOrders.map((row) => [`${row.salesChannel}:${row.channelOrderId}`, row.status]));
  const selection: BackfillSelection = { targets: [], skipped: [] };
  for (const row of quarantined) {
    if (!SYNCABLE_CHANNELS.includes(row.channel)) {
      selection.skipped.push({ ...row, reason: 'unsupported_channel' });
      continue;
    }
    const status = statusByKey.get(`${row.channel}:${row.externalOrderId}`);
    if (status === undefined) {
      selection.skipped.push({ ...row, reason: 'no_sales_order' });
      continue;
    }
    if (FINISHED_SALES_ORDER_STATUSES.includes(status)) {
      selection.skipped.push({ ...row, reason: `status:${status}` });
      continue;
    }
    selection.targets.push(row);
  }
  return selection;
}

export function countByReason(skipped: BackfillSelection['skipped']): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of skipped) counts[row.reason] = (counts[row.reason] ?? 0) + 1;
  return counts;
}
