import type { ScanRejection } from '@/lib/types/dto/fulfillment';

const ROUTE_LABEL: Record<ScanRejection['route'], string> = {
  simple_scan: '출고 검수 스캔',
  simple_force: '강제출고',
  location_scan: '위치 출고 스캔',
  location_force: '위치 강제출고',
};

/** «출고 검수 스캔 · 데모 상품 ×2» — 상품 이름을 모르면 바코드 */
export function scanRejectionWhat(rejection: ScanRejection): string {
  const route = ROUTE_LABEL[rejection.route] ?? '출고 저장';
  const item = rejection.skuName || rejection.barcode;
  if (!item) return route;
  return rejection.quantity
    ? `${route} · ${item} ×${rejection.quantity}`
    : `${route} · ${item}`;
}

/** «11. 20. 오후 3:04 · 홍길동» — 작업자 이름을 모르면 시각만 */
export function scanRejectionWhen(
  rejection: ScanRejection,
  workerName: string
): string {
  const at = new Date(rejection.rejectedAt).toLocaleString('ko-KR');
  return workerName ? `${at} · ${workerName}` : at;
}

/** 바구니는 배정이 풀리는 순간 지난 일이 되지만, 나머지는 고친 뒤 다시 찍어 반영돼야 서버가 지난 일로 본다 */
export function scanRejectionClears(rejection: ScanRejection): string | null {
  if (rejection.action === 'release_tote') return null;
  // 배치 작업 항목이 없던 거절은 뺄 배치가 없다
  return rejection.workItemId
    ? '고친 뒤 작업자가 다시 찍어 반영되거나 상자를 배치에서 빼면 이 표시는 사라져요.'
    : '고친 뒤 작업자가 다시 찍어 반영되면 이 표시는 사라져요.';
}
