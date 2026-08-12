"use server"

import { sdk } from "@/lib/config/medusa"
import {
  getAuthHeaders,
  getCacheOptions,
  getCacheTag,
  getCartId,
  removeCartId,
  setCartId,
} from "@lib/data/cookies"
import medusaError from "@lib/utils/medusa-error"
import {
  classifyCartLineItems,
  type CartLineItemClassification,
} from "@lib/utils/cart-availability"
import { withCartConflictRetry } from "./cart-conflict"
import { getIsMembershipCustomer } from "@lib/data/membership"
import { createRefreshThrottle } from "@lib/utils/refresh-throttle"
import { HttpTypes } from "@medusajs/types"
import { revalidateTag } from "next/cache"
import { redirect } from "next/navigation"
import { HttpApiError } from "../api-error"
import { getRegion } from "./regions"
import {
  recoverCustomerCart,
  retrieveCustomer,
  transferCart,
} from "./customer"
import {
  cartRequiresShipping,
  selectShippingOptionsForCart,
  shippingMethodsMatchOptions,
} from "./shipping-method-policy"

// 카트 조회 시 사용하는 기본 fields
const DEFAULT_CART_FIELDS =
  "*items, +items.requires_shipping, +items.product_type, *region, *items.product, *items.product.metadata, +items.product.shipping_profile.id, *items.variant, *items.variant.options, *items.variant.options.option, +items.variant.inventory_quantity, +items.variant.manage_inventory, +items.variant.allow_backorder, *items.thumbnail, *items.metadata, +items.total, +items.original_total, +items.compare_at_unit_price, *promotions, +shipping_methods, *customer, *customer.groups, customer_id, +payment_collection.id, +currency_code, +item_subtotal, +shipping_total, +total, +discount_total, +original_item_subtotal, +original_item_total"

/**
 * 카트 ID를 통해 카트 정보를 조회합니다. 만약 ID가 제공되지 않으면, 쿠키에 저장된 카트 ID를 사용합니다.
 * @param cartId (선택 사항) - 조회할 카트의 고유 ID입니다.
 * @returns 카트를 찾으면 카트 객체를, 찾지 못하면 null을 반환합니다.
 */
export async function retrieveCart(
  cartId?: string,
  fields?: string,
  cache: RequestCache = "force-cache"
) {
  const id = cartId || (await getCartId())
  fields ??= DEFAULT_CART_FIELDS

  if (!id) {
    return null
  }

  // 완료(주문 전환)된 카트를 감지하려면 completed_at 이 응답에 포함돼야 한다.
  // 구분자는 반드시 ",+completed_at"(콤마+플러스, 공백 없음) 이어야 한다. 두 함정을 동시에 피한다:
  //   1) ",completed_at"(공백 없이 plain): ", " 로 구분된 기존 필드열 뒤에 붙이면 직전 필드와 한
  //      토큰으로 묶여 Medusa 가 500 → retrieveCart null → '빈 장바구니/체크아웃 404' 장애.
  //   2) ", +completed_at"(콤마+공백+플러스): 500 은 피하지만 리딩 스페이스로 필드가 드롭되어
  //      응답에 completed_at 이 안 와 완료 감지 실패 → 완료 카트가 반환되어 addToCart 가
  //      'cart is already completed' 로 실패(무통장 주문 직후 장바구니 안 담김 장애).
  // "+" prefix 는 500 을 막고, 공백 제거는 필드가 정상 포함되게 한다.
  const effectiveFields = fields.includes("completed_at")
    ? fields
    : `${fields},+completed_at`

  const headers = {
    ...(await getAuthHeaders()),
  }

  const next = {
    ...(await getCacheOptions("carts")),
  }

  return await sdk.client
    .fetch<{ cart: HttpTypes.StoreCart }>(`/store/carts/${id}`, {
      method: "GET",
      query: {
        fields: effectiveFields,
      },
      headers,
      next,
      cache,
    })
    .then(async ({ cart }: { cart: HttpTypes.StoreCart }) => {
      // completeCartWorkflow 로 주문 전환된 카트는 더 이상 장바구니가 아니다.
      // 무통장입금처럼 브라우저가 완료 과정에 참여하지 않으면 쿠키가 남아
      // 완료된 카트가 계속 장바구니로 노출. 쿠키를 정리하고 null 을 돌려 상위에서 새 카트 생성/복구로 흐르게
      if (cart?.completed_at) {
        // 쿠키는 '이 완료된 카트를 쿠키가 실제로 가리킬 때'만 정리한다. 명시적 cartId 로 완료된
        // 파생 카트(체크아웃/배송 프리뷰 sub-cart)를 조회하는 경우, 쿠키가 가리키는 별개의 활성
        // source 카트를 지워 남은 장바구니를 유실시키면 안 된다.
        try {
          const cookieCartId = await getCartId()
          if (cookieCartId && cookieCartId === id) {
            // 렌더 컨텍스트에서는 쿠키 변경이 막힐 수 있어 best-effort 로 처리
            await removeCartId()
          }
        } catch {
          // Server Action/Route Handler 가 아닌 곳에서 호출되면 무시
        }
        return null
      }
      return cart
    })
    .catch(async (error) => {
      if (error?.response?.status === 404) {
        try {
          await removeCartId()
        } catch {
        }
      }
      return null
    })
}

/**
 * 카트 라인아이템 중 draft/미게시/삭제(또는 판매채널 이탈)된 상품과,
 * 담은 뒤 재고가 줄어 "담은 수량 > 가용 재고"가 된 상품을 가려낸다.
 *
 * 후자(insufficient*)는 담기 시점엔 통과했다가 결제 직전에야 부족해지는 케이스다. 이걸 막지
 * 않으면 결제 후 cart.complete 의 재고예약이 실패해 주문이 안 생긴다.
 * (지연 승인 도입으로 그때도 돈은 빠지지 않지만, 결제창까지 갔다가 실패하는 UX 는 막는 게 낫다.)
 *
 * availableByVariantId 는 재고를 추적하는 variant 의 남은 수량이다(추적 안 하거나 백오더 허용이면
 * 상한 없음). 장바구니가 이 값으로 "재고가 N개 남았어요" 를 안내하고 수량 변경을 미리 막는다 —
 * Medusa 재고부족 에러에는 수량 정보가 없어서 필요하다.
 */
export async function findUnavailableLineItems(
  cart: HttpTypes.StoreCart,
  countryCode: string
): Promise<CartLineItemClassification> {
  const items = cart.items ?? []
  const productIds = Array.from(
    new Set(
      items
        .map((item) => item.product_id)
        .filter((id): id is string => Boolean(id))
    )
  )

  const empty: CartLineItemClassification = {
    variantIds: [],
    productNames: [],
    optionGoneVariantIds: [],
    insufficientVariantIds: [],
    insufficientNames: [],
    availableByVariantId: {},
  }

  if (productIds.length === 0) {
    return empty
  }

  const region = await getRegion(countryCode)
  if (!region) {
    return empty
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  const { products } = await sdk.client
    .fetch<{ products: HttpTypes.StoreProduct[] }>(`/store/products`, {
      method: "GET",
      query: {
        id: productIds,
        region_id: region.id,
        // 카트 라인아이템의 variant 에는 Medusa 가 inventory_quantity 를 계산해 주지 않아
        // 항상 품절로 잡힌다. 재고가 계산되는 /store/products 응답에서 variant 재고를 받아와
        // 품절을 판정한다. (비회원 멤버십 전용 상품은 이 경로에서 재고 0 으로 마스킹돼 자동 품절)
        fields:
          "id,variants.id,+variants.inventory_quantity,+variants.manage_inventory,+variants.allow_backorder",
        limit: productIds.length,
      },
      headers,
      cache: "no-store",
    })
    .catch(() => ({ products: [] as HttpTypes.StoreProduct[] }))

  return classifyCartLineItems(items, products)
}

export async function getOrSetCart(countryCode: string) {
  const region = await getRegion(countryCode)

  if (!region) {
    throw new Error(`Region not found for country code: ${countryCode}`)
  }

  // customer_id도 함께 조회해서 연결 여부 확인
  let cart = await retrieveCart(undefined, "id,region_id,customer_id")

  const headers = {
    ...(await getAuthHeaders()),
  }

  // 로그인된 상태에서 장바구니가 다른 사용자의 것인지 확인
  if (cart && cart.customer_id && headers.authorization) {
    const customer = await retrieveCustomer()
    if (customer && cart.customer_id !== customer.id) {
      // 다른 사용자의 장바구니이므로 쿠키 제거 후 새 장바구니 생성
      await removeCartId()
      cart = null
    }
  }

  if (!cart) {
    // 쿠키 소실(캐시 삭제 / 쿠키 만료 / 시크릿 모드 / 다른 기기)로 카트 쿠키가 없더라도
    // 로그인 상태라면 새 카트를 만들기 전에 고객의 기존 미완료 카트를 먼저 복구
    // recoverCustomerCart 는 GET /store/customers/me/cart 를 호출하며, 백엔드가 completed_at IS NULL 로 필터링하므로 완료(주문 전환)된 카트는 절대 복구되지 않는다.
    if (headers.authorization) {
      const recovered = await recoverCustomerCart()
      if (recovered) {
        cart = recovered
      }
    }
  }

  if (!cart) {
    const cartResp = await sdk.store.cart.create(
      { region_id: region.id },
      {},
      headers
    )
    cart = cartResp.cart

    await setCartId(cart.id)

    // 로그인된 사용자라면 카트를 고객에게 연결
    if (headers.authorization) {
      try {
        await transferCart()
      } catch (error) {
        console.error("Cart transfer failed:", error)
      }
    }

    const cartCacheTag = await getCacheTag("carts")
    revalidateTag(cartCacheTag)
  } else if (headers.authorization && !cart.customer_id) {
    // 기존 카트가 있지만 고객에게 연결되지 않은 경우 연결
    try {
      await transferCart()
      const cartCacheTag = await getCacheTag("carts")
      revalidateTag(cartCacheTag)
    } catch (error) {
      console.error("Cart transfer failed:", error)
    }
  }

  if (cart && cart?.region_id !== region.id) {
    await sdk.store.cart.update(cart.id, { region_id: region.id }, {}, headers)
    const cartCacheTag = await getCacheTag("carts")
    revalidateTag(cartCacheTag)
  }

  return cart
}

export async function updateCart(
  data: HttpTypes.StoreUpdateCart,
  cartId?: string
) {
  const targetCartId = cartId || (await getCartId())

  if (!targetCartId) {
    throw new Error("No existing cart found, please create one before updating")
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  return sdk.store.cart
    .update(targetCartId, data, {}, headers)
    .then(async ({ cart }: { cart: HttpTypes.StoreCart }) => {
      const cartCacheTag = await getCacheTag("carts")
      revalidateTag(cartCacheTag)

      const fulfillmentCacheTag = await getCacheTag("fulfillment")
      revalidateTag(fulfillmentCacheTag)

      return cart
    })
    .catch(medusaError)
}

export async function addToCart({
  variantId,
  quantity,
  countryCode,
}: {
  variantId: string
  quantity: number
  countryCode: string
}): Promise<
  { cartId: string; error?: never } | { cartId?: never; error: string }
> {
  if (!variantId) {
    return { error: "Missing variant ID when adding to cart" }
  }

  const cart = await getOrSetCart(countryCode)

  if (!cart) {
    return { error: "Error retrieving or creating cart" }
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  try {
    await sdk.store.cart.createLineItem(
      cart.id,
      { variant_id: variantId, quantity },
      {},
      headers
    )

    const cartCacheTag = await getCacheTag("carts")
    revalidateTag(cartCacheTag)
    const fulfillmentCacheTag = await getCacheTag("fulfillment")
    revalidateTag(fulfillmentCacheTag)

    return { cartId: cart.id }
  } catch (err: any) {
    const status = err?.response?.status ?? err?.status ?? 0
    if (status === 401) throw err

    const message =
      err?.response?.data?.message ??
      err?.message ??
      "장바구니 담기에 실패했습니다."
    return { error: String(message) }
  }
}

export async function createBuyNowCart(params: {
  countryCode: string
  items: Array<{
    variantId: string
    quantity: number
  }>
}): Promise<
  { cartId: string; error?: never } | { cartId?: never; error: string }
> {
  const { countryCode, items } = params

  if (!items.length) {
    return { error: "No line items for buy now" }
  }

  const region = await getRegion(countryCode)

  if (!region) {
    return { error: `Region not found for country code: ${countryCode}` }
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  const cartResp = await sdk.store.cart.create(
    { region_id: region.id },
    {},
    headers
  )
  const cart = cartResp.cart

  if (headers.authorization) {
    try {
      await sdk.store.cart.transferCart(cart.id, {}, headers)
    } catch (error) {
      console.error("Buy-now cart transfer failed:", error)
    }
  }

  try {
    for (const item of items) {
      if (!item.variantId) {
        return { error: "Missing variant ID when creating buy-now cart" }
      }

      await sdk.store.cart.createLineItem(
        cart.id,
        { variant_id: item.variantId, quantity: item.quantity },
        {},
        headers
      )
    }
  } catch (err: any) {
    const status = err?.response?.status ?? err?.status ?? 0
    if (status === 401) throw err

    const message =
      err?.response?.data?.message ??
      err?.message ??
      "바로구매 처리 중 오류가 발생했습니다."
    return { error: String(message) }
  }

  const cartCacheTag = await getCacheTag("carts")
  revalidateTag(cartCacheTag)
  const fulfillmentCacheTag = await getCacheTag("fulfillment")
  revalidateTag(fulfillmentCacheTag)

  return { cartId: cart.id }
}

export async function createCheckoutCartFromLineItems(params: {
  countryCode: string
  lineItemIds: string[]
}): Promise<
  | { cartId: string }
  | { error: "ITEMS_UNAVAILABLE"; unavailableNames: string[] }
> {
  const { countryCode, lineItemIds } = params

  if (!lineItemIds.length) {
    throw new HttpApiError(
      "No selected line items for checkout cart",
      400,
      "BAD_REQUEST"
    )
  }

  const sourceCart = await retrieveCart(
    undefined,
    "id,region_id,*items,*items.variant",
    "no-store"
  )

  if (!sourceCart?.id) {
    throw new HttpApiError("Source cart not found", 404, "NOT_FOUND")
  }

  const selectedIdSet = new Set(lineItemIds)
  const selectedItems = (sourceCart.items ?? []).filter((item) =>
    selectedIdSet.has(item.id)
  )

  if (!selectedItems.length || selectedItems.length !== selectedIdSet.size) {
    throw new HttpApiError(
      "Some selected line items are not in source cart",
      400,
      "BAD_REQUEST"
    )
  }

  const regionId =
    sourceCart.region_id ?? (await getRegion(countryCode))?.id ?? null

  if (!regionId) {
    throw new Error(`Region not found for country code: ${countryCode}`)
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  const checkoutCartResp = await sdk.store.cart.create(
    { region_id: regionId },
    {},
    headers
  )
  const checkoutCart = checkoutCartResp.cart

  if (headers.authorization) {
    await sdk.store.cart.transferCart(checkoutCart.id, {}, headers)

    const transferredCart = await sdk.store.cart.retrieve(
      checkoutCart.id,
      { fields: "id,customer_id" },
      headers
    )

    if (!transferredCart?.cart?.customer_id) {
      throw new HttpApiError(
        "Checkout cart is not linked to customer",
        500,
        "CHECKOUT_CART_TRANSFER_FAILED"
      )
    }
  }

  // 미게시(draft)/삭제/판매중지 등으로 새 카트에 담을 수 없는 상품을 모아 호출부에 알린다.
  const unavailableNames: string[] = []

  for (const item of selectedItems) {
    const variantId = item.variant_id || item.variant?.id
    if (!variantId) {
      throw new HttpApiError(
        "Missing variant ID when creating checkout cart",
        400,
        "BAD_REQUEST"
      )
    }

    try {
      await sdk.store.cart.createLineItem(
        checkoutCart.id,
        {
          variant_id: variantId,
          quantity: item.quantity,
        },
        {},
        headers
      )
    } catch (error) {
      // 인증 만료는 error.tsx 의 토큰 복구 경로로 흘려보낸다
      if ((error as { status?: number })?.status === 401) {
        throw error
      }
      unavailableNames.push(item.product_title || item.title || "")
    }
  }

  if (unavailableNames.length > 0) {
    return { error: "ITEMS_UNAVAILABLE", unavailableNames }
  }

  await sdk.store.cart.update(
    checkoutCart.id,
    {
      metadata: {
        source_cart_id: sourceCart.id,
        source_line_item_ids: selectedItems.map((item) => item.id),
      },
    },
    {},
    headers
  )

  const cartCacheTag = await getCacheTag("carts")
  revalidateTag(cartCacheTag)

  const fulfillmentCacheTag = await getCacheTag("fulfillment")
  revalidateTag(fulfillmentCacheTag)

  return { cartId: checkoutCart.id }
}

export async function createShippingPreviewCartFromLineItems(params: {
  countryCode: string
  lineItemIds: string[]
}): Promise<{ cartId: string }> {
  const { countryCode, lineItemIds } = params

  if (!lineItemIds.length) {
    throw new HttpApiError(
      "No selected line items for shipping preview cart",
      400,
      "BAD_REQUEST"
    )
  }

  const sourceCart = await retrieveCart(
    undefined,
    "id,region_id,*items,*items.variant",
    "no-store"
  )

  if (!sourceCart?.id) {
    throw new HttpApiError("Source cart not found", 404, "NOT_FOUND")
  }

  const selectedIdSet = new Set(lineItemIds)
  const selectedItems = (sourceCart.items ?? []).filter((item) =>
    selectedIdSet.has(item.id)
  )

  if (!selectedItems.length || selectedItems.length !== selectedIdSet.size) {
    throw new HttpApiError(
      "Some selected line items are not in source cart",
      400,
      "BAD_REQUEST"
    )
  }

  const regionId =
    sourceCart.region_id ?? (await getRegion(countryCode))?.id ?? null

  if (!regionId) {
    throw new Error(`Region not found for country code: ${countryCode}`)
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  const previewCartResp = await sdk.store.cart.create(
    { region_id: regionId },
    {},
    headers
  )
  const previewCart = previewCartResp.cart

  if (headers.authorization) {
    try {
      await sdk.store.cart.transferCart(previewCart.id, {}, headers)
    } catch (error) {
      console.error("Shipping preview cart transfer failed:", error)
    }
  }

  for (const item of selectedItems) {
    const variantId = item.variant_id || item.variant?.id
    if (!variantId) {
      throw new HttpApiError(
        "Missing variant ID when creating shipping preview cart",
        400,
        "BAD_REQUEST"
      )
    }

    await sdk.store.cart.createLineItem(
      previewCart.id,
      {
        variant_id: variantId,
        quantity: item.quantity,
        metadata: {
          source_line_item_id: item.id,
        },
      },
      {},
      headers
    )
  }

  await sdk.store.cart.update(
    previewCart.id,
    {
      metadata: {
        is_shipping_preview: true,
        source_cart_id: sourceCart.id,
        source_line_item_ids: selectedItems.map((item) => item.id),
      },
    },
    {},
    headers
  )

  return { cartId: previewCart.id }
}

export async function syncShippingPreviewCartLineItems(params: {
  previewCartId: string
  items: Array<{
    sourceLineItemId: string
    variantId: string
    quantity: number
  }>
}) {
  const { previewCartId, items } = params

  const normalizedItems = items
    .filter(
      (item) => item.sourceLineItemId && item.variantId && item.quantity > 0
    )
    .map((item) => ({
      sourceLineItemId: item.sourceLineItemId,
      variantId: item.variantId,
      quantity: Math.max(1, Math.floor(item.quantity)),
    }))

  const headers = {
    ...(await getAuthHeaders()),
  }

  const previewCart = await sdk.client
    .fetch<{ cart: HttpTypes.StoreCart }>(`/store/carts/${previewCartId}`, {
      method: "GET",
      query: {
        fields: "id,*items,*items.variant,*items.metadata,+shipping_methods",
      },
      headers,
      cache: "no-store",
    })
    .then(({ cart }) => cart)
    .catch(() => null)

  if (!previewCart?.id) {
    throw new HttpApiError("Preview cart not found", 404, "NOT_FOUND")
  }

  const desiredBySource = new Map<
    string,
    { variantId: string; quantity: number }
  >()
  for (const item of normalizedItems) {
    desiredBySource.set(item.sourceLineItemId, {
      variantId: item.variantId,
      quantity: item.quantity,
    })
  }

  const existingBySource = new Map<
    string,
    {
      id: string
      quantity: number
      variantId: string | null
      duplicateIds: string[]
    }
  >()

  for (const line of previewCart.items ?? []) {
    const sourceLineItemId = (line.metadata as Record<string, unknown> | null)
      ?.source_line_item_id
    const sourceId =
      typeof sourceLineItemId === "string" ? sourceLineItemId : null

    if (!sourceId) {
      await sdk.store.cart.deleteLineItem(previewCartId, line.id, {}, headers)
      continue
    }

    const lineVariantId = line.variant_id || line.variant?.id || null

    const existing = existingBySource.get(sourceId)
    if (!existing) {
      existingBySource.set(sourceId, {
        id: line.id,
        quantity: line.quantity,
        variantId: lineVariantId,
        duplicateIds: [],
      })
      continue
    }

    existing.duplicateIds.push(line.id)
  }

  for (const [sourceId, current] of Array.from(existingBySource.entries())) {
    for (const duplicateId of current.duplicateIds) {
      await sdk.store.cart.deleteLineItem(
        previewCartId,
        duplicateId,
        {},
        headers
      )
    }

    const desired = desiredBySource.get(sourceId)
    if (!desired) {
      await sdk.store.cart.deleteLineItem(
        previewCartId,
        current.id,
        {},
        headers
      )
      continue
    }

    if (current.variantId !== desired.variantId) {
      await sdk.store.cart.deleteLineItem(
        previewCartId,
        current.id,
        {},
        headers
      )
      await sdk.store.cart.createLineItem(
        previewCartId,
        {
          variant_id: desired.variantId,
          quantity: desired.quantity,
          metadata: {
            source_line_item_id: sourceId,
          },
        },
        {},
        headers
      )
      continue
    }

    if (current.quantity !== desired.quantity) {
      await sdk.store.cart.updateLineItem(
        previewCartId,
        current.id,
        { quantity: desired.quantity },
        {},
        headers
      )
    }
  }

  for (const [sourceId, desired] of Array.from(desiredBySource.entries())) {
    if (existingBySource.has(sourceId)) continue
    await sdk.store.cart.createLineItem(
      previewCartId,
      {
        variant_id: desired.variantId,
        quantity: desired.quantity,
        metadata: {
          source_line_item_id: sourceId,
        },
      },
      {},
      headers
    )
  }
}

export async function deleteShippingPreviewCart(cartId: string) {
  if (!cartId) return

  const headers = {
    ...(await getAuthHeaders()),
  }

  await sdk.client
    .fetch(`/store/carts/${cartId}`, {
      method: "DELETE",
      headers,
    })
    .catch(() => null)
}

export async function getShippingTotalForCartPreview(
  cartId: string
): Promise<number> {
  const pricing = await getCartPricingForPreview(cartId)
  return pricing.shippingTotal
}

export async function getCartPricingForPreview(cartId: string): Promise<{
  originalItemSubtotal: number
  itemSubtotal: number
  shippingTotal: number
  total: number
  membershipDiscount: number
  nonMembershipDiscount: number
}> {
  const cart = await retrieveCart(cartId, undefined, "no-store")
  if (!cart?.id) {
    return {
      originalItemSubtotal: 0,
      itemSubtotal: 0,
      shippingTotal: 0,
      total: 0,
      membershipDiscount: 0,
      nonMembershipDiscount: 0,
    }
  }

  const getOriginalSubtotalFromItems = (target: HttpTypes.StoreCart) => {
    return (target.items ?? []).reduce((sum, item) => {
      if (typeof item.original_total === "number")
        return sum + item.original_total
      const compareAt =
        typeof item.compare_at_unit_price === "number"
          ? item.compare_at_unit_price
          : null
      const unit = typeof item.unit_price === "number" ? item.unit_price : 0
      return (
        sum +
        (compareAt != null && compareAt > 0 ? compareAt : unit) * item.quantity
      )
    }, 0)
  }

  const toPricing = (target: HttpTypes.StoreCart, fallbackShipping = 0) => {
    const itemSubtotal = target.item_subtotal ?? 0
    const shippingTotal = target.shipping_total ?? fallbackShipping
    const total = target.total ?? Math.max(0, itemSubtotal + shippingTotal)
    const originalItemSubtotal =
      target.original_item_subtotal ??
      target.original_item_total ??
      getOriginalSubtotalFromItems(target) ??
      itemSubtotal

    const membershipDiscount = Math.max(0, originalItemSubtotal - itemSubtotal)
    const totalDiscountAll = Math.max(
      0,
      originalItemSubtotal + shippingTotal - total
    )
    const nonMembershipDiscount = Math.max(
      0,
      totalDiscountAll - membershipDiscount
    )

    return {
      originalItemSubtotal,
      itemSubtotal,
      shippingTotal,
      total,
      membershipDiscount,
      nonMembershipDiscount,
    }
  }

  if (cart.shipping_methods?.length) {
    return toPricing(cart)
  }

  const options = await listCartShippingMethods(cart.id, "no-store")
  const shippingMethods = selectShippingOptionsForCart(options, cart.items)
  const standardOption = shippingMethods[0]
  if (!standardOption) {
    throw new Error(
      "배송이 필요한 상품에 적용 가능한 표준 배송 옵션이 없습니다."
    )
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  await sdk.store.cart.addShippingMethod(
    cart.id,
    { option_id: standardOption.id },
    {},
    headers
  )

  const recalculated = await retrieveCart(cart.id, undefined, "no-store")
  if (!recalculated) {
    return toPricing(cart, standardOption.amount ?? 0)
  }

  return toPricing(recalculated, standardOption.amount ?? 0)
}

export async function updateLineItem({
  lineId,
  quantity,
  cartId,
}: {
  lineId: string
  quantity: number
  cartId?: string
}) {
  if (!lineId) {
    throw new Error("Missing lineItem ID when updating line item")
  }

  const targetCartId = cartId || (await getCartId())

  if (!targetCartId) {
    throw new Error("Missing cart ID when updating line item")
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  await sdk.store.cart
    .updateLineItem(targetCartId, lineId, { quantity }, {}, headers)
    .then(async () => {
      const cartCacheTag = await getCacheTag("carts")
      revalidateTag(cartCacheTag)

      const fulfillmentCacheTag = await getCacheTag("fulfillment")
      revalidateTag(fulfillmentCacheTag)
    })
    .catch(medusaError)
}

export async function deleteLineItem(lineId: string, cartId?: string) {
  if (!lineId) {
    throw new Error("Missing lineItem ID when deleting line item")
  }

  const targetCartId = cartId || (await getCartId())

  if (!targetCartId) {
    throw new Error("Missing cart ID when deleting line item")
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  await sdk.store.cart
    .deleteLineItem(targetCartId, lineId, {}, headers)
    .then(async () => {
      const cartCacheTag = await getCacheTag("carts")
      revalidateTag(cartCacheTag)

      const fulfillmentCacheTag = await getCacheTag("fulfillment")
      revalidateTag(fulfillmentCacheTag)
    })
    .catch(medusaError)
}

/**
 * 여러 line item을 한 번에 삭제합니다 (batch delete)
 * @param lineIds 삭제할 line item ID 배열
 */
export async function deleteLineItems(lineIds: string[]) {
  if (!lineIds || lineIds.length === 0) {
    return
  }

  const cartId = await getCartId()

  if (!cartId) {
    throw new Error("Missing cart ID when deleting line items")
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  await sdk.client
    .fetch<{ cart: HttpTypes.StoreCart; deleted_count: number }>(
      `/store/carts/${cartId}/line-items/batch`,
      {
        method: "POST",
        headers,
        body: { ids: lineIds },
      }
    )
    .then(async () => {
      const cartCacheTag = await getCacheTag("carts")
      revalidateTag(cartCacheTag)

      const fulfillmentCacheTag = await getCacheTag("fulfillment")
      revalidateTag(fulfillmentCacheTag)
    })
    .catch(medusaError)
}

export async function initiatePaymentSession(
  cart: HttpTypes.StoreCart,
  data: HttpTypes.StoreInitializePaymentSession
) {
  const headers = {
    ...(await getAuthHeaders()),
  }

  return sdk.store.payment
    .initiatePaymentSession(cart, data, {}, headers)
    .then(async (resp) => {
      const cartCacheTag = await getCacheTag("carts")
      revalidateTag(cartCacheTag)
      return resp
    })
    .catch(medusaError)
}

export async function applyPromotions(codes: string[]) {
  const cartId = await getCartId()

  if (!cartId) {
    throw new Error("No existing cart found")
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  return sdk.store.cart
    .update(cartId, { promo_codes: codes }, {}, headers)
    .then(async () => {
      const cartCacheTag = await getCacheTag("carts")
      revalidateTag(cartCacheTag)

      const fulfillmentCacheTag = await getCacheTag("fulfillment")
      revalidateTag(fulfillmentCacheTag)
    })
    .catch(medusaError)
}

// export async function applyGiftCard(code: string) {
//   const cartId = getCartId()
//   if (!cartId) return "No cartId cookie found"
//   try {
//     await updateCart(cartId, { gift_cards: [{ code }] }).then(() => {
//       revalidateTag("cart")
//     })
//   } catch (error: any) {
//     throw error
//   }
// }

// export async function removeDiscount(code: string) {
// const cartId = getCartId()
// if (!cartId) return "No cartId cookie found"
// try {
//   await deleteDiscount(cartId, code)
//   revalidateTag("cart")
// } catch (error: any) {
//   throw error
// }
// }

// export async function removeGiftCard(
//   codeToRemove: string,
//   giftCards: any[]
// giftCards: GiftCard[]
//) {
//   const cartId = getCartId()
//   if (!cartId) return "No cartId cookie found"
//   try {
//     await updateCart(cartId, {
//       gift_cards: [...giftCards]
//         .filter((gc) => gc.code !== codeToRemove)
//         .map((gc) => ({ code: gc.code })),
//     }).then(() => {
//       revalidateTag("cart")
//     })
//   } catch (error: any) {
//     throw error
//   }
//}

export async function submitPromotionForm(
  // currentState: unknown,
  formData: FormData
) {
  const code = formData.get("code") as string
  try {
    await applyPromotions([code])
  } catch (e: any) {
    return e.message
  }
}

// TODO: Pass a POJO instead of a form entity here
export async function setAddresses(formData: FormData) {
  try {
    if (!formData) {
      throw new Error("No form data found when setting addresses")
    }
    const cartId = await getCartId()
    if (!cartId) {
      throw new Error("No existing cart found when setting addresses")
    }

    const data = {
      shipping_address: {
        first_name: formData.get("shipping_address.first_name"),
        last_name: formData.get("shipping_address.last_name"),
        address_1: formData.get("shipping_address.address_1"),
        address_2: "",
        company: formData.get("shipping_address.company"),
        postal_code: formData.get("shipping_address.postal_code"),
        city: formData.get("shipping_address.city"),
        country_code: formData.get("shipping_address.country_code"),
        province: formData.get("shipping_address.province"),
        phone: formData.get("shipping_address.phone"),
      },
      email: formData.get("email"),
    } as any

    const sameAsBilling = formData.get("same_as_billing")
    if (sameAsBilling === "on") data.billing_address = data.shipping_address

    if (sameAsBilling !== "on")
      data.billing_address = {
        first_name: formData.get("billing_address.first_name"),
        last_name: formData.get("billing_address.last_name"),
        address_1: formData.get("billing_address.address_1"),
        address_2: "",
        company: formData.get("billing_address.company"),
        postal_code: formData.get("billing_address.postal_code"),
        city: formData.get("billing_address.city"),
        country_code: formData.get("billing_address.country_code"),
        province: formData.get("billing_address.province"),
        phone: formData.get("billing_address.phone"),
      }
    await updateCart(data)
  } catch (e: any) {
    return e.message
  }

  redirect(
    `/${formData.get("shipping_address.country_code")}/checkout?step=delivery`
  )
}

/**
 * 장바구니(Cart)를 주문(Order) 상태로 전환합니다. 만약 장바구니 ID가 제공되지 않으면, 쿠키에 저장된 ID를 사용합니다.
 * @param cartId (선택 사항) - 주문 처리할 장바구니의 ID입니다.
 * @returns 주문이 성공적으로 완료되면 카트 객체를 반환하고, 실패하면 null을 반환합니다.
 * */
export async function placeOrder(cartId?: string) {
  const id = cartId || (await getCartId())

  if (!id) {
    throw new Error("No existing cart found when placing an order")
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  const cartRes = await sdk.store.cart
    .complete(id, {}, headers)
    .then(async (cartRes) => {
      const cartCacheTag = await getCacheTag("carts")
      revalidateTag(cartCacheTag)
      return cartRes
    })
    .catch(medusaError)

  if (cartRes?.type === "order") {
    const countryCode =
      cartRes.order.shipping_address?.country_code?.toLowerCase()

    const orderCacheTag = await getCacheTag("orders")
    revalidateTag(orderCacheTag)

    await removeCartId()
    redirect(`/${countryCode}/order/${cartRes?.order.id}/confirmed`)
  }

  return cartRes.cart
}

/**
 * Updates the countrycode param and revalidates the regions cache
 * @param regionId
 * @param countryCode
 */
export async function updateRegion(countryCode: string, currentPath: string) {
  const cartId = await getCartId()
  const region = await getRegion(countryCode)

  if (!region) {
    throw new Error(`Region not found for country code: ${countryCode}`)
  }

  if (cartId) {
    await updateCart({ region_id: region.id })
    const cartCacheTag = await getCacheTag("carts")
    revalidateTag(cartCacheTag)
  }

  const regionCacheTag = await getCacheTag("regions")
  revalidateTag(regionCacheTag)

  const productsCacheTag = await getCacheTag("products")
  revalidateTag(productsCacheTag)

  redirect(`/${countryCode}${currentPath}`)
}
// {shipping_methods.map((method) => (
//   <li key={method.id}>
//     <span>{method.name}</span>
//     {/* 최종 배송비 */}
//     <span>{formatPrice(method.total!)}</span>
//     {/* 원래 배송비 */}
//     <span>(Subtotal: {formatPrice(method.subtotal!)})</span>
//     {/* 배송비 할인 */}
//     <span>(Discounts: {formatPrice(method.discount_total!)})</span>
//   </li>
// ))}

export const addCartShippingMethod = async (
  cartId: string,
  optionId: string
) => {
  const headers = {
    ...(await getAuthHeaders()),
  }

  return sdk.store.cart
    .addShippingMethod(cartId, { option_id: optionId }, {}, headers)
    .then(async ({ cart }: { cart: HttpTypes.StoreCart }) => {
      const cartCacheTag = await getCacheTag("carts")
      revalidateTag(cartCacheTag)

      const fulfillmentCacheTag = await getCacheTag("fulfillment")
      revalidateTag(fulfillmentCacheTag)

      return cart
    })
    .catch(medusaError)
}

/**
 * 서버 컴포넌트 렌더 중 호출용: revalidateTag 없이 shipping method만 추가합니다.
 * revalidateTag는 렌더 중 호출 불가 (Next.js 제약)이므로 이 함수를 사용하세요.
 */
/**
 * 카트의 배송수단을 주어진 옵션들로 통째로 교체한다.
 * (커스텀 라우트 POST /store/carts/:id/shipping-methods/bulk)
 *
 * Medusa 기본 라우트는 option_id 를 하나만 받고, 내부 워크플로가 기존 배송수단을 전부 지운 뒤
 * 새로 만든다. 그래서 배송비 그룹이 2개 이상인 카트는 순차 호출로 붙일 수 없다.
 */
export const setCartShippingMethods = async (
  cartId: string,
  optionIds: string[]
) => {
  const headers = {
    ...(await getAuthHeaders()),
  }

  const post = () =>
    sdk.client
      .fetch<{ cart: HttpTypes.StoreCart }>(
        `/store/carts/${cartId}/shipping-methods/bulk`,
        {
          method: "POST",
          body: { option_ids: optionIds },
          query: { fields: DEFAULT_CART_FIELDS },
          headers,
        }
      )
      .then(({ cart }) => cart)

  // 같은 카트를 만지는 다른 요청과 겹쳤을 뿐이면 한 번 더 건다.
  // 그냥 던지면 장바구니·체크아웃이 통째로 500 이 된다.
  return withCartConflictRetry(post).catch(medusaError)
}

export const addCartShippingMethodDuringRender = async (
  cartId: string,
  optionIds: string[]
) => setCartShippingMethods(cartId, optionIds)

/**
 * 카트의 모든 배송 method 를 제거한다. (커스텀 라우트 DELETE /store/carts/:id/shipping-methods)
 * 물리→디지털 단독으로 바뀐 카트에 남은 배송 method 가 Medusa total 에 배송비를 더해
 * 결제 금액이 틀어지는 것을 막는다.
 */
export const clearCartShippingMethods = async (cartId: string) => {
  const headers = {
    ...(await getAuthHeaders()),
  }

  return sdk.client
    .fetch<{ cart: HttpTypes.StoreCart; deleted_count: number }>(
      `/store/carts/${cartId}/shipping-methods`,
      {
        method: "DELETE",
        headers,
      }
    )
    .then(({ cart }) => cart)
    .catch(() => null)
}

export const listCartShippingMethods = async (
  cartId: string,
  cache: RequestCache = "no-store"
) => {
  const headers = {
    ...(await getAuthHeaders()),
  }

  const next = {
    ...(await getCacheOptions("fulfillment")),
  }

  return sdk.client
    .fetch<HttpTypes.StoreShippingOptionListResponse>(
      `/store/shipping-options`,
      {
        method: "GET",
        query: {
          cart_id: cartId,
          fields: "id,name,amount,type,shipping_profile_id",
        },
        headers,
        next,
        cache,
      }
    )
    .then(({ shipping_options }) => shipping_options)
    .catch(() => {
      return null
    })
}

/**
 * 장바구니의 requires_shipping 값에 따라 필요한 경우에만 표준 배송 옵션을 자동 설정합니다.
 * @param cart - 장바구니 객체 (items 포함 필수)
 * @returns 업데이트된 cart와 필터링된 배송 옵션
 */
export async function ensureCorrectShippingMethod(
  cart: HttpTypes.StoreCart,
  /**
   * 배송수단 구성이 이미 맞더라도 다시 붙인다. 붙이는 순간 서버가 배송비를 다시 계산하므로,
   * 어드민이 배송비 그룹 금액을 고친 뒤에도 최신 금액으로 맞춰진다.
   *
   * 결제 금액을 확정하기 직전(체크아웃 진입)에만 켠다. 결제가 끝난 뒤에 켜면 이미 결제한 금액과
   * 주문 금액이 어긋난다.
   */
  options?: { refreshAmounts?: boolean }
): Promise<{
  cart: HttpTypes.StoreCart
  shippingMethods: HttpTypes.StoreCartShippingOption[] | null
  requiresShipping: boolean
}> {
  // 1. 이 카트에 적용 가능한 배송 옵션 조회.
  // 캐시하면 안 된다 — 응답이 **카트 내용에 따라 달라진다**. Medusa 는 카트에 담긴 상품의
  // shipping profile 에 해당하는 옵션만 돌려주므로, 배송비 그룹이 다른 상품을 담으면 목록이
  // 바뀐다. 캐시된 옛 목록을 보면 새로 담은 그룹의 배송비가 영영 안 붙는다.
  const allShippingMethods = await listCartShippingMethods(cart.id, "no-store")

  const requiresShipping = cartRequiresShipping(cart.items)
  const shippingMethods = selectShippingOptionsForCart(
    allShippingMethods,
    cart.items
  ) as HttpTypes.StoreCartShippingOption[]

  if (!requiresShipping) {
    // 디지털 단독(배송 불필요) 카트에 이전 물리 상품 때 설정된 배송 method 가 남아 있으면
    // Medusa total 에 배송비가 포함돼 결제 금액이 틀어진다. 남은 method 를 제거한다.
    if (cart.shipping_methods?.length) {
      const cleared = await clearCartShippingMethods(cart.id)
      return {
        cart: cleared ?? cart,
        shippingMethods: [],
        requiresShipping,
      }
    }
    return { cart, shippingMethods: [], requiresShipping }
  }

  // 4. 배송 옵션 자동 설정/업데이트
  // 배송비 그룹마다 배송수단이 하나씩 있어야 하므로, 현재 붙은 것들이 목표 집합과
  // 정확히 일치하지 않으면 통째로 다시 설정한다.
  const alreadyCorrect = shippingMethodsMatchOptions(
    cart.shipping_methods?.map((method) => ({
      shipping_option_id: method.shipping_option_id,
      amount: method.amount,
    })),
    shippingMethods
  )

  if (shippingMethods.length > 0 && (!alreadyCorrect || options?.refreshAmounts)) {
    const updatedCart = await setCartShippingMethods(
      cart.id,
      shippingMethods.map((option) => option.id)
    )
    if (updatedCart) {
      return { cart: updatedCart, shippingMethods, requiresShipping }
    }
  }

  return { cart, shippingMethods, requiresShipping }
}

export async function setShippingMethod({
  cartId,
  shippingMethodId,
}: {
  cartId: string
  shippingMethodId: string
}) {
  const headers = {
    ...(await getAuthHeaders()),
  }

  return sdk.store.cart
    .addShippingMethod(cartId, { option_id: shippingMethodId }, {}, headers)
    .then(async () => {
      const cartCacheTag = await getCacheTag("carts")
      revalidateTag(cartCacheTag)
    })
    .catch(medusaError)
}

export async function listCartOptions() {
  const cartId = await getCartId()
  const headers = {
    ...(await getAuthHeaders()),
  }
  const next = {
    ...(await getCacheOptions("shippingOptions")),
  }

  return await sdk.client.fetch<{
    shipping_options: HttpTypes.StoreCartShippingOption[]
  }>("/store/shipping-options", {
    query: { cart_id: cartId },
    next,
    headers,
    cache: "force-cache",
  })
}

/** 카트 캐시만 무효화. 해지 시 사용 (Medusa DB 갱신은 채널 어댑터가 처리). */
export async function invalidateCartCache(): Promise<void> {
  const cartCacheTag = await getCacheTag("carts")
  revalidateTag(cartCacheTag)
}

export type CartRefreshResult = {
  refreshed: boolean
  /** 현재 고객이 멤버십 그룹에 속해 있는지 여부
   *  - true:  그룹 반영 완료
   *  - false: 아직 미반영
   *  - null:  활성 카트 없음 (폴링 불필요)
   */
  hasMembershipGroup: boolean | null
}

const EMPTY_REFRESH_RESULT: CartRefreshResult = {
  refreshed: false,
  hasMembershipGroup: null,
}

async function requestCartPriceRefresh(): Promise<CartRefreshResult> {
  const headers = await getAuthHeaders()

  // 비로그인은 이 엔드포인트가 401 만 돌려준다. 부르지 않는다.
  if (!headers) {
    return EMPTY_REFRESH_RESULT
  }

  try {
    const result = await sdk.client.fetch<{
      refreshed: boolean
      hasMembershipGroup?: boolean | null
    }>("/store/customers/me/refresh-cart-prices", { method: "POST", headers })

    return {
      refreshed: Boolean(result.refreshed),
      hasMembershipGroup: result.hasMembershipGroup ?? null,
    }
  } catch (error) {
    console.error("[refreshCartPrices] 실패:", error)
    return EMPTY_REFRESH_RESULT
  }
}

// 카트 가격 재계산 + 캐시 무효화
export async function refreshCartPrices(): Promise<CartRefreshResult> {
  try {
    return await requestCartPriceRefresh()
  } finally {
    const cartCacheTag = await getCacheTag("carts")
    if (cartCacheTag) {
      revalidateTag(cartCacheTag)
    }
  }
}

/**
 * 이 재계산이 필요한 건 멤버십 상태가 바뀌었을 때다. 그 상태가 그대로면 다시 부를 이유가 없어
 * (카트 id, 멤버십 여부) 별로 최근에 한 번 돌렸는지 기억해 건너뛴다.
 *
 * 렌더 중에는 쿠키를 쓸 수 없어 프로세스 메모리에 둔다. 인스턴스가 바뀌면 한 번 더 돌 뿐이고,
 * 멤버십이 바뀌면 키가 달라져 즉시 다시 돈다. 관리자가 가격을 직접 고친 경우만 최대 TTL 만큼
 * 늦게 반영된다.
 */
const PRICE_REFRESH_TTL_MS = 10 * 60 * 1000
const priceRefreshThrottle = createRefreshThrottle(PRICE_REFRESH_TTL_MS)

/**
 * 렌더 중에 부를 수 있는 가격 재계산. revalidateTag 는 부르지 않는다 (렌더 도중 호출은 금지).
 *
 * 카트를 읽기 **전에** 순차로 돌리는 용도다. 예전처럼 클라이언트에서 재계산을 걸고
 * router.refresh 로 다시 그리면, 그 재계산과 다음 렌더의 배송수단 정합이 같은 카트를 동시에
 * 고쳐 경합이 났다. 다만 이 호출이 카트 조회 앞을 막고 서기 때문에, 매 렌더마다 돌리면
 * 그대로 TTFB 가 된다. 필요할 때만 돌린다.
 */
export async function refreshCartPricesDuringRender(): Promise<CartRefreshResult> {
  const headers = await getAuthHeaders()
  if (!headers) return EMPTY_REFRESH_RESULT

  const cartId = await getCartId()
  if (!cartId) return EMPTY_REFRESH_RESULT

  const isMember = await getIsMembershipCustomer()
  if (!priceRefreshThrottle.take(`${cartId}:${isMember ? "mem" : "reg"}`)) {
    return EMPTY_REFRESH_RESULT
  }

  return requestCartPriceRefresh()
}
