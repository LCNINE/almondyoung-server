"use server"

import { createSubscriptionServer } from "@/lib/api/membership"
import { HttpApiError } from "@/lib/api/api-error"
import { sdk } from "@/lib/config/medusa"
import {
  getAuthHeaders,
  getCacheTag,
  getCartId,
  removeCartId,
} from "@/lib/data/cookies"
import { revalidateTag } from "next/cache"

async function ensureShippingMethod(
  cartId: string,
  headers: Record<string, string>
): Promise<void> {
  const prefix = `[ensureShippingMethod] cartId=${cartId}`

  // 현재 cart의 shipping_methods 확인
  const { cart } = await sdk.client.fetch<{ cart: { shipping_methods?: { id: string }[] } }>(
    `/store/carts/${cartId}`,
    { method: "GET", query: { fields: "+shipping_methods" }, headers }
  )

  if (cart.shipping_methods?.length) {
    console.log(`${prefix} shipping_methods 존재 (count=${cart.shipping_methods.length}), 추가 불필요`)
    return
  }

  console.warn(`${prefix} shipping_methods 없음, 사용 가능한 옵션 조회 시작`)

  // 사용 가능한 shipping options 조회
  const { shipping_options } = await sdk.client.fetch<{
    shipping_options: { id: string; name: string; amount: number }[]
  }>("/store/shipping-options", {
    method: "GET",
    query: { cart_id: cartId },
    headers,
  })

  console.log(
    `${prefix} 사용 가능한 shipping options: ${JSON.stringify(
      shipping_options?.map((o) => ({ id: o.id, name: o.name, amount: o.amount })) ?? []
    )}`
  )

  if (!shipping_options?.length) {
    console.error(`${prefix} 사용 가능한 shipping option 없음, 할당 불가`)
    return
  }

  const targetOption = shipping_options[0]
  await sdk.store.cart.addShippingMethod(
    cartId,
    { option_id: targetOption.id },
    {},
    headers
  )
  console.log(`${prefix} shipping method 할당 완료 (option_id=${targetOption.id}, name=${targetOption.name})`)
}

interface ProcessPaymentResult {
  success: boolean
  redirectUrl: string
}

export async function processPaymentCallback(
  countryCode: string,
  intentId: string,
  mode?: string | null,
  planId?: string | null
): Promise<ProcessPaymentResult> {
  try {
    if (mode === "membership" && planId) {
      try {
        await createSubscriptionServer(planId)
        return {
          success: true,
          redirectUrl: `/${countryCode}/mypage/membership/subscribe/success`,
        }
      } catch (error: any) {
        if (error instanceof HttpApiError && error.status === 409) {
          return {
            success: true,
            redirectUrl: `/${countryCode}/mypage/membership/subscribe/success`,
          }
        }
        const message =
          error instanceof Error ? error.message : "멤버십 가입 처리 실패"
        return {
          success: false,
          redirectUrl: `/${countryCode}/mypage/membership/subscribe/fail?code=SUBSCRIBE_FAILED&message=${encodeURIComponent(message)}`,
        }
      }
    }

    const cartId = await getCartId()
    if (cartId) {
      const headers = { ...(await getAuthHeaders()) }

      // cart.complete() 직전 shipping method 보장
      await ensureShippingMethod(cartId, headers)

      const cartRes = await sdk.store.cart.complete(cartId, {}, headers)

      if (cartRes?.type === "order") {
        revalidateTag(await getCacheTag("orders"))
        await removeCartId()
        return {
          success: true,
          redirectUrl: `/${countryCode}/checkout/success/${intentId}?orderId=${cartRes.order.id}`,
        }
      }

      const errMsg =
        (cartRes as any)?.error?.message ?? "주문 처리에 실패했습니다."
      return {
        success: false,
        redirectUrl: `/${countryCode}/checkout/fail?code=ORDER_FAILED&message=${encodeURIComponent(errMsg)}`,
      }
    }

    return {
      success: true,
      redirectUrl: `/${countryCode}/checkout/success/${intentId}`,
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "알 수 없는 오류"
    return {
      success: false,
      redirectUrl:
        mode === "membership"
          ? `/${countryCode}/mypage/membership/subscribe/fail?code=CALLBACK_ERROR&message=${encodeURIComponent(errorMessage)}`
          : `/${countryCode}/checkout/fail?code=CALLBACK_ERROR&message=${encodeURIComponent(errorMessage)}`,
    }
  }
}
