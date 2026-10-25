import type { SupplierDto } from '@/lib/types/dto/inventory';

/**
 * 직배 입점사만 고른다 — 행마다 `isDirectDelivery === true` 로 판정한다. `?isDirectDelivery=true` 를 붙여
 * 받은 목록이라도 그 목록에 «들어 있음»을 직배의 증거로 쓰지 않는다: 그 파라미터를 모르는 core(admin-web 선배포·
 * core 롤백)는 whitelist 로 파라미터를 버리고 공급사 전부를 돌려준다. 그 목록을 직배로 믿으면 SKU 의 비직배 연결이
 * 「직배를 갈아 끼운다」는 payload 에서 빠져 지워진다.
 */
export function directDeliverySuppliers(
  list: readonly SupplierDto[] | undefined
): SupplierDto[] {
  return (list ?? []).filter(
    (s) => s.purchaseSettings?.isDirectDelivery === true
  );
}
