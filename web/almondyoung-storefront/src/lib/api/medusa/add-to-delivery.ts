"use server"

import { sdk } from "@/lib/config/medusa"
import { getAuthHeaders, getCacheTag } from "@lib/data/cookies"
import { revalidateTag } from "next/cache"
import { ApiAuthError } from "../api-error"

export type AddToDeliveryParent = {
  orderId: string
  displayId: number
  createdAt: string
  address: {
    name: string
    phone: string
    postalCode: string
    address1: string
    address2: string
  }
}

export type AddToDeliveryLink = {
  parentOrderId: string | null
  parentDisplayId: number | null
  parentCanceled: boolean
  /** 부모만 취소했을 때 부모 환불에서 실제로 뺀 금액 */
  parentWithheldAmount: number
  children: string[]
  waivedAmount: number
  withheldAmount: number
}

type ParentsResponse = {
  parents: Array<{
    order_id: string
    display_id: number
    created_at: string
    address: {
      name: string
      phone: string
      postal_code: string
      address_1: string
      address_2: string
    }
  }>
}

type LinksResponse = {
  links: Record<
    string,
    {
      parent_order_id: string | null
      parent_display_id: number | null
      parent_canceled: boolean
      parent_withheld_amount: number
      children: string[]
      waived_amount: number
      withheld_amount: number
    }
  >
}

/** 상품 상세 함께 받기 버튼: 이 상품을 붙일 수 있는 출고 전 주문. 비로그인·오류면 빈 목록이다. */
export async function listAddToDeliveryParents(
  productId: string
): Promise<AddToDeliveryParent[]> {
  const headers: Record<string, string> = { ...(await getAuthHeaders()) }
  if (!headers.authorization) return []

  try {
    const res = await sdk.client.fetch<ParentsResponse>(
      "/store/add-to-delivery/parents",
      { method: "GET", query: { product_id: productId }, headers }
    )

    return res.parents.map((p) => ({
      orderId: p.order_id,
      displayId: p.display_id,
      createdAt: p.created_at,
      address: {
        name: p.address.name,
        phone: p.address.phone,
        postalCode: p.address.postal_code,
        address1: p.address.address_1,
        address2: p.address.address_2,
      },
    }))
  } catch {
    return []
  }
}

/** 부모 배송지가 복사된 함께 배송 카트를 만들고 고른 상품을 일반 담기 경로로 넣는다. */
export async function createAddToDeliveryCart(input: {
  parentOrderId: string
  items: Array<{
    variantId: string
    quantity: number
    metadata?: Record<string, unknown>
  }>
}): Promise<
  { cartId: string; error?: never } | { cartId?: never; error: string }
> {
  const first = input.items[0]
  if (!first) return { error: "No line items" }

  const headers: Record<string, string> = { ...(await getAuthHeaders()) }

  try {
    const { cart_id } = await sdk.client.fetch<{ cart_id: string }>(
      "/store/add-to-delivery/carts",
      {
        method: "POST",
        body: {
          parent_order_id: input.parentOrderId,
          variant_id: first.variantId,
        },
        headers,
      }
    )

    for (const item of input.items) {
      await sdk.client.fetch(`/store/carts/${cart_id}/add-line-item`, {
        method: "POST",
        body: {
          variant_id: item.variantId,
          quantity: item.quantity,
          metadata: item.metadata,
        },
        headers,
      })
    }

    revalidateTag(await getCacheTag("carts"))
    revalidateTag(await getCacheTag("fulfillment"))

    return { cartId: cart_id }
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string }
    // 401 은 UNAUTHORIZED digest 로 던져 error.tsx 의 토큰 복구를 태운다
    if (e?.status === 401) throw new ApiAuthError()

    return { error: String(e?.message ?? "add-to-delivery failed") }
  }
}

/** 결제 순간 부모가 출고돼 막힌 카트를 일반 주문으로 바꾼다 — 부모 연결을 지우면 배송비가 다시 붙는다. */
export async function convertAddToDeliveryCartToNormal(cartId: string) {
  const headers: Record<string, string> = { ...(await getAuthHeaders()) }

  await sdk.store.cart
    .update(
      cartId,
      {
        metadata: { cart_kind: "buy_now", add_to_delivery_parent_order_id: null },
      },
      {},
      headers
    )
    .catch((err: { status?: number }) => {
      if (err?.status === 401) throw new ApiAuthError()

      throw err
    })

  revalidateTag(await getCacheTag("carts"))
  revalidateTag(await getCacheTag("fulfillment"))
}

/** 마이페이지: 주문마다 함께 배송 연결과 면제·차감 금액. 오류면 빈 값이다. */
export async function getAddToDeliveryLinks(
  orderIds: string[]
): Promise<Record<string, AddToDeliveryLink>> {
  if (orderIds.length === 0) return {}

  const headers: Record<string, string> = { ...(await getAuthHeaders()) }

  try {
    const res = await sdk.client.fetch<LinksResponse>(
      "/store/add-to-delivery/links",
      {
        method: "GET",
        query: { order_ids: orderIds.slice(0, 20).join(",") },
        headers,
      }
    )

    return Object.fromEntries(
      Object.entries(res.links).map(([id, l]) => [
        id,
        {
          parentOrderId: l.parent_order_id,
          parentDisplayId: l.parent_display_id,
          parentCanceled: l.parent_canceled,
          parentWithheldAmount: l.parent_withheld_amount,
          children: l.children,
          waivedAmount: l.waived_amount,
          withheldAmount: l.withheld_amount,
        },
      ])
    )
  } catch {
    return {}
  }
}
