import type { PendingCancellation } from '@/lib/types/dto/fulfillment';

/** «데모 상품 A 1개, 데모 상품 B 2개» — 상품명을 모르면 «상품» */
export function pendingCancellationItems(pending: PendingCancellation): string {
  return pending.lines
    .map((line) => `${line.skuName || '상품'} ${line.qty}개`)
    .join(', ');
}
