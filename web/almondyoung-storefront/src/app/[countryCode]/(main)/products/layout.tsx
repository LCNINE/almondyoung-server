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
  /**
   * 자동 로그인을 체크하고 로그인했다면 리프레시토큰의 유효기간은 90d으로 되어있을겁니다.
   *
   * 1. fetchCurrentUser()은 cookie의 jwt 토큰으로 유저 정보를 가져옵니다.
   * 2. 만약 jwt 토큰의 유효기간이 만료되었다면 serverApi()내부에서 refreshToken()을 호출하여 리프레시토큰을 사용하여 새로운 jwt 토큰을 발급받고,
   * 3. fetchCurrentUser()를 다시 호출하여 유저 정보를 가져옵니다.
   *
   */

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
