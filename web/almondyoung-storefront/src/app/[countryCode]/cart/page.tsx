import { EmptyCartView } from "@/components/cart/empty-cart-view"
import CartTemplate from "@/domains/cart/templates"
import {
  ensureCorrectShippingMethod,
  findUnavailableLineItems,
  retrieveCart,
} from "@/lib/api/medusa/cart"
import { isUnavailableVariantError } from "@/lib/utils/cart-availability"
import { notFound } from "next/navigation"

export const dynamic = "force-dynamic"

export default async function Cart({
  params,
}: {
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await params

  let cart = await retrieveCart().catch((error) => {
    console.error(error)
    return notFound()
  })

  if (!cart || cart.items?.length === 0) {
    return <EmptyCartView showHeader={false} bgColor="bg-muted" />
  }

  // draft/미게시(판매중단)된 상품을 직접 감지한다. (배송수단 throw 에 의존하지 않음)
  const { variantIds: unavailableVariantIds } = await findUnavailableLineItems(
    cart,
    countryCode
  )

  // 배송 옵션 자동 설정. draft 상품이 있으면 throw 할 수 있으나, 그대로 두면
  // 장바구니까지 500 으로 깨져 상품을 삭제할 화면조차 못 본다. 잡아서 원본 카트를
  // 그대로 렌더한다 (판매중단 뱃지는 위에서 이미 감지).
  try {
    const result = await ensureCorrectShippingMethod(cart)
    cart = result.cart
  } catch (error) {
    if (!isUnavailableVariantError(error)) {
      throw error
    }
  }

  return (
    <CartTemplate cart={cart} unavailableVariantIds={unavailableVariantIds} />
  )
}
