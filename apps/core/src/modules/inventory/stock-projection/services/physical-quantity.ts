/**
 * 창고 안에 실제로 있는 수량(«실재고»). 반품 검수 대기도 물건은 창고에 있으니 더한다 —
 * 판매가능수량(available_qty = ON_HAND − 예약)과는 다른 축이다.
 */
export function physicalQuantity(s: {
  onHandQty: number;
  defectiveQty: number;
  inTransferQty: number;
  returnedQty: number;
}): number {
  return s.onHandQty + s.defectiveQty + s.inTransferQty + s.returnedQty;
}
