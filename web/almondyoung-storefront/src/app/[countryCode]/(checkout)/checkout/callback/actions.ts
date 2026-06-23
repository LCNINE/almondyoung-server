"use server"

import {
  cartRequiresShipping,
  selectShippingOptionsForCart,
} from "@/lib/api/medusa/shipping-method-policy"
import { getIntent } from "@/lib/api/wallet"
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
    console.log(`${prefix} shipping 불필요 cart, shipping method 보장 생략`)
    return
  }

  console.warn(
    `${prefix} standard shipping method 보장, 사용 가능한 옵션 조회 시작`
  )

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

  console.log(
    `${prefix} 사용 가능한 shipping options: ${JSON.stringify(
      shipping_options?.map((o) => ({
        id: o.id,
        name: o.name,
        amount: o.amount,
        typeCode: o.type?.code ?? null,
      })) ?? []
    )}`
  )

  const standardOptions = selectShippingOptionsForCart(
    shipping_options,
    cart.items
  )

  if (!standardOptions.length) {
    console.error(
      `${prefix} 사용 가능한 standard shipping option 없음, 할당 불가`
    )
    throw new Error(
      "배송이 필요한 상품에 적용 가능한 표준 배송 옵션이 없습니다."
    )
  }

  const currentShippingOptionId = cart.shipping_methods?.[0]?.shipping_option_id
  const isCurrentOptionValid = standardOptions.some(
    (option) => option.id === currentShippingOptionId
  )

  if (currentShippingOptionId && isCurrentOptionValid) {
    console.log(
      `${prefix} standard shipping method 존재 (option_id=${currentShippingOptionId}), 추가 불필요`
    )
    return
  }

  const targetOption = standardOptions[0]
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

/**
 * 무통장입금 입금대기(AWAITING_DEPOSIT) intent 인지 wallet 에서 서버사이드로 확인.
 *
 * callback 의 status 쿼리는 wallet-web 이 붙이는 값이라 신뢰할 수 없다(누락/위조 가능). 무통장은
 * almond-payment 가 AWAITING_DEPOSIT 을 'authorized' 로 매핑하므로, 이 상태에서 cart.complete() 가
 * 그대로 성공해 marker 없는 주문이 생기고 WMS 게이트를 통과(미입금 출고)할 수 있다. 정상 흐름에선
 * 무통장은 wallet-web 입금화면에 머물러 이 callback 에 오지 않으므로, 여기 도달했다면 수동 진입/레이스다.
 * → 입금대기 intent 면 cart.complete() 를 막고 주문내역(웹훅이 선생성한 '입금확인중' 주문)으로 보낸다.
 *
 * 조회 실패(예: 크로스도메인 토큰 소실)는 fail-open: 카드 결제 정상 완료를 막지 않기 위해 진행시킨다.
 * 카드 intent 는 AWAITING_DEPOSIT 이 아니므로 fail-open 이어도 marker 없는 미입금 주문이 생기지 않는다.
 */
async function isAwaitingDepositIntent(intentId: string): Promise<boolean> {
  try {
    const intent = await getIntent(intentId)
    return intent.status === "AWAITING_DEPOSIT"
  } catch (err) {
    console.warn(
      `[processPaymentCallback] intent status lookup failed, proceeding (intentId=${intentId})`,
      err instanceof Error ? err.message : err
    )
    return false
  }
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
  cartId?: string | null
): Promise<ProcessPaymentResult> {
  try {
    // 무통장입금 입금대기 intent 는 cart.complete() 로 주문을 만들지 않는다(미입금 출고 방지).
    // 주문은 wallet 의 awaiting_deposit 웹훅이 marker 와 함께 선생성하므로 주문내역으로 보낸다.
    if (await isAwaitingDepositIntent(intentId)) {
      return {
        success: true,
        redirectUrl: `/${countryCode}/mypage/order/list`,
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
