import { sdk } from "@lib/app-config"
import {
  getCacheTag,
  removeAccessToken,
  removeCartId,
  removeMedusaAuthToken,
  removeRefreshToken,
} from "@lib/data/cookies"
import { revalidateTag } from "next/cache"
import { NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  await fetch(`${process.env.BACKEND_URL}/users/auth/signout`, {
    method: "POST",
    body: JSON.stringify({}),
    headers: {
      "Content-Type": "application/json",
      Cookie: request.cookies.toString(),
    },
  })

  await sdk.auth.logout()

  await removeMedusaAuthToken()
  await removeAccessToken()
  await removeRefreshToken()

  const customerCacheTag = await getCacheTag("customers")
  revalidateTag(customerCacheTag)

  await removeCartId()

  const cartCacheTag = await getCacheTag("carts")
  revalidateTag(cartCacheTag)

  return NextResponse.redirect(new URL("/", request.url))
}
