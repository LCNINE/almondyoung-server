import { retrieveCart } from "@/lib/api/medusa/cart"
import { CartMainClient } from "./(components)/cart-main-client"
import { EmptyCartView } from "@/components/cart/empty-cart-view"

export default async function ShoppingCartPage({
  params,
}: {
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await params
  let cart = await retrieveCart()

  if (cart?.items?.length === 0)
    return (
      <EmptyCartView
        countryCode={countryCode}
        showHeader={false}
        bgColor="bg-muted"
      />
    )

  return <CartMainClient />
}
