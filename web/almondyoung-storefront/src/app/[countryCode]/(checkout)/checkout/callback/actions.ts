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

/**
 * 카트의 completed_at 만 raw 로 조회한다. (lib/api/medusa/cart.retrieveCart 는 완료된 카트를 감지하면
 * null 을 돌려주므로 멱등 가드 용도로 쓸 수 없다.) completed_at 필드 포맷은 ",+completed_at"(콤마+플러스,
 * 공백 없음) 이어야 500/필드드롭 함정을 피한다.
 */
async function getCartCompletedAt(
  cartId: string,
  headers: Record<string, string>
): Promise<string | null> {
  try {
    const { cart } = await sdk.client.fetch<{
      cart: { completed_at?: string | null }
    }>(`/store/carts/${cartId}`, {
      method: "GET",
      query: { fields: "+completed_at" },
      headers,
      // 완료 여부는 실시간 상태라 절대 캐시하면 안 된다. 캐시되면 완료된 카트를
      // 미완료로 오판해 멱등 가드가 무력화된다.
      cache: "no-store",
    })
    return cart?.completed_at ?? null
  } catch {
    return null
  }
}

// "이미 완료된 카트를 재완료"할 때만 나오는 Medusa 에러 시그니처. cart.complete 가 이 에러를
// 던지면 주문은 이미 생성된 상태이므로(첫 호출이 성공) 성공으로 간주해도 안전하다.
function isAlreadyCompletedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "")
  return (
    /payment collection has not been initiated/i.test(msg) ||
    /already completed/i.test(msg) ||
    /completed cart/i.test(msg)
  )
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
    // 무통장입금 입금대기 intent 는 cart.complete() 로 주문을 만들지 않는다(미입금 출고 방지).
    // 주문은 wallet 의 awaiting_deposit 웹훅이 marker 와 함께 선생성하므로 주문내역으로 보낸다.
    if (await isAwaitingDepositIntent(intentId)) {
      return {
        success: true,
        redirectUrl: `/${countryCode}/mypage/order/list`,
      }
    }

    // cartId 는 결제 대상 checkout cart 를 positively 식별한 값(sessionStorage 매핑 또는 쿼리).
    // 유실 시(wallet 크로스도메인 리다이렉트로 sessionStorage 소실 + returnUrl 에 cartId 가 없어
    // URL 폴백 부재) 쿠키(쇼핑 카트)로 fallback 하면 안 된다: 엉뚱한 카트 완료를 시도하고, 아래
    // 쿠키 삭제 가드가 잔여 아이템이 남은 살아있는 쇼핑 카트의 쿠키를 지워 "결제 후 빈 장바구니"
    // 가 된다. 주문 생성은 wallet capture 웹훅(medusa payment-events: handleCaptureProjection →
    // recoverBankTransferOrder → completeCartWorkflow)이 intent→session→cart 로 서버사이드에서
    // authoritative 하게 처리하므로, 식별 불가 시 여기서는 완료를 시도하지 않고 성공 페이지로
    // 보낸다(쿠키 미변경 → 카트 페이지가 잔여 쇼핑 카트를 그대로 표시).
    const targetCartId = cartId
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

      // 이미 완료된 카트면(콜백 중복 호출 / effect 더블런 / 웹훅 레이스) 주문은 이미 생성됐다.
      // 이때 cart.complete() 를 다시 부르면 Medusa 가 "Payment collection has not been initiated
      // for cart" 로 던져, 결제·주문이 정상인데도 실패페이지가 뜬다. 완료된 카트는 성공으로 처리한다.
      const finishAsCompleted = async (
        orderId?: string
      ): Promise<ProcessPaymentResult> => {
        revalidateTag(await getCacheTag("orders"))
        if (sourceCartSelection) {
          await removePurchasedItemsFromSourceCart(sourceCartSelection, headers)
        }
        const currentCartId = await getCartId()
        // 실제로 완료된 카트가 쿠키 카트와 같을 때만 쿠키를 비운다(전체 결제: 쇼핑 카트=결제 카트).
        // 부분/즉시구매는 쿠키가 잔여 아이템이 남은 쇼핑 카트를 가리키므로 비우지 않는다.
        if (currentCartId === targetCartId) {
          await removeCartId()
        }
        return {
          success: true,
          redirectUrl: orderId
            ? `/${countryCode}/checkout/success/${intentId}?orderId=${orderId}`
            : `/${countryCode}/checkout/success/${intentId}`,
        }
      }

      const preCompletedAt = await getCartCompletedAt(targetCartId, headers)
      if (preCompletedAt) {
        logger.info("storefront.checkout.cart_already_completed", {
          attributes: { intent_id: intentId, target_cart_id: targetCartId },
        })
        return await finishAsCompleted()
      }

      let cartRes: Awaited<ReturnType<typeof sdk.store.cart.complete>>
      try {
        // cart.complete() 직전 shipping method 보장. ⚠️ 반드시 try 안에서 호출한다:
        // 서버 capture 웹훅(handleCaptureProjection → completeCartWorkflow)이 이 카트를 동시에
        // 완료하면, 완료된 카트에 addShippingMethod 가 throw 한다. try 밖이면 이 throw 가 바깥
        // catch 로 새어나가 결제·주문이 정상인데도 '실패페이지' 가 떴다(주문은 웹훅이 이미 생성).
        await ensureShippingMethod(targetCartId, headers)
        cartRes = await sdk.store.cart.complete(targetCartId, {}, headers)
      } catch (completeErr) {
        // 동시 호출 레이스 / 중복 콜백: 다른 호출(웹훅 포함)이 먼저 완료시킨 경우 주문은 이미 생성됐다.
        // ①완료 재확인(no-store) 또는 ②"이미 완료된 카트 재완료" 에러 시그니처면 성공 처리.
        const recheckCompletedAt = await getCartCompletedAt(
          targetCartId,
          headers
        )
        if (recheckCompletedAt || isAlreadyCompletedError(completeErr)) {
          logger.info(
            "storefront.checkout.cart_complete.race_already_completed",
            {
              attributes: {
                intent_id: intentId,
                target_cart_id: targetCartId,
              },
            }
          )
          return await finishAsCompleted()
        }
        throw completeErr
      }

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
        // 실제로 완료된 카트가 쿠키 카트와 같을 때만 쿠키를 비운다(전체 결제: 쇼핑 카트=결제 카트).
        // 부분/즉시구매는 쿠키가 잔여 아이템이 남은 쇼핑 카트를 가리키므로 비우지 않는다.
        if (currentCartId === targetCartId) {
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

    // targetCartId(=cartId) 식별 실패 — 위 if 블록을 타지 않은 경우. 주문은 서버측 capture 웹훅이
    // 생성하므로 쿠키를 건드리지 않고 성공 페이지로 보낸다(빈 장바구니 방지).
    logger.info("storefront.checkout.payment_callback.no_checkout_cart_mapping", {
      attributes: {
        country_code: countryCode,
        intent_id: intentId,
        mode: mode ?? null,
      },
    })
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
