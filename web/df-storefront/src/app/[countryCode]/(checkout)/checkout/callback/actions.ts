"use server"

import { sdk } from "@lib/config"
import {
  getAuthHeaders,
  getCacheTag,
  getCartId,
  removeCartId,
} from "@lib/data/cookies"
import { revalidateTag } from "next/cache"

export async function processPaymentCallback(
  countryCode: string,
  cartId?: string | null
): Promise<{ success: boolean; redirectUrl: string }> {
  if (!cartId) {
    return {
      success: false,
      redirectUrl: `/${countryCode}/checkout/fail?code=MISSING_CART&message=${encodeURIComponent(
        "Checkout cart could not be found."
      )}`,
    }
  }

  try {
    const headers = {
      ...(await getAuthHeaders()),
    }

    const cartRes = await sdk.store.cart.complete(cartId, {}, headers)

    revalidateTag(await getCacheTag("carts"))

    if (cartRes?.type === "order") {
      revalidateTag(await getCacheTag("orders"))

      const currentCartId = await getCartId()
      if (!currentCartId || currentCartId === cartId) {
        await removeCartId()
      }

      return {
        success: true,
        redirectUrl: `/${countryCode}/order/${cartRes.order.id}/confirmed`,
      }
    }

    const errMsg =
      (cartRes as { error?: { message?: string } })?.error?.message ??
      "Order completion failed."

    return {
      success: false,
      redirectUrl: `/${countryCode}/checkout/fail?code=ORDER_FAILED&message=${encodeURIComponent(
        errMsg
      )}`,
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown payment callback error."

    return {
      success: false,
      redirectUrl: `/${countryCode}/checkout/fail?code=CALLBACK_ERROR&message=${encodeURIComponent(
        errorMessage
      )}`,
    }
  }
}
