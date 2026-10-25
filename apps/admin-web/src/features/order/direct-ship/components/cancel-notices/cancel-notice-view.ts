import type { DirectShipCancelNotice } from '@/lib/types/dto/fulfillment';

export const CANCEL_NOTICE_OVERDUE_HOURS = 24;

export function isOverdue(createdAt: string, now: Date): boolean {
  return now.getTime() - new Date(createdAt).getTime() >= CANCEL_NOTICE_OVERDUE_HOURS * 3600_000;
}

export interface CancelNoticeGroup {
  supplierId: string;
  companyName: string;
  rows: DirectShipCancelNotice[];
  overdueCount: number;
}

/** 입점사 id 로 묶는다 — 이름이 같은 두 입점사를 한 묶음으로 보내면 남의 취소를 알린다. 이름 순. */
export function groupBySupplier(rows: DirectShipCancelNotice[], now: Date): CancelNoticeGroup[] {
  const map = new Map<string, { companyName: string; rows: DirectShipCancelNotice[] }>();
  for (const r of rows) {
    const group = map.get(r.supplierId);
    if (group) group.rows.push(r);
    else map.set(r.supplierId, { companyName: r.companyName, rows: [r] });
  }
  return [...map.entries()]
    .map(([supplierId, g]) => ({
      supplierId,
      companyName: g.companyName,
      rows: g.rows,
      overdueCount: g.rows.filter((r) => isOverdue(r.createdAt, now)).length,
    }))
    .sort((a, b) => a.companyName.localeCompare(b.companyName, 'ko'));
}
