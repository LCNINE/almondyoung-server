import type { HttpTypes } from "@medusajs/types"

/** 개인통관고유부호 형식: 영문 1자 + 숫자 12자 (예: P123456789012) */
export const PERSONAL_CUSTOMS_CODE_REGEX = /^[A-Za-z]\d{12}$/

/** 개인통관고유부호 조회·발급 (관세청 UNI-PASS) */
export const PERSONAL_CUSTOMS_CODE_URL =
  "https://unipass.customs.go.kr/per/persIndexRectOnslCrtf.do?qryIssTp=1"

export function isValidPersonalCustomsCode(code: string): boolean {
  return PERSONAL_CUSTOMS_CODE_REGEX.test(code.trim())
}

/**
 * 카트에 해외직구(product.metadata.isOverseas) 상품이 하나라도 있으면 true.
 * Medusa metadata 값은 boolean true 또는 문자열 'true' 둘 다 올 수 있다.
 */
export function cartHasOverseasItem(
  cart: Pick<HttpTypes.StoreCart, "items"> | null | undefined
): boolean {
  if (!cart?.items?.length) return false
  return cart.items.some((item) => {
    const isOverseas = item.product?.metadata?.isOverseas
    return isOverseas === true || isOverseas === "true"
  })
}
