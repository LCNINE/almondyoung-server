import type { DirectShipCancelNotice } from '@/lib/types/dto/fulfillment';

export const CANCEL_NOTICE_OVERDUE_HOURS = 24;

export function isOverdue(createdAt: string, now: Date): boolean {
  return now.getTime() - new Date(createdAt).getTime() >= CANCEL_NOTICE_OVERDUE_HOURS * 3600_000;
}

export function groupByCompany(
  rows: DirectShipCancelNotice[],
  now: Date
): Array<{ companyName: string; rows: DirectShipCancelNotice[]; overdueCount: number }> {
  const map = new Map<string, DirectShipCancelNotice[]>();
  for (const r of rows) {
    const list = map.get(r.companyName);
    if (list) list.push(r);
    else map.set(r.companyName, [r]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'ko'))
    .map(([companyName, list]) => ({
      companyName,
      rows: list,
      overdueCount: list.filter((r) => isOverdue(r.createdAt, now)).length,
    }));
}
