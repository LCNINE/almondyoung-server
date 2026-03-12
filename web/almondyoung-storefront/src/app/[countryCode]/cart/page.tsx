import { EmptyCartView } from "@/components/cart/empty-cart-view"
import CartTemplate from "@/domains/cart/templates"
import {
  addCartShippingMethodDuringRender,
  listCartShippingMethods,
  retrieveCart,
} from "@/lib/api/medusa/cart"
import { notFound } from "next/navigation"

export default async function Cart() {
  let cart = await retrieveCart().catch((error) => {
    console.error(error)
    return notFound()
  })

  if (!cart) {
    return <EmptyCartView showHeader={false} bgColor="bg-muted" />
  }

  // shipping method가 없으면 기본 배송 옵션 추가
  if (!cart.shipping_methods?.length) {
    const options = await listCartShippingMethods(cart.id)
    if (options?.[0]) {
      const updatedCart = await addCartShippingMethodDuringRender(
        cart.id,
        options[0].id
      )

      if (updatedCart) {
        cart = updatedCart
      }
    }
  }

  return <CartTemplate cart={cart} />
}
