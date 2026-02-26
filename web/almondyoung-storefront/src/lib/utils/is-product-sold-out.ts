/**
 * 상품 품절 여부 확인
 * 재고 관리를 하는 상품이면서 가용 재고가 0 이하일 때 품절로 판단
 */
export function isProductSoldOut(product: {
  manageInventory: boolean
  available: number
}) {
  return product.manageInventory && product.available <= 0
}
