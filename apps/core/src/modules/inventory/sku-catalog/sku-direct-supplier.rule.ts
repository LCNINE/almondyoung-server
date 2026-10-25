import type { SkuStockType } from './sku-delivery-profile.rule';

/**
 * 직배 SKU 는 직배 공급사(`suppliers.is_direct_delivery`) 하나에 묶인다(K3, 스펙 §4.2). 주문이 오면 이 연결로 입점사를 정한다 —
 * 사람이 이름으로 고르지 않는다. 직배가 아닌 공급사 연결은 세지 않는다.
 */
export interface SkuSupplierState {
  stockType: SkuStockType;
  /** 정렬·중복 없음 */
  directSupplierIds: readonly string[];
}

/**
 * 생성(before=null)은 항상, 수정은 재고 유형이나 직배 공급사 집합이 «값»으로 바뀔 때만 판정한다 — `deliveryProfileViolation` 과
 * 같은 이유다(admin-web 수정 폼이 stockType 을 매번 보내므로, 키 존재로 판정하면 연결 없는 옛 직배 SKU 의 이름만 고쳐도 막힌다).
 */
export function directSupplierViolation(
  before: SkuSupplierState | null,
  after: SkuSupplierState,
): 'SKU_DIRECT_SUPPLIER_REQUIRED' | null {
  if (before) {
    const changed =
      before.stockType !== after.stockType || before.directSupplierIds.join(',') !== after.directSupplierIds.join(',');
    if (!changed) return null;
  }
  return after.stockType === 'drop_shipped' && after.directSupplierIds.length !== 1
    ? 'SKU_DIRECT_SUPPLIER_REQUIRED'
    : null;
}
