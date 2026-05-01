import { EmptyCartView } from "@/components/cart/empty-cart-view"
import CartTemplate from "@/domains/cart/templates"
import {
  ensureCorrectShippingMethod,
  retrieveCart,
} from "@/lib/api/medusa/cart"
import { notFound } from "next/navigation"

export default async function Cart() {
  let cart = await retrieveCart().catch((error) => {
    console.error(error)
    return notFound()
  })

  if (!cart || cart.items?.length === 0) {
    return <EmptyCartView showHeader={false} bgColor="bg-muted" />
  }

  // 장바구니 아이템 타입에 따라 올바른 배송 옵션 자동 설정
  const result = await ensureCorrectShippingMethod(cart)
  cart = result.cart

  return <CartTemplate cart={cart} />
}
