"use server"

import {
  cartRequiresShipping,
  selectShippingOptionsForCart,
} from "@/lib/api/medusa/shipping-method-policy"
import { sdk } from "@/lib/config/medusa"
import {
  getAuthHeaders,
  getCacheTag,
  getCartId,
  removeCartId,
} from "@/lib/data/cookies"
import { revalidateTag } from "next/cache"
import { createWebLogger } from "@packages/web-observability"

const logger = createWebLogger({
  component: "storefront.checkout-callback",
  route: "/[countryCode]/checkout/callback",
})

async function ensureShippingMethod(
  cartId: string,
  headers: Record<string, string>
): Promise<void> {
  // 현재 cart의 shipping_methods 확인
  const { cart } = await sdk.client.fetch<{
    cart: {
      items?: {
        requires_shipping?: boolean | null
        product_type?: string | null
      }[]
      shipping_methods?: { id: string; shipping_option_id?: string | null }[]
    }
  }>(`/store/carts/${cartId}`, {
    method: "GET",
    query: {
      fields:
        "+items,+items.requires_shipping,+items.product_type,+shipping_methods,+shipping_methods.shipping_option_id",
    },
    headers,
  })

  if (!cartRequiresShipping(cart.items)) {
    logger.info("storefront.checkout.shipping_not_required", {
      attributes: { cart_id: cartId },
    })
    return
  }

  logger.info("storefront.checkout.shipping_method.ensure_started", {
    attributes: { cart_id: cartId },
  })

  // 사용 가능한 shipping options 조회
  const { shipping_options } = await sdk.client.fetch<{
    shipping_options: {
      id: string
      name: string
      amount: number
      type?: { code?: string | null } | null
    }[]
  }>("/store/shipping-options", {
    method: "GET",
    query: { cart_id: cartId, fields: "id,name,amount,type" },
    headers,
  })

  logger.info("storefront.checkout.shipping_options.loaded", {
    attributes: {
      cart_id: cartId,
      shipping_options:
        shipping_options?.map((o) => ({
          id: o.id,
          name: o.name,
          amount: o.amount,
          typeCode: o.type?.code ?? null,
        })) ?? [],
    },
  })

  const standardOptions = selectShippingOptionsForCart(
    shipping_options,
    cart.items
  )

  if (!standardOptions.length) {
    logger.error("storefront.checkout.shipping_options.none_applicable", {
      attributes: { cart_id: cartId },
    })
    throw new Error(
      "배송이 필요한 상품에 적용 가능한 표준 배송 옵션이 없습니다."
    )
  }

  const currentShippingOptionId = cart.shipping_methods?.[0]?.shipping_option_id
  const isCurrentOptionValid = standardOptions.some(
    (option) => option.id === currentShippingOptionId
  )

  if (currentShippingOptionId && isCurrentOptionValid) {
    logger.info("storefront.checkout.shipping_method.already_valid", {
      attributes: {
        cart_id: cartId,
        shipping_option_id: currentShippingOptionId,
      },
    })
    return
  }

  const targetOption = standardOptions[0]
  await sdk.store.cart.addShippingMethod(
    cartId,
    { option_id: targetOption.id },
    {},
    headers
  )
  logger.info("storefront.checkout.shipping_method.assigned", {
    attributes: {
      cart_id: cartId,
      shipping_option_id: targetOption.id,
      shipping_option_name: targetOption.name,
    },
  })
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
    logger.warn("storefront.checkout.source_cart_cleanup_partial_failure", {
      attributes: {
        source_cart_id: selection.sourceCartId,
        deleted_count: deletedCount,
        failed_count: failedCount,
      },
    })
  }
}

export async function processPaymentCallback(
  countryCode: string,
  intentId: string,
  mode?: string | null,
  cartId?: string | null
): Promise<ProcessPaymentResult> {
  try {
    const targetCartId = cartId || (await getCartId())
    logger.info("storefront.checkout.payment_callback.started", {
      attributes: {
        country_code: countryCode,
        intent_id: intentId,
        mode: mode ?? null,
        cart_id_param: cartId ?? null,
        target_cart_id: targetCartId ?? null,
      },
    })

    if (targetCartId) {
      const headers = { ...(await getAuthHeaders()) }
      const sourceCartSelection = await getSourceCartSelection(
        targetCartId,
        headers
      )

      // cart.complete() 직전 shipping method 보장
      await ensureShippingMethod(targetCartId, headers)

      const cartRes = await sdk.store.cart.complete(targetCartId, {}, headers)

      logger.info("storefront.checkout.cart_complete.finished", {
        attributes: {
          intent_id: intentId,
          target_cart_id: targetCartId,
          result_type: cartRes?.type ?? null,
          ...(cartRes?.type === "order"
            ? {
                order_id: cartRes.order.id,
                order_display_id: cartRes.order.display_id,
                customer_id: cartRes.order.customer_id ?? null,
              }
            : {}),
        },
      })

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
      logger.warn("storefront.checkout.cart_complete.non_order_result", {
        attributes: {
          intent_id: intentId,
          target_cart_id: targetCartId,
          result_type: (cartRes as any)?.type ?? null,
          error_message: errMsg,
        },
      })
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
    logger.error("storefront.checkout.payment_callback.failed", {
      error: err,
      attributes: {
        country_code: countryCode,
        intent_id: intentId,
        mode: mode ?? null,
        cart_id_param: cartId ?? null,
      },
    })
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
