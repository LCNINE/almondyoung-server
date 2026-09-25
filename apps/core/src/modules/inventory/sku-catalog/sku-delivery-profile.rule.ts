import { stockTypeEnum } from '../schema/inventory.schema';

export type SkuStockType = (typeof stockTypeEnum.enumValues)[number];

/**
 * 배송 프로필이 필수인 재고 유형. 우리 창고(또는 3PL)에서 실물로 출고되는 유형만이다 —
 * 계획 확정(`shipment-planning.service.ts` assertPlanProfile)이 SKU 의 프로필을 요구하기 때문.
 * drop_shipped 는 V2 출고 대상이 아니고 infinite 는 실물이 없다.
 */
export const DELIVERY_PROFILE_REQUIRED_STOCK_TYPES: readonly SkuStockType[] = ['physical', 'consignment'];

export function requiresDeliveryProfile(stockType: SkuStockType): boolean {
  return DELIVERY_PROFILE_REQUIRED_STOCK_TYPES.includes(stockType);
}

export interface SkuProfileState {
  stockType: SkuStockType;
  deliveryProfileId: string | null;
}

/**
 * 생성(before=null)은 항상, 수정은 재고 유형이나 프로필 «값»이 바뀌었을 때만 판정한다.
 * 키 존재로 판정하지 않는 이유: admin-web 수정 폼이 stockType 을 매번 보내서, 그러면 프로필 없는
 * 옛 SKU(라이브 대부분)의 이름만 고쳐도 막힌다 (스펙 §4.2).
 */
export function deliveryProfileViolation(
  before: SkuProfileState | null,
  after: SkuProfileState,
): 'SKU_DELIVERY_PROFILE_REQUIRED' | null {
  if (before) {
    const changed = before.stockType !== after.stockType || before.deliveryProfileId !== after.deliveryProfileId;
    if (!changed) return null;
  }
  return requiresDeliveryProfile(after.stockType) && !after.deliveryProfileId ? 'SKU_DELIVERY_PROFILE_REQUIRED' : null;
}
