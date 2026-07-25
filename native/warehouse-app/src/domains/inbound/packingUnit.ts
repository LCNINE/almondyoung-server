import type { SkuSearchItem } from '../inventory/types';

/**
 * 스캔 1회가 더할 수량. packingUnit 은 SKU 가 아니라 **바코드 행마다** 달리므로
 * 박스 바코드를 찍으면 +20, 낱개 바코드를 찍으면 +1 이 된다.
 *
 * 폴백이 1 인 건 안전한 쪽이라서다 — 값이 없거나 이상하면 작업자가 눈으로 센
 * 만큼만 오르고, NumberPad 로 언제든 고칠 수 있다. 반대로 잘못된 배수를
 * 곱하면 원장에 조용히 틀린 수량이 박힌다.
 *
 * 참고: 현재 sku_barcodes.packing_unit 은 전량 NULL 이라 실효 동작은 모두 +1 이다.
 * 운영에서 포장단위를 채우기 시작하면 앱 배포 없이 배수 누적으로 바뀐다.
 */
export function scanIncrement(sku: SkuSearchItem | undefined, barcode: string): number {
  const row = sku?.barcodes?.find((b) => b.barcode === barcode);
  const unit = row?.packingUnit;
  if (typeof unit !== 'number') return 1;
  if (!Number.isSafeInteger(unit) || unit < 1) return 1;
  return unit;
}
