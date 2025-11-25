import { Metadata } from "next"

import { retrieveCart } from "@lib/api/medusa/cart"
import { retrieveCustomer } from "@lib/api/medusa/customer"
import { getBaseURL } from "@lib/utils/env"

export const metadata: Metadata = {
  metadataBase: new URL(getBaseURL()),
}

export default async function PageLayout(props: { children: React.ReactNode }) {
  const customer = await retrieveCustomer()
  const cart = await retrieveCart()
  // let shippingOptions: StoreCartShippingOption[] = []

  // if (cart) {
  //   const { shipping_options } = await listCartOptions()

  //   shippingOptions = shipping_options
  // }

  return (
    <>
      <div id="menu-root" className="relative z-[150] overflow-visible"></div>
      <div>{props.children}</div>
    </>
  )
}
