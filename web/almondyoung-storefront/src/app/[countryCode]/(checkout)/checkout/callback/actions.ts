"use server"

import { createSubscription } from "@/lib/api/membership"
import { HttpApiError } from "@/lib/api/api-error"
import { sdk } from "@/lib/config/medusa"
import {
  getAuthHeaders,
  getCacheTag,
  getCartId,
  removeCartId,
} from "@/lib/data/cookies"
import { revalidateTag } from "next/cache"
import { refreshCartPrices } from "@/lib/api/medusa/cart"

async function ensureShippingMethod(
  cartId: string,
  headers: Record<string, string>
): Promise<void> {
  const prefix = `[ensureShippingMethod] cartId=${cartId}`

  // 현재 cart의 shipping_methods 확인
  const { cart } = await sdk.client.fetch<{
    cart: { shipping_methods?: { id: string }[] }
  }>(`/store/carts/${cartId}`, {
    method: "GET",
    query: { fields: "+shipping_methods" },
    headers,
  })

  if (cart.shipping_methods?.length) {
    console.log(
      `${prefix} shipping_methods 존재 (count=${cart.shipping_methods.length}), 추가 불필요`
    )
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
      shipping_options?.map((o) => ({
        id: o.id,
        name: o.name,
        amount: o.amount,
      })) ?? []
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
  console.log(
    `${prefix} shipping method 할당 완료 (option_id=${targetOption.id}, name=${targetOption.name})`
  )
}

interface ProcessPaymentResult {
  success: boolean
  redirectUrl: string
}

interface SourceCartSelection {
  sourceCartId: string
  sourceLineItemIds: string[]
}

async function getSourceCartSelection(
  checkoutCartId: string,
  headers: Record<string, string>
): Promise<SourceCartSelection | null> {
  try {
    const { cart } = await sdk.client.fetch<{
      cart: { metadata?: Record<string, unknown> }
    }>(`/store/carts/${checkoutCartId}`, { method: "GET", headers })

    const metadata = cart?.metadata ?? {}
    const sourceCartId =
      typeof metadata?.source_cart_id === "string"
        ? metadata.source_cart_id
        : null
    const sourceLineItemIds = Array.isArray(metadata?.source_line_item_ids)
      ? metadata.source_line_item_ids.filter(
        (id): id is string => typeof id === "string" && id.length > 0
      )
      : []

    if (
      !sourceCartId ||
      sourceCartId === checkoutCartId ||
      !sourceLineItemIds.length
    ) {
      return null
    }

    return { sourceCartId, sourceLineItemIds }
  } catch {
    return null
  }
}

async function removePurchasedItemsFromSourceCart(
  selection: SourceCartSelection,
  headers: Record<string, string>
) {
  const results = await Promise.allSettled(
    selection.sourceLineItemIds.map((lineItemId) =>
      sdk.store.cart.deleteLineItem(
        selection.sourceCartId,
        lineItemId,
        {},
        headers
      )
    )
  )

  const deletedCount = results.filter(
    (result) => result.status === "fulfilled"
  ).length
  const failedCount = results.length - deletedCount

  if (deletedCount > 0) {
    revalidateTag(await getCacheTag("carts"))
    revalidateTag(await getCacheTag("fulfillment"))
  }

  if (failedCount > 0) {
    console.warn(
      `[processPaymentCallback] source cart cleanup partially failed (sourceCartId=${selection.sourceCartId}, deleted=${deletedCount}, failed=${failedCount})`
    )
  }
}

export async function processPaymentCallback(
  countryCode: string,
  intentId: string,
  mode?: string | null,
  planId?: string | null,
  cartId?: string | null
): Promise<ProcessPaymentResult> {
  try {
    if (mode === "membership" && planId) {
      try {
        await createSubscription(planId)
        await refreshCartPrices().catch(() => { })
        revalidateTag(await getCacheTag("carts"))
        return {
          success: true,
          redirectUrl: `/${countryCode}/mypage/membership/subscribe/success`,
        }
      } catch (error: any) {
        if (error instanceof HttpApiError && error.status === 409) {
          await refreshCartPrices().catch(() => { })
          revalidateTag(await getCacheTag("carts"))
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

    const targetCartId = cartId || (await getCartId())
    console.log("============== callback 디버그 ==============")
    console.log("intentId:", intentId)
    console.log("cartId (param):", cartId)
    console.log("targetCartId:", targetCartId)
    console.log("=============================================")

    if (targetCartId) {
      const headers = { ...(await getAuthHeaders()) }
      const sourceCartSelection = await getSourceCartSelection(
        targetCartId,
        headers
      )

      // cart.complete() 직전 shipping method 보장
      await ensureShippingMethod(targetCartId, headers)

      const cartRes = await sdk.store.cart.complete(targetCartId, {}, headers)

      console.log("============== cart.complete 결과 ==============")
      console.log("cartRes.type:", cartRes?.type)
      if (cartRes?.type === "order") {
        console.log("order.id:", cartRes.order.id)
        console.log("order.display_id:", cartRes.order.display_id)
        console.log("order.customer_id:", cartRes.order.customer_id)
        console.log("order.email:", cartRes.order.email)
      }
      console.log("================================================")

      if (cartRes?.type === "order") {
        revalidateTag(await getCacheTag("orders"))

        if (sourceCartSelection) {
          await removePurchasedItemsFromSourceCart(sourceCartSelection, headers)
        }

        const currentCartId = await getCartId()
        if (!cartId || currentCartId === targetCartId) {
          await removeCartId()
        }
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

//멤버십 결제 성공 후 카트 캐시 무효화
export async function revalidateMembershipSuccess(): Promise<void> {
  const cartCacheTag = await getCacheTag("carts")
  if (cartCacheTag) {
    revalidateTag(cartCacheTag)
  }
}
