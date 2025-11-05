import { Metadata } from "next"

import { listCartOptions, retrieveCart } from "@lib/data/cart"
import { retrieveCustomer } from "@lib/data/customer"
import { fetchCurrentUser } from "@lib/api/users/me"
import { getBaseURL } from "@lib/utils/env"
import { StoreCartShippingOption } from "@medusajs/types"
import { ResponsiveHeader } from "@components/layout/components/header"
import { Breadcrumb } from "@components/layout/components/breadcrumb"

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
