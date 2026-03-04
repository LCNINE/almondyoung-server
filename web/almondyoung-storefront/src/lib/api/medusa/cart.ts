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
import { HttpTypes } from "@medusajs/types"
import { revalidateTag } from "next/cache"
import { redirect } from "next/navigation"
import { HttpApiError } from "../api-error"
import { getRegion } from "./regions"
import { retrieveCustomer, transferCart } from "./customer"

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
  fields ??=
    "*items, *region, *items.product, *items.variant, +items.variant.inventory_quantity, +items.variant.manage_inventory, *items.thumbnail, *items.metadata, +items.total, *promotions, +shipping_methods, *customer, *customer.groups, customer_id, +payment_collection.id"

  if (!id) {
    return null
  }

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
        fields,
      },
      headers,
      next,
      cache,
    })
    .then(({ cart }: { cart: HttpTypes.StoreCart }) => cart)
    .catch(async (error) => {
      if (error?.response?.status === 404) {
        await removeCartId()
      }
      return null
    })
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
}): Promise<{ cartId: string }> {
  if (!variantId) {
    throw new HttpApiError(
      "Missing variant ID when adding to cart",
      400,
      "BAD_REQUEST"
    )
  }

  const cart = await getOrSetCart(countryCode)

  if (!cart) {
    throw new HttpApiError(
      "Error retrieving or creating cart",
      400,
      "BAD_REQUEST"
    )
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  return await sdk.store.cart
    .createLineItem(
      cart.id,
      {
        variant_id: variantId,
        quantity,
      },
      {},
      headers
    )
    .then(async () => {
      const cartCacheTag = await getCacheTag("carts")
      revalidateTag(cartCacheTag)

      const fulfillmentCacheTag = await getCacheTag("fulfillment")
      revalidateTag(fulfillmentCacheTag)

      return { cartId: cart.id }
    })
    .catch(medusaError)
}

export async function createBuyNowCart(params: {
  countryCode: string
  items: Array<{
    variantId: string
    quantity: number
  }>
}): Promise<{ cartId: string }> {
  const { countryCode, items } = params

  if (!items.length) {
    throw new HttpApiError("No line items for buy now", 400, "BAD_REQUEST")
  }

  const region = await getRegion(countryCode)

  if (!region) {
    throw new Error(`Region not found for country code: ${countryCode}`)
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

  for (const item of items) {
    if (!item.variantId) {
      throw new HttpApiError(
        "Missing variant ID when creating buy-now cart",
        400,
        "BAD_REQUEST"
      )
    }

    await sdk.store.cart.createLineItem(
      cart.id,
      {
        variant_id: item.variantId,
        quantity: item.quantity,
      },
      {},
      headers
    )
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
}): Promise<{ cartId: string }> {
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
    "id,region_id,*items,*items.variant"
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
    try {
      await sdk.store.cart.transferCart(checkoutCart.id, {}, headers)
    } catch (error) {
      console.error("Checkout cart transfer failed:", error)
    }
  }

  for (const item of selectedItems) {
    const variantId = item.variant_id || item.variant?.id
    if (!variantId) {
      throw new HttpApiError(
        "Missing variant ID when creating checkout cart",
        400,
        "BAD_REQUEST"
      )
    }

    await sdk.store.cart.createLineItem(
      checkoutCart.id,
      {
        variant_id: variantId,
        quantity: item.quantity,
      },
      {},
      headers
    )
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
    "id,region_id,*items,*items.variant"
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
  items: Array<{ sourceLineItemId: string; variantId: string; quantity: number }>
}) {
  const { previewCartId, items } = params

  const normalizedItems = items
    .filter((item) => item.sourceLineItemId && item.variantId && item.quantity > 0)
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
      query: { fields: "id,*items,*items.variant,*items.metadata,+shipping_methods" },
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
    const sourceId = typeof sourceLineItemId === "string" ? sourceLineItemId : null

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
      await sdk.store.cart.deleteLineItem(previewCartId, duplicateId, {}, headers)
    }

    const desired = desiredBySource.get(sourceId)
    if (!desired) {
      await sdk.store.cart.deleteLineItem(previewCartId, current.id, {}, headers)
      continue
    }

    if (current.variantId !== desired.variantId) {
      await sdk.store.cart.deleteLineItem(previewCartId, current.id, {}, headers)
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

  for (const [sourceId, desired] of Array.from(
    desiredBySource.entries()
  )) {
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
  const cart = await retrieveCart(cartId, undefined, "no-store")
  if (!cart?.id) return 0

  if (cart.shipping_methods?.length) {
    return cart.shipping_total ?? 0
  }

  const options = await listCartShippingMethods(cart.id, "no-store")
  const firstOption = options?.[0]
  if (!firstOption) {
    return cart.shipping_total ?? 0
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  await sdk.store.cart.addShippingMethod(
    cart.id,
    { option_id: firstOption.id },
    {},
    headers
  )

  const recalculated = await retrieveCart(cart.id, undefined, "no-store")
  return recalculated?.shipping_total ?? firstOption.amount ?? 0
}

export async function updateLineItem({
  lineId,
  quantity,
}: {
  lineId: string
  quantity: number
}) {
  if (!lineId) {
    throw new Error("Missing lineItem ID when updating line item")
  }

  const cartId = await getCartId()

  if (!cartId) {
    throw new Error("Missing cart ID when updating line item")
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  await sdk.store.cart
    .updateLineItem(cartId, lineId, { quantity }, {}, headers)
    .then(async () => {
      const cartCacheTag = await getCacheTag("carts")
      revalidateTag(cartCacheTag)

      const fulfillmentCacheTag = await getCacheTag("fulfillment")
      revalidateTag(fulfillmentCacheTag)
    })
    .catch(medusaError)
}

export async function deleteLineItem(lineId: string) {
  if (!lineId) {
    throw new Error("Missing lineItem ID when deleting line item")
  }

  const cartId = await getCartId()

  if (!cartId) {
    throw new Error("Missing cart ID when deleting line item")
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  await sdk.store.cart
    .deleteLineItem(cartId, lineId, {}, headers)
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
export const addCartShippingMethodDuringRender = async (
  cartId: string,
  optionId: string
) => {
  const headers = {
    ...(await getAuthHeaders()),
  }

  return sdk.store.cart
    .addShippingMethod(cartId, { option_id: optionId }, {}, headers)
    .then(({ cart }: { cart: HttpTypes.StoreCart }) => cart)
    .catch(medusaError)
}

export const listCartShippingMethods = async (
  cartId: string,
  cache: RequestCache = "force-cache"
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
