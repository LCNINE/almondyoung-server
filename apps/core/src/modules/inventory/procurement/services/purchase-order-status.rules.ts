import { earliestExpectedDate } from '../../shared/dates/earliest-expected-date';

/** drizzle enum 컬럼은 문자열 유니온이다. TS enum 멤버로 비교하지 않는다. */
export type PurchaseOrderStatus = 'created' | 'confirmed' | 'received' | 'cancelled';
export type PurchaseOrderLineStatus = 'requested' | 'ordered' | 'unavailable';

const ACCEPTS_CHANGES: Record<PurchaseOrderStatus, boolean> = {
  created: true,
  confirmed: true,
  received: false,
  cancelled: false,
};
export const acceptsChanges = (s: PurchaseOrderStatus): boolean => ACCEPTS_CHANGES[s];

const DERIVATION_FROZEN: Record<PurchaseOrderStatus, boolean> = {
  created: false,
  confirmed: false,
  received: false,
  cancelled: true,
};
export const isDerivationFrozen = (s: PurchaseOrderStatus): boolean => DERIVATION_FROZEN[s];

export interface LineSettlement {
  status: PurchaseOrderLineStatus;
  orderedQty: number | null;
  receivedQty: number;
  closedAt: Date | null;
}

export function outstandingQty(line: LineSettlement): number {
  if (line.status !== 'ordered' || line.closedAt !== null) return 0;
  return Math.max(0, (line.orderedQty ?? 0) - line.receivedQty);
}

export type ReceivingProgress = 'awaiting' | 'received' | 'short_closed';
export function lineReceivingProgress(line: LineSettlement): ReceivingProgress | null {
  if (line.status !== 'ordered') return null;
  if (line.closedAt !== null) return 'short_closed';
  return outstandingQty(line) > 0 ? 'awaiting' : 'received';
}

export function deriveHeaderStatus(lines: readonly LineSettlement[]): Exclude<PurchaseOrderStatus, 'cancelled'> {
  if (lines.some((l) => l.status === 'requested')) return 'created';
  const hasOrdered = lines.some((l) => l.status === 'ordered');
  const hasOutstanding = lines.some((l) => outstandingQty(l) > 0);
  if (hasOrdered && !hasOutstanding) return 'received';
  return 'confirmed';
}

export function purchaseOrderExpectedArrival(
  lines: readonly (LineSettlement & { expectedArrival: string | null })[],
): Date | null {
  return earliestExpectedDate(lines.filter((l) => outstandingQty(l) > 0).map((l) => l.expectedArrival));
}
