import type { SupplierQueueSummary } from '@/lib/types/dto/fulfillment';

/** 요약 칩 — `이름 · 대기 n · 넘김 n · 못 보냄 n`, 0 인 수는 숨긴다 */
export function supplierChipLabel(s: SupplierQueueSummary): string {
  const parts = [s.supplierName];
  if (s.pendingShipments > 0) parts.push(`대기 ${s.pendingShipments}`);
  if (s.forwardedShipments > 0) parts.push(`넘김 ${s.forwardedShipments}`);
  if (s.unfulfillableLines > 0) parts.push(`못 보냄 ${s.unfulfillableLines}`);
  return parts.join(' · ');
}

/**
 * 화면이 쓸 입점사(`?supplier=`). 고르지 않았으면 요약의 첫 번째, 요약도 비면 null.
 * 고른 입점사가 요약에 없어도 그대로 둔다 — 요약은 열린 상자가 있는 입점사만 내지만,
 * 다 발송한 뒤에도 넘긴 것·올리기(송장 정정)는 그 입점사로 본다.
 */
export function resolveSupplierId(
  summaries: SupplierQueueSummary[] | undefined,
  requested: string | null
): string | null {
  if (requested) return requested;
  return summaries?.[0]?.supplierId ?? null;
}
